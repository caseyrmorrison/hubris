// ---------------------------------------------------------------------------
// Game orchestrator: run/chamber lifecycle, stats & bracket damage math,
// XP/level-ups, boon & level-up & shop & pom choice generation, door rewards,
// endless mode, meta banking + unlocks.
// Per-frame entity simulation lives in combat.ts; drawing in render.ts.
// ---------------------------------------------------------------------------
import { Camera } from '../engine/camera';
import type { AudioSys } from '../engine/audio';
import { Particles } from '../engine/particles';
import { SpatialHash } from '../engine/spatial';
import { choice, fmt, rand, randInt, TAU, weightedPick } from '../engine/math';
import {
  BOON_DEFS, BOSSES, CHAMBER_COUNT, CHAOS_MODS, CHARACTERS, ENEMY_DEFS,
  FATE_COLOR, MANA_SHIELD, TOME_DEFS, TOME_MAX_LEVEL, TOWER_DEFS, WEAPON_DEFS,
  WEAPON_MAX_LEVEL, LEGENDARY_COLOR, biomeIndex, boonDef, bossHPFor,
  chamberQuota, characterDef, enemyDmgScale, enemyHPScale, isBossChamber,
  isTwinBossChamber, rollRarity, skinUnlocked, towerDef, weaponDef,
  weaponUnlocked, xpForLevel,
  type SkinDef,
} from './data';
import {
  applyMirrorToStats, charStatsFor, defaultSave, heatLevel, loadSave,
  mirrorLevel, persistSave, totalHeat, type SaveData,
} from './meta';
import {
  emptyChaosMods, emptyMods, GOD_NAME, RARITY_MULT,
  type ActiveBuff, type BossVariant, type BuffKind, type ChaosModTotals,
  type CharacterId, type CinderPatch, type TakenFate,
  type DamageNumber, type DelayedHit, type Door, type EliteMod, type Enemy,
  type GodId, type LightningFx, type Mods, type OwnedBoon, type OwnedWeapon,
  type Chest, type Pickup, type Pillar, type Projectile, type Rarity,
  type RewardKind, type RunTotals, type ShockwaveFx, type ShopItem, type Stats,
  type Telegraph, type Tower, type Trap,
} from './types';
import { spawnBoss, updateCombat } from './combat';

export type GamePhase = 'combat' | 'cleared' | 'transition' | 'bossIntro' | 'over';

/** Structural input interface so headless tests can drive the game. */
export interface InputSource {
  mouseX: number;
  mouseY: number;
  mouseDown: boolean;
  padConnected: boolean;
  padAimActive: boolean;
  padAimX: number;
  padAimY: number;
  padFire: boolean;
  // Touch (virtual sticks + dash button)
  touchActive: boolean;
  touchAimHeld: boolean;
  touchMoveX: number;
  touchMoveY: number;
  touchStickOX: number;
  touchStickOY: number;
  dashBtnX: number;
  dashBtnY: number;
  dashBtnR: number;
  keys: Set<string>;
  justPressed: Set<string>;
  axis(): { x: number; y: number };
  pressed(...codes: string[]): boolean;
  down(...codes: string[]): boolean;
  touchMoveHeld(): boolean;
}

export interface UIHooks {
  openLevelUp(): void;
  openBoon(god: GodId): void;
  openLegendary(): void;
  openShop(): void;
  openPom(): void;
  showToast(text: string, color?: string): void;
  openDeath(): void;
  openVictory(): void;
  syncMenus(): void;
}

export interface PlayerState {
  x: number; y: number;
  hp: number;
  shield: number;         // mage mana shield
  shieldRegenT: number;   // cooldown before regen resumes
  aim: number;            // radians toward mouse / right stick
  moveX: number; moveY: number;
  facingX: number; facingY: number;
  invulnT: number;
  hurtT: number;          // red vignette timer
  dashT: number;
  dashDirX: number; dashDirY: number;
  charges: number;
  rechargeT: number;
  strikeCd: number;
  strikeAnimT: number;
  strikeAngle: number;
  comboIdx: number;       // 0,1 = swings, 2 = finisher
  comboT: number;         // window before the combo resets
  lastFinisher: boolean;  // for render: was the last swing the finisher?
  walkT: number;          // walk-cycle phase
  defiancesUsed: number;  // Death Defiances spent this run
}

export interface LevelChoice {
  kind: 'weapon' | 'tome' | 'gold';
  id: string;
  toLevel: number;
  amount: number;
  name: string;
  desc: string;
  icon: string;
  color: string;
  tag: string;
}

export interface BoonChoice {
  id: string;
  rarity: Rarity | 'duo' | 'legendary';
  name: string;
  desc: string;
  color: string;
  godLabel: string;
}

export interface PomChoice {
  index: number;        // index into g.boons
  name: string;
  from: Rarity;
  to: Rarity;
  god: GodId;
}

export class Game {
  cam = new Camera();
  particles = new Particles();
  hash = new SpatialHash<Enemy>();
  audio: AudioSys;
  input: InputSource;
  ui!: UIHooks;

  save: SaveData;

  state: 'menu' | 'run' = 'menu';
  phase: GamePhase = 'combat';
  overlayOpen = false;
  character: CharacterId = 'warrior';

  // run state
  chamber = 1;
  quota = 0;
  killsInChamber = 0;
  chamberT = 0;
  runT = 0;
  hitStop = 0;
  transitionT = 0;
  private chamberSwitched = false;
  bannerT = 0;
  bannerText = '';
  endless = false;
  pendingVictoryT = 0;    // sim-time delay before the victory screen
  pendingClearT = 0;      // herald bosses: loot-vacuum breather before doors
  deathT = 0;             // player death animation timer

  arenaHalfW = 1000;
  arenaHalfH = 725;
  pillars: Pillar[] = [];
  doors: Door[] = [];
  towers: Tower[] = [];
  chests: Chest[] = [];
  traps: Trap[] = [];
  buffs: ActiveBuff[] = [];
  chaosMods: ChaosModTotals = emptyChaosMods();
  fates: TakenFate[] = [];
  private stormT = 0;

  player: PlayerState = this.freshPlayer();
  stats: Stats = this.baseStats();
  mods: Mods = emptyMods();
  frenzyStacks = 0;
  frenzyIdleT = 0;

  level = 1;
  xp = 0;
  xpNeeded = xpForLevel(1);
  pendingLevelUps = 0;
  weapons: OwnedWeapon[] = [];
  tomes: Record<string, number> = {};
  boons: OwnedBoon[] = [];
  gold = 0;
  ichorRun = 0;
  freeRerolls = 0;
  goldRerollsUsed = 0;
  totals: RunTotals = { kills: 0, damageDealt: 0, goldEarned: 0, ichorEarned: 0, peakHit: 0 };
  boonDoorPending = false; // picking a boon at a door -> transition afterwards
  shopItems: ShopItem[] = [];
  lastUnlocks: string[] = [];

  // incremental meta banking (endless mode banks more than once per run)
  private runEnded = false;
  private runCounted = false;
  private winCounted = false;
  private goldBonusBanked = 0;
  private killsBanked = 0;
  private dmgBanked = 0;
  private charRunCounted = false;
  private charWinCounted = false;
  private charKillsBanked = 0;

  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  pickups: Pickup[] = [];
  patches: CinderPatch[] = [];
  dmgNumbers: DamageNumber[] = [];
  lightning: LightningFx[] = [];
  shockwaves: ShockwaveFx[] = [];
  telegraphs: Telegraph[] = [];
  delayedHits: DelayedHit[] = [];

  spawnAccum = 0;
  eliteAliveCap = 2;
  private idCounter = 1;

  constructor(input: InputSource, audio: AudioSys) {
    this.input = input;
    this.audio = audio;
    this.save = loadSave();
    this.audio.muted = this.save.muted;
    this.audio.setSettings(this.save.settings);
    this.cam.shakeScale = this.save.settings.shake;
  }

  nextId(): number { return this.idCounter++; }

  applySettings(): void {
    this.audio.setSettings(this.save.settings);
    this.cam.shakeScale = this.save.settings.shake;
    persistSave(this.save);
  }

  /** Erase all meta progress and start from a factory-fresh save. */
  wipeSave(): void {
    this.save = defaultSave();
    persistSave(this.save);
    this.audio.setMuted(this.save.muted);
    this.applySettings();
    this.ui.syncMenus();
  }

  /** Replace the save with an imported one (from a save code). */
  adoptSave(save: SaveData): void {
    this.save = save;
    persistSave(save);
    this.audio.setMuted(save.muted);
    this.applySettings();
    this.ui.syncMenus();
  }

