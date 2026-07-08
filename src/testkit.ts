// ---------------------------------------------------------------------------
// Headless harness: run the full game simulation in Node (no DOM, no canvas).
// Used by the balance regression tests and safe to import from tooling.
// ---------------------------------------------------------------------------
import { AudioSys } from './engine/audio';
import { Game, type InputSource } from './game/game';
import type { Enemy } from './game/types';

export class FakeInput implements InputSource {
  mouseX = 640;
  mouseY = 360;
  mouseDown = false;
  padConnected = false;
  padAimActive = false;
  padAimX = 0;
  padAimY = 0;
  padFire = false;
  touchActive = false;
  touchAimHeld = false;
  touchMoveX = 0;
  touchMoveY = 0;
  touchStickOX = 0;
  touchStickOY = 0;
  dashBtnX = 0;
  dashBtnY = 0;
  dashBtnR = 46;
  keys = new Set<string>();
  justPressed = new Set<string>();

  touchMoveHeld(): boolean {
    return false;
  }

  down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  pressed(...codes: string[]): boolean {
    return codes.some((c) => this.justPressed.has(c));
  }

  axis(): { x: number; y: number } {
    let x = 0, y = 0;
    if (this.down('KeyA')) x -= 1;
    if (this.down('KeyD')) x += 1;
    if (this.down('KeyW')) y -= 1;
    if (this.down('KeyS')) y += 1;
    if (x !== 0 && y !== 0) {
      const inv = 1 / Math.SQRT2;
      x *= inv;
      y *= inv;
    }
    return { x, y };
  }
}

/**
 * Game with a stub UI that auto-resolves every choice with the first option —
 * a "greedy player" baseline.
 */
export function createHeadlessGame(): { g: Game; input: FakeInput } {
  const input = new FakeInput();
  const audio = new AudioSys(); // never unlocked -> all methods no-op
  const g = new Game(input, audio);
  g.ui = {
    openLevelUp: () => {
      while (g.pendingLevelUps > 0) {
        g.applyLevelChoice(g.genLevelChoices(3)[0]);
        g.pendingLevelUps--;
      }
    },
    openBoon: (god) => {
      g.applyBoonChoice(g.genBoonChoices(god)[0]);
      g.afterBoonPicked();
    },
    openLegendary: () => {
      const c = g.genLegendaryChoices()[0];
      if (c) g.applyBoonChoice(c);
    },
    openShop: () => {
      g.leaveShop();
    },
    openPom: () => {
      const c = g.genPomChoices()[0];
      if (c) g.applyPom(c);
      else g.beginTransition();
    },
    showToast: () => {},
    openDeath: () => {},
    openVictory: () => {},
    syncMenus: () => {},
  };
  return { g, input };
}

const STEP = 1 / 60;

/** Advance n fixed steps (overlays never open — the stub resolves them). */
export function stepFrames(g: Game, input: FakeInput, n: number): void {
  for (let i = 0; i < n; i++) {
    if (g.state === 'run' && !g.overlayOpen) g.update(STEP);
    input.justPressed.clear();
  }
}

/**
 * A simple kiting bot: aims at the nearest enemy (or boss), holds attack,
 * retreats from close threats, dashes when crowded, and walks into the first
 * door when a chamber is cleared. Runs `seconds` of sim time.
 */
export function runBot(g: Game, input: FakeInput, seconds: number): void {
  const chunks = Math.ceil((seconds * 60) / 30);
  for (let chunk = 0; chunk < chunks; chunk++) {
    if (g.state !== 'run') break;
    const p = g.player;
    let nearest: Enemy | null = null;
    let nd = Infinity;
    let boss: Enemy | null = null;
    for (const e of g.enemies) {
      if (e.hp <= 0) continue;
      if (e.bossState) boss = e;
      const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (d < nd) {
        nd = d;
        nearest = e;
      }
    }
    const aimTarget = boss ?? nearest;
    if (aimTarget) {
      input.mouseX = g.cam.toScreenX(aimTarget.x);
      input.mouseY = g.cam.toScreenY(aimTarget.y);
      input.mouseDown = true;
    } else {
      input.mouseDown = false;
    }
    let tx = 0, ty = 0;
    const near = nearest;
    if (g.phase === 'cleared' && g.doors.length > 0) {
      tx = g.doors[0].x - p.x;
      ty = g.doors[0].y - p.y;
    } else {
      for (const e of g.enemies) {
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 240 * 240 && d2 > 1) {
          const wgt = (240 * 240) / d2;
          tx += dx * wgt * 0.01;
          ty += dy * wgt * 0.01;
        }
      }
      for (const pr of g.projectiles) {
        if (pr.friendly) continue;
        const dx = p.x - pr.x;
        const dy = p.y - pr.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 150 * 150 && d2 > 1) {
          tx += dx * ((150 * 150) / d2) * 0.02;
          ty += dy * ((150 * 150) / d2) * 0.02;
        }
      }
      if (near && nd > 200 * 200) {
        tx += (near.x - p.x) * 0.01;
        ty += (near.y - p.y) * 0.01;
      }
      tx -= Math.sign(p.x) * Math.max(0, Math.abs(p.x) - (g.arenaHalfW - 200)) * 0.06;
      ty -= Math.sign(p.y) * Math.max(0, Math.abs(p.y) - (g.arenaHalfH - 200)) * 0.06;
    }
    input.keys.clear();
    if (tx < -8) input.keys.add('KeyA');
    if (tx > 8) input.keys.add('KeyD');
    if (ty < -8) input.keys.add('KeyW');
    if (ty > 8) input.keys.add('KeyS');
    if (near && nd < 75 * 75 && p.charges > 0 && g.phase !== 'cleared') {
      input.justPressed.add('Space');
    }
    stepFrames(g, input, 30);
  }
}

/** Grant a strong midgame build directly (for boss/late-game tests). */
export function grantStrongBuild(g: Game): void {
  g.weapons = [
    { id: 'aegis', level: 6, t: 0, angle: 0, trailT: 0 },
    { id: 'darts', level: 6, t: 0, angle: 0, trailT: 0 },
    { id: 'pulse', level: 5, t: 0, angle: 0, trailT: 0 },
    { id: 'chakram', level: 5, t: 0, angle: 0, trailT: 0 },
  ];
  g.tomes = { might: 5, haste: 3, precision: 3, vitality: 3 };
  g.boons = [
    { id: 'z_chain', rarity: 'rare' },
    { id: 'z_jolt', rarity: 'epic' },
    { id: 'a_nova', rarity: 'rare' },
    { id: 'h_auto', rarity: 'rare' },
  ];
  g.level = 24;
  g.recomputeStats();
  g.player.hp = g.stats.maxHP;
}
