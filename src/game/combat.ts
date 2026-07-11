// ---------------------------------------------------------------------------
// Per-frame simulation: player, enemies, bosses, auto-weapons, projectiles,
// cinder patches, pickups, doors. Pure functions over the Game state.
// ---------------------------------------------------------------------------
import { angleDiff, clamp, rand, TAU } from '../engine/math';
import type { Game } from './game';
import {
  AEGIS, ARROW, BOSSES, BREATH, CATACLYSM, CENSER, CHAKRAM, CINDERPATH, COMET,
  DARTS, FANGS, FROST, HAMMER, LASH, MAELSTROM, MIRRORB, ORB, OUROBOROS, PULSE,
  SIPHON, SPEAR, TOWER_CAPTURE_RADIUS, TOWER_CHANNEL_TIME,
  TOWER_DECAY_RATE, TRAPDEF, VERDICT, aliveTarget, isBossChamber,
} from './data';
import type { BossVariant, Enemy, Projectile } from './types';

const PLAYER_RADIUS = 15;
const STRIKE_RANGE = 84;
const STRIKE_ARC = 1.05; // ± radians
const STRIKE_BASE = 24;
const FINISHER_MULT = 1.7;

// Scratch buffer for spatial queries (avoids per-frame allocation)
const Q: Enemy[] = [];

export function updateCombat(g: Game, dt: number): void {
  g.hash.rebuild(g.enemies);
  updatePlayer(g, dt);
  updateTowers(g, dt);
  updateChests(g, dt);
  updateWeapons(g, dt);
  updateTraps(g, dt);
  updateDelayedHits(g, dt);
  updateSpawns(g, dt);
  updateEnemies(g, dt);
  updateProjectiles(g, dt);
  updatePatches(g, dt);
  updatePickups(g, dt);
  updateDoors(g);
  g.enemies = g.enemies.filter((e) => e.hp > 0);
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function updatePlayer(g: Game, dt: number): void {
  const p = g.player;
  const s = g.stats;
  const input = g.input;

  p.invulnT = Math.max(0, p.invulnT - dt);
  p.hurtT = Math.max(0, p.hurtT - dt);
  p.strikeCd = Math.max(0, p.strikeCd - dt);
  p.strikeAnimT = Math.max(0, p.strikeAnimT - dt);
  if (p.comboT > 0) {
    p.comboT -= dt;
    if (p.comboT <= 0) p.comboIdx = 0;
  }

  // Accessibility: track the nearest live enemy for auto-aim / auto-fire
  const wantsAssist = g.save.settings.autoAim || g.save.settings.autoFire;
  let autoTarget: Enemy | null = null;
  let autoDist = Infinity;
  if (wantsAssist) {
    for (const e of g.enemies) {
      if (e.hp <= 0 || e.spawnT > 0) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < autoDist) {
        autoDist = d;
        autoTarget = e;
      }
    }
  }

  // Aim: auto-aim locks to the nearest enemy; otherwise right stick, then mouse
  if (g.save.settings.autoAim && autoTarget) {
    p.aim = Math.atan2(autoTarget.y - p.y, autoTarget.x - p.x);
  } else if (input.padAimActive) {
    p.aim = Math.atan2(input.padAimY, input.padAimX);
  } else {
    const mx = g.cam.toWorldX(input.mouseX);
    const my = g.cam.toWorldY(input.mouseY);
    p.aim = Math.atan2(my - p.y, mx - p.x);
  }

  const axis = input.axis();
  p.moveX = axis.x;
  p.moveY = axis.y;
  const moving = axis.x !== 0 || axis.y !== 0;
  if (moving) {
    p.facingX = axis.x;
    p.facingY = axis.y;
    p.walkT += dt * 11;
  }

  const tranceBonus = g.mods.battleTrance ? g.frenzyBonus() * 0.5 : 0;
  const speed = 238 * (1 + s.moveSpeed + tranceBonus + g.moveSpeedExtra());

  // Dash
  if (p.dashT > 0) {
    p.dashT -= dt;
    p.x += p.dashDirX * 950 * dt;
    p.y += p.dashDirY * 950 * dt;
    g.particles.spawn({
      x: p.x, y: p.y, vx: 0, vy: 0, life: 0.25, maxLife: 0.25,
      size: 8, color: g.mods.rideTheLightning ? '#8fdcff' : '#ffe08a',
      drag: 0, gravity: 0, additive: true,
    });
    if (g.mods.rideTheLightning) {
      g.hash.query(p.x, p.y, 60, Q);
      for (const e of Q) {
        if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 > (60 + e.radius) ** 2) continue;
        const key = 'rtl';
        if ((e.hitCd[key] ?? 0) > g.runT) continue;
        e.hitCd[key] = g.runT + 0.5;
        g.dealDamage(e, 45, { source: 'bolt', depth: 1 });
      }
    }
    // Slipstream duo: shoulder enemies out of the dash lane
    if (g.mods.slipstream) {
      g.hash.query(p.x, p.y, 56, Q);
      for (const e of Q) {
        if (e.bossState) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d > 56 + e.radius) continue;
        e.vx += ((e.x - p.x) / Math.max(10, d)) * 260;
        e.vy += ((e.y - p.y) / Math.max(10, d)) * 260;
      }
    }
  } else {
    p.x += axis.x * speed * dt;
    p.y += axis.y * speed * dt;
    if (input.pressed('Space', 'ShiftLeft', 'ShiftRight', 'PadDash') && p.charges > 0 && g.phase !== 'over') {
      p.charges--;
      p.dashT = 0.16;
      const dx = moving ? axis.x : p.facingX;
      const dy = moving ? axis.y : p.facingY;
      const len = Math.hypot(dx, dy) || 1;
      p.dashDirX = dx / len;
      p.dashDirY = dy / len;
      g.audio.play('dash');
      if (g.mods.dashBoltDamage > 0) g.boltStrike(p.x, p.y, g.mods.dashBoltDamage);
      // Breaking Wave: the sea surges outward from your launch point
      if (g.mods.dashWave > 0) {
        g.shockwaves.push({ x: p.x, y: p.y, r: 12, maxR: 95, life: 0.3, color: '#4a90ff' });
        g.audio.play('nova');
        g.hash.query(p.x, p.y, 95, Q);
        for (const e of Q) {
          const d = Math.hypot(e.x - p.x, e.y - p.y);
          if (d > 95 + e.radius) continue;
          g.dealDamage(e, g.mods.dashWave, {
            source: 'nova',
            kx: ((e.x - p.x) / Math.max(10, d)) * 420,
            ky: ((e.y - p.y) / Math.max(10, d)) * 420,
          });
        }
      }
    }
  }

  // Dash recharge
  if (p.charges < s.dashCharges) {
    p.rechargeT += dt;
    if (p.rechargeT >= s.dashRecharge) {
      p.rechargeT = 0;
      p.charges++;
    }
  } else {
    p.rechargeT = 0;
  }

  // Arena bounds + pillars
  p.x = clamp(p.x, -g.arenaHalfW + PLAYER_RADIUS, g.arenaHalfW - PLAYER_RADIUS);
  p.y = clamp(p.y, -g.arenaHalfH + PLAYER_RADIUS, g.arenaHalfH - PLAYER_RADIUS);
  pushOutOfPillars(g, p, PLAYER_RADIUS);

  // Basic attack (character-specific). Auto-fire attacks whenever a target
  // is inside this character's effective reach.
  const autoReach = (g.character === 'archer' ? 600 : g.character === 'mage' ? 460 : STRIKE_RANGE + 30)
    * (1 + g.stats.range);
  const autoWants = g.save.settings.autoFire && autoTarget !== null
    && autoDist <= autoReach + (autoTarget?.radius ?? 0);
  if ((input.mouseDown || input.padFire || input.touchAimHeld || autoWants)
    && p.strikeCd <= 0 && g.phase !== 'over') {
    if (g.character === 'archer') shootArrow(g);
    else if (g.character === 'mage') castOrb(g);
    else doStrike(g);
  }
}

/** King Tide legendary: finishing blows release a breaking wave. */
function kingTideWave(g: Game, x: number, y: number): void {
  const r = 110 * (1 + g.stats.area);
  g.shockwaves.push({ x, y, r: 12, maxR: r, life: 0.3, color: '#4a90ff' });
  g.audio.play('nova');
  g.hash.query(x, y, r, Q);
  for (const e of Q) {
    const d = Math.hypot(e.x - x, e.y - y);
    if (d > r + e.radius) continue;
    g.dealDamage(e, 35, {
      source: 'nova',
      kx: ((e.x - x) / Math.max(10, d)) * 420,
      ky: ((e.y - y) / Math.max(10, d)) * 420,
    });
  }
}

