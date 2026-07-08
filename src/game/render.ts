// ---------------------------------------------------------------------------
// World + HUD rendering. Everything is procedural: polygons, baked glow
// sprites (additive), and canvas text. No image assets.
// ---------------------------------------------------------------------------
import { clamp, fmt, lerp, TAU } from '../engine/math';
import { drawGlow, lightningPath, polygonPath, withAlpha } from '../engine/sprites';
import type { Game } from './game';
import {
  AEGIS, BIOMES, BOSSES, ENEMY_DEFS, TOWER_CAPTURE_RADIUS, WEAPON_MAX_LEVEL,
  boonDef, characterDef, towerDef, weaponDef,
} from './data';
import { ELITE_MOD_COLOR, GOD_COLOR, RARITY_COLOR, type CinderPatch, type Enemy } from './types';

const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const SANS = 'ui-sans-serif, system-ui, sans-serif';

let vignette: HTMLCanvasElement | null = null;
let vignetteKey = '';

export function render(g: Game, ctx: CanvasRenderingContext2D): void {
  const w = g.cam.viewW;
  const h = g.cam.viewH;

  // Background
  ctx.fillStyle = '#0a0d18';
  ctx.fillRect(0, 0, w, h);

  if (g.state === 'run') {
    drawArena(g, ctx);
    drawPatches(g, ctx);
    drawDoors(g, ctx);
    drawTowers(g, ctx);
    drawChests(g, ctx);
    drawTraps(g, ctx);
    drawPillars(g, ctx);
    drawTelegraphs(g, ctx);
    drawPickups(g, ctx);
    drawEnemies(g, ctx);
    drawPlayer(g, ctx);
    drawProjectiles(g, ctx);
    g.particles.draw(ctx, g.cam);
    drawLightning(g, ctx);
    drawShockwaves(g, ctx);
    drawDamageNumbers(g, ctx);
  }

  drawVignette(ctx, w, h);

  if (g.state === 'run') {
    drawTowerArrows(g, ctx);
    drawHUD(g, ctx);
    drawTouchUI(g, ctx);
    // Hurt flash
    if (g.player.hurtT > 0) {
      ctx.fillStyle = `rgba(238,66,102,${(g.player.hurtT / 0.35) * 0.18})`;
      ctx.fillRect(0, 0, w, h);
    }
    // Death fade
    if (g.deathT > 0) {
      const a = clamp(1 - g.deathT / 1.25, 0, 1) * 0.5;
      ctx.fillStyle = `rgba(6,8,16,${a})`;
      ctx.fillRect(0, 0, w, h);
    }
    // Chamber transition fade
    if (g.phase === 'transition') {
      const t = g.transitionT;
      const a = t < 0.45 ? t / 0.45 : clamp(1 - (t - 0.45) / 0.45, 0, 1);
      ctx.fillStyle = `rgba(6,8,16,${a})`;
      ctx.fillRect(0, 0, w, h);
    }
    drawBanner(g, ctx, w, h);
  }
}

// ---------------------------------------------------------------------------

function drawArena(g: Game, ctx: CanvasRenderingContext2D): void {
  const cam = g.cam;
  const biome = BIOMES[g.biome()];
  const x0 = cam.toScreenX(-g.arenaHalfW);
  const y0 = cam.toScreenY(-g.arenaHalfH);
  const aw = g.arenaHalfW * 2;
  const ah = g.arenaHalfH * 2;

  // Floor
  const grad = ctx.createLinearGradient(0, y0, 0, y0 + ah);
  grad.addColorStop(0, biome.floorTop);
  grad.addColorStop(1, biome.floorBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(x0, y0, aw, ah);

  // Grid
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, aw, ah);
  ctx.clip();
  ctx.strokeStyle = biome.grid;
  ctx.lineWidth = 1;
  const step = 100;
  const startX = Math.floor(-g.arenaHalfW / step) * step;
  for (let wx = startX; wx <= g.arenaHalfW; wx += step) {
    const sx = cam.toScreenX(wx);
    ctx.beginPath();
    ctx.moveTo(sx, y0);
    ctx.lineTo(sx, y0 + ah);
    ctx.stroke();
  }
  const startY = Math.floor(-g.arenaHalfH / step) * step;
  for (let wy = startY; wy <= g.arenaHalfH; wy += step) {
    const sy = cam.toScreenY(wy);
    ctx.beginPath();
    ctx.moveTo(x0, sy);
    ctx.lineTo(x0 + aw, sy);
    ctx.stroke();
  }
  ctx.restore();

  // Walls
  ctx.strokeStyle = biome.wall + '0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(x0, y0, aw, ah);
  ctx.strokeStyle = biome.wall + '0.12)';
  ctx.lineWidth = 9;
  ctx.strokeRect(x0, y0, aw, ah);
}

function drawPillars(g: Game, ctx: CanvasRenderingContext2D): void {
  const biome = BIOMES[g.biome()];
  for (const p of g.pillars) {
    if (!g.cam.isVisible(p.x, p.y, p.radius + 20)) continue;
    const sx = g.cam.toScreenX(p.x);
    const sy = g.cam.toScreenY(p.y);
    ctx.fillStyle = '#060812';
    ctx.beginPath();
    ctx.arc(sx, sy + 5, p.radius, 0, TAU);
    ctx.fill();
    ctx.fillStyle = biome.pillar;
    ctx.beginPath();
    ctx.arc(sx, sy, p.radius, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = biome.pillarEdge + '0.28)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = biome.pillarEdge + '0.10)';
    ctx.beginPath();
    ctx.ellipse(sx - p.radius * 0.25, sy - p.radius * 0.3, p.radius * 0.45, p.radius * 0.3, -0.5, 0, TAU);
    ctx.fill();
  }
}

