// ---------------------------------------------------------------------------
// Shared game types
// ---------------------------------------------------------------------------

export type GodId = 'zeus' | 'ares' | 'hermes' | 'poseidon';
export type Rarity = 'common' | 'rare' | 'epic';

export const RARITY_MULT: Record<Rarity, number> = { common: 1, rare: 1.5, epic: 2.25 };
export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#cfd6e4', rare: '#5aa2ff', epic: '#c17bff',
};
export const GOD_COLOR: Record<GodId, string> = {
  zeus: '#8fdcff', ares: '#ff5a5a', hermes: '#7bf1a8', poseidon: '#4a90ff',
};
export const GOD_NAME: Record<GodId, string> = {
  zeus: 'ZEUS', ares: 'ARES', hermes: 'HERMES', poseidon: 'POSEIDON',
};

/** Aggregated player stats, recomputed from meta + tomes + boons. */
export interface Stats {
  maxHP: number;
  might: number;          // bracket A: generic +damage% (additive within)
  strikePct: number;      // bracket B for strike
  autoPct: number;        // bracket B for auto-weapons
  atkSpeed: number;       // +% attack/fire rate
  moveSpeed: number;      // +% move speed
  critChance: number;     // 0..1
  critMult: number;       // default 2
  xpGain: number;         // +%
  goldGain: number;       // +%
  luck: number;           // shifts rarity & door odds
  pickupRadius: number;   // px
  dashCharges: number;
  dashRecharge: number;   // seconds per charge
  armor: number;          // flat damage reduction (hits floor at 1)
  vsElitePct: number;     // bonus damage vs elites & bosses
  killHeal: number;       // HP restored per kill
}

/** Boon-driven behaviour switches & proc magnitudes. */
export interface Mods {
  chainChance: number;    // strike: chance to chain lightning
  chainDamage: number;    // fraction of hit damage per jump
  smiteChance: number;    // auto hits: chance to call a bolt
  smiteDamage: number;    // flat bolt damage (scaled by brackets at use)
  dashBoltDamage: number; // 0 = off; damage of bolt left at dash start
  joltPct: number;        // vulnerability magnitude while Jolted
  novaChance: number;     // on-kill blood nova chance
  novaDamage: number;
  novaRadius: number;
  woundDPS: number;       // DoT applied by strike hits
  frenzyPerKill: number;  // +% damage per kill stack
  frenzyCap: number;
  // Poseidon
  knockbackPct: number;   // amplifies all knockback you deal
  slamDamage: number;     // knocked foes take this when smashed into walls
  dashWave: number;       // dash releases a shoving wave (damage; 0 = off)
  chillDur: number;       // strike hits Chill (-28% speed) for this long
  bountyChance: number;   // kills may drop double loot
  // Duo flags
  vengefulSky: boolean;   // novas call lightning
  rideTheLightning: boolean; // dash = damaging blink
  battleTrance: boolean;  // frenzy also grants speed
  seaStorm: boolean;      // chilled foes take +15% damage
  bloodTide: boolean;     // blood novas shove foes away
  slipstream: boolean;    // dashing knocks enemies aside
  // Legendary flags (boss-reward boons)
  stormLord: boolean;     // a permanent storm bolts nearby foes
  frenzyNoDecay: boolean; // Bloodlust stacks never decay
  kingTide: boolean;      // finishing blows release a breaking wave
}

export function emptyMods(): Mods {
  return {
    chainChance: 0, chainDamage: 0, smiteChance: 0, smiteDamage: 0,
    dashBoltDamage: 0, joltPct: 0, novaChance: 0, novaDamage: 0, novaRadius: 0,
    woundDPS: 0, frenzyPerKill: 0, frenzyCap: 0,
    knockbackPct: 0, slamDamage: 0, dashWave: 0, chillDur: 0, bountyChance: 0,
    vengefulSky: false, rideTheLightning: false, battleTrance: false,
    seaStorm: false, bloodTide: false, slipstream: false,
    stormLord: false, frenzyNoDecay: false, kingTide: false,
  };
}

export type EnemyKind = 'shade' | 'skitter' | 'spitter' | 'brute' | 'cinder' | 'weaver' | 'boss';

/** Elite affixes — elites from chamber 4 on roll one. */
export type EliteMod = 'splitter' | 'warded' | 'burning' | null;

export const ELITE_MOD_COLOR: Record<Exclude<EliteMod, null>, string> = {
  splitter: '#c17bff', warded: '#55d6f5', burning: '#ff7a30',
};

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number; y: number;
  vx: number; vy: number;   // knockback velocity (decays)
  radius: number;
  hp: number;
  maxHP: number;
  touchDamage: number;
  speed: number;
  xp: number;
  gold: number;
  elite: boolean;
  modifier: EliteMod;
  spawnT: number;           // >0: still rising in, harmless & unhittable
  flash: number;            // hit flash timer
  wobble: number;           // animation phase
  // statuses
  joltT: number;
  woundT: number;
  woundDPS: number;
  chillT: number;           // Poseidon: -28% speed while > 0
  burnTick: number;
  // per-source hit cooldowns (orbit blades, cinder path...)
  hitCd: Record<string, number>;
  // behaviour timers
  atkT: number;
  fuse: number;             // cinder: -1 until triggered
  windup: number;           // brute: telegraph countdown (-1 idle)
  lungeT: number;           // brute: active lunge time remaining
  lungeDirX: number;
  lungeDirY: number;
  emitT: number;            // burning elite: patch drop timer
  bossState?: BossState;
}

export type BossVariant = 'gatekeeper' | 'shepherd';