/** Shared on-hit procs for basic attacks: Wounds, Chill, chain lightning. */
function strikeProcs(g: Game, e: Enemy, base: number, doChain: boolean): void {
  if (g.mods.woundDPS > 0 && e.hp > 0) {
    e.woundT = 3;
    e.woundDPS = g.mods.woundDPS;
  }
  if (g.mods.chillDur > 0 && e.hp > 0) {
    e.chillT = Math.max(e.chillT, g.mods.chillDur);
  }
  if (doChain && g.mods.chainDamage > 0) {
    const targets = g.enemies
      .filter((o) => o.hp > 0 && o !== e)
      .map((o) => ({ o, d2: (o.x - e.x) ** 2 + (o.y - e.y) ** 2 }))
      .filter((t) => t.d2 < 180 * 180)
      .sort((a, b) => a.d2 - b.d2)
      .slice(0, 3);
    let px = e.x, py = e.y;
    for (const t of targets) {
      g.lightning.push({ x1: px, y1: py, x2: t.o.x, y2: t.o.y, life: 0.16, color: '#8fdcff' });
      g.dealDamage(t.o, base * g.mods.chainDamage, { source: 'bolt', depth: 1 });
      px = t.o.x;
      py = t.o.y;
    }
    if (targets.length > 0) g.audio.play('bolt');
  }
}

/** Archer: long-range piercing arrows; every 3rd shot is a triple volley. */
function shootArrow(g: Game): void {
  const p = g.player;
  const power = p.comboIdx === 2;
  p.lastFinisher = power;
  p.strikeCd = (power ? ARROW.power.cd : ARROW.cd) / g.atkSpeedMult();
  p.strikeAnimT = 0.14;
  p.strikeAngle = p.aim;
  p.comboIdx = (p.comboIdx + 1) % 3;
  p.comboT = 1.4;
  if (power && g.mods.kingTide) kingTideWave(g, p.x, p.y);
  const n = (power ? ARROW.power.count : 1) + (power ? g.stats.projectiles : 0);
  for (let i = 0; i < n; i++) {
    const a = p.aim + (i - (n - 1) / 2) * ARROW.power.spread;
    const pr = makeProj('arrow', p.x + Math.cos(a) * 16, p.y + Math.sin(a) * 16,
      Math.cos(a) * ARROW.speed, Math.sin(a) * ARROW.speed,
      6, ARROW.base * (power ? ARROW.power.mult : 1), true,
      (power ? ARROW.power.pierce : ARROW.pierce) + g.stats.pierce, 0);
    g.projectiles.push(pr);
  }
  g.audio.play('dash');
}

/** Mage: exploding spell-orbs; every 3rd is a surge with a larger blast. */
function castOrb(g: Game): void {
  const p = g.player;
  const surge = p.comboIdx === 2;
  p.lastFinisher = surge;
  p.strikeCd = (surge ? ORB.surge.cd : ORB.cd) / g.atkSpeedMult();
  p.strikeAnimT = 0.18;
  p.strikeAngle = p.aim;
  p.comboIdx = (p.comboIdx + 1) % 3;
  p.comboT = 1.4;
  if (surge && g.mods.kingTide) kingTideWave(g, p.x, p.y);
  const pr = makeProj('orb', p.x + Math.cos(p.aim) * 18, p.y + Math.sin(p.aim) * 18,
    Math.cos(p.aim) * ORB.speed, Math.sin(p.aim) * ORB.speed,
    surge ? 12 : 9, ORB.base * (surge ? ORB.surge.mult : 1), true, 0, 0);
  pr.aoe = (surge ? ORB.surge.aoe : ORB.aoe) * (1 + g.stats.area);
  g.projectiles.push(pr);
  g.audio.play('nova');
}

function explodeOrb(g: Game, pr: Projectile): void {
  g.shockwaves.push({ x: pr.x, y: pr.y, r: 8, maxR: pr.aoe, life: 0.3, color: '#8fdcff' });
  g.particles.burst(pr.x, pr.y, '#8fdcff', 10, { speed: 200, size: 5, life: 0.4 });
  g.audio.play('nova');
  g.hash.query(pr.x, pr.y, pr.aoe + 30, Q);
  for (const e of Q) {
    if (e.hp <= 0 || e.spawnT > 0 || pr.hitIds.has(e.id)) continue;
    if ((e.x - pr.x) ** 2 + (e.y - pr.y) ** 2 > (pr.aoe + e.radius) ** 2) continue;
    g.dealDamage(e, pr.damage * ORB.aoeFrac, { source: 'strike' });
  }
}

function doStrike(g: Game): void {
  const p = g.player;
  const finisher = p.comboIdx === 2;
  p.lastFinisher = finisher;
  // Finisher hits harder but has a longer recovery
  p.strikeCd = (finisher ? 0.52 : 0.3) / g.atkSpeedMult();
  p.strikeAnimT = finisher ? 0.22 : 0.16;
  p.strikeAngle = p.aim;
  p.comboIdx = (p.comboIdx + 1) % 3;
  p.comboT = 1.1;
  if (finisher && g.mods.kingTide) {
    kingTideWave(g, p.x + Math.cos(p.aim) * 40, p.y + Math.sin(p.aim) * 40);
  }

  const arc = STRIKE_ARC + (finisher ? 0.18 : 0);
  const base = STRIKE_BASE * (finisher ? FINISHER_MULT : 1);
  const knock = 260 * (finisher ? 1.9 : 1);

  const reach = STRIKE_RANGE * (1 + g.stats.range); // Farsight / Olympian Reach
  const cx = p.x + Math.cos(p.aim) * 30;
  const cy = p.y + Math.sin(p.aim) * 30;
  g.hash.query(cx, cy, reach + 30, Q);
  const hit: Enemy[] = [];
  for (const e of Q) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d > reach + e.radius) continue;
    if (Math.abs(angleDiff(p.aim, Math.atan2(e.y - p.y, e.x - p.x))) > arc) continue;
    hit.push(e);
  }
  let connected = false;
  for (const e of hit) {
    connected = true;
    const kx = Math.cos(p.aim) * knock;
    const ky = Math.sin(p.aim) * knock;
    g.dealDamage(e, base, { source: 'strike', kx, ky });
    strikeProcs(g, e, base, e === hit[0]); // wounds all; chains once per swing
  }
  // Parry enemy projectiles caught in the arc
  for (let i = g.projectiles.length - 1; i >= 0; i--) {
    const pr = g.projectiles[i];
    if (pr.friendly) continue;
    const d = Math.hypot(pr.x - p.x, pr.y - p.y);
    if (d < reach + 14 &&
      Math.abs(angleDiff(p.aim, Math.atan2(pr.y - p.y, pr.x - p.x))) < arc + 0.2) {
      g.particles.burst(pr.x, pr.y, '#ffe08a', 5, { speed: 140, size: 4, life: 0.3 });
      g.projectiles.splice(i, 1);
    }
  }
  if (connected) {
    g.audio.play('hit');
    g.cam.shake(finisher ? 3 : 1.2);
  }
}

// ---------------------------------------------------------------------------
// Obelisk capture: stand in the ring to channel; leaving lets it decay.
// The first moment of channeling wakes a defense wave.
// ---------------------------------------------------------------------------

function updateTowers(g: Game, dt: number): void {
  if (g.phase !== 'combat') return; // no safe captures after the fight
  const p = g.player;
  for (const t of g.towers) {
    t.phase += dt;
    if (t.captured) continue;
    const inRing = (p.x - t.x) ** 2 + (p.y - t.y) ** 2 <= TOWER_CAPTURE_RADIUS ** 2;
    if (inRing && g.deathT <= 0) {
      if (t.progress === 0) g.audio.play('ui');
      // Channeling attracts attention
      if (!t.waveSpawned && g.phase === 'combat') {
        t.waveSpawned = true;
        for (let i = 0; i < 4; i++) {
          const a = rand(TAU);
          const r = rand(240, 360);
          const x = clamp(t.x + Math.cos(a) * r, -g.arenaHalfW + 40, g.arenaHalfW - 40);
          const y = clamp(t.y + Math.sin(a) * r, -g.arenaHalfH + 40, g.arenaHalfH - 40);
          g.spawnEnemyAt({ x, y });
        }
      }
      t.progress += dt / TOWER_CHANNEL_TIME;
      // Rising motes while channeling
      if (Math.random() < 0.3) {
        g.particles.spawn({
          x: t.x + rand(-30, 30), y: t.y + rand(-10, 30),
          vx: 0, vy: rand(-90, -50), life: 0.6, maxLife: 0.6,
          size: 4, color: '#ffe08a', drag: 0, gravity: 0, additive: true,
        });
      }
      if (t.progress >= 1) {
        t.progress = 1;
        g.captureTower(t);
      }
    } else if (t.progress > 0) {
      t.progress = Math.max(0, t.progress - dt * TOWER_DECAY_RATE);
    }
  }
}

function updateChests(g: Game, dt: number): void {
  if (g.phase !== 'combat' && g.phase !== 'cleared') return;
  const p = g.player;
  for (const chest of [...g.chests]) {
    chest.phase += dt;
    const d2 = (p.x - chest.x) ** 2 + (p.y - chest.y) ** 2;
    if (d2 > 38 * 38) {
      chest.nagged = false;
      continue;
    }
    if (!g.openChest(chest) && !chest.nagged) {
      chest.nagged = true;
      g.ui.showToast(`Gilded chest: need ◈ ${chest.cost}`, '#ee4266');
    }
  }
}

