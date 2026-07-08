/**
 * Pre-rendered glow sprites. Canvas shadowBlur is far too slow per-frame,
 * so we bake radial-gradient "glow pucks" once and blit them with
 * globalCompositeOperation='lighter' for the neon look.
 */
const cache = new Map<string, HTMLCanvasElement>();

export function glowSprite(color: string, radius: number, coreAlpha = 1): HTMLCanvasElement {
  const key = `${color}|${radius}|${coreAlpha}`;
  let c = cache.get(key);
  if (c) return c;
  const size = Math.ceil(radius * 2);
  c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  g.addColorStop(0, withAlpha(color, coreAlpha));
  g.addColorStop(0.35, withAlpha(color, coreAlpha * 0.45));
  g.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  cache.set(key, c);
  return c;
}

export function drawGlow(
  ctx: CanvasRenderingContext2D, color: string, x: number, y: number, radius: number, alpha = 1,
): void {
  const spr = glowSprite(color, Math.max(4, Math.round(radius)));
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha;
  ctx.drawImage(spr, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = prev;
}

/** hex (#rrggbb) or css color -> rgba string with alpha */
export function withAlpha(color: string, a: number): string {
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return color;
}

/** Trace a regular polygon path (does not fill/stroke). */
export function polygonPath(
  ctx: CanvasRenderingContext2D, x: number, y: number, sides: number, r: number, rot = 0,
): void {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Jagged lightning polyline between two points. */
export function lightningPath(
  ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, jag = 10,
): void {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const segs = Math.max(3, Math.floor(len / 26));
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const off = (Math.random() * 2 - 1) * jag;
    ctx.lineTo(x1 + dx * t + nx * off, y1 + dy * t + ny * off);
  }
  ctx.lineTo(x2, y2);
}
