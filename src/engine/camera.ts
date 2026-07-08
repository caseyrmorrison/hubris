import { clamp, damp, rand } from './math';

export class Camera {
  x = 0;
  y = 0;
  viewW = 1280;
  viewH = 720;
  /** User setting: 1 full, 0.4 reduced, 0 off. */
  shakeScale = 1;
  private shakeAmt = 0;
  shakeX = 0;
  shakeY = 0;

  follow(tx: number, ty: number, dt: number): void {
    this.x = damp(this.x, tx, 8, dt);
    this.y = damp(this.y, ty, 8, dt);
  }

  /** Keep view inside arena bounds (world is centered on 0,0). */
  clampTo(halfW: number, halfH: number): void {
    const mx = Math.max(0, halfW + 90 - this.viewW / 2);
    const my = Math.max(0, halfH + 90 - this.viewH / 2);
    this.x = clamp(this.x, -mx, mx);
    this.y = clamp(this.y, -my, my);
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(this.shakeAmt + amount * this.shakeScale, 26);
  }

  update(dt: number): void {
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 42);
    const a = this.shakeAmt;
    this.shakeX = rand(-a, a);
    this.shakeY = rand(-a, a);
  }

  /** Top-left world coordinate of the view. */
  left(): number { return this.x - this.viewW / 2 + this.shakeX; }
  top(): number { return this.y - this.viewH / 2 + this.shakeY; }

  toScreenX(wx: number): number { return wx - this.left(); }
  toScreenY(wy: number): number { return wy - this.top(); }
  toWorldX(sx: number): number { return sx + this.left(); }
  toWorldY(sy: number): number { return sy + this.top(); }

  isVisible(wx: number, wy: number, pad = 80): boolean {
    return (
      wx > this.left() - pad && wx < this.left() + this.viewW + pad &&
      wy > this.top() - pad && wy < this.top() + this.viewH + pad
    );
  }
}
