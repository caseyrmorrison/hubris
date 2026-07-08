// ---------------------------------------------------------------------------
// Static content definitions: enemies, bosses, auto-weapons, tomes, boons,
// mirror, biomes, heat pacts. All numbers here are the balance surface.
// ---------------------------------------------------------------------------
import type { BossVariant, EnemyKind, GodId, Mods, Rarity, Stats } from './types';
import type { SaveData } from './meta';

// ------------------------------ Enemies -----------------------------------

export interface EnemyDef {
  hp: number;
  speed: number;
  touchDamage: number;
  radius: number;
  xp: number;
  gold: number;
  color: string;
  sides: number;       // polygon sides for rendering
  weight: number;      // spawn weighting baseline
  minChamber: number;
}

export const ENEMY_DEFS: Record<Exclude<EnemyKind, 'boss'>, EnemyDef> = {
  shade:   { hp: 18,  speed: 74,  touchDamage: 7,  radius: 14, xp: 1, gold: 1, color: '#7d6bd9', sides: 5, weight: 100, minChamber: 1 },
  skitter: { hp: 10,  speed: 150, touchDamage: 5,  radius: 10, xp: 1, gold: 1, color: '#d96bd0', sides: 3, weight: 55,  minChamber: 2 },
  spitter: { hp: 26,  speed: 55,  touchDamage: 8,  radius: 15, xp: 2, gold: 2, color: '#ff7a5c', sides: 4, weight: 40,  minChamber: 3 },
  brute:   { hp: 95,  speed: 42,  touchDamage: 18, radius: 26, xp: 5, gold: 4, color: '#c94b4b', sides: 6, weight: 22,  minChamber: 4 },
  cinder:  { hp: 14,  speed: 120, touchDamage: 4,  radius: 12, xp: 2, gold: 1, color: '#ff9f45', sides: 3, weight: 30,  minChamber: 5 },
  weaver:  { hp: 34,  speed: 62,  touchDamage: 9,  radius: 15, xp: 3, gold: 3, color: '#ff6b9d', sides: 7, weight: 34,  minChamber: 6 },
  reaver:  { hp: 24,  speed: 128, touchDamage: 12, radius: 13, xp: 3, gold: 2, color: '#ff5a3c', sides: 4, weight: 42,  minChamber: 3 },
  stalker: { hp: 32,  speed: 120, touchDamage: 11, radius: 12, xp: 3, gold: 3, color: '#ff2e63', sides: 3, weight: 30,  minChamber: 5 },
};

/** Chamber scaling multipliers (c = 1-based chamber index). */
export function enemyHPScale(c: number): number {
  return 1 + 0.4 * (c - 1) + 0.085 * (c - 1) * (c - 1);
}
export function enemyDmgScale(c: number): number {
  return 1 + 0.13 * (c - 1);
}
/** Kill quota per chamber (boss chambers have none). */
export function chamberQuota(c: number): number {
  return 16 + c * 9;
}
/** Target number of simultaneously alive enemies. */
export function aliveTarget(c: number, tInChamber: number): number {
  return Math.min(10 + c * 8 + tInChamber * 0.6, 230);
}

// ------------------------------- Bosses -----------------------------------

export interface BossDef {
  name: string;
  baseHP: number;
  radius: number;
  speed: number;
  touchDamage: number;
  color: string;
  xp: number;
  gold: number;
}

export const BOSSES: Record<BossVariant, BossDef> = {
  gatekeeper: {
    name: 'THE GATEKEEPER', baseHP: 2400, radius: 52, speed: 66,
    touchDamage: 26, color: '#b23a67', xp: 40, gold: 60,
  },
  shepherd: {
    name: 'THE SHEPHERD OF SHADES', baseHP: 2050, radius: 44, speed: 82,
    touchDamage: 22, color: '#8b5cf6', xp: 40, gold: 60,
  },
};

/**
 * Boss HP scales with an estimate of build power so the fight lasts for
 * everyone: strong builds get a wall, weak builds don't slog.
 */
export function bossHPFor(variant: BossVariant, power: number, chamber: number): number {
  const mult = Math.min(9, Math.max(2.2, 1 + power * 0.055));
  const endless = chamber > CHAMBER_COUNT ? 1 + (chamber - CHAMBER_COUNT) * 0.35 : 1;
  // Stage factors: early heralds are light, twin fights split the pool,
  // the chamber-15 gate stands alone and tall, the finale pairs two near-full.
  const stage =
    chamber < 10 ? 0.55 :        // chamber 5 herald
    chamber === 10 ? 0.6 :       // twin barrier (×2 bosses)
    chamber < CHAMBER_COUNT ? 0.85 : // chamber 15 gate
    chamber === CHAMBER_COUNT ? 0.9 : // final twins (×2 bosses)
    1;                           // endless singles (scaled by `endless`)
  return Math.round(BOSSES[variant].baseHP * mult * endless * stage);
}

// ---------------------------- Auto-weapons --------------------------------

export const WEAPON_MAX_LEVEL = 7; // level 7 = Transcended

export interface WeaponUnlock {
  desc: string;
  /** [current, goal] against lifetime save counters. */
  progress(save: SaveData): [number, number];
}

export interface WeaponDef {
  id: string;
  name: string;
  color: string;
  icon: string; // single glyph used in UI cards
  unlock?: WeaponUnlock;
  describe(level: number): string;
}