  setOverlayOpen(open: boolean): void {
    this.overlayOpen = open;
    this.audio.setDucked(open);
  }

  private freshPlayer(): PlayerState {
    return {
      x: 0, y: 300, hp: 100, shield: 0, shieldRegenT: 0, aim: -Math.PI / 2,
      moveX: 0, moveY: 0, facingX: 0, facingY: -1,
      invulnT: 0, hurtT: 0, dashT: 0, dashDirX: 0, dashDirY: -1,
      charges: 2, rechargeT: 0, strikeCd: 0, strikeAnimT: 0, strikeAngle: 0,
      comboIdx: 0, comboT: 0, lastFinisher: false, walkT: 0,
      defiancesUsed: 0,
    };
  }

  private baseStats(): Stats {
    return {
      maxHP: 100, might: 0, strikePct: 0, autoPct: 0, atkSpeed: 0, moveSpeed: 0,
      critChance: 0.05, critMult: 2, xpGain: 0, goldGain: 0, luck: 0,
      pickupRadius: 90, dashCharges: 2, dashRecharge: 1.3,
      armor: 0, vsElitePct: 0, killHeal: 0,
    };
  }

  // ------------------------------------------------------------------
  // Stats
  // ------------------------------------------------------------------

  recomputeStats(): void {
    const oldMax = this.stats?.maxHP ?? 100;
    const s = this.baseStats();
    applyMirrorToStats(this.save, s);
    for (const t of TOME_DEFS) {
      const lvl = this.tomes[t.id] ?? 0;
      if (lvl > 0) t.apply(s, lvl);
    }
    const mods = emptyMods();
    for (const owned of this.boons) {
      const def = boonDef(owned.id);
      def.apply(s, mods, RARITY_MULT[owned.rarity]);
    }
    s.luck += this.shopLuck; // Fortune Contracts persist through recomputes
    // Character passives
    if (this.character === 'warrior') {
      s.maxHP += 20;
    } else if (this.character === 'archer') {
      s.pickupRadius *= 1.5;
      s.moveSpeed += 0.05;
    }
    // Altar of Fate run modifiers
    const cm = this.chaosMods;
    s.might += cm.might;
    s.atkSpeed += cm.atkSpeed;
    s.moveSpeed += cm.moveSpeed;
    s.maxHP += cm.maxHP;
    s.goldGain += cm.goldGain;
    s.xpGain += cm.xpGain;
    s.luck += cm.luck;
    s.maxHP = Math.max(40, s.maxHP);
    this.stats = s;
    this.mods = mods;
    // Growing max HP heals the difference — leveling up should feel good.
    if (s.maxHP > oldMax) this.player.hp += s.maxHP - oldMax;
    this.player.hp = Math.min(this.player.hp, s.maxHP);
    this.player.charges = Math.min(this.player.charges, s.dashCharges);
  }

  frenzyBonus(): number {
    if (this.mods.frenzyPerKill <= 0) return 0;
    return Math.min(this.frenzyStacks * this.mods.frenzyPerKill, this.mods.frenzyCap);
  }

  /** The Megabonk bracket formula. Additive within brackets, multiplied across. */
  damageMult(source: 'strike' | 'auto' | 'bolt' | 'nova' | 'burn', jolted: boolean): number {
    const bracketA = 1 + this.stats.might;
    const bracketB = source === 'strike' ? 1 + this.stats.strikePct
      : source === 'auto' ? 1 + this.stats.autoPct : 1;
    const bracketC = 1 + this.frenzyBonus();
    const bracketD = jolted ? 1 + this.mods.joltPct : 1;
    const bracketE = 1 + this.buffBonus('wrath'); // obelisk surges
    return bracketA * bracketB * bracketC * bracketD * bracketE;
  }

  // ------------------------------------------------------------------
  // Timed buffs (from captured obelisks)
  // ------------------------------------------------------------------

  buffBonus(kind: BuffKind): number {
    let total = 0;
    for (const b of this.buffs) {
      if (b.kind === kind) total += b.power;
    }
    return total;
  }

  addBuff(kind: BuffKind, power: number, dur: number): void {
    // Lingering Echoes stretches every obelisk buff
    dur *= 1 + 0.2 * mirrorLevel(this.save, 'echoes');
    this.buffs.push({ kind, power, t: dur, dur });
  }

  atkSpeedMult(): number {
    return 1 + this.stats.atkSpeed + this.buffBonus('haste');
  }

  /** Extra move-speed fraction from haste buffs (2/3 of the attack bonus). */
  moveSpeedExtra(): number {
    return this.buffBonus('haste') * 0.66;
  }

  goldGainMult(): number {
    return 1 + this.stats.goldGain + this.buffBonus('greed');
  }

  /** Mage mana-shield capacity (0 for other characters). */
  maxShield(): number {
    return this.character === 'mage' ? Math.round(this.stats.maxHP * MANA_SHIELD.capFrac) : 0;
  }

  captureTower(t: Tower): void {
    t.captured = true;
    const def = towerDef(t.kind);
    this.shockwaves.push({ x: t.x, y: t.y, r: 14, maxR: 260, life: 0.6, color: def.color });
    this.particles.burst(t.x, t.y, def.color, 28, { speed: 300, size: 7, life: 0.7 });
    this.audio.play('boon');
    this.cam.shake(6);
    this.ui.showToast(`${def.name.toUpperCase()} — ${def.desc}`, def.color);
    switch (t.kind) {
      case 'wrath':
        this.addBuff('wrath', 0.35, 45);
        break;
      case 'storm':
        this.addBuff('storm', 1, 30);
        this.boltStrike(t.x, t.y - 40, 40);
        break;
      case 'haste':
        this.addBuff('haste', 0.3, 30);
        break;
      case 'greed': {
        this.addBuff('greed', 0.5, 60);
        // Gold shower
        const coins = 8 + Math.floor(this.chamber / 2);
        for (let i = 0; i < coins; i++) {
          this.pickups.push({
            kind: 'gold', x: t.x + rand(-30, 30), y: t.y + rand(-30, 30),
            vx: rand(-160, 160), vy: rand(-200, -60),
            value: 4 + Math.floor(this.chamber / 3), magnet: false, bob: rand(TAU),
          });
        }
        break;
      }
      case 'vigor':
        this.player.hp = Math.min(this.stats.maxHP, this.player.hp + this.stats.maxHP * 0.25);
        this.addBuff('regen', 2.5, 20);
        break;
      case 'souls': {
        // Burst of gems + vacuum everything on the floor
        this.dropXP(t.x, t.y - 20, Math.max(6, Math.round(this.xpNeeded * 0.4)));
        for (const pk of this.pickups) pk.magnet = true;
        break;
      }
      case 'chaos':
        this.rollFate();
        break;
    }
  }

  /** Altar of Fate: accept a random run-long modifier, for better or worse. */
  applyFate(def: (typeof CHAOS_MODS)[number]): void {
    def.apply(this.chaosMods);
    this.fates.push({ name: def.name, desc: def.desc, polarity: def.polarity });
    this.recomputeStats();
    this.player.hp = Math.min(this.player.hp, this.stats.maxHP);
    this.bannerT = 1.8;
    this.bannerText = `FATE — ${def.name.toUpperCase()}`;
    this.ui.showToast(`${def.name}: ${def.desc}`, FATE_COLOR[def.polarity]);
    this.audio.play(def.polarity === 'bane' ? 'hurt' : 'boon');
  }

  private rollFate(): void {
    this.applyFate(weightedPick(CHAOS_MODS, CHAOS_MODS.map((m) => m.weight)));
  }

  /** Rough build-power estimate — drives boss HP scaling. */
  buildPower(): number {
    let weaponLevels = 0;
    for (const w of this.weapons) weaponLevels += w.level;
    let tomeLevels = 0;
    for (const id of Object.keys(this.tomes)) tomeLevels += this.tomes[id];
    return this.level + weaponLevels * 1.5 + this.boons.length * 2.5 + tomeLevels;
  }

  heat(id: string): number {
    return heatLevel(this.save, id);
  }

  // ------------------------------------------------------------------
  // Run lifecycle
  // ------------------------------------------------------------------