function pushOutOfPillars(g: Game, obj: { x: number; y: number }, r: number): void {
  for (const pil of g.pillars) {
    const dx = obj.x - pil.x;
    const dy = obj.y - pil.y;
    const d = Math.hypot(dx, dy);
    const min = pil.radius + r;
    if (d < min && d > 0.001) {
      obj.x = pil.x + (dx / d) * min;
      obj.y = pil.y + (dy / d) * min;
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-weapons
// ---------------------------------------------------------------------------

function updateWeapons(g: Game, dt: number): void {
  const p = g.player;
  const atk = g.atkSpeedMult();
  for (const w of g.weapons) {
    const li = w.level - 1;
    switch (w.id) {
      case 'aegis': {
        w.angle += AEGIS.spinSpeed * atk * dt;
        const n = AEGIS.blades[li];
        for (let i = 0; i < n; i++) {
          const a = w.angle + (i / n) * TAU;
          const bx = p.x + Math.cos(a) * AEGIS.radius[li];
          const by = p.y + Math.sin(a) * AEGIS.radius[li];
          g.hash.query(bx, by, 30, Q);
          for (const e of Q) {
            if ((e.x - bx) ** 2 + (e.y - by) ** 2 > (16 + e.radius) ** 2) continue;
            if ((e.hitCd['ae'] ?? 0) > g.runT) continue;
            e.hitCd['ae'] = g.runT + AEGIS.hitCooldown;
            const d = Math.max(10, Math.hypot(e.x - p.x, e.y - p.y));
            g.dealDamage(e, AEGIS.damage[li], {
              source: 'auto',
              kx: ((e.x - p.x) / d) * 150, ky: ((e.y - p.y) / d) * 150,
            });
          }
        }
        break;
      }
      case 'darts': {
        w.t -= dt;
        if (w.t <= 0) {
          const dCount = DARTS.count[li] + g.stats.projectiles;
          const targets = nearestEnemies(g, p.x, p.y, 700, dCount);
          if (targets.length === 0) {
            w.t = 0.2;
          } else {
            w.t = DARTS.interval[li] / atk;
            for (let i = 0; i < dCount; i++) {
              const tgt = targets[i % targets.length];
              const a = Math.atan2(tgt.y - p.y, tgt.x - p.x) + rand(-0.3, 0.3);
              g.projectiles.push(makeProj('dart', p.x, p.y,
                Math.cos(a) * DARTS.speed, Math.sin(a) * DARTS.speed,
                7, DARTS.damage[li], true, g.stats.pierce, tgt.id));
            }
          }
        }
        break;
      }
      case 'pulse': {
        w.t -= dt;
        if (w.t <= 0) {
          w.t = PULSE.interval[li] / atk;
          const r = PULSE.radius[li] * (1 + g.stats.area);
          g.shockwaves.push({ x: p.x, y: p.y, r: 14, maxR: r, life: 0.35, color: '#c17bff' });
          g.audio.play('nova');
          g.hash.query(p.x, p.y, r, Q);
          for (const e of Q) {
            const d = Math.hypot(e.x - p.x, e.y - p.y);
            if (d > r + e.radius) continue;
            const nx = (e.x - p.x) / Math.max(10, d);
            const ny = (e.y - p.y) / Math.max(10, d);
            g.dealDamage(e, PULSE.damage[li], {
              source: 'auto', kx: nx * PULSE.knockback, ky: ny * PULSE.knockback,
            });
          }
        }
        break;
      }
      case 'cinderpath': {
        const moving = p.moveX !== 0 || p.moveY !== 0 || p.dashT > 0;
        if (moving) {
          w.trailT -= dt;
          if (w.trailT <= 0) {
            w.trailT = CINDERPATH.emitEvery;
            if (g.patches.length > 130) g.patches.shift();
            g.patches.push({
              x: p.x - p.facingX * 14, y: p.y - p.facingY * 14,
              radius: CINDERPATH.radius[li], life: CINDERPATH.duration,
              dps: CINDERPATH.dps[li], hostile: false, seed: rand(TAU),
            });
          }
        }
        break;
      }
      case 'chakram': {
        w.t -= dt;
        if (w.t <= 0) {
          w.t = CHAKRAM.interval[li] / atk;
          const n = CHAKRAM.count[li] + g.stats.projectiles;
          const spread = [0, 0.55, -0.55, 1.1, -1.1, Math.PI];
          for (let i = 0; i < n; i++) {
            const a = p.aim + spread[i % spread.length];
            g.projectiles.push(makeProj('chakram', p.x, p.y,
              Math.cos(a) * CHAKRAM.speed, Math.sin(a) * CHAKRAM.speed,
              CHAKRAM.radius, CHAKRAM.damage[li], true, -1, 0));
          }
        }
        break;
      }
      case 'lash': {
        w.t -= dt;
        if (w.t <= 0) {
          const targets = nearestEnemies(g, p.x, p.y, LASH.range, 1);
          if (targets.length === 0) {
            w.t = 0.25;
          } else {
            w.t = LASH.interval[li] / atk;
            const first = targets[0];
            g.lightning.push({ x1: p.x, y1: p.y, x2: first.x, y2: first.y, life: 0.18, color: '#8fdcff' });
            g.dealDamage(first, LASH.damage[li], { source: 'auto' });
            // Chain outward
            let fromX = first.x, fromY = first.y;
            const seen = new Set([first.id]);
            for (let c = 0; c < LASH.chains[li]; c++) {
              const next = g.enemies
                .filter((e) => e.hp > 0 && e.spawnT <= 0 && !seen.has(e.id))
                .map((e) => ({ e, d2: (e.x - fromX) ** 2 + (e.y - fromY) ** 2 }))
                .filter((t) => t.d2 < LASH.chainRange * LASH.chainRange)
                .sort((a, b) => a.d2 - b.d2)[0];
              if (!next) break;
              seen.add(next.e.id);
              g.lightning.push({ x1: fromX, y1: fromY, x2: next.e.x, y2: next.e.y, life: 0.15, color: '#8fdcff' });
              g.dealDamage(next.e, LASH.damage[li] * LASH.chainFrac, { source: 'auto', depth: 1 });
              fromX = next.e.x;
              fromY = next.e.y;
            }
            g.audio.play('bolt');
          }
        }
        break;
      }
      case 'mirror': {
        w.t -= dt;
        if (w.t <= 0) {
          w.t = MIRRORB.interval[li] / atk;
          const n = MIRRORB.count[li] + g.stats.projectiles;
          const back = p.aim + Math.PI;
          for (let i = 0; i < n; i++) {
            const a = back + (i - (n - 1) / 2) * 0.3;
            g.projectiles.push(makeProj('mirror', p.x, p.y,
              Math.cos(a) * MIRRORB.speed, Math.sin(a) * MIRRORB.speed,
              9, MIRRORB.damage[li], true, MIRRORB.pierce + g.stats.pierce, 0));
          }
        }
        break;
      }
      case 'comet': {
        w.t -= dt;
        if (w.t <= 0) {
          const targets = nearestEnemies(g, p.x, p.y, COMET.range, 6);
          if (targets.length === 0) {
            w.t = 0.3;
          } else {
            w.t = COMET.interval[li] / atk;
            const tgt = targets[Math.floor(rand(targets.length))];
            const r = COMET.radius[li];
            g.telegraphs.push({
              kind: 'circle', x: tgt.x, y: tgt.y, x2: 0, y2: 0,
              radius: r, t: COMET.delay, maxT: COMET.delay,
            });
            g.delayedHits.push({ x: tgt.x, y: tgt.y, t: COMET.delay, damage: COMET.damage[li], radius: r });
          }
        }
        break;
      }
      case 'spear': {
        w.t -= dt;
        if (w.t <= 0) {
          w.t = SPEAR.interval[li] / atk;
          const n = SPEAR.count[li] + g.stats.projectiles;
          for (let i = 0; i < n; i++) {
            const a = p.aim + (i - (n - 1) / 2) * 0.14;
            g.projectiles.push(makeProj('spear', p.x + Math.cos(a) * 18, p.y + Math.sin(a) * 18,
              Math.cos(a) * SPEAR.speed, Math.sin(a) * SPEAR.speed,
              9, SPEAR.damage[li], true, SPEAR.pierce + g.stats.pierce, 0));
          }
        }
        break;
      }
      case 'trap': {
        w.t -= dt;
        if (w.t <= 0 && g.traps.length < TRAPDEF.maxOut[li]) {
          w.t = TRAPDEF.interval[li] / atk;
          g.traps.push({
            x: p.x, y: p.y, armT: TRAPDEF.armTime,
            damage: TRAPDEF.damage[li], radius: TRAPDEF.radius, phase: rand(TAU),
          });
        }
        break;
      }
      case 'hammer': {
        w.t -= dt;
        if (w.t <= 0) {
          w.t = HAMMER.interval[li] / atk;
          const hx = p.x + Math.cos(p.aim) * HAMMER.reach;
          const hy = p.y + Math.sin(p.aim) * HAMMER.reach;
          const r = HAMMER.radius[li];
          g.shockwaves.push({ x: hx, y: hy, r: 10, maxR: r, life: 0.35, color: '#c9a86a' });
          g.particles.burst(hx, hy, '#c9a86a', 12, { speed: 220, size: 5, life: 0.4 });
          g.audio.play('nova');
          g.cam.shake(2.5);
          g.hash.query(hx, hy, r + 30, Q);
          for (const e of Q) {
            const d = Math.hypot(e.x - hx, e.y - hy);
            if (d > r + e.radius) continue;
            g.dealDamage(e, HAMMER.damage[li], {
              source: 'auto',
              kx: ((e.x - hx) / Math.max(10, d)) * HAMMER.knockback,
              ky: ((e.y - hy) / Math.max(10, d)) * HAMMER.knockback,
            });
          }
        }
        break;
      }
      case 'frost': {
        w.t -= dt;
        if (w.t <= 0) {
          w.t = FROST.interval[li] / atk;
          const r = FROST.radius[li] * (1 + g.stats.area);
          g.shockwaves.push({ x: p.x, y: p.y, r: 12, maxR: r, life: 0.4, color: '#a8e6ff' });
          g.audio.play('nova');
          g.hash.query(p.x, p.y, r + 30, Q);
          for (const e of Q) {
            const d = Math.hypot(e.x - p.x, e.y - p.y);
            if (d > r + e.radius) continue;
            e.chillT = Math.max(e.chillT, FROST.chill[li]);
            g.dealDamage(e, FROST.damage[li], { source: 'auto' });
          }
        }
        break;
      }
      case 'fangs': {
        w.t -= dt;
        if (w.t <= 0) {
          w.t = FANGS.interval[li] / atk;
          const n = 2 + g.stats.projectiles;
          for (let i = 0; i < n; i++) {
            // Alternate flanks: +90°, -90°, then rear quarters for extras
            const off = [Math.PI / 2, -Math.PI / 2, Math.PI * 0.75, -Math.PI * 0.75, Math.PI][i % 5];
            const a = p.aim + off;
            g.projectiles.push(makeProj('mirror', p.x, p.y,
              Math.cos(a) * FANGS.speed, Math.sin(a) * FANGS.speed,
              9, FANGS.damage[li], true, 1 + g.stats.pierce, 0));
          }
        }
        break;
      }
      case 'censer': {
        w.angle += CENSER.orbitSpeed * atk * dt;
        const cx = p.x + Math.cos(w.angle) * CENSER.orbitRadius;
        const cy = p.y + Math.sin(w.angle) * CENSER.orbitRadius;
        w.trailT -= dt;
        if (w.trailT <= 0) {
          w.trailT = CENSER.emitEvery;
          if (g.patches.length > 130) g.patches.shift();
          g.patches.push({
            x: cx, y: cy,
            radius: CENSER.patchRadius[li] * (1 + g.stats.area), life: CENSER.patchLife,
            dps: CENSER.dps[li], hostile: false, seed: rand(TAU),
          });
        }
        break;
      }
      case 'maelstrom': {
        w.t -= dt;
        if (w.t <= 0) {
          w.t = MAELSTROM.interval[li] / atk;
          const r = MAELSTROM.radius[li] * (1 + g.stats.area);
          g.shockwaves.push({ x: p.x, y: p.y, r: r, maxR: r * 0.2, life: 0.4, color: '#5cc8ff' });
          g.audio.play('nova');
          g.hash.query(p.x, p.y, r + 30, Q);
          for (const e of Q) {
            const d = Math.hypot(e.x - p.x, e.y - p.y);
            if (d > r + e.radius) continue;
            // Knockback INWARD — feeds novas, traps, and the strike arc
            g.dealDamage(e, MAELSTROM.damage[li], {
              source: 'auto',
              kx: ((p.x - e.x) / Math.max(10, d)) * MAELSTROM.pull,
              ky: ((p.y - e.y) / Math.max(10, d)) * MAELSTROM.pull,
            });
          }
        }
        break;
      }
      case 'breath': {
        w.t -= dt;
        if (w.t <= 0) {
          w.t = BREATH.interval[li] / atk;
          const R = BREATH.range[li] * (1 + g.stats.range);
          for (let i = 0; i < 10; i++) {
            const a = p.aim + rand(-BREATH.arc, BREATH.arc) * 0.8;
            const d = rand(40, R);
            g.particles.burst(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, '#ff6b35', 2,
              { speed: 60, size: 5, life: 0.35 });
          }
          g.audio.play('nova');
          g.hash.query(p.x, p.y, R + 40, Q);
          for (const e of Q) {
            const d = Math.hypot(e.x - p.x, e.y - p.y);
            if (d > R + e.radius) continue;
            if (Math.abs(angleDiff(p.aim, Math.atan2(e.y - p.y, e.x - p.x))) > BREATH.arc) continue;
            g.dealDamage(e, BREATH.damage[li], { source: 'auto' });
          }
        }
        break;
      }
      case 'siphon': {
        w.t -= dt;
        if (w.t <= 0) {
          const targets = nearestEnemies(g, p.x, p.y, SIPHON.range * (1 + g.stats.range), 1);
          if (targets.length === 0) {
            w.t = 0.25;
          } else {
            w.t = SIPHON.interval[li] / atk;
            const tgt = targets[0];
            g.lightning.push({ x1: tgt.x, y1: tgt.y, x2: p.x, y2: p.y, life: 0.22, color: '#3ddc97' });
            g.dealDamage(tgt, SIPHON.damage[li], { source: 'auto' });
            g.player.hp = Math.min(g.stats.maxHP, g.player.hp + SIPHON.heal[li]);
          }
        }
        break;
      }
      case 'cataclysm': {
        w.t -= dt;
        if (w.t <= 0) {
          w.t = CATACLYSM.interval[li] / atk;
          const r = CATACLYSM.radius * (1 + g.stats.area);
          g.cam.shake(9);
          g.audio.play('slam');
          g.shockwaves.push({ x: p.x, y: p.y, r: 30, maxR: r, life: 0.6, color: '#ff2d55' });
          for (const e of g.enemies) {
            if (e.hp <= 0 || e.spawnT > 0) continue;
            if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 > r * r) continue;
            e.chillT = Math.max(e.chillT, CATACLYSM.chill);
            g.dealDamage(e, CATACLYSM.damage[li], { source: 'auto' });
          }
        }
        break;
      }
      case 'verdict': {
        w.t -= dt;
        if (w.t <= 0) {
          // The pillar seeks the mightiest foe standing — bosses included
          let tgt: Enemy | null = null;
          for (const e of g.enemies) {
            if (e.hp <= 0 || e.spawnT > 0) continue;
            if (!tgt || e.hp > tgt.hp) tgt = e;
          }
          if (!tgt) {
            w.t = 0.3;
          } else {
            w.t = VERDICT.interval[li] / atk;
            const dmg = VERDICT.damage[li]
              + Math.min(VERDICT.hpFracCap, tgt.maxHP * VERDICT.hpFrac);
            g.lightning.push({ x1: tgt.x, y1: tgt.y - 320, x2: tgt.x, y2: tgt.y, life: 0.28, color: '#fff1a8' });
            g.particles.burst(tgt.x, tgt.y, '#fff1a8', 26, { speed: 300, size: 7, life: 0.6 });
            g.shockwaves.push({ x: tgt.x, y: tgt.y, r: 8, maxR: VERDICT.splashRadius * (1 + g.stats.area), life: 0.3, color: '#fff1a8' });
            g.audio.play('bolt');
            g.cam.shake(5);
            g.dealDamage(tgt, dmg, { source: 'bolt' });
            const sr = VERDICT.splashRadius * (1 + g.stats.area);
            g.hash.query(tgt.x, tgt.y, sr + 30, Q);
            for (const e of Q) {
              if (e === tgt) continue;
              if ((e.x - tgt.x) ** 2 + (e.y - tgt.y) ** 2 > (sr + e.radius) ** 2) continue;
              g.dealDamage(e, VERDICT.damage[li] * VERDICT.splashFrac, { source: 'bolt' });
            }
          }
        }
        break;
      }
      case 'ouroboros': {
        w.angle += OUROBOROS.orbitSpeed * atk * dt;
        const orbitR = OUROBOROS.orbitRadius[li] * (1 + g.stats.area);
        const hx = p.x + Math.cos(w.angle) * orbitR;
        const hy = p.y + Math.sin(w.angle) * orbitR;
        // Serpent body shimmer
        w.trailT -= dt;
        if (w.trailT <= 0) {
          w.trailT = 0.05;
          g.particles.burst(hx, hy, '#00e5a0', 1, { speed: 30, size: 5, life: 0.5 });
        }
        g.hash.query(hx, hy, OUROBOROS.headRadius + 30, Q);
        for (const e of Q) {
          if ((e.x - hx) ** 2 + (e.y - hy) ** 2 > (OUROBOROS.headRadius + e.radius) ** 2) continue;
          if ((e.hitCd['ou'] ?? 0) > g.runT) continue;
          e.hitCd['ou'] = g.runT + OUROBOROS.hitCooldown;
          e.chillT = Math.max(e.chillT, OUROBOROS.chill);
          const d = Math.max(10, Math.hypot(e.x - p.x, e.y - p.y));
          g.dealDamage(e, OUROBOROS.damage[li], {
            source: 'auto',
            kx: ((e.x - p.x) / d) * 220, ky: ((e.y - p.y) / d) * 220,
          });
        }
        break;
      }
    }
  }
}

/** Tartarus Snares: arm, then detonate on the first foe that steps close. */
function updateTraps(g: Game, dt: number): void {
  for (const trap of [...g.traps]) {
    trap.phase += dt;
    if (trap.armT > 0) {
      trap.armT -= dt;
      continue;
    }
    g.hash.query(trap.x, trap.y, 60, Q);
    let triggered = false;
    for (const e of Q) {
      if (e.hp <= 0 || e.spawnT > 0) continue;
      if ((e.x - trap.x) ** 2 + (e.y - trap.y) ** 2 <= (52 + e.radius) ** 2) {
        triggered = true;
        break;
      }
    }
    if (!triggered) continue;
    g.shockwaves.push({ x: trap.x, y: trap.y, r: 10, maxR: trap.radius, life: 0.3, color: '#9b5de5' });
    g.particles.burst(trap.x, trap.y, '#9b5de5', 14, { speed: 240, size: 5, life: 0.45 });
    g.audio.play('nova');
    g.hash.query(trap.x, trap.y, trap.radius + 30, Q);
    for (const e of Q) {
      if (e.hp <= 0 || e.spawnT > 0) continue;
      if ((e.x - trap.x) ** 2 + (e.y - trap.y) ** 2 > (trap.radius + e.radius) ** 2) continue;
      g.dealDamage(e, trap.damage, { source: 'auto' });
      if (e.hp > 0) e.chillT = Math.max(e.chillT, TRAPDEF.chill);
    }
    g.traps.splice(g.traps.indexOf(trap), 1);
  }
}

function updateDelayedHits(g: Game, dt: number): void {
  for (let i = g.delayedHits.length - 1; i >= 0; i--) {
    const h = g.delayedHits[i];
    h.t -= dt;
    if (h.t > 0) continue;
    g.delayedHits.splice(i, 1);
    // Impact
    g.shockwaves.push({ x: h.x, y: h.y, r: 12, maxR: h.radius, life: 0.35, color: '#ff9f45' });
    g.particles.burst(h.x, h.y, '#ff9f45', 18, { speed: 260, size: 6, life: 0.5 });
    g.lightning.push({ x1: h.x + 60, y1: h.y - 380, x2: h.x, y2: h.y, life: 0.12, color: '#ffce8a' });
    g.audio.play('nova');
    g.cam.shake(3);
    g.hash.query(h.x, h.y, h.radius + 30, Q);
    for (const e of Q) {
      if ((e.x - h.x) ** 2 + (e.y - h.y) ** 2 > (h.radius + e.radius) ** 2) continue;
      g.dealDamage(e, h.damage, { source: 'auto' });
    }
  }
}

function nearestEnemies(g: Game, x: number, y: number, range: number, n: number): Enemy[] {
  return g.enemies
    .filter((e) => e.hp > 0 && e.spawnT <= 0)
    .map((e) => ({ e, d2: (e.x - x) ** 2 + (e.y - y) ** 2 }))
    .filter((t) => t.d2 < range * range)
    .sort((a, b) => a.d2 - b.d2)
    .slice(0, n)
    .map((t) => t.e);
}

function makeProj(
  kind: Projectile['kind'], x: number, y: number, vx: number, vy: number,
  radius: number, damage: number, friendly: boolean, pierce: number, targetId: number,
): Projectile {
  return {
    kind, x, y, vx, vy, radius, damage, friendly, pierce, targetId,
    life: 0, spin: rand(TAU), phase: 0, aoe: 0, hitIds: new Set(),
  };
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

function updateSpawns(g: Game, dt: number): void {
  if (g.phase !== 'combat' || isBossChamber(g.chamber)) return;
  // Finite population: once the chamber's budget is spent, no more spawns —
  // the survivors are all that stand between you and the doors.
  if (g.spawnBudgetUsed >= g.quota) return;
  g.spawnAccum += dt;
  if (g.spawnAccum < 0.4) return;
  g.spawnAccum = 0;
  const alive = g.enemies.length;
  const target = aliveTarget(g.chamber, g.chamberT);
  const deficit = Math.floor(target - alive);
  const batch = Math.min(deficit, 6, g.quota - g.spawnBudgetUsed);
  for (let i = 0; i < batch; i++) {
    g.spawnEnemyAt(g.perimeterPoint());
    g.spawnBudgetUsed++;
  }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function updateEnemies(g: Game, dt: number): void {
  const p = g.player;
  const list = g.enemies;
  for (const e of list) {
    if (e.hp <= 0) continue;
    e.wobble += dt * 3;
    e.flash = Math.max(0, e.flash - dt);
    if (e.spawnT > 0) {
      e.spawnT -= dt;
      continue;
    }
    // Statuses
    if (e.joltT > 0) e.joltT -= dt;
    if (e.chillT > 0) e.chillT -= dt;
    if (e.woundT > 0) {
      e.woundT -= dt;
      e.burnTick -= dt;
      if (e.burnTick <= 0) {
        e.burnTick = 0.5;
        g.dealDamage(e, e.woundDPS * 0.5, { source: 'burn', canCrit: false });
        if (e.hp <= 0) continue;
      }
    }
    // Burning elites scorch the ground behind them
    if (e.modifier === 'burning') {
      e.emitT -= dt;
      if (e.emitT <= 0) {
        e.emitT = 0.4;
        if (g.patches.length > 150) g.patches.shift();
        g.patches.push({
          x: e.x, y: e.y, radius: 26, life: 2,
          dps: e.touchDamage * 0.8, hostile: true, seed: rand(TAU),
        });
      }
    }

    if (e.bossState) {
      updateBoss(g, e, dt);
      continue;
    }

    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;
    let sx = 0, sy = 0;

    switch (e.kind) {
      case 'shade':
        sx = nx; sy = ny;
        break;
      case 'skitter': {
        const j = Math.sin(e.wobble * 2.2) * 0.55;
        sx = nx - ny * j;
        sy = ny + nx * j;
        break;
      }
      case 'spitter': {
        if (dist > 340) { sx = nx; sy = ny; }
        else if (dist < 230) { sx = -nx; sy = -ny; }
        else { sx = -ny * 0.4; sy = nx * 0.4; }
        e.atkT -= dt;
        // Hold just above the warning window while out of range so the
        // pre-fire flash is always an honest signal.
        if (e.atkT <= 0.36 && dist >= 560) e.atkT = 0.36;
        if (e.atkT <= 0 && dist < 560) {
          e.atkT = rand(2.0, 2.6);
          const a = Math.atan2(dy, dx);
          g.projectiles.push(makeProj('spit', e.x, e.y,
            Math.cos(a) * 250, Math.sin(a) * 250, 9, e.touchDamage, false, 0, 0));
        }
        break;
      }
      case 'weaver': {
        // Orbits at range and fires a 3-shot fan
        if (dist > 360) { sx = nx; sy = ny; }
        else if (dist < 240) { sx = -nx * 0.7; sy = -ny * 0.7; }
        else { sx = -ny * 0.7; sy = nx * 0.7; }
        e.atkT -= dt;
        if (e.atkT <= 0.36 && dist >= 600) e.atkT = 0.36;
        if (e.atkT <= 0 && dist < 600) {
          e.atkT = rand(2.6, 3.2);
          const a = Math.atan2(dy, dx);
          for (const off of [-0.32, 0, 0.32]) {
            g.projectiles.push(makeProj('spit', e.x, e.y,
              Math.cos(a + off) * 235, Math.sin(a + off) * 235, 9, e.touchDamage, false, 0, 0));
          }
        }
        break;
      }
      case 'brute': {
        // Telegraphed lunge when close
        if (e.lungeT > 0) {
          e.lungeT -= dt;
          e.x += e.lungeDirX * 500 * dt;
          e.y += e.lungeDirY * 500 * dt;
        } else if (e.windup >= 0) {
          e.windup -= dt;
          if (e.windup <= 0) {
            e.windup = -1;
            e.lungeT = 0.38;
            e.lungeDirX = nx;
            e.lungeDirY = ny;
            g.audio.play('dash');
          }
        } else {
          sx = nx; sy = ny;
          e.atkT -= dt;
          if (e.atkT <= 0 && dist < 230) {
            e.atkT = rand(2.6, 3.4);
            e.windup = 0.55;
            g.telegraphs.push({
              kind: 'line', x: e.x, y: e.y,
              x2: e.x + nx * 280, y2: e.y + ny * 280, radius: e.radius + 8, t: 0.55, maxT: 0.55,
            });
          }
        }
        break;
      }
      case 'cinder': {
        if (e.fuse < 0 && dist < 95) {
          e.fuse = 0.75;
        }
        if (e.fuse >= 0) {
          e.fuse -= dt;
          if (e.fuse <= 0) {
            // Detonate
            g.particles.burst(e.x, e.y, '#ff9f45', 24, { speed: 300, size: 7, life: 0.5 });
            g.shockwaves.push({ x: e.x, y: e.y, r: 10, maxR: 95, life: 0.3, color: '#ff9f45' });
            g.cam.shake(4);
            g.audio.play('nova');
            if (Math.hypot(p.x - e.x, p.y - e.y) < 95 + PLAYER_RADIUS) {
              g.hurtPlayer(e.touchDamage * 2.4, e.x, e.y);
            }
            e.hp = 0;
            g.killEnemy(e);
            continue;
          }
        } else {
          sx = nx; sy = ny;
        }
        break;
      }
      case 'reaver': {
        // Relentless: fast chase punctuated by frequent quick lunges.
        if (e.lungeT > 0) {
          e.lungeT -= dt;
          e.x += e.lungeDirX * 680 * dt;
          e.y += e.lungeDirY * 680 * dt;
        } else if (e.windup >= 0) {
          e.windup -= dt;
          if (e.windup <= 0) {
            e.windup = -1;
            e.lungeT = 0.3;
            e.lungeDirX = nx;
            e.lungeDirY = ny;
            g.audio.play('dash');
          }
        } else {
          sx = nx; sy = ny; // fast base chase (see its high speed def)
          e.atkT -= dt;
          if (e.atkT <= 0 && dist < 340) {
            e.atkT = rand(1.3, 1.9);
            e.windup = 0.28; // a brief tell before it pounces
            g.telegraphs.push({
              kind: 'line', x: e.x, y: e.y,
              x2: e.x + nx * 240, y2: e.y + ny * 240, radius: e.radius + 6, t: 0.28, maxT: 0.28,
            });
          }
        }
        break;
      }
      case 'stalker': {
        // Cuts you off — aims where you're heading, not where you stand.
        const leadX = p.x + p.moveX * 130;
        const leadY = p.y + p.moveY * 130;
        const ldx = leadX - e.x, ldy = leadY - e.y;
        const ld = Math.hypot(ldx, ldy) || 1;
        sx = ldx / ld; sy = ldy / ld;
        break;
      }
      case 'hexer': {
        // Warlock at the rim: keeps far out and lobs slow SEEKING hexes —
        // ignore them and they curve home; kite or kill the caster.
        if (dist > 480) { sx = nx; sy = ny; }
        else if (dist < 360) { sx = -nx * 0.8; sy = -ny * 0.8; }
        else { sx = -ny * 0.5; sy = nx * 0.5; }
        e.atkT -= dt;
        if (e.atkT <= 0.36 && dist >= 640) e.atkT = 0.36;
        if (e.atkT <= 0 && dist < 640) {
          e.atkT = rand(3.2, 4.0);
          const a = Math.atan2(dy, dx);
          g.projectiles.push(makeProj('hex', e.x, e.y,
            Math.cos(a) * 150, Math.sin(a) * 150, 11, e.touchDamage, false, 0, 0));
          g.audio.play('hexCast');
        }
        break;
      }
      case 'juggernaut': {
        // Walking siege engine: shrugs off knockback (see dealDamage) and
        // slams the ground when close — a telegraphed ring you must leave.
        if (e.windup >= 0) {
          e.windup -= dt;
          if (e.windup <= 0) {
            e.windup = -1;
            const R = 130;
            g.particles.burst(e.x, e.y, '#d4a24e', 26, { speed: 320, size: 7, life: 0.5 });
            g.shockwaves.push({ x: e.x, y: e.y, r: 12, maxR: R, life: 0.32, color: '#d4a24e' });
            g.cam.shake(6);
            g.audio.play('slam');
            if (Math.hypot(p.x - e.x, p.y - e.y) < R + PLAYER_RADIUS) {
              g.hurtPlayer(e.touchDamage * 1.5, e.x, e.y);
            }
          }
        } else {
          sx = nx; sy = ny;
          e.atkT -= dt;
          if (e.atkT <= 0 && dist < 150) {
            e.atkT = rand(2.8, 3.6);
            e.windup = 0.6;
            g.telegraphs.push({
              kind: 'circle', x: e.x, y: e.y, x2: e.x, y2: e.y,
              radius: 130, t: 0.6, maxT: 0.6,
            });
          }
        }
        break;
      }
      case 'blinker': {
        // Ambusher: flashes bright, then blinks to your flank and rushes in.
        if (e.windup >= 0) {
          e.windup -= dt;
          if (e.windup <= 0) {
            e.windup = -1;
            g.particles.burst(e.x, e.y, '#55f2d6', 14, { speed: 240, size: 5, life: 0.4 });
            const a = rand(TAU);
            const r = rand(150, 220);
            e.x = clamp(p.x + Math.cos(a) * r, -g.arenaHalfW + 20, g.arenaHalfW - 20);
            e.y = clamp(p.y + Math.sin(a) * r, -g.arenaHalfH + 20, g.arenaHalfH - 20);
            g.particles.burst(e.x, e.y, '#55f2d6', 14, { speed: 240, size: 5, life: 0.4 });
            g.audio.play('blink');
          }
        } else {
          sx = nx; sy = ny;
          e.atkT -= dt;
          if (e.atkT <= 0 && dist > 240) {
            e.atkT = rand(2.4, 3.2);
            e.windup = 0.35; // the bright tell before it vanishes
          }
        }
        break;
      }
      default:
        sx = nx; sy = ny;
    }

    // Light separation from packed neighbors
    g.hash.query(e.x, e.y, e.radius + 14, Q);
    let sepX = 0, sepY = 0, sepN = 0;
    for (const o of Q) {
      if (o === e || o.hp <= 0 || sepN >= 3) continue;
      const ox = e.x - o.x;
      const oy = e.y - o.y;
      const od = Math.hypot(ox, oy);
      const min = e.radius + o.radius;
      if (od < min && od > 0.001) {
        sepX += (ox / od) * (min - od);
        sepY += (oy / od) * (min - od);
        sepN++;
      }
    }

    // Chilled foes wade through the undertow
    const spd = e.chillT > 0 ? e.speed * 0.72 : e.speed;
    e.x += (sx * spd + e.vx) * dt + sepX * 4 * dt;
    e.y += (sy * spd + e.vy) * dt + sepY * 4 * dt;
    const drag = Math.max(0, 1 - 5 * dt);
    e.vx *= drag;
    e.vy *= drag;

    const preX = e.x;
    const preY = e.y;
    e.x = clamp(e.x, -g.arenaHalfW + e.radius, g.arenaHalfW - e.radius);
    e.y = clamp(e.y, -g.arenaHalfH + e.radius, g.arenaHalfH - e.radius);
    // Crushing Depths: knocked hard into a wall = slammed
    if (g.mods.slamDamage > 0 && (preX !== e.x || preY !== e.y)
      && Math.hypot(e.vx, e.vy) > 260 && (e.hitCd['slam'] ?? 0) <= g.runT) {
      e.hitCd['slam'] = g.runT + 0.8;
      g.particles.burst(e.x, e.y, '#4a90ff', 8, { speed: 180, size: 4, life: 0.35 });
      g.dealDamage(e, g.mods.slamDamage, { source: 'nova' });
      if (e.hp <= 0) continue;
    }
    pushOutOfPillars(g, e, e.radius * 0.8);

    // Contact damage (brutes hit harder mid-lunge)
    if (e.fuse < 0 && dist < e.radius + PLAYER_RADIUS + 2) {
      g.hurtPlayer(e.touchDamage * (e.lungeT > 0 ? 1.4 : 1), e.x, e.y);
    }
  }
}

// ---------------------------------------------------------------------------
// Bosses
// ---------------------------------------------------------------------------

export function spawnBoss(g: Game, variant: BossVariant, xOffset = 0): void {
  const def = BOSSES[variant];
  const hp = g.bossPowerHP(variant);
  const e: Enemy = {
    id: g.nextId(),
    kind: 'boss',
    x: xOffset, y: -g.arenaHalfH + 240, vx: 0, vy: 0,
    radius: def.radius,
    hp, maxHP: hp,
    touchDamage: def.touchDamage,
    speed: def.speed,
    xp: def.xp, gold: def.gold,
    elite: false,
    modifier: null,
    spawnT: 0,
    flash: 0,
    wobble: 0,
    joltT: 0, woundT: 0, woundDPS: 0, chillT: 0, burnTick: 0,
    hitCd: {},
    atkT: 0,
    fuse: -1,
    windup: -1,
    lungeT: 0,
    lungeDirX: 0,
    lungeDirY: 0,
    emitT: 0,
    bossState: {
      variant, phase: 1, move: 'idle', moveT: 2.2, cycle: 0,
      chargeDirX: 0, chargeDirY: 1, spiralA: 0, volleyN: 0, roared: false,
    },
  };
  g.enemies.push(e);
}

function updateBoss(g: Game, e: Enemy, dt: number): void {
  const b = e.bossState!;
  if (g.phase === 'bossIntro') return;

  // Enrage at half health
  if (b.phase === 1 && e.hp <= e.maxHP * 0.5) {
    b.phase = 2;
    b.roared = true;
    e.touchDamage *= 1.25;
    e.speed *= 1.25;
    g.audio.play('bossRoar');
    g.cam.shake(12);
    g.bannerT = 1.6;
    g.bannerText = `${BOSSES[b.variant].name} — ENRAGED`;
    g.particles.burst(e.x, e.y, '#ff5a5a', 30, { speed: 300, size: 8, life: 0.7 });
  }

  // The Archon wields the Gatekeeper's aggressive kit — bursts, charges, adds.
  if (b.variant === 'shepherd') updateShepherd(g, e, dt);
  else updateGatekeeper(g, e, dt);

  e.x = clamp(e.x, -g.arenaHalfW + e.radius, g.arenaHalfW - e.radius);
  e.y = clamp(e.y, -g.arenaHalfH + e.radius, g.arenaHalfH - e.radius);

  // Body contact while not charging
  const p = g.player;
  const dist = Math.hypot(p.x - e.x, p.y - e.y);
  if (b.move !== 'charging' && dist < e.radius + PLAYER_RADIUS + 2) {
    g.hurtPlayer(e.touchDamage * 0.7, e.x, e.y);
  }
}

function updateGatekeeper(g: Game, e: Enemy, dt: number): void {
  const b = e.bossState!;
  const p = g.player;
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = dx / dist, ny = dy / dist;
  b.moveT -= dt;

  switch (b.move) {
    case 'idle': {
      e.x += nx * e.speed * dt;
      e.y += ny * e.speed * dt;
      if (b.moveT <= 0) {
        const cycle1 = ['burst', 'chargePrep', 'summon'] as const;
        const cycle2 = ['burst', 'spiral', 'chargePrep', 'burst', 'summon'] as const;
        const cyc = b.phase === 1 ? cycle1 : cycle2;
        b.move = cyc[b.cycle % cyc.length];
        b.cycle++;
        if (b.move === 'burst') b.moveT = 0.4;
        if (b.move === 'chargePrep') {
          b.moveT = 0.7;
          b.chargeDirX = nx;
          b.chargeDirY = ny;
          g.telegraphs.push({
            kind: 'line', x: e.x, y: e.y,
            x2: e.x + nx * 760, y2: e.y + ny * 760, radius: 60, t: 0.7, maxT: 0.7,
          });
        }
        if (b.move === 'summon') b.moveT = 0.7;
        if (b.move === 'spiral') b.moveT = 2.4;
      }
      break;
    }
    case 'burst': {
      if (b.moveT <= 0) {
        const n = b.phase === 1 ? 14 : 20;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + rand(-0.05, 0.05);
          g.projectiles.push(makeProj('bossOrb', e.x, e.y,
            Math.cos(a) * 195, Math.sin(a) * 195, 11, e.touchDamage * 0.6, false, 0, 0));
        }
        g.audio.play('nova');
        g.cam.shake(4);
        endBossMove(b);
      }
      break;
    }
    case 'chargePrep': {
      if (b.moveT <= 0) {
        b.move = 'charging';
        b.moveT = 0.55;
        g.audio.play('bossRoar');
      }
      break;
    }
    case 'charging': {
      e.x += b.chargeDirX * 580 * dt;
      e.y += b.chargeDirY * 580 * dt;
      if (dist < e.radius + PLAYER_RADIUS + 6) g.hurtPlayer(e.touchDamage, e.x, e.y);
      const hitWall =
        e.x <= -g.arenaHalfW + e.radius || e.x >= g.arenaHalfW - e.radius ||
        e.y <= -g.arenaHalfH + e.radius || e.y >= g.arenaHalfH - e.radius;
      if (b.moveT <= 0 || hitWall) {
        if (hitWall) g.cam.shake(8);
        endBossMove(b, 1.0);
      }
      break;
    }
    case 'summon': {
      if (b.moveT <= 0) {
        const n = b.phase === 1 ? 5 : 7;
        summonAround(g, e, n);
        g.audio.play('bossRoar');
        endBossMove(b);
      }
      break;
    }
    case 'spiral': {
      b.spiralA += dt * 7;
      e.x += nx * e.speed * 0.4 * dt;
      e.y += ny * e.speed * 0.4 * dt;
      e.atkT -= dt;
      if (e.atkT <= 0) {
        e.atkT = 0.085;
        for (const off of [0, Math.PI]) {
          const a = b.spiralA + off;
          g.projectiles.push(makeProj('bossOrb', e.x, e.y,
            Math.cos(a) * 215, Math.sin(a) * 215, 10, e.touchDamage * 0.5, false, 0, 0));
        }
      }
      if (b.moveT <= 0) endBossMove(b);
      break;
    }
    default:
      endBossMove(b);
  }
}

function updateShepherd(g: Game, e: Enemy, dt: number): void {
  const b = e.bossState!;
  const p = g.player;
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = dx / dist, ny = dy / dist;
  b.moveT -= dt;

  switch (b.move) {
    case 'idle': {
      // Keeps its distance — drifts to a comfortable ring around you
      if (dist < 300) { e.x -= nx * e.speed * dt; e.y -= ny * e.speed * dt; }
      else if (dist > 460) { e.x += nx * e.speed * 0.7 * dt; e.y += ny * e.speed * 0.7 * dt; }
      else { e.x += -ny * e.speed * 0.5 * dt; e.y += nx * e.speed * 0.5 * dt; }
      if (b.moveT <= 0) {
        const cycle1 = ['summon', 'volley', 'teleport', 'volley'] as const;
        const cycle2 = ['summon', 'ring', 'volley', 'teleport', 'volley'] as const;
        const cyc = b.phase === 1 ? cycle1 : cycle2;
        b.move = cyc[b.cycle % cyc.length];
        b.cycle++;
        if (b.move === 'summon') b.moveT = 0.6;
        if (b.move === 'volley') { b.moveT = 1.5; b.volleyN = 0; e.atkT = 0.2; }
        if (b.move === 'teleport') b.moveT = 0.45;
        if (b.move === 'ring') b.moveT = 0.8;
      }
      break;
    }
    case 'summon': {
      if (b.moveT <= 0) {
        const n = b.phase === 1 ? 6 : 8;
        summonAround(g, e, n);
        g.audio.play('bossRoar');
        endShepherdMove(b);
      }
      break;
    }
    case 'volley': {
      e.atkT -= dt;
      const bursts = b.phase === 1 ? 3 : 4;
      if (e.atkT <= 0 && b.volleyN < bursts) {
        e.atkT = 0.38;
        b.volleyN++;
        for (const off of [-0.25, 0, 0.25]) {
          const a = Math.atan2(dy, dx) + off;
          g.projectiles.push(makeProj('soul', e.x, e.y,
            Math.cos(a) * 170, Math.sin(a) * 170, 10, e.touchDamage * 0.55, false, 0, 0));
        }
        g.audio.play('nova');
      }
      if (b.moveT <= 0 && b.volleyN >= bursts) endShepherdMove(b);
      break;
    }
    case 'teleport': {
      if (b.moveT <= 0) {
        g.particles.burst(e.x, e.y, '#8b5cf6', 22, { speed: 240, size: 7, life: 0.5 });
        // Blink to a far point, biased away from the player
        for (let i = 0; i < 12; i++) {
          const x = rand(-g.arenaHalfW + 120, g.arenaHalfW - 120);
          const y = rand(-g.arenaHalfH + 120, g.arenaHalfH - 120);
          if ((x - p.x) ** 2 + (y - p.y) ** 2 > 420 * 420 || i === 11) {
            e.x = x;
            e.y = y;
            break;
          }
        }
        g.particles.burst(e.x, e.y, '#8b5cf6', 22, { speed: 240, size: 7, life: 0.5 });
        g.audio.play('dash');
        endShepherdMove(b, 0.5);
      }
      break;
    }
    case 'ring': {
      if (b.moveT <= 0) {
        // A closing ring of souls around YOU — dash through the gap
        const n = 12;
        const skip = Math.floor(rand(n));
        for (let i = 0; i < n; i++) {
          if (i === skip || i === (skip + 1) % n) continue; // escape gap
          const a = (i / n) * TAU;
          const sx = p.x + Math.cos(a) * 300;
          const sy = p.y + Math.sin(a) * 300;
          g.projectiles.push(makeProj('bossOrb', sx, sy,
            -Math.cos(a) * 110, -Math.sin(a) * 110, 10, e.touchDamage * 0.5, false, 0, 0));
        }
        g.audio.play('bossRoar');
        g.cam.shake(5);
        endShepherdMove(b);
      }
      break;
    }
    default:
      endShepherdMove(b);
  }
}

function summonAround(g: Game, e: Enemy, n: number): void {
  for (let i = 0; i < n; i++) {
    const a = rand(TAU);
    const r = rand(150, 320);
    const x = clamp(e.x + Math.cos(a) * r, -g.arenaHalfW + 40, g.arenaHalfW - 40);
    const y = clamp(e.y + Math.sin(a) * r, -g.arenaHalfH + 40, g.arenaHalfH - 40);
    g.spawnEnemyAt({ x, y });
  }
}

function endBossMove(b: NonNullable<Enemy['bossState']>, idle = 0): void {
  b.move = 'idle';
  b.moveT = (idle || (b.phase === 1 ? rand(1.1, 1.7) : rand(0.6, 1.1)));
}

function endShepherdMove(b: NonNullable<Enemy['bossState']>, idle = 0): void {
  b.move = 'idle';
  b.moveT = (idle || (b.phase === 1 ? rand(0.9, 1.4) : rand(0.5, 0.9)));
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

function updateProjectiles(g: Game, dt: number): void {
  const p = g.player;
  const list = g.projectiles;
  for (let i = list.length - 1; i >= 0; i--) {
    const pr = list[i];
    pr.life += dt;
    pr.spin += dt * 12;
    let dead = false;

    if (pr.kind === 'dart') {
      // home in on target
      const tgt = g.enemies.find((e) => e.id === pr.targetId && e.hp > 0);
      if (tgt) {
        const want = Math.atan2(tgt.y - pr.y, tgt.x - pr.x);
        const cur = Math.atan2(pr.vy, pr.vx);
        const na = cur + clamp(angleDiff(cur, want), -7 * dt, 7 * dt);
        const sp = Math.hypot(pr.vx, pr.vy);
        pr.vx = Math.cos(na) * sp;
        pr.vy = Math.sin(na) * sp;
      }
      if (pr.life > 2.2) dead = true;
    } else if (pr.kind === 'chakram') {
      if (pr.phase === 0 && pr.life * CHAKRAM.speed >= CHAKRAM.range) {
        pr.phase = 1;
        pr.hitIds.clear();
      }
      if (pr.phase === 1) {
        const a = Math.atan2(p.y - pr.y, p.x - pr.x);
        const sp = CHAKRAM.speed * 1.2;
        pr.vx = Math.cos(a) * sp;
        pr.vy = Math.sin(a) * sp;
        if (Math.hypot(p.x - pr.x, p.y - pr.y) < 28) dead = true;
      }
    } else if (pr.kind === 'soul') {
      // Shepherd's souls chase the player
      const want = Math.atan2(p.y - pr.y, p.x - pr.x);
      const cur = Math.atan2(pr.vy, pr.vx);
      const na = cur + clamp(angleDiff(cur, want), -2.4 * dt, 2.4 * dt);
      const sp = Math.hypot(pr.vx, pr.vy);
      pr.vx = Math.cos(na) * sp;
      pr.vy = Math.sin(na) * sp;
      if (pr.life > 4.5) dead = true;
    } else if (pr.kind === 'hex') {
      // Hexer's slow seeker: lazy turn rate — outrun it or break its line
      const want = Math.atan2(p.y - pr.y, p.x - pr.x);
      const cur = Math.atan2(pr.vy, pr.vx);
      const na = cur + clamp(angleDiff(cur, want), -1.5 * dt, 1.5 * dt);
      const sp = Math.hypot(pr.vx, pr.vy);
      pr.vx = Math.cos(na) * sp;
      pr.vy = Math.sin(na) * sp;
      if (pr.life > 5) dead = true;
    } else if (pr.kind === 'mirror') {
      if (pr.life > 1.6) dead = true;
    } else if (pr.kind === 'arrow') {
      if (pr.life > ARROW.life * (1 + g.stats.range)) dead = true;
    } else if (pr.kind === 'spear') {
      if (pr.life > SPEAR.life) dead = true;
    } else if (pr.kind === 'orb') {
      if (pr.life > ORB.life) {
        explodeOrb(g, pr); // fizzles into its blast at max range
        dead = true;
      }
    } else {
      // enemy shots expire vs. walls and time
      if (pr.life > 6) dead = true;
    }

    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;

    if (Math.abs(pr.x) > g.arenaHalfW || Math.abs(pr.y) > g.arenaHalfH) dead = true;

    if (!dead && pr.friendly) {
      // Basic-attack projectiles hit in the strike bracket and proc on-hit boons
      const isBasic = pr.kind === 'arrow' || pr.kind === 'orb';
      g.hash.query(pr.x, pr.y, pr.radius + 26, Q);
      for (const e of Q) {
        if (e.hp <= 0 || e.spawnT > 0) continue;
        if (pr.hitIds.has(e.id)) continue;
        if ((e.x - pr.x) ** 2 + (e.y - pr.y) ** 2 > (pr.radius + e.radius) ** 2) continue;
        pr.hitIds.add(e.id);
        const sp = Math.hypot(pr.vx, pr.vy) || 1;
        g.dealDamage(e, pr.damage, {
          source: isBasic ? 'strike' : 'auto',
          kx: (pr.vx / sp) * 120, ky: (pr.vy / sp) * 120,
        });
        if (isBasic) strikeProcs(g, e, pr.damage, true);
        if (pr.kind === 'orb') {
          explodeOrb(g, pr);
          dead = true;
          break;
        }
        if (pr.pierce === 0) { dead = true; break; }
        if (pr.pierce > 0) pr.pierce--;
      }
    } else if (!dead && !pr.friendly) {
      if (Math.hypot(p.x - pr.x, p.y - pr.y) < pr.radius + PLAYER_RADIUS) {
        g.hurtPlayer(pr.damage, pr.x - pr.vx * 0.1, pr.y - pr.vy * 0.1);
        dead = true;
      }
    }

    if (dead) list.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// Cinder patches (friendly trail + hostile scorch from burning elites)
// ---------------------------------------------------------------------------

function updatePatches(g: Game, dt: number): void {
  const p = g.player;
  const list = g.patches;
  for (let i = list.length - 1; i >= 0; i--) {
    const pa = list[i];
    pa.life -= dt;
    if (pa.life <= 0) {
      list.splice(i, 1);
      continue;
    }
    // tick every 0.35s of remaining life
    const prev = Math.floor((pa.life + dt) / 0.35);
    const cur = Math.floor(pa.life / 0.35);
    if (prev !== cur) {
      if (pa.hostile) {
        if ((p.x - pa.x) ** 2 + (p.y - pa.y) ** 2 <= (pa.radius + PLAYER_RADIUS) ** 2) {
          g.hurtPlayer(pa.dps * 0.35, pa.x, pa.y);
        }
      } else {
        g.hash.query(pa.x, pa.y, pa.radius + 26, Q);
        for (const e of Q) {
          if (e.hp <= 0 || e.spawnT > 0) continue;
          if ((e.x - pa.x) ** 2 + (e.y - pa.y) ** 2 > (pa.radius + e.radius) ** 2) continue;
          g.dealDamage(e, pa.dps * 0.35, { source: 'auto', canCrit: false, silentNumber: true });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pickups & doors
// ---------------------------------------------------------------------------

function updatePickups(g: Game, dt: number): void {
  const p = g.player;
  const list = g.pickups;
  const magR2 = g.stats.pickupRadius * g.stats.pickupRadius;
  for (let i = list.length - 1; i >= 0; i--) {
    const pk = list[i];
    pk.bob += dt * 4;
    const dx = p.x - pk.x;
    const dy = p.y - pk.y;
    const d2 = dx * dx + dy * dy;
    if (!pk.magnet && d2 < magR2) pk.magnet = true;
    if (pk.magnet) {
      const d = Math.sqrt(d2) || 1;
      const sp = clamp(d * 6, 240, 980);
      pk.x += (dx / d) * sp * dt;
      pk.y += (dy / d) * sp * dt;
    } else {
      pk.x += pk.vx * dt;
      pk.y += pk.vy * dt;
      pk.vx *= 1 - 3 * dt;
      pk.vy *= 1 - 3 * dt;
    }
    if (d2 < 26 * 26) {
      switch (pk.kind) {
        case 'xp': case 'xp3': case 'xp8':
          g.gainXP(pk.value);
          g.audio.play('pickup');
          break;
        case 'gold':
          g.addGold(Math.max(1, Math.round(pk.value * g.goldGainMult())));
          g.audio.play('gold');
          break;
        case 'heart':
          g.player.hp = Math.min(g.stats.maxHP, g.player.hp + pk.value);
          g.ui.showToast(`+${pk.value} HP`, '#3ddc97');
          break;
        case 'ichor':
          g.addIchor(pk.value);
          g.ui.showToast(`+${pk.value} Ichor`, '#e05780');
          break;
      }
      list.splice(i, 1);
    }
  }
}

function updateDoors(g: Game): void {
  if (g.phase !== 'cleared') return;
  const p = g.player;
  for (const d of g.doors) {
    if (Math.hypot(p.x - d.x, p.y - d.y) < 52) {
      g.enterDoor(d);
      return;
    }
  }
}