// Per-level tuning tables (index 0 = level 1)
export const AEGIS = {
  blades: [2, 2, 3, 3, 4, 4, 5],
  damage: [10, 14, 18, 24, 30, 38, 60],
  radius: [72, 76, 82, 88, 94, 100, 112],
  spinSpeed: 2.7,
  hitCooldown: 0.38,
};
export const DARTS = {
  count: [1, 2, 2, 3, 3, 4, 5],
  damage: [13, 15, 19, 23, 28, 34, 52],
  interval: [1.15, 1.1, 1.0, 0.95, 0.85, 0.78, 0.62],
  speed: 460,
};
export const PULSE = {
  damage: [16, 21, 27, 34, 42, 52, 82],
  radius: [110, 124, 138, 152, 166, 180, 210],
  interval: [2.9, 2.7, 2.5, 2.3, 2.1, 1.9, 1.5],
  knockback: 260,
};
export const CINDERPATH = {
  dps: [9, 13, 17, 22, 28, 35, 55],
  radius: [30, 33, 36, 39, 43, 47, 56],
  duration: 2.3,
  emitEvery: 0.14,
};
export const CHAKRAM = {
  count: [1, 1, 1, 2, 2, 2, 3],
  damage: [17, 22, 28, 32, 40, 50, 76],
  interval: [2.3, 2.1, 1.9, 1.9, 1.7, 1.5, 1.2],
  speed: 430,
  range: 380,
  radius: 16,
};
export const LASH = {
  damage: [15, 19, 24, 30, 37, 46, 72],
  interval: [1.5, 1.4, 1.3, 1.2, 1.1, 1.0, 0.8],
  chains: [2, 2, 3, 3, 4, 5, 6],
  range: 360,
  chainRange: 190,
  chainFrac: 0.6,
};
export const MIRRORB = {
  count: [2, 2, 3, 3, 4, 4, 6],
  damage: [12, 16, 20, 25, 31, 39, 60],
  interval: [1.6, 1.5, 1.4, 1.3, 1.2, 1.1, 0.9],
  speed: 480,
  pierce: 2,
};
export const COMET = {
  damage: [24, 30, 38, 47, 58, 72, 110],
  interval: [2.8, 2.6, 2.4, 2.2, 2.0, 1.8, 1.4],
  radius: [70, 74, 78, 84, 90, 96, 110],
  delay: 0.55,
  range: 460,
};
export const SPEAR = {
  count: [1, 1, 2, 2, 2, 3, 4],
  damage: [16, 20, 25, 31, 38, 47, 72],
  interval: [1.7, 1.6, 1.5, 1.4, 1.3, 1.2, 1.0],
  speed: 720,
  pierce: 5,
  life: 0.75,
};
export const TRAPDEF = {
  damage: [20, 26, 33, 41, 50, 62, 95],
  interval: [2.6, 2.4, 2.2, 2.0, 1.9, 1.8, 1.6],
  radius: 90,
  maxOut: [2, 2, 3, 3, 3, 4, 5],
  armTime: 0.5,
  chill: 1.5,
};
export const HAMMER = {
  damage: [26, 33, 42, 52, 64, 80, 120],
  interval: [2.4, 2.2, 2.1, 1.9, 1.8, 1.6, 1.4],
  radius: [80, 84, 88, 94, 100, 106, 118],
  reach: 120,
  knockback: 320,
};

export const WEAPON_DEFS: WeaponDef[] = [
  {
    id: 'aegis', name: 'Aegis Shards', color: '#8fdcff', icon: '✹',
    describe: (l) => `${AEGIS.blades[l - 1]} shards orbit you, each dealing ${AEGIS.damage[l - 1]} on contact.`,
  },
  {
    id: 'darts', name: 'Seeker Darts', color: '#7bf1a8', icon: '➳',
    describe: (l) => `Fires ${DARTS.count[l - 1]} homing dart${DARTS.count[l - 1] > 1 ? 's' : ''} (${DARTS.damage[l - 1]} dmg) every ${DARTS.interval[l - 1]}s.`,
  },
  {
    id: 'pulse', name: 'Pulse of Olympus', color: '#c17bff', icon: '◉',
    describe: (l) => `Nova every ${PULSE.interval[l - 1]}s: ${PULSE.damage[l - 1]} dmg in a ${PULSE.radius[l - 1]}px ring, knocks back.`,
  },
  {
    id: 'cinderpath', name: 'Cinder Path', color: '#ff9f45', icon: '♨',
    describe: (l) => `Your steps burn: ${CINDERPATH.dps[l - 1]} dmg/s trail while moving.`,
  },
  {
    id: 'chakram', name: 'Returning Chakram', color: '#f0c75e', icon: '❍',
    describe: (l) => `Throws ${CHAKRAM.count[l - 1]} piercing chakram${CHAKRAM.count[l - 1] > 1 ? 's' : ''} (${CHAKRAM.damage[l - 1]} dmg) that return.`,
  },
  {
    id: 'lash', name: 'Storm Lash', color: '#8fdcff', icon: 'ϟ',
    unlock: {
      desc: 'Deal 50,000 lifetime damage',
      progress: (s) => [Math.min(s.totalDamage, 50000), 50000],
    },
    describe: (l) => `Lightning whip strikes the nearest foe (${LASH.damage[l - 1]} dmg) and chains to ${LASH.chains[l - 1]} others.`,
  },
  {
    id: 'mirror', name: 'Mirror Blades', color: '#d96bd0', icon: '⋈',
    unlock: {
      desc: 'Escape the underworld once',
      progress: (s) => [Math.min(s.wins, 1), 1],
    },
    describe: (l) => `Fires ${MIRRORB.count[l - 1]} piercing blades (${MIRRORB.damage[l - 1]} dmg) behind you — guards your back.`,
  },
  {
    id: 'comet', name: 'Comet Shard', color: '#ff9f45', icon: '☄',
    unlock: {
      desc: 'Slay 2,000 lifetime foes',
      progress: (s) => [Math.min(s.kills, 2000), 2000],
    },
    describe: (l) => `Calls a comet on a random foe every ${COMET.interval[l - 1]}s: ${COMET.damage[l - 1]} dmg in a ${COMET.radius[l - 1]}px blast.`,
  },
  {
    id: 'spear', name: 'Phalanx Spears', color: '#ffd166', icon: '❯',
    describe: (l) => `Hurls ${SPEAR.count[l - 1]} deep-piercing spear${SPEAR.count[l - 1] > 1 ? 's' : ''} (${SPEAR.damage[l - 1]} dmg) where you aim.`,
  },
  {
    id: 'trap', name: 'Tartarus Snare', color: '#9b5de5', icon: '✳',
    describe: (l) => `Plants mines (up to ${TRAPDEF.maxOut[l - 1]}): ${TRAPDEF.damage[l - 1]} dmg blast that Chills survivors.`,
  },
  {
    id: 'hammer', name: 'Echo Hammer', color: '#c9a86a', icon: '⚒',
    unlock: {
      desc: 'Complete 10 runs',
      progress: (s) => [Math.min(s.runs, 10), 10],
    },
    describe: (l) => `Slams the ground ahead every ${HAMMER.interval[l - 1]}s: ${HAMMER.damage[l - 1]} dmg and a mighty shove.`,
  },
];