export type BossMove =
  | 'idle' | 'burst' | 'chargePrep' | 'charging' | 'summon' | 'spiral'
  | 'volley' | 'teleport' | 'ring';

export interface BossState {
  variant: BossVariant;
  phase: 1 | 2;
  move: BossMove;
  moveT: number;
  cycle: number;
  chargeDirX: number;
  chargeDirY: number;
  spiralA: number;
  volleyN: number;
  roared: boolean;
}

export type CharacterId = 'warrior' | 'archer' | 'mage';

export type ProjKind = 'dart' | 'chakram' | 'spit' | 'bossOrb' | 'soul' | 'mirror' | 'arrow' | 'orb' | 'spear';

export interface Projectile {
  kind: ProjKind;
  x: number; y: number;
  vx: number; vy: number;
  radius: number;
  damage: number;
  life: number;
  friendly: boolean;
  pierce: number;           // remaining pierces (-1 = infinite)
  spin: number;
  targetId: number;         // homing target (darts)
  phase: 0 | 1;             // chakram: 0 out, 1 return
  aoe: number;              // orb: explosion radius (0 = none)
  hitIds: Set<number>;
}

export type PickupKind = 'xp' | 'xp3' | 'xp8' | 'gold' | 'heart' | 'ichor';

export interface Pickup {
  kind: PickupKind;
  x: number; y: number;
  vx: number; vy: number;
  value: number;
  magnet: boolean;
  bob: number;
}

export interface DamageNumber {
  x: number; y: number;
  vy: number;
  text: string;
  life: number;
  crit: boolean;
  color: string | null;
}

export interface CinderPatch {
  x: number; y: number;
  radius: number;
  life: number;
  dps: number;
  hostile: boolean;         // burning elites leave patches that hurt YOU
  seed: number;             // flame flicker phase
}

export interface LightningFx {
  x1: number; y1: number; x2: number; y2: number;
  life: number;
  color: string;
}

export interface ShockwaveFx {
  x: number; y: number;
  r: number; maxR: number;
  life: number;
  color: string;
}

/** Comet Shard impacts land after a short telegraph. */
export interface DelayedHit {
  x: number; y: number;
  t: number;
  damage: number;
  radius: number;
}

// Capturable obelisks (Megabonk-style shrines): stand in the ring to channel,
// fend off the defense wave, collect an in-run buff. 'chaos' altars are a
// separate breed — they roll a random run-long fate, blessing or bane.
export type TowerKind = 'wrath' | 'storm' | 'haste' | 'greed' | 'vigor' | 'souls' | 'chaos';

/** Accumulated run-long modifiers from Altars of Fate. */
export interface ChaosModTotals {
  might: number;        // + player damage (Might bracket)
  atkSpeed: number;
  moveSpeed: number;
  maxHP: number;        // flat
  goldGain: number;
  xpGain: number;
  luck: number;
  enemyHP: number;      // + enemy health
  enemySpeed: number;   // + enemy speed
  damageTaken: number;  // + damage the player takes
}

export function emptyChaosMods(): ChaosModTotals {
  return {
    might: 0, atkSpeed: 0, moveSpeed: 0, maxHP: 0, goldGain: 0,
    xpGain: 0, luck: 0, enemyHP: 0, enemySpeed: 0, damageTaken: 0,
  };
}

export type FatePolarity = 'boon' | 'bane' | 'mixed';

/** A fate the player has accepted this run (for the build panel). */
export interface TakenFate {
  name: string;
  desc: string;
  polarity: FatePolarity;
}

export interface Tower {
  x: number;
  y: number;
  kind: TowerKind;
  progress: number;      // 0..1 channel progress
  captured: boolean;
  waveSpawned: boolean;  // the defense wave triggers once
  phase: number;         // glow animation
}

/** World chests: walk over to open. Gilded ones cost gold and give more. */
export interface Chest {
  x: number;
  y: number;
  gilded: boolean;
  cost: number;      // 0 for common chests
  phase: number;     // bob animation
  nagged: boolean;   // "not enough gold" toast shown for this approach
}

export type BuffKind = 'wrath' | 'storm' | 'haste' | 'greed' | 'regen';

export interface ActiveBuff {
  kind: BuffKind;
  power: number;
  t: number;    // remaining seconds
  dur: number;
}

/** Tartarus Snare: armed proximity mine that chills what it doesn't kill. */
export interface Trap {
  x: number; y: number;
  armT: number;      // arming countdown; triggers only once armed
  damage: number;
  radius: number;
  phase: number;     // pulse animation
}

export type RewardKind = 'boon' | 'gold' | 'heal' | 'xpcache' | 'ichor' | 'chest' | 'shop' | 'pom' | 'forge';

export interface Door {
  x: number; y: number;
  reward: RewardKind;
  god?: GodId;
}

export interface ShopItem {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
  cost: number;
  bought: boolean;
}

export interface Telegraph {
  kind: 'circle' | 'line';
  x: number; y: number;
  x2: number; y2: number;
  radius: number;
  t: number;
  maxT: number;
}

export interface Pillar {
  x: number; y: number;
  radius: number;
}

/** A boon the player owns (with its rolled rarity). */
export interface OwnedBoon {
  id: string;
  rarity: Rarity;
}

/** Runtime state of an equipped auto-weapon. */
export interface OwnedWeapon {
  id: string;
  level: number;
  t: number;        // fire timer
  angle: number;    // orbit phase
  trailT: number;   // cinder path emit timer
}

export interface RunTotals {
  kills: number;
  damageDealt: number;
  goldEarned: number;
  ichorEarned: number;
  peakHit: number;
}