  startRun(character?: CharacterId): void {
    if (character) {
      this.character = character;
      this.save.lastCharacter = character;
      persistSave(this.save);
    }
    this.state = 'run';
    this.phase = 'combat';
    this.runEnded = false;
    this.runCounted = false;
    this.winCounted = false;
    this.goldBonusBanked = 0;
    this.killsBanked = 0;
    this.dmgBanked = 0;
    this.charRunCounted = false;
    this.charWinCounted = false;
    this.charKillsBanked = 0;
    this.endless = false;
    this.pendingVictoryT = 0;
    this.pendingClearT = 0;
    this.deathT = 0;
    this.chamber = 1;
    this.runT = 0;
    this.level = 1;
    this.xp = 0;
    this.xpNeeded = xpForLevel(1);
    this.pendingLevelUps = 0;
    this.weapons = [];
    this.tomes = {};
    this.boons = [];
    this.gold = 0;
    this.ichorRun = 0;
    this.goldRerollsUsed = 0;
    this.freeRerolls = mirrorLevel(this.save, 'keeneye');
    this.totals = { kills: 0, damageDealt: 0, goldEarned: 0, ichorEarned: 0, peakHit: 0 };
    this.lastUnlocks = [];
    this.shopLuck = 0;
    this.buffs = [];
    this.chaosMods = emptyChaosMods();
    this.fates = [];
    this.frenzyStacks = 0;
    this.player = this.freshPlayer();
    this.recomputeStats();
    this.player.hp = this.stats.maxHP;
    this.player.shield = this.maxShield();
    this.player.charges = this.stats.dashCharges;
    // Head Start mirror upgrade: begin with random common boons (one per rank)
    const headstarts = mirrorLevel(this.save, 'headstart');
    if (headstarts > 0) {
      const pool = BOON_DEFS.filter((b) => !b.duo);
      for (let i = 0; i < headstarts && pool.length > 0; i++) {
        const picked = pool.splice(Math.floor(rand(pool.length)), 1)[0];
        this.boons.push({ id: picked.id, rarity: 'common' });
      }
      this.recomputeStats();
    }
    // Deep Pockets: run starts with a coin purse
    this.gold = 50 * mirrorLevel(this.save, 'pockets');
    if (this.gold > 0) this.totals.goldEarned = this.gold;
    // Starting weapon: one random unlocked auto-weapon at level 1
    const unlocked = WEAPON_DEFS.filter((w) => weaponUnlocked(w, this.save));
    const startWeapon = choice(unlocked);
    this.weapons.push({ id: startWeapon.id, level: 1, t: 0, angle: 0, trailT: 0 });
    this.setupChamber(1);
    this.ui.showToast(`${startWeapon.name} equipped`, startWeapon.color);
    // Awakening: begin the run already leveled — choices open immediately
    const awakening = mirrorLevel(this.save, 'awakening');
    if (awakening > 0) {
      this.level += awakening;
      this.xpNeeded = xpForLevel(this.level);
      this.pendingLevelUps += awakening;
      this.maybeOpenLevelUp();
    }
  }

  biome(): number {
    return biomeIndex(this.chamber);
  }

  setupChamber(c: number): void {
    this.chamber = c;
    this.chamberT = 0;
    this.pendingClearT = 0;
    this.killsInChamber = 0;
    this.quota = Math.round(chamberQuota(c) * (1 + 0.4 * this.heat('quota')));
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.patches = [];
    this.telegraphs = [];
    this.delayedHits = [];
    this.traps = [];
    this.doors = [];
    this.spawnAccum = 0;
    this.player.x = 0;
    this.player.y = this.arenaHalfH - 180;
    this.cam.x = this.player.x;
    this.cam.y = this.player.y;
    this.eliteAliveCap = c >= 6 ? 3 : 2;

    const isBoss = isBossChamber(c);
    // Pillars: none in boss arenas, 3-5 elsewhere; keep the center open.
    this.pillars = [];
    this.towers = [];
    this.chests = [];
    if (!isBoss) {
      const n = randInt(3, 5);
      for (let i = 0; i < n; i++) {
        for (let tries = 0; tries < 20; tries++) {
          const x = rand(-this.arenaHalfW + 160, this.arenaHalfW - 160);
          const y = rand(-this.arenaHalfH + 160, this.arenaHalfH - 160);
          if (Math.abs(x) < 180 && Math.abs(y) < 180) continue;
          if (Math.abs(x - this.player.x) < 220 && Math.abs(y - this.player.y) < 220) continue;
          if (this.pillars.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < 260 ** 2)) continue;
          this.pillars.push({ x, y, radius: rand(42, 68) });
          break;
        }
      }
    }