export function weaponDef(id: string): WeaponDef {
  return WEAPON_DEFS.find((w) => w.id === id)!;
}

export function weaponUnlocked(def: WeaponDef, save: SaveData): boolean {
  if (!def.unlock) return true;
  if (save.seenUnlocks.includes(def.id)) return true;
  const [cur, goal] = def.unlock.progress(save);
  return cur >= goal;
}

// ------------------------------- Tomes ------------------------------------

export const TOME_MAX_LEVEL = 5;

export interface TomeDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  desc: string;             // per-level effect description
  apply(stats: Stats, level: number): void;
}

export const TOME_DEFS: TomeDef[] = [
  { id: 'might', name: 'Tome of Might', icon: '⚔', color: '#ff5a5a',
    desc: '+10% damage per rank', apply: (s, l) => { s.might += 0.10 * l; } },
  { id: 'haste', name: 'Tome of Haste', icon: '⚡', color: '#8fdcff',
    desc: '+8% attack speed per rank', apply: (s, l) => { s.atkSpeed += 0.08 * l; } },
  { id: 'vitality', name: 'Tome of Vitality', icon: '❤', color: '#3ddc97',
    desc: '+20 max HP per rank', apply: (s, l) => { s.maxHP += 20 * l; } },
  { id: 'insight', name: 'Tome of Insight', icon: '◎', color: '#c17bff',
    desc: '+15% XP per rank', apply: (s, l) => { s.xpGain += 0.15 * l; } },
  { id: 'fortune', name: 'Tome of Fortune', icon: '☘', color: '#7bf1a8',
    desc: '+1 Luck per rank (better rarities & rewards)', apply: (s, l) => { s.luck += l; } },
  { id: 'greed', name: 'Tome of Greed', icon: '◈', color: '#f0c75e',
    desc: '+20% gold per rank', apply: (s, l) => { s.goldGain += 0.20 * l; } },
  { id: 'sandals', name: 'Winged Sandals', icon: '↯', color: '#ffe08a',
    desc: '+7% move speed per rank', apply: (s, l) => { s.moveSpeed += 0.07 * l; } },
  { id: 'precision', name: 'Tome of Precision', icon: '✦', color: '#ff9f45',
    desc: '+5% crit chance per rank', apply: (s, l) => { s.critChance += 0.05 * l; } },
  { id: 'colossus', name: 'Tome of the Colossus', icon: '⛰', color: '#b23a67',
    desc: '+8% damage to elites & bosses per rank', apply: (s, l) => { s.vsElitePct += 0.08 * l; } },
  { id: 'turtle', name: 'Tome of the Turtle', icon: '⛨', color: '#4a90ff',
    desc: '+0.6 armor per rank (flat damage reduction)', apply: (s, l) => { s.armor += 0.6 * l; } },
  { id: 'momentum', name: 'Tome of Momentum', icon: '≫', color: '#ffe08a',
    desc: '+3% move & +3% attack speed per rank', apply: (s, l) => { s.moveSpeed += 0.03 * l; s.atkSpeed += 0.03 * l; } },
  { id: 'leech', name: 'Tome of the Leech', icon: '❧', color: '#e05780',
    desc: 'Kills restore 0.3 HP per rank', apply: (s, l) => { s.killHeal += 0.3 * l; } },
];

export function tomeDef(id: string): TomeDef {
  return TOME_DEFS.find((t) => t.id === id)!;
}

// ------------------------------- Boons ------------------------------------

export interface BoonDef {
  id: string;
  god: GodId;
  name: string;
  duo?: GodId;                       // second god (duo boon) — requires a boon from both
  legendary?: boolean;               // boss-reward tier; never in normal offerings
  describe(mult: number): string;
  apply(stats: Stats, mods: Mods, mult: number): void;
}

/** Hades-orange for the legendary tier. */
export const LEGENDARY_COLOR = '#ff9838';

