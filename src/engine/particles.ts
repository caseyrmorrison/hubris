import type { Camera } from './camera';
import { drawGlow } from './sprites';
import { rand, TAU } from './math';

export interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number;
  color: string;
  drag: number;
  gravity: number;
  additive: boolean;
}

const MAX_PARTICLES = 700;

export class Particles {
  list: Particle[] = [];

  spawn(p: Particle): void {
    if (this.list.length >= MAX_PARTICLES) {
      // Recycle the oldest slot to keep bursts responsive under load.
      this.list[(Math.random() * this.list.length) | 0] = p;
      return;
    }
    this.list.push(p);
  }

  burst(x: number, y: number, color: string, count: number, opts: {
    speed?: number; size?: number; life?: number; drag?: number; gravity?: number; additive?: boolean;
  } = {}): void {
    const { speed = 160, size = 5, life = 0.5, drag = 3, gravity = 0, additive = true } = opts;
    for (let i = 0; i < count; i++) {
      const a = rand(TAU);
      const s = speed * rand(0.3, 1);
      this.spawn({
        x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: life * rand(0.6, 1.3), maxLife: life,
        size: size * rand(0.6, 1.4),
        color, drag, gravity, additive,
      });
    }
  }

  update(dt: number): void {
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i];
      p.life -= dt;
      if (p.life <= 0) {
        l[i] = l[l.length - 1];
        l.pop();
        continue;
      }
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera): void {
    ctx.save();
    for (const p of this.list) {
      if (!cam.isVisible(p.x, p.y, 30)) continue;
      const t = Math.min(1, p.life / p.maxLife);
      const sx = cam.toScreenX(p.x);
      const sy = cam.toScreenY(p.y);
      ctx.globalCompositeOperation = p.additive ? 'lighter' : 'source-over';
      drawGlow(ctx, p.color, sx, sy, p.size * (0.5 + t * 0.8) * 2, t);
    }
    ctx.restore();
  }
}