    // Obelisks to capture — from chamber 2 on, never in boss arenas
    if (!isBoss && c >= 2) {
      const count = Math.random() < 0.25 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const spot = this.findPropSpot(320);
        if (!spot) continue;
        const def = weightedPick(TOWER_DEFS, TOWER_DEFS.map((t) => t.weight));
        this.towers.push({
          x: spot.x, y: spot.y, kind: def.kind, progress: 0, captured: false,
          waveSpawned: false, phase: rand(TAU),
        });
      }
      // Altars of Fate spawn on their own schedule — the gamble is optional
      if (c >= 3 && Math.random() < 0.35) {
        const spot = this.findPropSpot(320);
        if (spot) {
          this.towers.push({
            x: spot.x, y: spot.y, kind: 'chaos', progress: 0, captured: false,
            waveSpawned: false, phase: rand(TAU),
          });
        }
      }
    }

    // Chests hide around the arena — free ones, and gilded ones for gold
    if (!isBoss) {
      if (Math.random() < 0.45) {
        const spot = this.findPropSpot(260);
        if (spot) this.chests.push({ ...spot, gilded: false, cost: 0, phase: rand(TAU), nagged: false });
      }
      if (c >= 3 && Math.random() < 0.3) {
        const spot = this.findPropSpot(260);
        if (spot) {
          this.chests.push({
            ...spot, gilded: true, cost: Math.round((50 + c * 12) * this.priceMult()),
            phase: rand(TAU), nagged: false,
          });
        }
      }
    }

    if (isBoss) {
      this.phase = 'bossIntro';
      this.bannerT = 2.2;
      if (isTwinBossChamber(c)) {
        // Both gates open at once — the barrier and the finale
        this.bannerText = c === CHAMBER_COUNT ? 'THE FINAL GATES' : 'THE TWIN GATES';
        spawnBoss(this, 'gatekeeper', -260);
        spawnBoss(this, 'shepherd', 260);
      } else {
        const variant: BossVariant = choice(['gatekeeper', 'shepherd'] as const);
        this.bannerText = BOSSES[variant].name;
        spawnBoss(this, variant);
      }
      this.audio.play('bossRoar');
      this.audio.setScene('boss', this.biome());
      this.cam.shake(14);
    } else {
      this.phase = 'combat';
      this.bannerT = 1.6;
      this.bannerText = this.endless && c > CHAMBER_COUNT
        ? `CHAMBER ${c} — THE DESCENT`
        : `CHAMBER ${roman(c)}`;
      this.audio.setScene('combat', this.biome());
    }
  }

  /** A clear spot away from the player start, pillars, and other props. */
  private findPropSpot(playerClearance: number): { x: number; y: number } | null {
    for (let tries = 0; tries < 24; tries++) {
      const x = rand(-this.arenaHalfW + 220, this.arenaHalfW - 220);
      const y = rand(-this.arenaHalfH + 280, this.arenaHalfH - 240);
      if (Math.abs(x - this.player.x) < playerClearance && Math.abs(y - this.player.y) < playerClearance) continue;
      if (this.pillars.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < (p.radius + 130) ** 2)) continue;
      if (this.towers.some((t) => (t.x - x) ** 2 + (t.y - y) ** 2 < 380 ** 2)) continue;
      if (this.chests.some((ch) => (ch.x - x) ** 2 + (ch.y - y) ** 2 < 320 ** 2)) continue;
      return { x, y };
    }
    return null;
  }

  /** Walk-over chest opening. Returns true if it opened. */
  openChest(chest: Chest): boolean {
    if (chest.gilded) {
      if (this.gold < chest.cost) return false;
      this.gold -= chest.cost;
      const names: string[] = [];
      for (let i = 0; i < 2; i++) {
        const c = this.genLevelChoices(1)[0];
        if (c) {
          this.applyLevelChoice(c);
          names.push(`${c.name} ${c.tag}`.trim());
        }
      }
      this.audio.play('buy');
      this.ui.showToast(`Gilded chest: ${names.join(' + ') || '+80 gold'}`, '#ffd166');
      if (names.length === 0) this.addGold(80);
    } else {
      const c = this.genLevelChoices(1)[0];
      if (c) {
        this.applyLevelChoice(c);
        this.ui.showToast(`Chest: ${c.name} ${c.tag}`.trim(), c.color);
      } else {
        this.addGold(50);
        this.ui.showToast('Chest: +50 gold', '#f0c75e');
      }
      this.audio.play('gold');
    }
    this.particles.burst(chest.x, chest.y, chest.gilded ? '#ffd166' : '#b98f4a', 16, {
      speed: 220, size: 5, life: 0.5,
    });
    this.shockwaves.push({
      x: chest.x, y: chest.y, r: 8, maxR: 70, life: 0.3,
      color: chest.gilded ? '#ffd166' : '#b98f4a',
    });
    this.chests = this.chests.filter((ch) => ch !== chest);
    return true;
  }

  // ------------------------------------------------------------------
  // Spawning
  // ------------------------------------------------------------------

  perimeterPoint(): { x: number; y: number } {
    const side = randInt(0, 3);
    const w = this.arenaHalfW - 40, h = this.arenaHalfH - 40;
    if (side === 0) return { x: rand(-w, w), y: -h };
    if (side === 1) return { x: rand(-w, w), y: h };
    if (side === 2) return { x: -w, y: rand(-h, h) };
    return { x: w, y: rand(-h, h) };
  }

  spawnEnemyAt(pos: { x: number; y: number }, forceElite = false, forceKind?: keyof typeof ENEMY_DEFS): Enemy {
    const c = this.chamber;
    const kinds = (Object.keys(ENEMY_DEFS) as (keyof typeof ENEMY_DEFS)[])
      .filter((k) => ENEMY_DEFS[k].minChamber <= c);
    const kind = forceKind ?? weightedPick(kinds, kinds.map((k) => ENEMY_DEFS[k].weight));
    const def = ENEMY_DEFS[kind];
    let elite = forceElite;
    if (!elite && c >= 2 && !forceKind) {
      const aliveElites = this.enemies.filter((e) => e.elite && e.hp > 0).length;
      if (aliveElites < this.eliteAliveCap && Math.random() < 0.035 + c * 0.005) elite = true;
    }
    // Elites from chamber 4 on carry an affix
    let modifier: EliteMod = null;
    if (elite && c >= 4) {
      modifier = choice(['splitter', 'warded', 'burning'] as const);
    }
    const heatHP = (1 + 0.3 * this.heat('foes')) * (1 + this.chaosMods.enemyHP);
    const heatSpeed = (1 + 0.15 * this.heat('swift')) * (1 + this.chaosMods.enemySpeed);
    const hpMul = enemyHPScale(c) * (elite ? 6 : 1) * heatHP;
    const dmgMul = enemyDmgScale(c) * (elite ? 1.5 : 1);
    const e: Enemy = {
      id: this.nextId(),
      kind,
      x: pos.x, y: pos.y, vx: 0, vy: 0,
      radius: def.radius * (elite ? 1.35 : 1),
      hp: def.hp * hpMul, maxHP: def.hp * hpMul,
      touchDamage: def.touchDamage * dmgMul,
      speed: def.speed * (elite ? 1.1 : rand(0.9, 1.1)) * heatSpeed,
      xp: def.xp * (elite ? 6 : 1),
      gold: def.gold * (elite ? 5 : 1),
      elite,
      modifier,
      spawnT: 0.55,
      flash: 0,
      wobble: rand(TAU),
      joltT: 0, woundT: 0, woundDPS: 0, chillT: 0, burnTick: 0,
      hitCd: {},
      atkT: rand(0.5, 2),
      fuse: -1,
      windup: -1,
      lungeT: 0,
      lungeDirX: 0,
      lungeDirY: 0,
      emitT: 0,
    };
    this.enemies.push(e);
    return e;
  }

  // ------------------------------------------------------------------
  // Damage pipeline
  // ------------------------------------------------------------------

  dealDamage(
    e: Enemy, base: number,
    opts: {
      source: 'strike' | 'auto' | 'bolt' | 'nova' | 'burn';
      canCrit?: boolean; kx?: number; ky?: number; depth?: number; silentNumber?: boolean;
    },
  ): number {
    if (e.hp <= 0 || e.spawnT > 0) return 0;
    const depth = opts.depth ?? 0;
    let dmg = base * this.damageMult(opts.source, e.joltT > 0);
    // Warded elites shrug off auto-weapon damage — strike and godpower break through
    if (e.modifier === 'warded' && opts.source === 'auto') dmg *= 0.25;
    // Tome of the Colossus: the big ones bleed too
    if ((e.elite || e.bossState) && this.stats.vsElitePct > 0) {
      dmg *= 1 + this.stats.vsElitePct;
    }
    // Sea Storm duo: chilled foes are vulnerable
    if (this.mods.seaStorm && e.chillT > 0) dmg *= 1.15;
    let crit = false;
    if (opts.canCrit !== false && Math.random() < this.stats.critChance) {
      crit = true;
      dmg *= this.stats.critMult;
    }
    if (!e.bossState && (opts.kx || opts.ky)) {
      const kb = 1 + this.mods.knockbackPct;
      e.vx += (opts.kx ?? 0) * kb;
      e.vy += (opts.ky ?? 0) * kb;
    }
    e.hp -= dmg;
    e.flash = 0.09;
    this.totals.damageDealt += dmg;
    if (dmg > this.totals.peakHit) this.totals.peakHit = dmg;
    if (!opts.silentNumber) this.addDmgNumber(e.x + rand(-8, 8), e.y - e.radius - 4, dmg, crit);
    if (crit) {
      this.audio.play('crit');
      if (dmg > 200) this.hitStop = Math.max(this.hitStop, 0.045);
    }
    // Lightning applies Jolted (Static Charge)
    if (opts.source === 'bolt' && this.mods.joltPct > 0) e.joltT = 4;
    // Olympian Sanction: auto-weapon hits can call a smite
    if (opts.source === 'auto' && depth === 0 && this.mods.smiteChance > 0
      && Math.random() < this.mods.smiteChance) {
      this.boltStrike(e.x, e.y, this.mods.smiteDamage, depth + 1);
    }
    if (e.hp <= 0) {
      this.killEnemy(e);
      // Melee kills feel chunky
      if (opts.source === 'strike') this.hitStop = Math.max(this.hitStop, 0.035);
    }
    return dmg;
  }

  boltStrike(x: number, y: number, damage: number, depth = 0): void {
    this.lightning.push({ x1: x + rand(-30, 30), y1: y - 420, x2: x, y2: y, life: 0.22, color: '#bfe9ff' });
    this.audio.play('bolt');
    this.cam.shake(1.5);
    const near: Enemy[] = [];
    this.hash.query(x, y, 60, near);
    for (const e of near) {
      if ((e.x - x) ** 2 + (e.y - y) ** 2 <= (60 + e.radius) ** 2) {
        this.dealDamage(e, damage, { source: 'bolt', depth: depth + 1 });
      }
    }
    this.particles.burst(x, y, '#bfe9ff', 10, { speed: 190, size: 4, life: 0.35 });
  }

  killEnemy(e: Enemy): void {
    if (e.bossState) {
      this.bossDefeated(e);
      return;
    }
    this.totals.kills++;
    if (this.phase === 'combat') this.killsInChamber++;
    this.frenzyStacks++;
    this.frenzyIdleT = 0;
    // Tome of the Leech
    if (this.stats.killHeal > 0) {
      this.player.hp = Math.min(this.stats.maxHP, this.player.hp + this.stats.killHeal);
    }
    const def = ENEMY_DEFS[e.kind as keyof typeof ENEMY_DEFS];
    this.particles.burst(e.x, e.y, def?.color ?? '#c94b4b', e.elite ? 22 : 9, {
      speed: e.elite ? 260 : 170, size: e.elite ? 7 : 5, life: 0.5,
    });
    this.audio.play('enemyDie');
    // Splitter elites burst into shades
    if (e.modifier === 'splitter' && this.phase === 'combat') {
      for (let i = 0; i < 3; i++) {
        const child = this.spawnEnemyAt(
          { x: e.x + rand(-24, 24), y: e.y + rand(-24, 24) }, false, 'shade');
        child.spawnT = 0.35;
      }
    }
    // Drops
    this.dropXP(e.x, e.y, e.xp);
    if (e.gold > 0) {
      this.pickups.push({
        kind: 'gold', x: e.x + rand(-10, 10), y: e.y + rand(-10, 10),
        vx: rand(-40, 40), vy: rand(-40, 40), value: e.gold, magnet: false, bob: rand(TAU),
      });
    }
    if (e.elite) {
      const v = this.chamber >= 6 ? 2 : 1;
      this.pickups.push({ kind: 'ichor', x: e.x, y: e.y, vx: 0, vy: -30, value: v, magnet: false, bob: rand(TAU) });
      this.cam.shake(5);
    }
    if (Math.random() < 0.02) {
      this.pickups.push({ kind: 'heart', x: e.x, y: e.y, vx: 0, vy: 0, value: 15, magnet: false, bob: rand(TAU) });
    }
    // Ocean's Bounty: the sea provides twice over
    if (this.mods.bountyChance > 0 && Math.random() < this.mods.bountyChance) {
      this.dropXP(e.x, e.y, e.xp);
      this.pickups.push({
        kind: 'gold', x: e.x + rand(-12, 12), y: e.y + rand(-12, 12),
        vx: rand(-60, 60), vy: rand(-60, 60), value: e.gold, magnet: false, bob: rand(TAU),
      });
    }
    // Blood Detonation
    if (this.mods.novaChance > 0 && Math.random() < this.mods.novaChance) {
      this.explodeNova(e.x, e.y);
    }
    // Quota check
    if (this.phase === 'combat' && !isBossChamber(this.chamber) && this.killsInChamber >= this.quota) {
      this.onQuotaMet();
    }
  }

  explodeNova(x: number, y: number): void {
    const r = this.mods.novaRadius;
    this.shockwaves.push({ x, y, r: 8, maxR: r, life: 0.3, color: '#ff5a5a' });
    this.audio.play('nova');
    const near: Enemy[] = [];
    this.hash.query(x, y, r, near);
    for (const e of near) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d <= r + e.radius) {
        // Blood Tide duo: the nova is a wave — everything caught is shoved
        const opts = this.mods.bloodTide
          ? { source: 'nova' as const, depth: 1, kx: ((e.x - x) / Math.max(10, d)) * 520, ky: ((e.y - y) / Math.max(10, d)) * 520 }
          : { source: 'nova' as const, depth: 1 };
        this.dealDamage(e, this.mods.novaDamage, opts);
      }
    }
    if (this.mods.vengefulSky) this.boltStrike(x, y, this.mods.novaDamage * 0.8, 1);
  }

  dropXP(x: number, y: number, total: number): void {
    let v = Math.round(total);
    let guard = 0;
    while (v > 0 && guard++ < 6) {
      const size = v >= 8 ? 8 : v >= 3 ? 3 : 1;
      v -= size;
      this.pickups.push({
        kind: size === 8 ? 'xp8' : size === 3 ? 'xp3' : 'xp',
        x: x + rand(-14, 14), y: y + rand(-14, 14),
        vx: rand(-50, 50), vy: rand(-50, 50),
        value: size, magnet: false, bob: rand(TAU),
      });
    }
  }

  gainXP(n: number): void {
    this.xp += n * (1 + this.stats.xpGain);
    while (this.xp >= this.xpNeeded) {
      this.xp -= this.xpNeeded;
      this.level++;
      this.xpNeeded = xpForLevel(this.level);
      this.pendingLevelUps++;
      this.shockwaves.push({
        x: this.player.x, y: this.player.y, r: 10, maxR: 150, life: 0.45, color: '#f0c75e',
      });
    }
    this.maybeOpenLevelUp();
  }

  maybeOpenLevelUp(): void {
    if (this.pendingLevelUps > 0 && !this.overlayOpen && this.state === 'run'
      && this.phase !== 'over' && this.deathT <= 0) {
      this.audio.play('levelup');
      this.ui.openLevelUp();
    }
  }

  hurtPlayer(dmg: number, fromX?: number, fromY?: number): void {
    const p = this.player;
    if (p.invulnT > 0 || p.dashT > 0 || this.phase === 'over' || this.deathT > 0) return;
    dmg *= 1 + this.chaosMods.damageTaken; // Blood Price and its kin
    // Armor (Thick Skin + Tome of the Turtle): flat reduction, min 1
    if (this.stats.armor > 0) dmg = Math.max(1, dmg - this.stats.armor);
    // The Oracle's mana shield soaks damage first
    let absorbed = 0;
    if (p.shield > 0) {
      absorbed = Math.min(p.shield, dmg);
      p.shield -= absorbed;
      dmg -= absorbed;
      p.shieldRegenT = MANA_SHIELD.regenDelay;
      this.particles.burst(p.x, p.y, '#8fdcff', 8, { speed: 180, size: 5, life: 0.35 });
      if (dmg <= 0.001) {
        // Fully absorbed: brief mercy window, no red flash
        p.invulnT = 0.8;
        this.audio.play('nova');
        this.cam.shake(3);
        return;
      }
    }
    p.hp -= dmg;
    p.invulnT = 0.8;
    p.hurtT = 0.35;
    this.cam.shake(7);
    this.audio.play('hurt');
    this.particles.burst(p.x, p.y, '#ff5a5a', 10, { speed: 200, size: 5, life: 0.4 });
    if (fromX !== undefined && fromY !== undefined) {
      const d = Math.max(20, Math.hypot(p.x - fromX, p.y - fromY));
      p.x += ((p.x - fromX) / d) * 14;
      p.y += ((p.y - fromY) / d) * 14;
    }
    if (p.hp <= 0) {
      if (p.defiancesUsed < mirrorLevel(this.save, 'defiance')) {
        p.defiancesUsed++;
        p.hp = this.stats.maxHP * 0.5;
        p.invulnT = 2;
        this.audio.play('defiance');
        this.shockwaves.push({ x: p.x, y: p.y, r: 10, maxR: 300, life: 0.5, color: '#ffe08a' });
        // Shove everything away
        for (const e of this.enemies) {
          if (e.bossState) continue;
          const d = Math.max(30, Math.hypot(e.x - p.x, e.y - p.y));
          e.vx += ((e.x - p.x) / d) * 700;
          e.vy += ((e.y - p.y) / d) * 700;
        }
        this.ui.showToast('DEATH DEFIED', '#ffe08a');
      } else {
        // Death animation plays out before the screen appears
        p.hp = 0;
        this.phase = 'over';
        this.deathT = 1.25;
        this.hitStop = Math.max(this.hitStop, 0.12);
        this.cam.shake(14);
        this.particles.burst(p.x, p.y, '#f0c75e', 40, { speed: 260, size: 7, life: 0.9 });
        this.shockwaves.push({ x: p.x, y: p.y, r: 8, maxR: 220, life: 0.6, color: '#f0c75e' });
      }
    }
  }

  // ------------------------------------------------------------------
  // Chamber clear & doors
  // ------------------------------------------------------------------

  onQuotaMet(): void {
    this.phase = 'cleared';
    this.audio.play('door');
    // Dissolve stragglers (they still burst, no quota needed now)
    for (const e of [...this.enemies]) {
      if (e.hp > 0 && !e.bossState) {
        e.hp = 0;
        this.particles.burst(e.x, e.y, '#7d6bd9', 5, { speed: 120, size: 4, life: 0.4 });
        this.dropXP(e.x, e.y, Math.max(1, Math.round(e.xp / 2)));
      }
    }
    this.enemies = this.enemies.filter((e) => e.bossState);
    // Vacuum every pickup
    for (const pk of this.pickups) pk.magnet = true;
    this.doors = this.rollDoors();
    this.bannerT = 1.4;
    this.bannerText = 'CHAMBER CLEARED — CHOOSE A DOOR';
  }

  private hasUpgradeableBoon(): boolean {
    return this.boons.some((b) => !boonDef(b.id).duo && b.rarity !== 'epic');
  }

  private rollDoors(): Door[] {
    const doors: Door[] = [];
    const gods: GodId[] = ['zeus', 'ares', 'hermes', 'poseidon'];
    const luck = this.stats.luck;
    let count = Math.random() < 0.2 + luck * 0.06 ? 3 : 2;
    count = Math.max(1, count - this.heat('stingy'));
    // First door: always a boon (build velocity is the game)
    doors.push({ x: 0, y: 0, reward: 'boon', god: choice(gods) });
    const others: RewardKind[] = ['gold', 'heal', 'xpcache', 'ichor', 'chest', 'boon', 'shop', 'pom', 'forge'];
    const weights = [11, 11, 11, 8, 12, 16, 13, this.hasUpgradeableBoon() ? 9 : 0, 10];
    while (doors.length < count) {
      const reward = weightedPick(others, weights);
      doors.push({ x: 0, y: 0, reward, god: reward === 'boon' ? choice(gods) : undefined });
    }
    // Lay out along the top wall
    const spacing = 240;
    const x0 = -((doors.length - 1) * spacing) / 2;
    doors.forEach((d, i) => {
      d.x = x0 + i * spacing;
      d.y = -this.arenaHalfH + 70;
    });
    return doors;
  }

  enterDoor(door: Door): void {
    if (this.phase !== 'cleared') return;
    this.audio.play('door');
    switch (door.reward) {
      case 'boon':
        this.boonDoorPending = true;
        this.pendingGod = door.god!;
        this.audio.play('boon');
        this.ui.openBoon(door.god!);
        return; // transition happens after the pick
      case 'shop':
        this.shopItems = this.genShopItems();
        this.ui.openShop();
        return; // transition happens on leaveShop()
      case 'pom': {
        if (this.genPomChoices().length > 0) {
          this.ui.openPom();
          return; // transition happens after the pick
        }
        // Nothing to empower — the pom ferments into XP
        this.ui.showToast('The pom ferments into pure XP', '#c17bff');
        this.gainXP(this.xpNeeded * 0.8 / (1 + this.stats.xpGain));
        break;
      }
      case 'gold': {
        const amt = Math.round((40 + this.chamber * 9) * (1 + this.stats.goldGain));
        this.addGold(amt);
        this.ui.showToast(`+${amt} gold`, '#f0c75e');
        break;
      }
      case 'heal': {
        const amt = Math.round(this.stats.maxHP * 0.3);
        this.player.hp = Math.min(this.stats.maxHP, this.player.hp + amt);
        this.ui.showToast(`Ambrosia: +${amt} HP`, '#3ddc97');
        break;
      }
      case 'xpcache': {
        this.ui.showToast('XP cache!', '#c17bff');
        this.gainXP(this.xpNeeded * 1.15 / (1 + this.stats.xpGain));
        break;
      }
      case 'ichor': {
        const amt = 3 + Math.floor(this.chamber / 4);
        this.addIchor(amt);
        this.ui.showToast(`+${amt} Ichor`, '#e05780');
        break;
      }
      case 'chest': {
        const choices = this.genLevelChoices(1);
        if (choices.length > 0) {
          const c = choices[0];
          this.applyLevelChoice(c);
          this.ui.showToast(`Chest: ${c.name} ${c.tag}`, c.color);
        } else {
          this.addGold(60);
          this.ui.showToast('Chest: +60 gold', '#f0c75e');
        }
        break;
      }
      case 'forge': {
        // Daedalus-style: a guaranteed weapon level
        const upgradeable = this.weapons.filter((w) => w.level < WEAPON_MAX_LEVEL);
        if (upgradeable.length > 0) {
          const w = choice(upgradeable);
          w.level++;
          const def = weaponDef(w.id);
          this.recomputeStats();
          if (w.level === WEAPON_MAX_LEVEL) this.audio.play('transcend');
          this.ui.showToast(`Forge: ${def.name} → Lv ${w.level}`, def.color);
        } else {
          this.addGold(80);
          this.ui.showToast('Forge: nothing to improve — +80 gold', '#ffb454');
        }
        break;
      }
    }
    this.beginTransition();
  }

  pendingGod: GodId = 'zeus';

  afterBoonPicked(): void {
    if (this.boonDoorPending) {
      this.boonDoorPending = false;
      this.beginTransition();
    }
  }

  beginTransition(): void {
    this.phase = 'transition';
    this.transitionT = 0;
    this.chamberSwitched = false;
  }

  // ------------------------------------------------------------------
  // Charon's shop
  // ------------------------------------------------------------------

  genShopItems(): ShopItem[] {
    const c = this.chamber;
    const p = this.priceMult();
    const items: ShopItem[] = [
      {
        id: 'ambrosia', name: 'Ambrosia', icon: '✚', color: '#3ddc97',
        desc: 'Restore 40% of your max HP.', cost: Math.round((45 + c * 8) * p), bought: false,
      },
      {
        id: 'cache', name: 'Weapon Cache', icon: '▣', color: '#8fdcff',
        desc: 'A random owned weapon gains a level.', cost: Math.round((80 + c * 10) * p), bought: false,
      },
      {
        id: 'blessing', name: 'Sealed Blessing', icon: '✦', color: '#c17bff',
        desc: 'A random god grants a random boon.', cost: Math.round((100 + c * 12) * p), bought: false,
      },
      {
        id: 'contract', name: 'Fortune Contract', icon: '☘', color: '#7bf1a8',
        desc: '+2 Luck for the rest of this run.', cost: Math.round(70 * p), bought: false,
      },
    ];
    return items;
  }

  /** Returns true if the purchase went through. */
  buyShopItem(item: ShopItem): boolean {
    if (item.bought || this.gold < item.cost) return false;
    switch (item.id) {
      case 'ambrosia': {
        const amt = Math.round(this.stats.maxHP * 0.4);
        this.player.hp = Math.min(this.stats.maxHP, this.player.hp + amt);
        this.ui.showToast(`+${amt} HP`, '#3ddc97');
        break;
      }
      case 'cache': {
        const upgradeable = this.weapons.filter((w) => w.level < WEAPON_MAX_LEVEL);
        if (upgradeable.length > 0) {
          const w = choice(upgradeable);
          w.level++;
          const def = weaponDef(w.id);
          this.ui.showToast(`${def.name} → Lv ${w.level}`, def.color);
          if (w.level === WEAPON_MAX_LEVEL) this.audio.play('transcend');
        } else {
          this.addGold(item.cost); // nothing to upgrade — refund via gold (net free)
          this.ui.showToast('Nothing left to upgrade', '#8a93b8');
        }
        break;
      }
      case 'blessing': {
        const gods: GodId[] = ['zeus', 'ares', 'hermes', 'poseidon'];
        const cs = this.genBoonChoices(choice(gods));
        const pick = cs[0];
        this.applyBoonChoice(pick);
        this.ui.showToast(`${pick.name} (${pick.rarity})`, '#c17bff');
        break;
      }
      case 'contract': {
        this.shopLuck += 2;
        this.recomputeStats();
        this.ui.showToast('+2 Luck', '#7bf1a8');
        break;
      }
    }
    this.gold -= item.cost;
    item.bought = true;
    this.audio.play('buy');
    return true;
  }

  shopLuck = 0; // Fortune Contracts bought this run

  leaveShop(): void {
    this.beginTransition();
  }

  // ------------------------------------------------------------------
  // Pom of Power — upgrade an owned boon's rarity
  // ------------------------------------------------------------------

  genPomChoices(): PomChoice[] {
    const out: PomChoice[] = [];
    this.boons.forEach((b, i) => {
      const def = boonDef(b.id);
      if (def.duo || b.rarity === 'epic') return;
      const to: Rarity = b.rarity === 'common' ? 'rare' : 'epic';
      out.push({ index: i, name: def.name, from: b.rarity, to, god: def.god });
    });
    return out;
  }

  applyPom(c: PomChoice): void {
    this.boons[c.index].rarity = c.to;
    this.recomputeStats();
    this.audio.play('boon');
    this.ui.showToast(`${c.name} → ${c.to.toUpperCase()}`, '#f0c75e');
    this.beginTransition();
  }

  // ------------------------------------------------------------------
  // Boss defeat, victory & endless
  // ------------------------------------------------------------------

  bossDefeated(boss: Enemy): void {
    this.enemies = this.enemies.filter((e) => e !== boss);
    this.hitStop = 0.35;
    this.cam.shake(20);
    this.audio.play('bossRoar');
    this.shockwaves.push({ x: boss.x, y: boss.y, r: 20, maxR: 500, life: 0.8, color: '#ffe08a' });
    this.particles.burst(boss.x, boss.y, '#ffb3c8', 60, { speed: 380, size: 9, life: 1 });
    // Loot burst: XP gems + the boss's gold hoard
    this.dropXP(boss.x, boss.y, 40);
    for (let i = 0; i < 6; i++) {
      this.pickups.push({
        kind: 'gold', x: boss.x + rand(-24, 24), y: boss.y + rand(-24, 24),
        vx: rand(-180, 180), vy: rand(-220, -40),
        value: Math.max(1, Math.round(boss.gold / 6)), magnet: false, bob: rand(TAU),
      });
    }
    // Twin fights: the chamber only falls when BOTH gates do
    if (this.enemies.some((e) => e.bossState)) {
      this.addIchor(5);
      this.ui.showToast('One gate falls — one remains', '#ffb3c8');
      return;
    }
    // Clear leftover summons
    for (const e of this.enemies) {
      if (!e.bossState) e.hp = 0;
    }
    // Everything on the floor flies home while the dust settles
    for (const pk of this.pickups) pk.magnet = true;
    if (this.chamber === CHAMBER_COUNT) {
      // The final twins: bank the win now; the victory prompt waits a couple
      // of seconds so the loot is collected first.
      this.addIchor(20);
      this.phase = 'over';
      this.bankMeta(true);
      this.pendingVictoryT = 2.5;
    } else {
      // Herald / barrier / endless boss: pay out and keep going.
      // bank without a win — only the final twins count an escape.
      const amt = 6 + Math.floor(this.chamber / 5) * 2;
      this.addIchor(amt);
      this.bankMeta(false);
      this.ui.showToast(`+${amt} Ichor — the descent continues`, '#e05780');
      this.audio.setScene('combat', this.biome());
      this.phase = 'combat'; // even if it died mid-intro
      this.pendingClearT = 2.2; // loot vacuums in before the doors appear
    }
    // Every conquered boss chamber earns a Legendary boon from the gods
    if (this.genLegendaryChoices().length > 0) {
      this.audio.play('unlock');
      this.ui.openLegendary();
    } else {
      this.addIchor(20);
      this.ui.showToast('The gods have no legends left to give — +20 Ichor', FATE_COLOR.mixed);
    }
  }

  continueEndless(): void {
    this.endless = true;
    this.setOverlayOpen(false);
    this.ui.showToast('THE DESCENT CONTINUES', '#c17bff');
    this.beginTransition();
  }

  finishToMenu(): void {
    this.runEnded = true;
    this.state = 'menu';
    this.audio.setScene('calm', 0);
    this.ui.syncMenus();
  }

  // ------------------------------------------------------------------
  // Meta banking (incremental — endless banks repeatedly)
  // ------------------------------------------------------------------

  private bankMeta(win: boolean): void {
    let gain = this.ichorRun;
    this.ichorRun = 0;
    if (win && !this.winCounted) {
      this.winCounted = true;
      this.save.wins++;
      gain += 10 + 2 * totalHeat(this.save);
    }
    const goldBonus = Math.floor(this.totals.goldEarned / 200);
    gain += goldBonus - this.goldBonusBanked;
    this.goldBonusBanked = goldBonus;
    this.save.ichor += gain;
    this.totals.ichorEarned += gain;
    if (!this.runCounted) {
      this.runCounted = true;
      this.save.runs++;
    }
    this.save.kills += this.totals.kills - this.killsBanked;
    this.killsBanked = this.totals.kills;
    this.save.totalDamage += this.totals.damageDealt - this.dmgBanked;
    this.dmgBanked = this.totals.damageDealt;
    this.save.bestChamber = Math.max(this.save.bestChamber, this.chamber);
    // Per-character lifetime stats (drive skin unlocks)
    const cs = charStatsFor(this.save, this.character);
    if (this.runCounted && !this.charRunCounted) {
      this.charRunCounted = true;
      cs.runs++;
    }
    if (this.winCounted && !this.charWinCounted) {
      this.charWinCounted = true;
      cs.wins++;
    }
    cs.kills += this.totals.kills - this.charKillsBanked;
    this.charKillsBanked = this.totals.kills;
    cs.bestChamber = Math.max(cs.bestChamber, this.chamber);
    // Newly earned weapon unlocks
    for (const def of WEAPON_DEFS) {
      if (!def.unlock || this.save.seenUnlocks.includes(def.id)) continue;
      const [cur, goal] = def.unlock.progress(this.save);
      if (cur >= goal) {
        this.save.seenUnlocks.push(def.id);
        this.lastUnlocks.push(def.name);
        this.audio.play('unlock');
      }
    }
    // Newly earned skins (any character's — feats can overlap)
    for (const ch of CHARACTERS) {
      const stats = charStatsFor(this.save, ch.id);
      for (const skin of ch.skins) {
        if (!skin.unlock || this.save.seenSkins.includes(skin.id)) continue;
        if (skinUnlocked(skin, stats)) {
          this.save.seenSkins.push(skin.id);
          this.lastUnlocks.push(`${skin.name} (${ch.name} skin)`);
          this.audio.play('unlock');
        }
      }
    }
    persistSave(this.save);
  }

  endRun(win: boolean): void {
    if (this.runEnded) return;
    this.runEnded = true;
    this.phase = 'over';
    this.bankMeta(win);
    this.audio.setScene('calm', 0);
    if (win) this.ui.openVictory();
    else this.ui.openDeath();
  }

  abandonRun(): void {
    // Ichor is permanent even when you walk away
    if (!this.runEnded) {
      this.runEnded = true;
      this.bankMeta(false);
    }
    this.finishToMenu();
  }

  addGold(n: number): void {
    this.gold += n;
    this.totals.goldEarned += n;
  }

  addIchor(n: number): void {
    this.ichorRun += n;
    this.audio.play('ichor');
  }

  addDmgNumber(x: number, y: number, dmg: number, crit: boolean, color: string | null = null): void {
    const mode = this.save.settings.dmgNumbers;
    if (mode === 'off') return;
    if (mode === 'reduced' && !crit && dmg < 100) return;
    if (this.dmgNumbers.length > 90) this.dmgNumbers.shift();
    this.dmgNumbers.push({ x, y, vy: -60, text: fmt(dmg), life: crit ? 0.9 : 0.65, crit, color });
  }

  // ------------------------------------------------------------------
  // Level-up choices
  // ------------------------------------------------------------------

  genLevelChoices(n = 3): LevelChoice[] {
    const opts: LevelChoice[] = [];
    const weights: number[] = [];
    for (const def of WEAPON_DEFS) {
      if (!weaponUnlocked(def, this.save)) continue;
      const owned = this.weapons.find((w) => w.id === def.id);
      if (owned && owned.level < WEAPON_MAX_LEVEL) {
        const to = owned.level + 1;
        const transcend = to === WEAPON_MAX_LEVEL;
        opts.push({
          kind: 'weapon', id: def.id, toLevel: to, amount: 0,
          name: def.name, desc: def.describe(to), icon: def.icon, color: def.color,
          tag: transcend ? 'TRANSCEND' : `Lv ${to}`,
        });
        weights.push(transcend ? 7 : 11);
      } else if (!owned && this.weapons.length < 5) {
        opts.push({
          kind: 'weapon', id: def.id, toLevel: 1, amount: 0,
          name: def.name, desc: def.describe(1), icon: def.icon, color: def.color, tag: 'NEW',
        });
        weights.push(8);
      }
    }
    for (const def of TOME_DEFS) {
      const lvl = this.tomes[def.id] ?? 0;
      if (lvl < TOME_MAX_LEVEL) {
        opts.push({
          kind: 'tome', id: def.id, toLevel: lvl + 1, amount: 0,
          name: def.name, desc: def.desc, icon: def.icon, color: def.color,
          tag: lvl === 0 ? 'NEW' : `Rank ${lvl + 1}`,
        });
        weights.push(lvl > 0 ? 7 : 6);
      }
    }
    // Draw n distinct
    const out: LevelChoice[] = [];
    while (out.length < n && opts.length > 0) {
      const pick = weightedPick(opts, weights);
      const i = opts.indexOf(pick);
      opts.splice(i, 1);
      weights.splice(i, 1);
      out.push(pick);
    }
    while (out.length < n) {
      const amt = 40 + this.chamber * 10;
      out.push({
        kind: 'gold', id: 'gold', toLevel: 0, amount: amt,
        name: 'Charon’s Cut', desc: `Everything is maxed. Take ${amt} gold.`,
        icon: '◈', color: '#f0c75e', tag: '',
      });
    }
    return out;
  }

  applyLevelChoice(c: LevelChoice): void {
    if (c.kind === 'weapon') {
      const owned = this.weapons.find((w) => w.id === c.id);
      if (owned) owned.level = c.toLevel;
      else this.weapons.push({ id: c.id, level: 1, t: 0, angle: rand(TAU), trailT: 0 });
      if (c.toLevel === WEAPON_MAX_LEVEL) {
        this.audio.play('transcend');
        this.shockwaves.push({ x: this.player.x, y: this.player.y, r: 10, maxR: 260, life: 0.6, color: '#ffe08a' });
        this.ui.showToast(`${c.name} TRANSCENDED`, '#ffe08a');
      }
    } else if (c.kind === 'tome') {
      this.tomes[c.id] = c.toLevel;
    } else {
      this.addGold(c.amount);
    }
    this.recomputeStats();
  }

  /** Charon's Favor: −10% per rank on all gold prices. */
  priceMult(): number {
    return 1 - 0.1 * mirrorLevel(this.save, 'charon');
  }

  /** Cost of the next reroll: null = free, number = gold price. */
  rerollCost(): number | null {
    if (this.freeRerolls > 0) return null;
    const base = 20 * Math.pow(1.7, this.goldRerollsUsed) * this.priceMult();
    return Math.max(5, Math.round(base / 5) * 5);
  }

  payReroll(): boolean {
    const cost = this.rerollCost();
    if (cost === null) {
      this.freeRerolls--;
      return true;
    }
    if (this.gold >= cost) {
      this.gold -= cost;
      this.goldRerollsUsed++;
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------
  // Boon choices
  // ------------------------------------------------------------------

  hasBoonFromGod(god: GodId): boolean {
    return this.boons.some((b) => {
      const d = boonDef(b.id);
      return d.god === god || d.duo === god;
    });
  }

  genBoonChoices(god: GodId): BoonChoice[] {
    const ownedIds = new Set(this.boons.map((b) => b.id));
    const pool = BOON_DEFS.filter((def) => {
      if (ownedIds.has(def.id)) return false;
      if (def.legendary) return false; // boss rewards only
      if (def.duo) {
        // Duo shows up in either god's offering, once both gods have blessed you
        if (def.god !== god && def.duo !== god) return false;
        return this.hasBoonFromGod(def.god) && this.hasBoonFromGod(def.duo);
      }
      return def.god === god;
    });
    const weights = pool.map((d) => (d.duo ? 5 : 10));
    const out: BoonChoice[] = [];
    const copy = [...pool];
    const wcopy = [...weights];
    // Council of Gods: the offering table grows a 4th seat
    const offerCount = 3 + mirrorLevel(this.save, 'council');
    while (out.length < offerCount && copy.length > 0) {
      const def = weightedPick(copy, wcopy);
      const i = copy.indexOf(def);
      copy.splice(i, 1);
      wcopy.splice(i, 1);
      if (def.duo) {
        out.push({
          id: def.id, rarity: 'duo', name: def.name, desc: def.describe(1),
          color: '#f0c75e', godLabel: `${GOD_NAME[def.god]} + ${GOD_NAME[def.duo]}`,
        });
      } else {
        const rarity = rollRarity(this.stats.luck);
        out.push({
          id: def.id, rarity, name: def.name, desc: def.describe(RARITY_MULT[rarity]),
          color: '', godLabel: GOD_NAME[def.god],
        });
      }
    }
    if (out.length === 0) {
      // God has nothing left to give: gold instead
      out.push({
        id: '__gold', rarity: 'common', name: 'Parting Gift',
        desc: `${GOD_NAME[god]} has no more blessings. Take 80 gold.`,
        color: '#f0c75e', godLabel: GOD_NAME[god],
      });
    }
    return out;
  }

  /** Boss reward: pick one of the gods' Legendary boons (never re-offered). */
  genLegendaryChoices(): BoonChoice[] {
    const ownedIds = new Set(this.boons.map((b) => b.id));
    const pool = BOON_DEFS.filter((def) => def.legendary && !ownedIds.has(def.id));
    // Shuffle, offer up to 3
    const copy = [...pool];
    const out: BoonChoice[] = [];
    while (out.length < 3 && copy.length > 0) {
      const def = copy.splice(Math.floor(rand(copy.length)), 1)[0];
      out.push({
        id: def.id, rarity: 'legendary', name: def.name, desc: def.describe(1),
        color: LEGENDARY_COLOR, godLabel: GOD_NAME[def.god],
      });
    }
    return out;
  }

  applyBoonChoice(c: BoonChoice): void {
    if (c.id === '__gold') {
      this.addGold(80);
    } else {
      this.boons.push({
        id: c.id,
        rarity: c.rarity === 'duo' || c.rarity === 'legendary' ? 'epic' : c.rarity,
      });
      this.recomputeStats();
    }
    this.audio.play('boon');
  }

  /** The active skin for a character (falls back to default if locked). */
  selectedSkin(charId: CharacterId = this.character): SkinDef {
    const def = characterDef(charId);
    const chosen = def.skins.find((s) => s.id === this.save.skins[charId]);
    if (chosen && skinUnlocked(chosen, charStatsFor(this.save, charId))) return chosen;
    return def.skins[0];
  }

  /** Player sprite colors from the equipped skin. */
  playerColors(): { body: string; trim: string } {
    const skin = this.selectedSkin();
    return { body: skin.body, trim: skin.trim };
  }

  bossPowerHP(variant: BossVariant): number {
    return bossHPFor(variant, this.buildPower(), this.chamber)
      * (1 + 0.3 * this.heat('foes')) * (1 + this.chaosMods.enemyHP);
  }

  // ------------------------------------------------------------------
  // Per-frame update (called from main loop when unpaused, fixed dt)
  // ------------------------------------------------------------------

  update(dt: number): void {
    if (this.state !== 'run') return;
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      return;
    }

    // Death animation → death screen
    if (this.deathT > 0) {
      this.deathT -= dt;
      this.cam.update(dt);
      this.particles.update(dt);
      this.tickFx(dt);
      if (this.deathT <= 0) this.endRun(false);
      return;
    }

    // Victory delay → victory screen (sim-time, not wall-clock)
    if (this.pendingVictoryT > 0) {
      this.pendingVictoryT -= dt;
      if (this.pendingVictoryT <= 0 && this.state === 'run') {
        this.ui.openVictory();
      }
    }

    // Herald-boss breather → doors open once the loot has flown in
    if (this.pendingClearT > 0 && this.phase === 'combat') {
      this.pendingClearT -= dt;
      if (this.pendingClearT <= 0) {
        this.phase = 'cleared';
        this.doors = this.rollDoors();
        this.audio.play('door');
        this.bannerT = 1.4;
        this.bannerText = 'CHOOSE A DOOR';
      }
    }

    this.runT += dt;
    this.chamberT += dt;
    if (this.bannerT > 0) this.bannerT -= dt;

    // Frenzy decay when not killing (Rage Incarnate never lets go)
    this.frenzyIdleT += dt;
    if (this.frenzyIdleT > 2 && this.frenzyStacks > 0 && !this.mods.frenzyNoDecay) {
      this.frenzyStacks = Math.max(0, this.frenzyStacks - dt * 6);
    }

    // Obelisk buffs tick down; regen and storms act while live
    for (let i = this.buffs.length - 1; i >= 0; i--) {
      this.buffs[i].t -= dt;
      if (this.buffs[i].t <= 0) this.buffs.splice(i, 1);
    }
    const regen = this.buffBonus('regen');
    if (regen > 0 && this.player.hp > 0) {
      this.player.hp = Math.min(this.stats.maxHP, this.player.hp + regen * dt);
    }
    // Mana shield regenerates once out of the fray
    const shieldCap = this.maxShield();
    if (shieldCap > 0) {
      if (this.player.shieldRegenT > 0) this.player.shieldRegenT -= dt;
      else if (this.player.shield < shieldCap) {
        this.player.shield = Math.min(shieldCap, this.player.shield + MANA_SHIELD.regenRate * dt);
      }
    }
    if (this.buffBonus('storm') > 0 || this.mods.stormLord) {
      this.stormT -= dt;
      if (this.stormT <= 0) {
        this.stormT = 0.7;
        const targets = this.enemies.filter((e) => e.hp > 0 && e.spawnT <= 0);
        if (targets.length > 0) {
          const e = choice(targets);
          this.boltStrike(e.x, e.y, 40);
        }
      }
    }

    if (this.phase === 'transition') {
      this.transitionT += dt;
      if (this.transitionT >= 0.45 && !this.chamberSwitched) {
        this.chamberSwitched = true;
        this.setupChamber(this.chamber + 1);
        this.phase = 'transition'; // setupChamber sets combat/bossIntro; restore fade-in
      }
      if (this.transitionT >= 0.9) {
        this.phase = isBossChamber(this.chamber) ? 'bossIntro' : 'combat';
        if (isBossChamber(this.chamber)) this.bannerT = 2.2;
      }
      this.cam.update(dt);
      return;
    }

    if (this.phase === 'bossIntro') {
      if (this.bannerT <= 0) this.phase = 'combat';
    }

    updateCombat(this, dt);
    this.cam.follow(this.player.x, this.player.y, dt);
    this.cam.clampTo(this.arenaHalfW, this.arenaHalfH);
    this.cam.update(dt);
    this.particles.update(dt);
    this.tickFx(dt);
  }

  private tickFx(dt: number): void {
    for (let i = this.dmgNumbers.length - 1; i >= 0; i--) {
      const d = this.dmgNumbers[i];
      d.life -= dt;
      d.y += d.vy * dt;
      d.vy *= 1 - 2.4 * dt;
      if (d.life <= 0) this.dmgNumbers.splice(i, 1);
    }
    for (let i = this.lightning.length - 1; i >= 0; i--) {
      this.lightning[i].life -= dt;
      if (this.lightning[i].life <= 0) this.lightning.splice(i, 1);
    }
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.life -= dt;
      s.r += (s.maxR - s.r) * 10 * dt;
      if (s.life <= 0) this.shockwaves.splice(i, 1);
    }
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      this.telegraphs[i].t -= dt;
      if (this.telegraphs[i].t <= 0) this.telegraphs.splice(i, 1);
    }
  }
}

function roman(n: number): string {
  const R = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  return R[n - 1] ?? String(n);
}