export const BOON_DEFS: BoonDef[] = [
  // --- ZEUS: storm ---
  {
    id: 'z_chain', god: 'zeus', name: 'Chain Lightning',
    describe: (m) => `Your strike arcs lightning to ${3} nearby foes for ${Math.round(45 * m)}% of the hit.`,
    apply: (s, mo, m) => { mo.chainChance = 1; mo.chainDamage += 0.45 * m; },
  },
  {
    id: 'z_smite', god: 'zeus', name: 'Olympian Sanction',
    describe: (m) => `Auto-weapon hits have ${Math.round(12 * m)}% chance to smite for ${Math.round(30 * m)} bolt damage.`,
    apply: (s, mo, m) => { mo.smiteChance += 0.12 * m; mo.smiteDamage += 30 * m; },
  },
  {
    id: 'z_dashbolt', god: 'zeus', name: 'Thunder Flourish',
    describe: (m) => `Dashing drops a static bolt dealing ${Math.round(40 * m)} damage around your launch point.`,
    apply: (s, mo, m) => { mo.dashBoltDamage += 40 * m; },
  },
  {
    id: 'z_jolt', god: 'zeus', name: 'Static Charge',
    describe: (m) => `Lightning Jolts foes: they take +${Math.round(25 * m)}% damage for 4s.`,
    apply: (s, mo, m) => { mo.joltPct += 0.25 * m; },
  },
  {
    id: 'z_haste', god: 'zeus', name: 'Storm Tempo',
    describe: (m) => `+${Math.round(15 * m)}% attack speed.`,
    apply: (s, mo, m) => { s.atkSpeed += 0.15 * m; },
  },
  // --- ARES: carnage ---
  {
    id: 'a_strike', god: 'ares', name: 'Brutal Edge',
    describe: (m) => `+${Math.round(40 * m)}% strike damage.`,
    apply: (s, mo, m) => { s.strikePct += 0.40 * m; },
  },
  {
    id: 'a_nova', god: 'ares', name: 'Blood Detonation',
    describe: (m) => `Kills have ${Math.round(30 * m)}% chance to detonate: ${Math.round(35 * m)} damage nova.`,
    apply: (s, mo, m) => { mo.novaChance += 0.30 * m; mo.novaDamage += 35 * m; mo.novaRadius = Math.max(mo.novaRadius, 90); },
  },
  {
    id: 'a_crit', god: 'ares', name: 'Killer Instinct',
    describe: (m) => `+${Math.round(10 * m)}% crit chance.`,
    apply: (s, mo, m) => { s.critChance += 0.10 * m; },
  },
  {
    id: 'a_wound', god: 'ares', name: 'Grievous Wounds',
    describe: (m) => `Strike hits Wound foes: ${Math.round(12 * m)} damage/s for 3s.`,
    apply: (s, mo, m) => { mo.woundDPS += 12 * m; },
  },
  {
    id: 'a_frenzy', god: 'ares', name: 'Bloodlust',
    describe: (m) => `+1% damage per kill (max ${Math.round(25 * m)}%), decays out of combat.`,
    apply: (s, mo, m) => { mo.frenzyPerKill = Math.max(mo.frenzyPerKill, 0.01); mo.frenzyCap += 0.25 * m; },
  },
  // --- HERMES: tempo ---
  {
    id: 'h_speed', god: 'hermes', name: 'Greater Haste',
    describe: (m) => `+${Math.round(16 * m)}% move speed.`,
    apply: (s, mo, m) => { s.moveSpeed += 0.16 * m; },
  },
  {
    id: 'h_dash', god: 'hermes', name: 'Extra Wind',
    describe: (m) => `+1 dash charge; dashes recharge ${Math.round(15 * m)}% faster.`,
    apply: (s, mo, m) => { s.dashCharges += 1; s.dashRecharge *= 1 / (1 + 0.15 * m); },
  },
  {
    id: 'h_auto', god: 'hermes', name: 'Quick Hands',
    describe: (m) => `+${Math.round(30 * m)}% auto-weapon damage.`,
    apply: (s, mo, m) => { s.autoPct += 0.30 * m; },
  },
  {
    id: 'h_magnet', god: 'hermes', name: 'Fleet Fingers',
    describe: (m) => `+${Math.round(60 * m)}px pickup radius and +${Math.round(10 * m)}% XP.`,
    apply: (s, mo, m) => { s.pickupRadius += 60 * m; s.xpGain += 0.10 * m; },
  },
  {
    id: 'h_greed', god: 'hermes', name: 'Silver Tongue',
    describe: (m) => `+${Math.round(30 * m)}% gold.`,
    apply: (s, mo, m) => { s.goldGain += 0.30 * m; },
  },
  // --- POSEIDON: tides ---
  {
    id: 'p_strike', god: 'poseidon', name: 'Tidal Strike',
    describe: (m) => `+${Math.round(15 * m)}% strike damage; your blows knock foes ${Math.round(60 * m)}% further.`,
    apply: (s, mo, m) => { s.strikePct += 0.15 * m; mo.knockbackPct += 0.60 * m; },
  },
  {
    id: 'p_slam', god: 'poseidon', name: 'Crushing Depths',
    describe: (m) => `Foes smashed into walls take ${Math.round(30 * m)} damage.`,
    apply: (s, mo, m) => { mo.slamDamage += 30 * m; },
  },
  {
    id: 'p_wave', god: 'poseidon', name: 'Breaking Wave',
    describe: (m) => `Dashing releases a wave: ${Math.round(25 * m)} damage that shoves everything nearby.`,
    apply: (s, mo, m) => { mo.dashWave += 25 * m; },
  },
  {
    id: 'p_slow', god: 'poseidon', name: 'Undertow',
    describe: (m) => `Strike hits Chill foes: −28% speed for ${(2.5 * m).toFixed(1)}s.`,
    apply: (s, mo, m) => { mo.chillDur = Math.max(mo.chillDur, 2.5 * m); },
  },
  {
    id: 'p_bounty', god: 'poseidon', name: "Ocean's Bounty",
    describe: (m) => `Kills have ${Math.round(12 * m)}% chance to drop double loot.`,
    apply: (s, mo, m) => { mo.bountyChance += 0.12 * m; },
  },
  // --- DUOS ---
  {
    id: 'd_vengefulsky', god: 'zeus', duo: 'ares', name: 'Vengeful Sky',
    describe: () => `Blood Detonations also call lightning bolts from the sky.`,
    apply: (s, mo) => { mo.vengefulSky = true; mo.novaChance = Math.max(mo.novaChance, 0.3); mo.novaDamage = Math.max(mo.novaDamage, 35); mo.novaRadius = Math.max(mo.novaRadius, 90); },
  },
  {
    id: 'd_ridelightning', god: 'zeus', duo: 'hermes', name: 'Ride the Lightning',
    describe: () => `Your dash becomes a lightning blink that shocks everything along its path.`,
    apply: (s, mo) => { mo.rideTheLightning = true; },
  },
  {
    id: 'd_battletrance', god: 'ares', duo: 'hermes', name: 'Battle Trance',
    describe: () => `Bloodlust stacks also grant move & attack speed.`,
    apply: (s, mo) => { mo.battleTrance = true; mo.frenzyPerKill = Math.max(mo.frenzyPerKill, 0.01); mo.frenzyCap = Math.max(mo.frenzyCap, 0.25); },
  },
  {
    id: 'd_seastorm', god: 'zeus', duo: 'poseidon', name: 'Sea Storm',
    describe: () => `Chilled foes take +15% damage from everything.`,
    apply: (s, mo) => { mo.seaStorm = true; mo.chillDur = Math.max(mo.chillDur, 2.5); },
  },
  {
    id: 'd_bloodtide', god: 'ares', duo: 'poseidon', name: 'Blood Tide',
    describe: () => `Blood Detonations shove everything they catch far away.`,
    apply: (s, mo) => { mo.bloodTide = true; mo.novaChance = Math.max(mo.novaChance, 0.3); mo.novaDamage = Math.max(mo.novaDamage, 35); mo.novaRadius = Math.max(mo.novaRadius, 90); },
  },
  {
    id: 'd_slipstream', god: 'hermes', duo: 'poseidon', name: 'Slipstream',
    describe: () => `+10% move speed, and dashing knocks enemies out of your path.`,
    apply: (s, mo) => { mo.slipstream = true; s.moveSpeed += 0.10; },
  },
  // --- LEGENDARIES (guaranteed boss rewards; one per god) ---
  {
    id: 'l_zeus', god: 'zeus', legendary: true, name: "Skyfather's Wrath",
    describe: () => `A living storm follows you: lightning strikes a nearby foe every moment.`,
    apply: (s, mo) => { mo.stormLord = true; },
  },
  {
    id: 'l_ares', god: 'ares', legendary: true, name: 'Rage Incarnate',
    describe: () => `Bloodlust never decays, and its cap rises by 25%.`,
    apply: (s, mo) => {
      mo.frenzyNoDecay = true;
      mo.frenzyPerKill = Math.max(mo.frenzyPerKill, 0.01);
      mo.frenzyCap += 0.25;
    },
  },
  {
    id: 'l_hermes', god: 'hermes', legendary: true, name: 'Divine Celerity',
    describe: () => `+1 dash charge, +20% attack speed, dashes recharge 25% faster.`,
    apply: (s) => { s.dashCharges += 1; s.atkSpeed += 0.20; s.dashRecharge *= 0.75; },
  },
  {
    id: 'l_poseidon', god: 'poseidon', legendary: true, name: 'King Tide',
    describe: () => `Your finishing blows release a breaking wave that shoves and wounds everything near.`,
    apply: (s, mo) => { mo.kingTide = true; },
  },
];