/** Discrete flickering flame tongues instead of a fuzzy blob. */
function drawPatch(g: Game, ctx: CanvasRenderingContext2D, pa: CinderPatch, now: number): void {
  const a = clamp(pa.life / 1.2, 0, 1);
  const sx = g.cam.toScreenX(pa.x);
  const sy = g.cam.toScreenY(pa.y);
  const outer = pa.hostile ? '#ff4545' : '#ff7a30';
  const inner = pa.hostile ? '#ff9d9d' : '#ffd166';

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(ctx, outer, sx, sy, pa.radius * 1.1, a * 0.32);

  for (let k = 0; k < 3; k++) {
    const ang = pa.seed + k * 2.1;
    const fx = sx + Math.cos(ang) * pa.radius * 0.45;
    const fy = sy + Math.sin(ang) * pa.radius * 0.3;
    const flick = 0.7 + 0.3 * Math.sin(now * 0.02 + pa.seed * 7 + k * 1.7);
    const hgt = (7 + pa.radius * 0.22) * flick;
    const wid = 3.2 + pa.radius * 0.06;
    ctx.globalAlpha = a * 0.85;
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.moveTo(fx - wid, fy + 2);
    ctx.quadraticCurveTo(fx, fy - hgt * 0.3, fx, fy - hgt);
    ctx.quadraticCurveTo(fx, fy - hgt * 0.3, fx + wid, fy + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.moveTo(fx - wid * 0.45, fy + 1);
    ctx.lineTo(fx, fy - hgt * 0.55);
    ctx.lineTo(fx + wid * 0.45, fy + 1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawPatches(g: Game, ctx: CanvasRenderingContext2D): void {
  const now = performance.now();
  for (const pa of g.patches) {
    if (!g.cam.isVisible(pa.x, pa.y, pa.radius + 16)) continue;
    drawPatch(g, ctx, pa, now);
  }
}

const DOOR_META: Record<string, { glyph: string; label: string; color: string }> = {
  gold: { glyph: '◈', label: 'GOLD', color: '#f0c75e' },
  heal: { glyph: '✚', label: 'AMBROSIA', color: '#3ddc97' },
  xpcache: { glyph: '◎', label: 'XP CACHE', color: '#c17bff' },
  ichor: { glyph: '⬥', label: 'ICHOR', color: '#e05780' },
  chest: { glyph: '▣', label: 'CHEST', color: '#8fdcff' },
  shop: { glyph: '☽', label: "CHARON'S WARES", color: '#9b5de5' },
  pom: { glyph: '✾', label: 'POM OF POWER', color: '#f0c75e' },
  forge: { glyph: '⚒', label: 'FORGE', color: '#ffb454' },
};

function drawDoors(g: Game, ctx: CanvasRenderingContext2D): void {
  if (g.phase !== 'cleared') return;
  for (const d of g.doors) {
    const sx = g.cam.toScreenX(d.x);
    const sy = g.cam.toScreenY(d.y);
    const meta = d.reward === 'boon'
      ? { glyph: godGlyph(d.god!), label: `BOON OF ${d.god!.toUpperCase()}`, color: GOD_COLOR[d.god!] }
      : DOOR_META[d.reward];
    const pulse = 0.8 + Math.sin(performance.now() / 300) * 0.2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, meta.color, sx, sy, 58 * pulse, 0.5);
    ctx.restore();
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(sx, sy, 36, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(meta.color, 0.4);
    ctx.beginPath();
    ctx.arc(sx, sy, 44, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = meta.color;
    ctx.font = `26px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(meta.glyph, sx, sy + 1);
    ctx.font = `600 12px ${SANS}`;
    ctx.fillStyle = withAlpha(meta.color, 0.9);
    ctx.fillText(meta.label, sx, sy + 64);
  }
}

function godGlyph(god: string): string {
  return god === 'zeus' ? 'Z' : god === 'ares' ? 'A' : god === 'poseidon' ? 'P' : 'H';
}

// ---------------------------------------------------------------------------
// Capturable obelisks
// ---------------------------------------------------------------------------

function drawTowers(g: Game, ctx: CanvasRenderingContext2D): void {
  for (const t of g.towers) {
    if (!g.cam.isVisible(t.x, t.y, TOWER_CAPTURE_RADIUS + 60)) continue;
    const def = towerDef(t.kind);
    const sx = g.cam.toScreenX(t.x);
    const sy = g.cam.toScreenY(t.y);
    const pulse = 0.75 + Math.sin(t.phase * 2.2) * 0.25;
    const alpha = t.captured ? 0.35 : 1;

    // Capture ring
    if (!t.captured) {
      ctx.strokeStyle = withAlpha(def.color, 0.22 + pulse * 0.1);
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 10]);
      ctx.beginPath();
      ctx.arc(sx, sy, TOWER_CAPTURE_RADIUS, t.phase * 0.4, t.phase * 0.4 + TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Beacon beam so it reads from across the arena
    if (!t.captured) {
      const beam = ctx.createLinearGradient(0, sy - 300, 0, sy);
      beam.addColorStop(0, withAlpha(def.color, 0));
      beam.addColorStop(1, withAlpha(def.color, 0.14 * pulse));
      ctx.fillStyle = beam;
      ctx.fillRect(sx - 16, sy - 300, 32, 300);
    }

    // Glow + body
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, def.color, sx, sy - 26, 44, t.captured ? 0.18 : 0.4 * pulse);
    ctx.restore();
    if (t.kind === 'chaos') {
      // Altar of Fate: a hovering crystal shard over a dark plinth
      const hover = Math.sin(t.phase * 1.8) * 4;
      ctx.fillStyle = '#090c1a';
      ctx.strokeStyle = withAlpha(def.color, 0.4);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(sx, sy + 14, 22, 8, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      polygonPath(ctx, sx, sy + 4, 3, 14, -Math.PI / 2);
      ctx.fillStyle = '#0d1126';
      ctx.fill();
      ctx.stroke();
      // The shard itself spins slowly and hovers
      ctx.save();
      ctx.translate(sx, sy - 34 + hover);
      ctx.rotate(Math.sin(t.phase * 0.9) * 0.35);
      ctx.fillStyle = '#1a0d22';
      ctx.strokeStyle = t.captured ? withAlpha(def.color, 0.5) : def.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, -22);
      ctx.lineTo(11, 0);
      ctx.lineTo(0, 22);
      ctx.lineTo(-11, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = t.captured ? withAlpha(def.color, 0.5) : def.color;
      ctx.font = `14px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.glyph, 0, 0);
      ctx.restore();
      // Orbiting chaos motes
      if (!t.captured) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 3; i++) {
          const a = t.phase * 2.4 + (i / 3) * TAU;
          drawGlow(ctx, def.color,
            sx + Math.cos(a) * 28, sy - 34 + hover + Math.sin(a) * 14, 8, 0.6);
        }
        ctx.restore();
      }
    } else {
      // Obelisk: tapered pillar
      ctx.fillStyle = '#0d1126';
      ctx.strokeStyle = t.captured ? withAlpha(def.color, 0.5) : def.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(sx - 13, sy + 12);
      ctx.lineTo(sx - 8, sy - 58);
      ctx.lineTo(sx + 8, sy - 58);
      ctx.lineTo(sx + 13, sy + 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Base
      ctx.fillStyle = '#090c1a';
      ctx.strokeStyle = withAlpha(def.color, 0.4);
      ctx.beginPath();
      ctx.ellipse(sx, sy + 14, 22, 8, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      // Rune glyph
      ctx.fillStyle = t.captured ? withAlpha(def.color, 0.5) : def.color;
      ctx.font = `20px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.glyph, sx, sy - 24);
    }
    ctx.restore();

    // Channel progress arc
    if (!t.captured && t.progress > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = withAlpha(def.color, 0.9);
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(sx, sy - 22, 44, -Math.PI / 2, -Math.PI / 2 + t.progress * TAU);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = withAlpha(def.color, 0.9);
      ctx.font = `700 12px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(t.progress * 100)}%`, sx, sy - 74);
    }
  }
}

function drawTraps(g: Game, ctx: CanvasRenderingContext2D): void {
  for (const t of g.traps) {
    if (!g.cam.isVisible(t.x, t.y, 40)) continue;
    const sx = g.cam.toScreenX(t.x);
    const sy = g.cam.toScreenY(t.y);
    const armed = t.armT <= 0;
    const pulse = armed ? 0.5 + Math.sin(t.phase * 6) * 0.3 : 0.25;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, '#9b5de5', sx, sy, 16, pulse);
    ctx.restore();
    ctx.strokeStyle = withAlpha('#9b5de5', armed ? 0.9 : 0.45);
    ctx.fillStyle = '#1a1030';
    ctx.lineWidth = 2;
    polygonPath(ctx, sx, sy, 6, 9, t.phase * 0.4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = armed ? '#c9a2ff' : '#5a4a7a';
    ctx.beginPath();
    ctx.arc(sx, sy, 2.5, 0, TAU);
    ctx.fill();
  }
}

function drawChests(g: Game, ctx: CanvasRenderingContext2D): void {
  for (const chest of g.chests) {
    if (!g.cam.isVisible(chest.x, chest.y, 60)) continue;
    const sx = g.cam.toScreenX(chest.x);
    const sy = g.cam.toScreenY(chest.y) + Math.sin(chest.phase * 2.4) * 2;
    const body = chest.gilded ? '#8a6a1e' : '#5c4426';
    const trim = chest.gilded ? '#ffd166' : '#b98f4a';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, trim, sx, sy, 30, chest.gilded ? 0.45 : 0.25);
    ctx.restore();
    // Body
    ctx.fillStyle = body;
    ctx.strokeStyle = trim;
    ctx.lineWidth = 2;
    roundRect(ctx, sx - 15, sy - 6, 30, 16, 3);
    ctx.fill();
    ctx.stroke();
    // Lid
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(sx - 15, sy - 6);
    ctx.quadraticCurveTo(sx, sy - 18, sx + 15, sy - 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Clasp
    ctx.fillStyle = trim;
    ctx.beginPath();
    ctx.arc(sx, sy - 2, 3, 0, TAU);
    ctx.fill();
    // Gilded price tag
    if (chest.gilded) {
      ctx.font = `700 12px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = g.gold >= chest.cost ? '#ffd166' : '#ee4266';
      ctx.fillText(`◈ ${chest.cost}`, sx, sy - 30);
    }
  }
}

/** Edge-of-screen arrows pointing at uncaptured obelisks. */
function drawTowerArrows(g: Game, ctx: CanvasRenderingContext2D): void {
  if (g.phase !== 'combat' && g.phase !== 'cleared') return;
  const w = g.cam.viewW;
  const h = g.cam.viewH;
  for (const t of g.towers) {
    if (t.captured) continue;
    const sx = g.cam.toScreenX(t.x);
    const sy = g.cam.toScreenY(t.y - 30);
    if (sx > -40 && sx < w + 40 && sy > -40 && sy < h + 40) continue; // on screen
    const def = towerDef(t.kind);
    const pad = 40;
    const cx = clamp(sx, pad, w - pad);
    const cy = clamp(sy, pad + 40, h - pad - 40);
    const a = Math.atan2(sy - cy, sx - cx);
    ctx.save();
    ctx.globalAlpha = 0.65 + Math.sin(performance.now() / 250) * 0.2;
    ctx.translate(cx, cy);
    ctx.fillStyle = def.color;
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(2, 7);
    ctx.lineTo(2, -7);
    ctx.closePath();
    ctx.fill();
    ctx.rotate(-a);
    ctx.font = `13px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.glyph, -6, 0);
    ctx.restore();
  }
}

function drawTelegraphs(g: Game, ctx: CanvasRenderingContext2D): void {
  for (const t of g.telegraphs) {
    const a = 0.14 + 0.2 * (1 - t.t / t.maxT);
    ctx.strokeStyle = `rgba(255,90,90,${a + 0.25})`;
    ctx.fillStyle = `rgba(255,90,90,${a})`;
    if (t.kind === 'line') {
      const x1 = g.cam.toScreenX(t.x), y1 = g.cam.toScreenY(t.y);
      const x2 = g.cam.toScreenX(t.x2), y2 = g.cam.toScreenY(t.y2);
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * t.radius, ny = (dx / len) * t.radius;
      ctx.beginPath();
      ctx.moveTo(x1 + nx, y1 + ny);
      ctx.lineTo(x2 + nx, y2 + ny);
      ctx.lineTo(x2 - nx, y2 - ny);
      ctx.lineTo(x1 - nx, y1 - ny);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(g.cam.toScreenX(t.x), g.cam.toScreenY(t.y), t.radius, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
  }
}

const PICKUP_STYLE = {
  xp: { color: '#55d6f5', r: 5 },
  xp3: { color: '#c17bff', r: 7 },
  xp8: { color: '#f0c75e', r: 9 },
  gold: { color: '#f0c75e', r: 5 },
  heart: { color: '#3ddc97', r: 8 },
  ichor: { color: '#e05780', r: 8 },
} as const;

function drawPickups(g: Game, ctx: CanvasRenderingContext2D): void {
  for (const pk of g.pickups) {
    if (!g.cam.isVisible(pk.x, pk.y, 20)) continue;
    const st = PICKUP_STYLE[pk.kind];
    const sx = g.cam.toScreenX(pk.x);
    const sy = g.cam.toScreenY(pk.y) + Math.sin(pk.bob) * 3;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, st.color, sx, sy, st.r * 2.6, 0.55);
    ctx.restore();
    ctx.fillStyle = st.color;
    if (pk.kind === 'gold') {
      ctx.beginPath();
      ctx.arc(sx, sy, st.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.arc(sx - 1.5, sy - 1.5, 1.6, 0, TAU);
      ctx.fill();
    } else if (pk.kind === 'heart') {
      ctx.font = `700 13px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✚', sx, sy);
    } else if (pk.kind === 'ichor') {
      ctx.beginPath();
      ctx.moveTo(sx, sy - st.r - 2);
      ctx.quadraticCurveTo(sx + st.r, sy, sx, sy + st.r * 0.8);
      ctx.quadraticCurveTo(sx - st.r, sy, sx, sy - st.r - 2);
      ctx.fill();
    } else {
      // XP gem: diamond
      ctx.beginPath();
      ctx.moveTo(sx, sy - st.r);
      ctx.lineTo(sx + st.r * 0.7, sy);
      ctx.lineTo(sx, sy + st.r);
      ctx.lineTo(sx - st.r * 0.7, sy);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawEnemies(g: Game, ctx: CanvasRenderingContext2D): void {
  const p = g.player;
  for (const e of g.enemies) {
    if (e.hp <= 0 || !g.cam.isVisible(e.x, e.y, e.radius + 40)) continue;
    const sx = g.cam.toScreenX(e.x);
    const sy = g.cam.toScreenY(e.y);
    const def = e.kind === 'boss' ? null : ENEMY_DEFS[e.kind as keyof typeof ENEMY_DEFS];
    const color = e.kind === 'boss' ? BOSSES[e.bossState!.variant].color : def!.color;
    const rising = e.spawnT > 0;
    const scale = rising ? clamp(1 - e.spawnT / 0.55, 0.15, 1) : 1;
    const r = e.radius * scale * (1 + Math.sin(e.wobble) * 0.05);

    ctx.save();
    if (rising) ctx.globalAlpha = 0.5 + scale * 0.5;

    // Elite aura (affix-tinted)
    if (e.elite) {
      const auraColor = e.modifier ? ELITE_MOD_COLOR[e.modifier] : '#f0c75e';
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, auraColor, sx, sy, r * 2.2, 0.4);
      ctx.restore();
      ctx.strokeStyle = withAlpha(auraColor, 0.8);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 6, 0, TAU);
      ctx.stroke();
      // Warded elites carry a visible shield hexagon
      if (e.modifier === 'warded') {
        ctx.strokeStyle = 'rgba(85,214,245,0.5)';
        ctx.lineWidth = 1.5;
        polygonPath(ctx, sx, sy, 6, r + 12, e.wobble * 0.3);
        ctx.stroke();
      }
    }

    // Soft glow
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, color, sx, sy, r * 1.7, e.kind === 'boss' ? 0.5 : 0.3);
    ctx.restore();

    // Body polygon (boss only flickers its rim — it is hit near-constantly)
    const sides = e.kind === 'boss' ? 8 : def!.sides;
    const rot = e.wobble * (e.kind === 'skitter' ? 1.4 : 0.4);
    const bruteWinding = e.kind === 'brute' && e.windup >= 0;
    const flashing = (e.flash > 0 && (e.kind !== 'boss' || e.flash > 0.07)) || bruteWinding;
    ctx.fillStyle = flashing ? (bruteWinding ? '#ff8f8f' : '#ffffff') : shade(color, 0.42);
    ctx.strokeStyle = e.flash > 0 || bruteWinding ? '#ffffff' : color;
    ctx.lineWidth = e.kind === 'boss' ? 4 : 2;
    polygonPath(ctx, sx, sy, sides, r, rot);
    ctx.fill();
    ctx.stroke();

    // Cinder fuse warning
    if (e.kind === 'cinder' && e.fuse >= 0) {
      const blink = Math.sin(performance.now() / 40) > 0 ? 0.9 : 0.3;
      ctx.strokeStyle = `rgba(255,159,69,${blink})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 8, 0, TAU);
      ctx.stroke();
    }

    // Ranged attack warning (spitter & weaver about to fire)
    if ((e.kind === 'spitter' || e.kind === 'weaver') && e.atkT > 0 && e.atkT < 0.35) {
      const wa = 1 - e.atkT / 0.35;
      ctx.strokeStyle = withAlpha(color, 0.4 + wa * 0.6);
      ctx.lineWidth = 2 + wa * 2;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 6 + (1 - wa) * 8, 0, TAU);
      ctx.stroke();
    }

    if (e.kind === 'boss') {
      if (e.bossState!.variant === 'gatekeeper') {
        // Crown spikes
        ctx.fillStyle = color;
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i - 2) * 0.38;
          const bx = sx + Math.cos(a) * (r + 4);
          const by = sy + Math.sin(a) * (r + 4);
          polygonPath(ctx, bx, by, 3, 8, a + Math.PI / 2);
          ctx.fill();
        }
      } else {
        // Shepherd: three soul-motes orbit it
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 3; i++) {
          const a = e.wobble * 1.6 + (i / 3) * TAU;
          const mx = sx + Math.cos(a) * (r + 18);
          const my = sy + Math.sin(a) * (r + 18);
          drawGlow(ctx, '#b79cff', mx, my, 12, 0.8);
          ctx.fillStyle = '#e6dcff';
          ctx.beginPath();
          ctx.arc(mx, my, 3, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // Eyes track the player
    if (!rising) {
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      const ex = Math.cos(a) * r * 0.35;
      const ey = Math.sin(a) * r * 0.35;
      const eyeR = Math.max(1.6, r * 0.13);
      const sep = Math.max(3, r * 0.3);
      ctx.fillStyle = e.kind === 'boss' ? '#ffd7e2' : '#eef2ff';
      ctx.beginPath();
      ctx.arc(sx + ex - Math.sin(a) * sep, sy + ey + Math.cos(a) * sep, eyeR, 0, TAU);
      ctx.arc(sx + ex + Math.sin(a) * sep, sy + ey - Math.cos(a) * sep, eyeR, 0, TAU);
      ctx.fill();
    }

    // Status tints
    if (e.joltT > 0) {
      ctx.strokeStyle = 'rgba(143,220,255,0.7)';
      ctx.lineWidth = 1.5;
      polygonPath(ctx, sx, sy, sides, r + 4, -rot * 0.7);
      ctx.stroke();
    }
    if (e.chillT > 0) {
      ctx.strokeStyle = 'rgba(74,144,255,0.65)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.arc(sx, sy, r + 3, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (e.woundT > 0) {
      ctx.fillStyle = 'rgba(255,90,90,0.6)';
      ctx.beginPath();
      ctx.arc(sx + r * 0.4, sy + r * 0.4, 3, 0, TAU);
      ctx.fill();
    }

    // Elite health bar
    if (e.elite && e.hp < e.maxHP) {
      const bw = r * 2;
      ctx.fillStyle = 'rgba(10,12,24,0.7)';
      ctx.fillRect(sx - bw / 2, sy - r - 12, bw, 4);
      ctx.fillStyle = '#f0c75e';
      ctx.fillRect(sx - bw / 2, sy - r - 12, bw * clamp(e.hp / e.maxHP, 0, 1), 4);
    }

    ctx.restore();
  }
}

function drawPlayer(g: Game, ctx: CanvasRenderingContext2D): void {
  const p = g.player;
  const dying = g.deathT > 0;
  if (g.phase === 'over' && p.hp <= 0 && !dying) return;
  const sx = g.cam.toScreenX(p.x);
  const sy = g.cam.toScreenY(p.y);
  const moving = p.moveX !== 0 || p.moveY !== 0;
  const bob = moving && !dying ? Math.sin(p.walkT) * 1.8 : 0;

  // Invulnerability blink
  const blink = p.invulnT > 0 && Math.floor(performance.now() / 90) % 2 === 0;

  ctx.save();
  ctx.translate(sx, sy + bob);
  let alpha = blink ? 0.45 : 1;
  if (dying) {
    const t = clamp(g.deathT / 1.25, 0, 1);
    alpha = t;
    ctx.rotate((1 - t) * 2.6);
    ctx.scale(0.5 + t * 0.5, 0.5 + t * 0.5);
  }
  ctx.globalAlpha = alpha;

  const skin = g.playerColors();
  const bodyColor = skin.body;
  const trimColor = skin.trim;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(ctx, bodyColor, 0, 0, 34, 0.5 * alpha);
  ctx.restore();

  // Mana shield aura
  if (g.character === 'mage' && p.shield > 0 && !dying) {
    const frac = p.shield / Math.max(1, g.maxShield());
    ctx.strokeStyle = withAlpha('#8fdcff', 0.25 + frac * 0.45);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 24 + Math.sin(performance.now() / 300) * 1.5, 0, TAU);
    ctx.stroke();
  }

  // Cape/body: tall diamond
  ctx.fillStyle = bodyColor;
  ctx.strokeStyle = withAlpha(trimColor, 0.9);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -11);
  ctx.lineTo(8.5, 0);
  ctx.lineTo(0, 12);
  ctx.lineTo(-8.5, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Feet flickers when walking
  if (moving && !dying) {
    ctx.fillStyle = shade(bodyColor.startsWith('#') ? bodyColor : '#f0c75e', 0.75);
    const step = Math.sin(p.walkT);
    ctx.beginPath();
    ctx.arc(-3.5, 13 + step * 2, 2, 0, TAU);
    ctx.arc(3.5, 13 - step * 2, 2, 0, TAU);
    ctx.fill();
  }

  // Head
  ctx.fillStyle = '#fff8e6';
  ctx.beginPath();
  ctx.arc(0, -15, 4.6, 0, TAU);
  ctx.fill();

  // Weapon
  const animDur = p.lastFinisher ? 0.22 : 0.16;
  if (g.character === 'archer') {
    // Bow: an arc facing the aim, string flexing on release
    const ba = p.aim;
    const flex = p.strikeAnimT > 0 ? (p.strikeAnimT / animDur) * 5 : 0;
    ctx.strokeStyle = trimColor;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, 18, ba - 0.75, ba + 0.75);
    ctx.stroke();
    const x1 = Math.cos(ba - 0.75) * 18, y1 = Math.sin(ba - 0.75) * 18;
    const x2 = Math.cos(ba + 0.75) * 18, y2 = Math.sin(ba + 0.75) * 18;
    const mx = Math.cos(ba) * (6 - flex), my = Math.sin(ba) * (6 - flex);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(mx, my);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  } else if (g.character === 'mage') {
    // Staff: held at an offset, glowing tip that flares on cast
    const sa = p.aim + 0.35;
    const tipX = Math.cos(sa) * 26, tipY = Math.sin(sa) * 26;
    ctx.strokeStyle = trimColor;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(Math.cos(sa) * 6, Math.sin(sa) * 6);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    const flare = p.strikeAnimT > 0 ? p.strikeAnimT / animDur : 0.4;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, bodyColor, tipX, tipY, 10 + flare * 8, 0.5 + flare * 0.5);
    ctx.restore();
    ctx.fillStyle = '#e8f6ff';
    ctx.beginPath();
    ctx.arc(tipX, tipY, 3, 0, TAU);
    ctx.fill();
  } else {
    // Blade: rests beside the aim, sweeps across it during a swing
    let swing = 0.55;
    if (p.strikeAnimT > 0) {
      const prog = 1 - p.strikeAnimT / animDur;
      const dir = p.comboIdx % 2 === 0 ? 1 : -1;
      const range = p.lastFinisher ? 1.5 : 1.2;
      swing = lerp(-range, range, prog) * dir;
    }
    const ba = p.aim + swing;
    ctx.strokeStyle = trimColor;
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(Math.cos(ba) * 10, Math.sin(ba) * 10);
    ctx.lineTo(Math.cos(ba) * 30, Math.sin(ba) * 30);
    ctx.stroke();
    // Crossguard
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(ba) * 14 + Math.cos(ba + Math.PI / 2) * 4, Math.sin(ba) * 14 + Math.sin(ba + Math.PI / 2) * 4);
    ctx.lineTo(Math.cos(ba) * 14 + Math.cos(ba - Math.PI / 2) * 4, Math.sin(ba) * 14 + Math.sin(ba - Math.PI / 2) * 4);
    ctx.stroke();
  }
  ctx.restore();

  // Strike crescent (warrior only, screen space)
  if (g.character === 'warrior' && p.strikeAnimT > 0 && !dying) {
    const t = p.strikeAnimT / animDur;
    const big = p.lastFinisher;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(255,240,200,${t})`;
    ctx.lineWidth = (big ? 18 : 13) * t + 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(sx, sy, big ? 72 : 62, p.strikeAngle - (big ? 1.2 : 1.0), p.strikeAngle + (big ? 1.2 : 1.0));
    ctx.stroke();
    ctx.strokeStyle = `rgba(240,199,94,${t * 0.6})`;
    ctx.lineWidth = (big ? 30 : 22) * t + 4;
    ctx.beginPath();
    ctx.arc(sx, sy, big ? 64 : 55, p.strikeAngle - 0.85, p.strikeAngle + 0.85);
    ctx.stroke();
    ctx.restore();
  }

  // Aegis blades (rendered here so they sit above the player)
  const aegis = g.weapons.find((w) => w.id === 'aegis');
  if (aegis && !dying) {
    const li = aegis.level - 1;
    const n = AEGIS.blades[li];
    const transcended = aegis.level >= WEAPON_MAX_LEVEL;
    for (let i = 0; i < n; i++) {
      const a = aegis.angle + (i / n) * TAU;
      const bx = sx + Math.cos(a) * AEGIS.radius[li];
      const by = sy + Math.sin(a) * AEGIS.radius[li];
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, transcended ? '#ffe08a' : '#8fdcff', bx, by, 16, 0.6);
      ctx.restore();
      ctx.fillStyle = transcended ? '#ffe08a' : '#cdefff';
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(a + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(5, 7);
      ctx.lineTo(-5, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Reticle: at the mouse, projected along the stick, or — with auto-aim —
  // along the actual (locked) aim so it never lies about where you'll hit
  const inp = g.input;
  let rx = inp.mouseX;
  let ry = inp.mouseY;
  if (g.save.settings.autoAim) {
    rx = sx + Math.cos(p.aim) * 130;
    ry = sy + Math.sin(p.aim) * 130;
  } else if (inp.padAimActive) {
    rx = sx + inp.padAimX * 150;
    ry = sy + inp.padAimY * 150;
  }
  ctx.strokeStyle = 'rgba(240,199,94,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(rx, ry, 7, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(rx - 11, ry);
  ctx.lineTo(rx - 4, ry);
  ctx.moveTo(rx + 4, ry);
  ctx.lineTo(rx + 11, ry);
  ctx.moveTo(rx, ry - 11);
  ctx.lineTo(rx, ry - 4);
  ctx.moveTo(rx, ry + 4);
  ctx.lineTo(rx, ry + 11);
  ctx.stroke();
}

function drawProjectiles(g: Game, ctx: CanvasRenderingContext2D): void {
  for (const pr of g.projectiles) {
    if (!g.cam.isVisible(pr.x, pr.y, 30)) continue;
    const sx = g.cam.toScreenX(pr.x);
    const sy = g.cam.toScreenY(pr.y);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (pr.kind === 'dart') {
      drawGlow(ctx, '#7bf1a8', sx, sy, 12, 0.7);
      ctx.fillStyle = '#d9ffe8';
      ctx.translate(sx, sy);
      ctx.rotate(Math.atan2(pr.vy, pr.vx));
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(-5, 4);
      ctx.lineTo(-5, -4);
      ctx.closePath();
      ctx.fill();
    } else if (pr.kind === 'arrow') {
      drawGlow(ctx, '#baf7d2', sx, sy, 10, 0.55);
      ctx.strokeStyle = '#e9fff2';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.translate(sx, sy);
      ctx.rotate(Math.atan2(pr.vy, pr.vx));
      ctx.beginPath();
      ctx.moveTo(-9, 0);
      ctx.lineTo(7, 0);
      ctx.stroke();
      ctx.fillStyle = '#e9fff2';
      ctx.beginPath();
      ctx.moveTo(11, 0);
      ctx.lineTo(5, 3);
      ctx.lineTo(5, -3);
      ctx.closePath();
      ctx.fill();
    } else if (pr.kind === 'orb') {
      drawGlow(ctx, '#8fdcff', sx, sy, pr.radius * 2.4, 0.85);
      ctx.fillStyle = '#e8f6ff';
      ctx.beginPath();
      ctx.arc(sx, sy, pr.radius * 0.55, 0, TAU);
      ctx.fill();
      const a = Math.atan2(pr.vy, pr.vx) + Math.PI;
      drawGlow(ctx, '#8fdcff', sx + Math.cos(a) * 12, sy + Math.sin(a) * 12, 10, 0.4);
    } else if (pr.kind === 'spear') {
      drawGlow(ctx, '#ffd166', sx, sy, 12, 0.55);
      ctx.strokeStyle = '#fff0c2';
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.translate(sx, sy);
      ctx.rotate(Math.atan2(pr.vy, pr.vx));
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(10, 0);
      ctx.stroke();
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(7, 4);
      ctx.lineTo(7, -4);
      ctx.closePath();
      ctx.fill();
    } else if (pr.kind === 'mirror') {
      drawGlow(ctx, '#d96bd0', sx, sy, 13, 0.7);
      ctx.fillStyle = '#ffd9f8';
      ctx.translate(sx, sy);
      ctx.rotate(Math.atan2(pr.vy, pr.vx));
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-4, 4.5);
      ctx.lineTo(-1, 0);
      ctx.lineTo(-4, -4.5);
      ctx.closePath();
      ctx.fill();
    } else if (pr.kind === 'chakram') {
      drawGlow(ctx, '#f0c75e', sx, sy, 22, 0.55);
      ctx.strokeStyle = '#ffe9b0';
      ctx.lineWidth = 3.5;
      ctx.translate(sx, sy);
      ctx.rotate(pr.spin);
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0.4, TAU - 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 12, TAU - 0.4, TAU - 0.2);
      ctx.stroke();
    } else if (pr.kind === 'spit') {
      drawGlow(ctx, '#ff7a5c', sx, sy, 14, 0.8);
      ctx.fillStyle = '#ffb49e';
      ctx.beginPath();
      ctx.arc(sx, sy, 4.5, 0, TAU);
      ctx.fill();
    } else if (pr.kind === 'soul') {
      drawGlow(ctx, '#b79cff', sx, sy, 17, 0.85);
      ctx.fillStyle = '#e9defc';
      ctx.beginPath();
      ctx.arc(sx, sy, 4.5, 0, TAU);
      ctx.fill();
      // little wisp tail
      const a = Math.atan2(pr.vy, pr.vx) + Math.PI;
      drawGlow(ctx, '#b79cff', sx + Math.cos(a) * 9, sy + Math.sin(a) * 9, 9, 0.4);
    } else {
      drawGlow(ctx, '#ff4f9e', sx, sy, 18, 0.85);
      ctx.fillStyle = '#ffc2dd';
      ctx.beginPath();
      ctx.arc(sx, sy, 5.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawLightning(g: Game, ctx: CanvasRenderingContext2D): void {
  if (g.lightning.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const l of g.lightning) {
    const a = clamp(l.life / 0.2, 0, 1);
    const x1 = g.cam.toScreenX(l.x1), y1 = g.cam.toScreenY(l.y1);
    const x2 = g.cam.toScreenX(l.x2), y2 = g.cam.toScreenY(l.y2);
    ctx.strokeStyle = withAlpha('#d7f1ff', a);
    ctx.lineWidth = 2.5;
    lightningPath(ctx, x1, y1, x2, y2, 12);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(l.color, a * 0.5);
    ctx.lineWidth = 6;
    lightningPath(ctx, x1, y1, x2, y2, 12);
    ctx.stroke();
    drawGlow(ctx, l.color, x2, y2, 26, a);
  }
  ctx.restore();
}

function drawShockwaves(g: Game, ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const s of g.shockwaves) {
    const a = clamp(s.life / 0.5, 0, 1);
    ctx.strokeStyle = withAlpha(s.color, a * 0.8);
    ctx.lineWidth = 3 + a * 4;
    ctx.beginPath();
    ctx.arc(g.cam.toScreenX(s.x), g.cam.toScreenY(s.y), s.r, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDamageNumbers(g: Game, ctx: CanvasRenderingContext2D): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const d of g.dmgNumbers) {
    const maxLife = d.crit ? 0.9 : 0.65;
    const t = clamp(d.life / maxLife, 0, 1);
    const pop = d.crit ? 1 + (1 - t) * 0.15 : 1;
    const size = (d.crit ? 19 : 13) * pop;
    ctx.font = `800 ${size}px ${SANS}`;
    ctx.globalAlpha = t;
    const sx = g.cam.toScreenX(d.x);
    const sy = g.cam.toScreenY(d.y);
    ctx.fillStyle = '#0a0d18';
    ctx.fillText(d.text, sx + 1.5, sy + 1.5);
    ctx.fillStyle = d.color ?? (d.crit ? '#ffe08a' : '#f2f4fa');
    ctx.fillText(d.text, sx, sy);
  }
  ctx.globalAlpha = 1;
}

function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const key = `${w}x${h}`;
  if (!vignette || vignetteKey !== key) {
    vignette = document.createElement('canvas');
    vignette.width = w;
    vignette.height = h;
    const vctx = vignette.getContext('2d')!;
    const grad = vctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36, w / 2, h / 2, Math.max(w, h) * 0.72);
    grad.addColorStop(0, 'rgba(4,6,12,0)');
    grad.addColorStop(1, 'rgba(4,6,12,0.55)');
    vctx.fillStyle = grad;
    vctx.fillRect(0, 0, w, h);
    vignetteKey = key;
  }
  ctx.drawImage(vignette, 0, 0);
}

function drawBanner(g: Game, ctx: CanvasRenderingContext2D, w: number, h: number): void {
  if (g.bannerT <= 0) return;
  const a = clamp(g.bannerT, 0, 1);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 34px ${SERIF}`;
  ctx.fillStyle = '#0a0d18';
  ctx.fillText(g.bannerText, w / 2 + 2, 142);
  ctx.fillStyle = g.bannerColor;
  ctx.fillText(g.bannerText, w / 2, 140);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

function drawHUD(g: Game, ctx: CanvasRenderingContext2D): void {
  const w = g.cam.viewW;
  const h = g.cam.viewH;
  const p = g.player;
  const s = g.stats;

  ctx.textBaseline = 'middle';

  // --- HP bar (top-left) ---
  const hpW = 250;
  roundRect(ctx, 18, 18, hpW, 20, 5);
  ctx.fillStyle = 'rgba(8,10,20,0.75)';
  ctx.fill();
  const hpPct = clamp(p.hp / s.maxHP, 0, 1);
  if (hpPct > 0) {
    roundRect(ctx, 20, 20, (hpW - 4) * hpPct, 16, 4);
    ctx.fillStyle = hpPct > 0.5 ? '#3ddc97' : hpPct > 0.25 ? '#f0c75e' : '#ee4266';
    ctx.fill();
  }
  ctx.font = `700 12px ${SANS}`;
  ctx.fillStyle = '#eef2ff';
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.ceil(p.hp)} / ${Math.round(s.maxHP)}`, 18 + hpW / 2, 28);

  // Mana shield bar (mage): thin cyan strip under the HP bar
  const shieldCap = g.maxShield();
  if (shieldCap > 0) {
    roundRect(ctx, 18, 40, hpW, 6, 3);
    ctx.fillStyle = 'rgba(8,10,20,0.75)';
    ctx.fill();
    const sfrac = clamp(p.shield / shieldCap, 0, 1);
    if (sfrac > 0) {
      roundRect(ctx, 19, 41, (hpW - 2) * sfrac, 4, 2);
      ctx.fillStyle = '#8fdcff';
      ctx.fill();
    }
  }

  // Dash pips
  for (let i = 0; i < s.dashCharges; i++) {
    const x = 26 + i * 20;
    ctx.beginPath();
    ctx.arc(x, 52, 6, 0, TAU);
    if (i < p.charges) {
      ctx.fillStyle = '#ffe08a';
      ctx.fill();
    } else if (i === p.charges) {
      ctx.fillStyle = 'rgba(255,224,138,0.25)';
      ctx.fill();
      const frac = clamp(p.rechargeT / s.dashRecharge, 0, 1);
      ctx.beginPath();
      ctx.moveTo(x, 52);
      ctx.arc(x, 52, 6, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,224,138,0.7)';
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255,224,138,0.2)';
      ctx.fill();
    }
  }
  // Death defiance markers (one ankh per remaining revive)
  const defiancesLeft = (g.save.mirror['defiance'] ?? 0) - p.defiancesUsed;
  for (let i = 0; i < defiancesLeft; i++) {
    ctx.font = `14px ${SANS}`;
    ctx.fillStyle = '#ffe08a';
    ctx.textAlign = 'left';
    ctx.fillText('☥', 26 + s.dashCharges * 20 + 6 + i * 14, 52);
  }

  // Active obelisk buffs with remaining seconds
  const BUFF_CHIP: Record<string, { glyph: string; color: string }> = {
    wrath: { glyph: '⚔', color: '#ff5a5a' },
    storm: { glyph: 'ϟ', color: '#8fdcff' },
    haste: { glyph: '↯', color: '#f4f1ea' },
    greed: { glyph: '◈', color: '#f0c75e' },
    regen: { glyph: '✚', color: '#3ddc97' },
  };
  let chipX = 20;
  for (const b of g.buffs) {
    const meta = BUFF_CHIP[b.kind];
    if (!meta) continue;
    roundRect(ctx, chipX, 66, 52, 20, 10);
    ctx.fillStyle = 'rgba(8,10,20,0.75)';
    ctx.fill();
    ctx.strokeStyle = withAlpha(meta.color, b.t < 5 ? (Math.sin(performance.now() / 120) > 0 ? 0.9 : 0.3) : 0.7);
    ctx.lineWidth = 1.5;
    roundRect(ctx, chipX, 66, 52, 20, 10);
    ctx.stroke();
    ctx.fillStyle = meta.color;
    ctx.font = `12px ${SANS}`;
    ctx.textAlign = 'left';
    ctx.fillText(meta.glyph, chipX + 7, 77);
    ctx.font = `700 11px ${SANS}`;
    ctx.fillStyle = '#c9d2f0';
    ctx.fillText(`${Math.ceil(b.t)}s`, chipX + 23, 77);
    chipX += 58;
  }

  // --- Chamber + quota / boss bars (top-center; twin fights stack two) ---
  ctx.textAlign = 'center';
  const bosses = g.enemies.filter((e) => e.bossState).slice(0, 2);
  if (bosses.length > 0) {
    const bw = Math.min(520, w - 320);
    bosses.forEach((boss, i) => {
      const y = 26 + i * 34;
      ctx.font = `700 13px ${SERIF}`;
      ctx.fillStyle = '#ffb3c8';
      ctx.fillText(BOSSES[boss.bossState!.variant].name, w / 2, y);
      roundRect(ctx, w / 2 - bw / 2, y + 8, bw, 12, 4);
      ctx.fillStyle = 'rgba(8,10,20,0.75)';
      ctx.fill();
      const pct = clamp(boss.hp / boss.maxHP, 0, 1);
      if (pct > 0) {
        roundRect(ctx, w / 2 - bw / 2 + 2, y + 10, (bw - 4) * pct, 8, 3);
        ctx.fillStyle = BOSSES[boss.bossState!.variant].color;
        ctx.fill();
      }
    });
  } else {
    ctx.font = `700 16px ${SERIF}`;
    ctx.fillStyle = '#c9d2f0';
    const label = g.endless && g.chamber > 10 ? `CHAMBER ${g.chamber} · ENDLESS` : `CHAMBER ${g.chamber}`;
    ctx.fillText(label, w / 2, 24);
    if (g.phase === 'combat' && !g.doors.length && g.quota > 0) {
      const qw = 240;
      const remaining = g.remainingFoes();
      roundRect(ctx, w / 2 - qw / 2, 36, qw, 10, 3);
      ctx.fillStyle = 'rgba(8,10,20,0.75)';
      ctx.fill();
      const pct = clamp(g.killsInChamber / Math.max(1, g.killsInChamber + remaining), 0, 1);
      if (pct > 0) {
        roundRect(ctx, w / 2 - qw / 2 + 2, 38, (qw - 4) * pct, 6, 2);
        ctx.fillStyle = '#c17bff';
        ctx.fill();
      }
      ctx.font = `600 11px ${SANS}`;
      ctx.fillStyle = 'rgba(201,210,240,0.85)';
      ctx.fillText(`${remaining} FOE${remaining === 1 ? '' : 'S'} REMAIN`, w / 2, 56);
    } else if (g.phase === 'cleared') {
      ctx.font = `600 12px ${SANS}`;
      ctx.fillStyle = '#f0c75e';
      ctx.fillText('walk into a door', w / 2, 42);
    }
  }

  // --- Currencies (top-right) ---
  ctx.textAlign = 'right';
  ctx.font = `700 15px ${SANS}`;
  ctx.fillStyle = '#f0c75e';
  ctx.fillText(`◈ ${fmt(g.gold)}`, w - 22, 26);
  ctx.fillStyle = '#e05780';
  ctx.fillText(`⬥ ${fmt(g.save.ichor + g.ichorRun)}`, w - 22, 48);
  // Frenzy indicator
  const fr = g.frenzyBonus();
  if (fr > 0.005) {
    ctx.fillStyle = '#ff5a5a';
    ctx.font = `700 13px ${SANS}`;
    ctx.fillText(`FRENZY +${Math.round(fr * 100)}%`, w - 22, 70);
  }

  // --- XP bar (bottom, full width) ---
  const xw = w - 36;
  roundRect(ctx, 18, h - 26, xw, 12, 4);
  ctx.fillStyle = 'rgba(8,10,20,0.8)';
  ctx.fill();
  const xpPct = clamp(g.xp / g.xpNeeded, 0, 1);
  if (xpPct > 0) {
    roundRect(ctx, 20, h - 24, (xw - 4) * xpPct, 8, 3);
    const grad = ctx.createLinearGradient(20, 0, 20 + xw, 0);
    grad.addColorStop(0, '#55d6f5');
    grad.addColorStop(1, '#c17bff');
    ctx.fillStyle = grad;
    ctx.fill();
  }
  ctx.textAlign = 'right';
  ctx.font = `800 13px ${SANS}`;
  ctx.fillStyle = '#eef2ff';
  ctx.fillText(`LV ${g.level}`, w - 24, h - 40);

  // --- Boons (bottom-left, above XP bar) ---
  let bx = 26;
  for (const owned of g.boons) {
    const def = boonDef(owned.id);
    const col = def.duo ? '#f0c75e' : GOD_COLOR[def.god];
    ctx.beginPath();
    ctx.arc(bx, h - 48, 9, 0, TAU);
    ctx.fillStyle = 'rgba(8,10,20,0.8)';
    ctx.fill();
    ctx.strokeStyle = def.duo ? '#f0c75e' : RARITY_COLOR[owned.rarity];
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.font = `800 10px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText(def.duo ? '✦' : godGlyph(def.god), bx, h - 48);
    bx += 24;
  }

  // --- Weapons (bottom-right, above XP bar) ---
  let wx = w - 34;
  for (let i = g.weapons.length - 1; i >= 0; i--) {
    const ow = g.weapons[i];
    const def = weaponDef(ow.id);
    const transcended = ow.level >= WEAPON_MAX_LEVEL;
    ctx.beginPath();
    ctx.arc(wx, h - 52, 11, 0, TAU);
    ctx.fillStyle = 'rgba(8,10,20,0.8)';
    ctx.fill();
    ctx.strokeStyle = transcended ? '#ffe08a' : def.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = transcended ? '#ffe08a' : def.color;
    ctx.font = `13px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText(def.icon, wx, h - 51);
    ctx.font = `700 9px ${SANS}`;
    ctx.fillStyle = '#c9d2f0';
    ctx.fillText(transcended ? '★' : `${ow.level}`, wx, h - 36);
    wx -= 30;
  }

  // Build panel hint
  ctx.textAlign = 'left';
  ctx.font = `600 11px ${SANS}`;
  ctx.fillStyle = 'rgba(201,210,240,0.4)';
  ctx.fillText('TAB build · ESC pause', 22, h - 44);
}

/** Virtual sticks + dash button, only once the player has touched the screen. */
function drawTouchUI(g: Game, ctx: CanvasRenderingContext2D): void {
  const inp = g.input;
  if (!inp.touchActive) return;
  const h = g.cam.viewH;

  ctx.save();
  // Move stick: anchored where the thumb landed; a faint hint circle otherwise
  if (inp.touchMoveHeld()) {
    const ox = inp.touchStickOX;
    const oy = inp.touchStickOY;
    ctx.strokeStyle = 'rgba(240,199,94,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ox, oy, 54, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = 'rgba(240,199,94,0.45)';
    ctx.beginPath();
    ctx.arc(ox + inp.touchMoveX * 54, oy + inp.touchMoveY * 54, 22, 0, TAU);
    ctx.fill();
  } else {
    ctx.strokeStyle = 'rgba(240,199,94,0.14)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(110, h - 130, 54, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = 'rgba(240,199,94,0.12)';
    ctx.beginPath();
    ctx.arc(110, h - 130, 22, 0, TAU);
    ctx.fill();
  }

  // Dash button
  const canDash = g.player.charges > 0;
  ctx.fillStyle = 'rgba(8,10,20,0.6)';
  ctx.beginPath();
  ctx.arc(inp.dashBtnX, inp.dashBtnY, inp.dashBtnR, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = canDash ? 'rgba(255,224,138,0.75)' : 'rgba(255,224,138,0.25)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = canDash ? '#ffe08a' : 'rgba(255,224,138,0.3)';
  ctx.font = `26px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('≫', inp.dashBtnX, inp.dashBtnY + 1);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(hex: string, factor: number): string {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const gr = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  return `rgb(${r},${gr},${b})`;
}
