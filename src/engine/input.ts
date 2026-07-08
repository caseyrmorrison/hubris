export class Input {
  keys = new Set<string>();
  justPressed = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  mouseJustPressed = false;

  // Touch state: left-half drag = move stick, right-half drag = aim stick
  // (fires while held), and a dash button (position set by the main loop).
  touchActive = false;
  touchMoveX = 0;
  touchMoveY = 0;
  touchStickOX = 0;   // move-stick origin (for rendering)
  touchStickOY = 0;
  touchAimHeld = false;
  viewW = 1280;
  dashBtnX = 0;
  dashBtnY = 0;
  dashBtnR = 46;
  private moveTouchId: number | null = null;
  private aimTouchId: number | null = null;
  private aimOriginX = 0;
  private aimOriginY = 0;

  // Gamepad state. Rising edges land in justPressed as synthetic codes:
  // PadA / PadB / PadX / PadDash / PadStart / PadUp / PadDown / PadLeft / PadRight
  padConnected = false;
  padMoveX = 0;
  padMoveY = 0;
  padAimX = 0;
  padAimY = 0;
  padAimActive = false;
  padFire = false;
  private padPrev: Record<number, boolean> = {};
  private dirHold: Record<string, { held: boolean; t: number }> = {};
  private lastPollT = 0;

  constructor(target: HTMLElement, touchTarget?: HTMLElement) {
    const tt = touchTarget ?? target;
    tt.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    tt.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    tt.addEventListener('touchend', (e) => this.onTouchEnd(e));
    tt.addEventListener('touchcancel', (e) => this.onTouchEnd(e));
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.justPressed.add(e.code);
      // Avoid page scroll from game keys
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    target.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.padAimActive = false; // mouse takes aim back
    });
    target.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouseDown = true;
        this.mouseJustPressed = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    this.touchActive = true;
    for (const t of Array.from(e.changedTouches)) {
      const x = t.clientX;
      const y = t.clientY;
      // Dash button first — it owns its circle
      const bd = Math.hypot(x - this.dashBtnX, y - this.dashBtnY);
      if (bd < this.dashBtnR + 16) {
        this.justPressed.add('PadDash');
        continue;
      }
      if (x < this.viewW * 0.5 && this.moveTouchId === null) {
        this.moveTouchId = t.identifier;
        this.touchStickOX = x;
        this.touchStickOY = y;
        this.touchMoveX = 0;
        this.touchMoveY = 0;
      } else if (this.aimTouchId === null) {
        this.aimTouchId = t.identifier;
        this.aimOriginX = x;
        this.aimOriginY = y;
        this.touchAimHeld = true;
      }
    }
  }

  private onTouchMove(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.moveTouchId) {
        const dx = t.clientX - this.touchStickOX;
        const dy = t.clientY - this.touchStickOY;
        const len = Math.hypot(dx, dy);
        const mag = Math.min(1, len / 56);
        if (len > 6) {
          this.touchMoveX = (dx / len) * mag;
          this.touchMoveY = (dy / len) * mag;
        } else {
          this.touchMoveX = 0;
          this.touchMoveY = 0;
        }
      } else if (t.identifier === this.aimTouchId) {
        const dx = t.clientX - this.aimOriginX;
        const dy = t.clientY - this.aimOriginY;
        const len = Math.hypot(dx, dy);
        if (len > 14) {
          this.padAimActive = true;
          this.padAimX = dx / len;
          this.padAimY = dy / len;
        }
      }
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.moveTouchId) {
        this.moveTouchId = null;
        this.touchMoveX = 0;
        this.touchMoveY = 0;
      } else if (t.identifier === this.aimTouchId) {
        this.aimTouchId = null;
        this.touchAimHeld = false;
      }
    }
  }

  /** True while the move stick is being held. */
  touchMoveHeld(): boolean {
    return this.moveTouchId !== null;
  }

  down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  pressed(...codes: string[]): boolean {
    return codes.some((c) => this.justPressed.has(c));
  }

  /** Poll the first connected gamepad. Call once per frame from the main loop. */
  pollGamepad(): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const now = performance.now();
    const dt = this.lastPollT ? Math.min(0.1, (now - this.lastPollT) / 1000) : 0.016;
    this.lastPollT = now;
    const gp = [...navigator.getGamepads()].find((p) => p && p.connected);
    this.padConnected = !!gp;
    if (!gp) {
      this.padMoveX = 0;
      this.padMoveY = 0;
      this.padFire = false;
      return;
    }
    const dz = (v: number | undefined): number => {
      const x = v ?? 0;
      return Math.abs(x) > 0.22 ? x : 0;
    };
    this.padMoveX = dz(gp.axes[0]);
    this.padMoveY = dz(gp.axes[1]);
    const ax = dz(gp.axes[2]);
    const ay = dz(gp.axes[3]);
    const mag = Math.hypot(ax, ay);
    if (mag > 0.3) {
      this.padAimActive = true;
      this.padAimX = ax / mag;
      this.padAimY = ay / mag;
    }
    // A / RT fire; B / RB / LB dash; Start pause. In menus the UI layer
    // consumes PadA (select), PadB (back), PadX (reroll) and the directions.
    this.padFire = !!(gp.buttons[0]?.pressed || gp.buttons[7]?.pressed);
    this.padEdge(gp, 0, ['PadA']);
    this.padEdge(gp, 1, ['PadB', 'PadDash']);
    this.padEdge(gp, 2, ['PadX']);
    this.padEdge(gp, 4, ['PadDash']);
    this.padEdge(gp, 5, ['PadDash']);
    this.padEdge(gp, 9, ['PadStart']);
    // D-pad or flicked left stick navigates menus, with hold-to-repeat
    const sx = gp.axes[0] ?? 0;
    const sy = gp.axes[1] ?? 0;
    this.dirNav('PadUp', !!gp.buttons[12]?.pressed || sy < -0.55, dt);
    this.dirNav('PadDown', !!gp.buttons[13]?.pressed || sy > 0.55, dt);
    this.dirNav('PadLeft', !!gp.buttons[14]?.pressed || sx < -0.55, dt);
    this.dirNav('PadRight', !!gp.buttons[15]?.pressed || sx > 0.55, dt);
  }

  private padEdge(gp: Gamepad, idx: number, codes: string[]): void {
    const pressed = !!gp.buttons[idx]?.pressed;
    if (pressed && !this.padPrev[idx]) {
      for (const c of codes) this.justPressed.add(c);
    }
    this.padPrev[idx] = pressed;
  }

  private dirNav(code: string, held: boolean, dt: number): void {
    let st = this.dirHold[code];
    if (!st) st = this.dirHold[code] = { held: false, t: 0 };
    if (held && !st.held) {
      this.justPressed.add(code);
      st.held = true;
      st.t = 0;
    } else if (held) {
      st.t += dt;
      if (st.t > 0.45) {
        this.justPressed.add(code);
        st.t = 0.3; // ~150ms repeat after the initial delay
      }
    } else {
      st.held = false;
    }
  }

  /** Normalized movement axis: keyboard, then touch stick, then gamepad. */
  axis(): { x: number; y: number } {
    let x = 0, y = 0;
    if (this.down('KeyA', 'ArrowLeft')) x -= 1;
    if (this.down('KeyD', 'ArrowRight')) x += 1;
    if (this.down('KeyW', 'ArrowUp')) y -= 1;
    if (this.down('KeyS', 'ArrowDown')) y += 1;
    if (x === 0 && y === 0 && (this.touchMoveX !== 0 || this.touchMoveY !== 0)) {
      x = this.touchMoveX;
      y = this.touchMoveY;
    }
    if (x === 0 && y === 0 && (this.padMoveX !== 0 || this.padMoveY !== 0)) {
      x = this.padMoveX;
      y = this.padMoveY;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  /** Call at end of each frame. */
  endFrame(): void {
    this.justPressed.clear();
    this.mouseJustPressed = false;
  }
}