export function boonDef(id: string): BoonDef {
  return BOON_DEFS.find((b) => b.id === id)!;
}

/** Rarity odds shift with luck. Returns rolled rarity. */
export function rollRarity(luck: number): Rarity {
  const rare = Math.min(0.55, 0.22 + luck * 0.05);
  const epic = Math.min(0.4, 0.07 + luck * 0.03);
  const r = Math.random();
  if (r < epic) return 'epic';
  if (r < epic + rare) return 'rare';
  return 'common';
}

// ---------------------------- Mirror of Hubris -----------------------------

export interface MirrorDef {
  id: string;
  name: string;
  desc: string;
  maxLevel: number;
  costs: number[];
}

export const MIRROR_DEFS: MirrorDef[] = [
  { id: 'vigor', name: 'Vigor', desc: '+15 max HP per rank', maxLevel: 7, costs: [4, 6, 9, 13, 18, 24, 31] },
  { id: 'ferocity', name: 'Ferocity', desc: '+5% damage per rank', maxLevel: 7, costs: [5, 8, 12, 17, 23, 30, 38] },
  { id: 'swiftness', name: 'Swiftness', desc: '+4% move speed per rank', maxLevel: 5, costs: [4, 7, 11, 16, 22] },
  { id: 'defiance', name: 'Death Defiance', desc: 'Cheat death once per run per rank (revive at 50% HP)', maxLevel: 2, costs: [30, 55] },
  { id: 'wind', name: 'Second Wind', desc: '+1 dash charge', maxLevel: 1, costs: [20] },
  { id: 'keeneye', name: 'Keen Eye', desc: '+1 free reroll per run', maxLevel: 3, costs: [8, 16, 26] },
  { id: 'goldtouch', name: 'Golden Touch', desc: '+15% gold per rank', maxLevel: 5, costs: [4, 7, 10, 14, 19] },
  { id: 'scholar', name: 'Scholar', desc: '+10% XP per rank', maxLevel: 5, costs: [6, 10, 15, 20, 26] },
  { id: 'favor', name: "Fortune's Favor", desc: '+1 Luck per rank', maxLevel: 3, costs: [10, 18, 28] },
  { id: 'headstart', name: 'Head Start', desc: 'Begin each run with a random Common boon per rank', maxLevel: 2, costs: [15, 35] },
  { id: 'armor', name: 'Thick Skin', desc: 'Every hit deals 1 less damage per rank (min 1)', maxLevel: 3, costs: [8, 14, 22] },
  { id: 'lethality', name: 'Lethality', desc: '+2% crit chance per rank', maxLevel: 3, costs: [7, 12, 18] },
  { id: 'pockets', name: 'Deep Pockets', desc: 'Begin each run with 50 gold per rank', maxLevel: 3, costs: [5, 9, 14] },
  { id: 'awakening', name: 'Awakening', desc: 'Begin each run 1 level higher per rank', maxLevel: 3, costs: [12, 20, 30] },
  { id: 'council', name: 'Council of Gods', desc: 'God offerings present a 4th boon to choose from', maxLevel: 1, costs: [40] },
  { id: 'echoes', name: 'Lingering Echoes', desc: 'Obelisk buffs last 20% longer per rank', maxLevel: 3, costs: [6, 11, 17] },
  { id: 'charon', name: "Charon's Favor", desc: 'Shop, gilded chest & reroll prices −10% per rank', maxLevel: 3, costs: [8, 13, 20] },
  { id: 'lodestone', name: 'Lodestone', desc: '+25px pickup radius per rank', maxLevel: 2, costs: [5, 10] },
];

