/**
 * Simple spatial hash over objects with x/y/radius, rebuilt each step.
 * Used for enemy queries (projectile hits, separation, nearest-target).
 */
export interface Spatialish {
  x: number;
  y: number;
  radius: number;
}

const CELL = 84;

export class SpatialHash<T extends Spatialish> {
  private map = new Map<number, T[]>();

  private key(cx: number, cy: number): number {
    return (cx + 2048) * 4096 + (cy + 2048);
  }

  rebuild(items: readonly T[]): void {
    this.map.clear();
    for (const it of items) {
      const cx = Math.floor(it.x / CELL);
      const cy = Math.floor(it.y / CELL);
      const k = this.key(cx, cy);
      let arr = this.map.get(k);
      if (!arr) {
        arr = [];
        this.map.set(k, arr);
      }
      arr.push(it);
    }
  }

  /** Collect items whose cell overlaps the circle (coarse; caller does fine check). */
  query(x: number, y: number, r: number, out: T[]): T[] {
    out.length = 0;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const arr = this.map.get(this.key(cx, cy));
        if (arr) for (const it of arr) out.push(it);
      }
    }
    return out;
  }
}
