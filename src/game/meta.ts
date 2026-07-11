import { MIRROR_DEFS } from './data';
import type { Stats } from './types';

export interface Settings {
  master: number;                        // 0..1
  music: number;                         // 0..1
  sfx: number;                           // 0..1
  shake: number;                         // 1 full, 0.4 reduced, 0 off
  dmgNumbers: 'full' | 'reduced' | 'off';
  autoAim: boolean;                      // aim locks to the nearest enemy
  autoFire: boolean;                     // attack whenever a target is in range
  hudSize: 'default' | 'large' | 'huge'; // scales the in-run HUD + pads it off the edges
  devMode: boolean;                      // unlocks the developer/testing panel (` or DEV button)
}

// ---------------------------- HUD geometry --------------------------------
// The HUD lives OUTSIDE the play area. On large screens it seats itself in
// the natural margin around the arena; when the arena would fill the screen,
// these bands are RESERVED above and below the world view so the indicators
// always have their own space and never sit on the map.

/** Scale + edge inset per HUD SIZE setting. */
export const HUD_SIZES: Record<Settings['hudSize'], { scale: number; inset: number }> = {
  default: { scale: 1, inset: 0 },
  large: { scale: 1.25, inset: 8 },
  huge: { scale: 1.5, inset: 16 },
};

/** Vertical thickness (unscaled px) of the top / bottom indicator bands. */
export const HUD_TOP_BAND = 112;
export const HUD_BOTTOM_BAND = 100;

/** Screen-space band heights for the current settings. */
export function hudBands(s: Settings): { top: number; bottom: number } {
  const k = HUD_SIZES[s.hudSize]?.scale ?? 1;
  return { top: Math.round(HUD_TOP_BAND * k), bottom: Math.round(HUD_BOTTOM_BAND * k) };
}

/** Per-character lifetime stats — drive skin unlock tasks. */
export interface CharStats {
  runs: number;
  wins: number;
  kills: number;
  bestChamber: number;
}

export function emptyCharStats(): CharStats {
  return { runs: 0, wins: 0, kills: 0, bestChamber: 0 };
}

export interface SaveData {
  ichor: number;
  mirror: Record<string, number>;
  heat: Record<string, number>;
  runs: number;
  wins: number;
  kills: number;
  totalDamage: number;
  bestChamber: number;
  seenUnlocks: string[];
  charStats: Record<string, CharStats>;
  skins: Record<string, string>;   // selected skin id per character
  seenSkins: string[];             // skin ids whose unlock toast has fired
  lastCharacter: import('./types').CharacterId;
  muted: boolean;
  settings: Settings;
}

const KEY = 'hubris_save_v1';

export function defaultSettings(): Settings {
  return {
    master: 0.8, music: 0.6, sfx: 0.9, shake: 1, dmgNumbers: 'full',
    autoAim: false, autoFire: false, hudSize: 'default', devMode: false,
  };
}

export function defaultSave(): SaveData {
  return {
    ichor: 0, mirror: {}, heat: {}, runs: 0, wins: 0, kills: 0,
    totalDamage: 0, bestChamber: 0, seenUnlocks: [],
    charStats: {}, skins: {}, seenSkins: [], lastCharacter: 'warrior',
    muted: false, settings: defaultSettings(),
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw);
    return {
      ...defaultSave(),
      ...parsed,
      settings: { ...defaultSettings(), ...(parsed.settings ?? {}) },
    };
  } catch {
    return defaultSave();
  }
}

export function persistSave(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Private browsing / quota / headless — the run still works.
  }
}

/** Base64 save code for backup / moving between browsers or ports. */
export function exportSave(save: SaveData): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(save))));
}

/** Parse a save code; returns null when the code is invalid. */
export function importSave(code: string): SaveData | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (typeof parsed.ichor !== 'number' || typeof parsed.mirror !== 'object') return null;
    return {
      ...defaultSave(),
      ...parsed,
      settings: { ...defaultSettings(), ...(parsed.settings ?? {}) },
    };
  } catch {
    return null;
  }
}

export function mirrorLevel(save: SaveData, id: string): number {
  return save.mirror[id] ?? 0;
}

/** Lifetime stats for one character (created on first access). */
export function charStatsFor(save: SaveData, id: string): CharStats {
  let cs = save.charStats[id];
  if (!cs) {
    cs = emptyCharStats();
    save.charStats[id] = cs;
  }
  return cs;
}

/** Cost of the next rank, or null if maxed. */
export function mirrorNextCost(save: SaveData, id: string): number | null {
  const def = MIRROR_DEFS.find((d) => d.id === id)!;
  const lvl = mirrorLevel(save, id);
  if (lvl >= def.maxLevel) return null;
  return def.costs[lvl];
}

export function tryBuyMirror(save: SaveData, id: string): boolean {
  const cost = mirrorNextCost(save, id);
  if (cost === null || save.ichor < cost) return false;
  save.ichor -= cost;
  save.mirror[id] = mirrorLevel(save, id) + 1;
  persistSave(save);
  return true;
}

export function heatLevel(save: SaveData, id: string): number {
  return save.heat[id] ?? 0;
}

export function totalHeat(save: SaveData): number {
  let t = 0;
  for (const k of Object.keys(save.heat)) t += save.heat[k];
  return t;
}

export function applyMirrorToStats(save: SaveData, s: Stats): void {
  s.maxHP += 15 * mirrorLevel(save, 'vigor');
  s.might += 0.05 * mirrorLevel(save, 'ferocity');
  s.moveSpeed += 0.04 * mirrorLevel(save, 'swiftness');
  s.dashCharges += mirrorLevel(save, 'wind');
  s.goldGain += 0.15 * mirrorLevel(save, 'goldtouch');
  s.xpGain += 0.10 * mirrorLevel(save, 'scholar');
  s.luck += mirrorLevel(save, 'favor');
  s.critChance += 0.02 * mirrorLevel(save, 'lethality');
  s.pickupRadius += 25 * mirrorLevel(save, 'lodestone');
  s.armor += mirrorLevel(save, 'armor');
  s.pierce += mirrorLevel(save, 'piercing');
  s.range += 0.08 * mirrorLevel(save, 'reach');
  s.area += 0.08 * mirrorLevel(save, 'reach');
  s.projectiles += mirrorLevel(save, 'quiver');
  // Pact of Punishment
  s.maxHP -= 25 * heatLevel(save, 'frail');
}