// -------------------------- Pact of Punishment -----------------------------

export interface HeatDef {
  id: string;
  name: string;
  desc: string;
  maxLevel: number;
}

export const HEAT_DEFS: HeatDef[] = [
  { id: 'foes', name: 'Hardened Foes', desc: '+30% enemy health per rank', maxLevel: 2 },
  { id: 'swift', name: 'Swift Doom', desc: '+15% enemy speed', maxLevel: 1 },
  { id: 'quota', name: 'Tight Quota', desc: '+40% enemies per chamber', maxLevel: 1 },
  { id: 'frail', name: 'Frail Vessel', desc: '−25 max HP', maxLevel: 1 },
  { id: 'stingy', name: 'Stingy Fates', desc: 'One fewer door per chamber', maxLevel: 1 },
];

// ------------------------------- Biomes ------------------------------------

export interface Biome {
  name: string;
  floorTop: string;
  floorBottom: string;
  grid: string;
  /** rgba prefix, alpha appended at draw time, e.g. 'rgba(133,153,255,' */
  wall: string;
  pillar: string;
  pillarEdge: string;
}

export const BIOMES: Biome[] = [
  {
    name: 'THE HOLLOWS',
    floorTop: '#141a33', floorBottom: '#0e1226',
    grid: 'rgba(96,116,190,0.08)', wall: 'rgba(133,153,255,',
    pillar: '#1a2040', pillarEdge: 'rgba(133,153,255,',
  },
  {
    name: 'THE EMBER COURT',
    floorTop: '#2b1520', floorBottom: '#170c13',
    grid: 'rgba(255,140,90,0.07)', wall: 'rgba(255,159,105,',
    pillar: '#2e1a20', pillarEdge: 'rgba(255,159,105,',
  },
];

/** Chambers 1-5 Hollows, 6-10 Ember Court, alternating every 5 in endless. */
export function biomeIndex(c: number): number {
  return Math.floor((c - 1) / 5) % 2;
}

// ----------------------------- Characters ----------------------------------

/** A cosmetic skin: body/trim recolor, unlocked by a per-character feat. */
export interface SkinDef {
  id: string;
  name: string;
  body: string;
  trim: string;
  unlock?: {
    desc: string;
    progress(cs: import('./meta').CharStats): [number, number];
  };
}

export interface CharacterDef {
  id: import('./types').CharacterId;
  name: string;
  weapon: string;
  color: string;
  glyph: string;
  attackDesc: string;
  passiveDesc: string;
  skins: SkinDef[];   // index 0 = default, always unlocked
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'warrior', name: 'THE EXILE', weapon: 'Ashen Blade', color: '#f0c75e', glyph: '⚔',
    attackDesc: 'Sweeping 3-hit combo — the finisher hits harder. Swings parry projectiles.',
    passiveDesc: 'Battle-hardened: +20 max HP.',
    skins: [
      { id: 'w_default', name: 'Gilded Exile', body: '#f0c75e', trim: '#ffe9b0' },
      { id: 'w_blood', name: 'Bloodforged', body: '#ff5a5a', trim: '#ffc2c2',
        unlock: { desc: 'Slay 1,000 foes as the Exile',
          progress: (cs) => [Math.min(cs.kills, 1000), 1000] } },
      { id: 'w_stygian', name: 'Stygian Steel', body: '#8fa9c9', trim: '#e3ecf7',
        unlock: { desc: 'Defeat the Gatekeeper as the Exile',
          progress: (cs) => [Math.min(cs.wins, 1), 1] } },
    ],
  },
  {
    id: 'archer', name: 'THE HUNTRESS', weapon: 'Sable Bow', color: '#7bf1a8', glyph: '➳',
    attackDesc: 'Long-range piercing arrows; every 3rd shot looses a triple volley.',
    passiveDesc: 'Hawk eye: +50% pickup radius, +5% move speed.',
    skins: [
      { id: 'a_default', name: 'Verdant Huntress', body: '#7bf1a8', trim: '#dcffe9' },
      { id: 'a_moonlit', name: 'Moonlit', body: '#55d6f5', trim: '#d7f6ff',
        unlock: { desc: 'Reach chamber 8 as the Huntress',
          progress: (cs) => [Math.min(cs.bestChamber, 8), 8] } },
      { id: 'a_autumn', name: 'Autumn Vale', body: '#ff9f45', trim: '#ffe0b8',
        unlock: { desc: 'Defeat the Gatekeeper as the Huntress',
          progress: (cs) => [Math.min(cs.wins, 1), 1] } },
    ],
  },
  {
    id: 'mage', name: 'THE ORACLE', weapon: 'Circlet Staff', color: '#8fdcff', glyph: '✦',
    attackDesc: 'Exploding spell-orbs; every 3rd casts a surge with a far larger blast.',
    passiveDesc: 'Mana shield: absorbs hits and regenerates out of combat.',
    skins: [
      { id: 'm_default', name: 'Azure Oracle', body: '#8fdcff', trim: '#e8f6ff' },
      { id: 'm_void', name: 'Voidbound', body: '#ff4fd8', trim: '#ffd0f4',
        unlock: { desc: 'Slay 750 foes as the Oracle',
          progress: (cs) => [Math.min(cs.kills, 750), 750] } },
      { id: 'm_solar', name: 'Solar Flare', body: '#ffd166', trim: '#fff0c2',
        unlock: { desc: 'Reach chamber 10 as the Oracle',
          progress: (cs) => [Math.min(cs.bestChamber, 10), 10] } },
    ],
  },
];

export function characterDef(id: import('./types').CharacterId): CharacterDef {
  return CHARACTERS.find((c) => c.id === id)!;
}

export function skinUnlocked(skin: SkinDef, cs: import('./meta').CharStats): boolean {
  if (!skin.unlock) return true;
  const [cur, goal] = skin.unlock.progress(cs);
  return cur >= goal;
}

// Basic-attack tuning (all scale with the strike bracket & attack speed)
export const ARROW = {
  base: 15, speed: 660, cd: 0.38, life: 0.85, pierce: 1,
  power: { mult: 1.5, count: 3, spread: 0.16, pierce: 3, cd: 0.55 },
};
export const ORB = {
  base: 18, speed: 430, cd: 0.6, life: 1.35, aoe: 48, aoeFrac: 0.7,
  surge: { mult: 1.6, aoe: 84, cd: 0.85 },
};
export const MANA_SHIELD = {
  capFrac: 0.25,     // shield capacity as a fraction of max HP
  regenDelay: 6,     // seconds without damage before regen starts
  regenRate: 9,      // shield per second
};

// ------------------------------- Towers ------------------------------------

export const TOWER_CAPTURE_RADIUS = 92;
export const TOWER_CHANNEL_TIME = 3.5;   // seconds standing in the ring
export const TOWER_DECAY_RATE = 0.5;     // progress lost per second outside

export interface TowerDef {
  kind: import('./types').TowerKind;
  name: string;
  color: string;
  glyph: string;
  desc: string;
  weight: number;
}

export const TOWER_DEFS: TowerDef[] = [
  { kind: 'wrath', name: 'Obelisk of Wrath', color: '#ff5a5a', glyph: '⚔',
    desc: '+35% damage for 45s', weight: 20 },
  { kind: 'storm', name: 'Obelisk of Storms', color: '#8fdcff', glyph: 'ϟ',
    desc: 'lightning storms rage for 30s', weight: 18 },
  { kind: 'haste', name: 'Obelisk of Haste', color: '#f4f1ea', glyph: '↯',
    desc: '+30% attack & +20% move speed for 30s', weight: 18 },
  { kind: 'greed', name: 'Obelisk of Greed', color: '#f0c75e', glyph: '◈',
    desc: 'gold shower · +50% gold for 60s', weight: 15 },
  { kind: 'vigor', name: 'Obelisk of Vigor', color: '#3ddc97', glyph: '✚',
    desc: 'heal 25% · regenerate for 20s', weight: 15 },
  { kind: 'souls', name: 'Obelisk of Souls', color: '#c17bff', glyph: '◎',
    desc: 'a burst of souls · vacuums every gem', weight: 14 },
  // Weight 0: Altars of Fate never roll from the obelisk pool — they spawn
  // on their own schedule and gamble a run-long modifier.
  { kind: 'chaos', name: 'Altar of Fate', color: '#ff4fd8', glyph: '✺',
    desc: 'a random fate — blessing or bane', weight: 0 },
];

export function towerDef(kind: import('./types').TowerKind): TowerDef {
  return TOWER_DEFS.find((t) => t.kind === kind)!;
}

// --------------------------- Altars of Fate --------------------------------
// Chaos towers roll one of these run-long modifiers. Blessings are common,
// banes sting, and mixed pacts are where the fun lives.

export interface ChaosModDef {
  id: string;
  name: string;
  polarity: import('./types').FatePolarity;
  desc: string;
  weight: number;
  apply(m: import('./types').ChaosModTotals): void;
}

export const CHAOS_MODS: ChaosModDef[] = [
  // Blessings
  { id: 'fate_might', name: 'Sharpened Fate', polarity: 'boon',
    desc: '+15% damage', weight: 10, apply: (m) => { m.might += 0.15; } },
  { id: 'fate_haste', name: 'Quickened Fate', polarity: 'boon',
    desc: '+15% attack speed', weight: 10, apply: (m) => { m.atkSpeed += 0.15; } },
  { id: 'fate_swift', name: 'Fleet Fate', polarity: 'boon',
    desc: '+10% move speed', weight: 10, apply: (m) => { m.moveSpeed += 0.10; } },
  { id: 'fate_vigor', name: 'Thick Blood', polarity: 'boon',
    desc: '+30 max HP', weight: 10, apply: (m) => { m.maxHP += 30; } },
  { id: 'fate_gold', name: 'Gilded Fate', polarity: 'boon',
    desc: '+25% gold', weight: 9, apply: (m) => { m.goldGain += 0.25; } },
  { id: 'fate_luck', name: 'Lucky Fate', polarity: 'boon',
    desc: '+2 Luck', weight: 9, apply: (m) => { m.luck += 2; } },
  // Banes
  { id: 'fate_hungry', name: 'Hungry Depths', polarity: 'bane',
    desc: 'enemies +20% health', weight: 7, apply: (m) => { m.enemyHP += 0.20; } },
  { id: 'fate_doom', name: 'Hastened Doom', polarity: 'bane',
    desc: 'enemies +12% speed', weight: 7, apply: (m) => { m.enemySpeed += 0.12; } },
  { id: 'fate_frail', name: 'Thinned Blood', polarity: 'bane',
    desc: '−20 max HP', weight: 7, apply: (m) => { m.maxHP -= 20; } },
  { id: 'fate_dim', name: 'Dimmed Insight', polarity: 'bane',
    desc: '−15% XP', weight: 7, apply: (m) => { m.xpGain -= 0.15; } },
  // Mixed pacts
  { id: 'fate_glass', name: 'Glass Cannon', polarity: 'mixed',
    desc: '+25% damage · −25 max HP', weight: 9,
    apply: (m) => { m.might += 0.25; m.maxHP -= 25; } },
  { id: 'fate_berserk', name: 'Berserker’s Pact', polarity: 'mixed',
    desc: '+25% attack speed · enemies +12% speed', weight: 9,
    apply: (m) => { m.atkSpeed += 0.25; m.enemySpeed += 0.12; } },
  { id: 'fate_midas', name: 'Midas Curse', polarity: 'mixed',
    desc: '+50% gold · enemies +15% health', weight: 9,
    apply: (m) => { m.goldGain += 0.50; m.enemyHP += 0.15; } },
  { id: 'fate_blood', name: 'Blood Price', polarity: 'mixed',
    desc: '+20% damage · +15% damage taken', weight: 9,
    apply: (m) => { m.might += 0.20; m.damageTaken += 0.15; } },
];

export const FATE_COLOR: Record<import('./types').FatePolarity, string> = {
  boon: '#3ddc97', bane: '#ee4266', mixed: '#ff4fd8',
};

// ------------------------------ XP curve -----------------------------------

export function xpForLevel(level: number): number {
  // level = current level; XP needed to reach the next one.
  return Math.round(10 + (level - 1) * 6 + (level - 1) * (level - 1) * 0.9);
}

export const CHAMBER_COUNT = 20; // the run: 20 chambers; escape at the final twins

// ----------------------------- Storm lightning ----------------------------
// The rapid sky-bolt from the Storm Lord boon and the Obelisk of Storms.
// It is NOT a baseline attack — you only get it from those sources. Fires
// fast for an engaging, crackling event loop.
export const STORM_INTERVAL = 0.7;  // seconds between storm strikes
export const STORM_DAMAGE = 40;     // per-bolt base (runs through damage brackets)

// ------------------------------- Massacre ---------------------------------
// Diablo-style kill chain: each kill refreshes a short window; the more you
// stack, the bigger the XP multiplier. Let it lapse and the chain resets.
// Deliberately modest — a small edge over base leveling, not a runaway.
export const MASSACRE_WINDOW = 2.2;  // seconds a kill keeps the chain alive
export const MASSACRE_PER_KILL = 0.007; // +0.7% XP per chained kill...
export const MASSACRE_MAX = 0.4;     // ...capped at +40% XP (1.4x total)

/** Escalating flavor labels by chain size. */
export function massacreTier(count: number): { label: string; color: string } | null {
  if (count >= 50) return { label: 'APOCALYPSE', color: '#ff4fd8' };
  if (count >= 30) return { label: 'SLAUGHTER', color: '#ff5a5a' };
  if (count >= 15) return { label: 'CARNAGE', color: '#ff9838' };
  if (count >= 5) return { label: 'MASSACRE', color: '#f0c75e' };
  return null;
}

/** A major boss guards every 5th chamber: 5, 10, 15, 20, ... */
export function isBossChamber(c: number): boolean {
  return c >= 5 && c % 5 === 0;
}

/** Twin fights: two bosses at once — the mid-run barrier and the finale. */
export function isTwinBossChamber(c: number): boolean {
  return c === 10 || c === CHAMBER_COUNT;
}
