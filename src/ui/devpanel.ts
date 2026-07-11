// ---------------------------------------------------------------------------
// Developer/testing panel: a compact in-game console for exercising every
// system — chamber jumps, cheats, build granting, spawns, time control.
// Enabled via Settings → Developer mode, then ` (backtick) or the DEV button.
// Nothing here persists into saves except the devMode setting itself.
// ---------------------------------------------------------------------------
import type { Game } from '../game/game';
import type { UIManager } from './overlays';
import { spawnBoss } from '../game/combat';
import { ENEMY_DEFS, WEAPON_DEFS, WEAPON_MAX_LEVEL, weaponUnlocked } from '../game/data';
import type { GodId } from '../game/types';
import { rand } from '../engine/math';

const GODS: GodId[] = ['zeus', 'ares', 'hermes', 'poseidon'];

function el(tag: string, cls = '', text = ''): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export class DevPanel {
  private g: Game;
  private ui: UIManager;
  private root: HTMLElement;
  private launcher: HTMLElement;
  private info!: HTMLElement;
  private open = false;
  private frames = 0;
  private lastFpsAt = performance.now();
  private fps = 0;

  constructor(g: Game, ui: UIManager) {
    this.g = g;
    this.ui = ui;
    const host = document.getElementById('ui') ?? document.body;

    this.launcher = el('button', 'devbtn', 'DEV');
    this.launcher.onclick = () => this.toggle();
    host.appendChild(this.launcher);

    this.root = el('div', 'devpanel');
    // Panel interactions must never reach the game's mouse handlers on body
    for (const type of ['mousedown', 'mouseup', 'click', 'touchstart', 'touchend']) {
      this.root.addEventListener(type, (e) => e.stopPropagation());
    }
    this.build();
    host.appendChild(this.root);

    setInterval(() => this.sync(), 400);
  }

  toggle(): void {
    this.open = !this.open;
    this.root.classList.toggle('visible', this.open);
  }

  /** Called by the main loop every frame — feeds the FPS readout. */
  tick(): void {
    this.frames++;
    const now = performance.now();
    if (now - this.lastFpsAt >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.lastFpsAt));
      this.frames = 0;
      this.lastFpsAt = now;
    }
  }

  private sync(): void {
    const enabled = this.g.save.settings.devMode;
    this.launcher.classList.toggle('visible', enabled);
    if (!enabled && this.open) this.toggle();
    if (!this.open) return;
    const g = this.g;
    this.info.textContent =
      `${this.fps} fps · ch ${g.chamber} ${g.phase} · ${g.enemies.length} foes · `
      + `${g.projectiles.length} proj · HP ${Math.ceil(g.player.hp)}/${Math.round(g.stats.maxHP)} `
      + `· ${g.devTimeScale}x${g.devPaused ? ' ⏸' : ''}${g.devGodMode ? ' · GOD' : ''}`;
  }

  private section(title: string): HTMLElement {
    const s = el('div', 'dev-section');
    s.appendChild(el('div', 'dev-title', title));
    this.root.appendChild(s);
    return s;
  }

  private btn(parent: HTMLElement, label: string, fn: () => void): HTMLElement {
    const b = el('button', 'dev-b', label);
    b.onclick = () => { fn(); this.sync(); };
    parent.appendChild(b);
    return b;
  }

  /** Guard: most actions only make sense mid-run. */
  private inRun(fn: () => void): () => void {
    return () => { if (this.g.state === 'run') fn(); };
  }

  private spawnRing(kind: keyof typeof ENEMY_DEFS, n: number, elite = false): void {
    const g = this.g;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const e = g.spawnEnemyAt(
        { x: g.player.x + Math.cos(a) * rand(260, 420), y: g.player.y + Math.sin(a) * rand(260, 420) },
        elite, kind);
      e.spawnT = 0.3;
    }
  }

  private build(): void {
    const g = this.g;
    const head = el('div', 'dev-head');
    head.appendChild(el('span', '', 'DEV PANEL'));
    const close = el('button', 'dev-b', '✕');
    close.onclick = () => this.toggle();
    head.appendChild(close);
    this.root.appendChild(head);
    this.info = el('div', 'dev-info', '—');
    this.root.appendChild(this.info);

    const run = this.section('RUN');
    this.btn(run, 'EXILE', () => g.startRun('warrior'));
    this.btn(run, 'HUNTRESS', () => g.startRun('archer'));
    this.btn(run, 'ORACLE', () => g.startRun('mage'));
    for (const c of [1, 4, 5, 9, 10, 15, 19, 20, 21]) {
      this.btn(run, `CH ${c}`, this.inRun(() => { g.setOverlayOpen(false); g.setupChamber(c); }));
    }
    this.btn(run, 'CLEAR CHAMBER', this.inRun(() => {
      for (const e of [...g.enemies]) g.dealDamage(e, 1e12, { source: 'strike' });
      g.spawnBudgetUsed = g.quota;
    }));

    const player = this.section('PLAYER');
    this.btn(player, 'GOD MODE', () => { g.devGodMode = !g.devGodMode; });
    this.btn(player, 'FULL HEAL', this.inRun(() => { g.player.hp = g.stats.maxHP; }));
    this.btn(player, 'HP = 1', this.inRun(() => { g.player.hp = 1; }));
    this.btn(player, '+1000 GOLD', this.inRun(() => g.addGold(1000)));
    this.btn(player, '+100 ICHOR', this.inRun(() => g.addIchor(100)));
    this.btn(player, '+5 LEVELS', this.inRun(() => { g.pendingLevelUps += 5; g.maybeOpenLevelUp(); }));
    this.btn(player, '+1 BANKED', this.inRun(() => { g.bankedLevelUps++; }));

    const stats = this.section('STATS (dev-only, stack per click)');
    this.btn(stats, '+25% MIGHT', this.inRun(() => { g.devMods.might += 0.25; g.recomputeStats(); }));
    this.btn(stats, '+1 PIERCE', this.inRun(() => { g.devMods.pierce += 1; g.recomputeStats(); }));
    this.btn(stats, '+25% AREA', this.inRun(() => { g.devMods.area += 0.25; g.recomputeStats(); }));
    this.btn(stats, '+25% RANGE', this.inRun(() => { g.devMods.range += 0.25; g.recomputeStats(); }));
    this.btn(stats, '+1 PROJECTILE', this.inRun(() => { g.devMods.projectiles += 1; g.recomputeStats(); }));
    this.btn(stats, 'RESET', this.inRun(() => {
      g.devMods = { might: 0, pierce: 0, area: 0, range: 0, projectiles: 0 };
      g.recomputeStats();
    }));

    const buildS = this.section('BUILD');
    this.btn(buildS, 'RANDOM WEAPON', this.inRun(() => {
      const pool = WEAPON_DEFS.filter((w) => weaponUnlocked(w, g.save) && !g.weapons.some((o) => o.id === w.id));
      const def = pool[Math.floor(rand(pool.length))];
      if (def) g.weapons.push({ id: def.id, level: 1, t: 0, angle: 0, trailT: 0 });
    }));
    this.btn(buildS, '+1 ALL WEAPON LVLS', this.inRun(() => {
      for (const w of g.weapons) w.level = Math.min(WEAPON_MAX_LEVEL, w.level + 1);
    }));
    this.btn(buildS, 'RANDOM BOON', this.inRun(() => {
      const god = GODS[Math.floor(rand(GODS.length))];
      const c = g.genBoonChoices(god)[0];
      if (c) g.applyBoonChoice(c);
    }));
    this.btn(buildS, 'LEGENDARY (real flow)', this.inRun(() => {
      g.pendingLegendaries++;
      g.maybeOpenLegendary();
    }));
    this.btn(buildS, 'MAX BUILD', this.inRun(() => {
      for (const def of WEAPON_DEFS.filter((w) => weaponUnlocked(w, g.save)).slice(0, 4)) {
        const owned = g.weapons.find((o) => o.id === def.id);
        if (owned) owned.level = WEAPON_MAX_LEVEL;
        else g.weapons.push({ id: def.id, level: WEAPON_MAX_LEVEL, t: 0, angle: 0, trailT: 0 });
      }
      for (const god of GODS) {
        const c = g.genBoonChoices(god)[0];
        if (c) { c.rarity = 'epic'; g.applyBoonChoice(c); }
      }
      g.recomputeStats();
    }));

    const spawn = this.section('SPAWN');
    this.btn(spawn, 'SHADES ×10', this.inRun(() => this.spawnRing('shade', 10)));
    this.btn(spawn, 'REAVERS ×5', this.inRun(() => this.spawnRing('reaver', 5)));
    this.btn(spawn, 'STALKERS ×5', this.inRun(() => this.spawnRing('stalker', 5)));
    this.btn(spawn, 'ELITES ×3', this.inRun(() => this.spawnRing('brute', 3, true)));
    this.btn(spawn, 'HORDE ×200 (perf)', this.inRun(() => this.spawnRing('shade', 200)));
    this.btn(spawn, 'GATEKEEPER', this.inRun(() => spawnBoss(g, 'gatekeeper')));
    this.btn(spawn, 'SHEPHERD', this.inRun(() => spawnBoss(g, 'shepherd')));
    this.btn(spawn, 'ARCHON DROP', this.inRun(() => g.devArchonDrop()));
    this.btn(spawn, 'KILL ALL', this.inRun(() => {
      for (const e of [...g.enemies]) g.dealDamage(e, 1e12, { source: 'strike' });
    }));

    const over = this.section('OVERLAYS');
    this.btn(over, 'SHOP', this.inRun(() => { g.shopItems = g.genShopItems(); this.ui.openShopForDev(); }));
    this.btn(over, 'POM', this.inRun(() => this.ui.openPomForDev()));

    const time = this.section('TIME');
    for (const s of [0.25, 0.5, 1, 2, 4]) {
      this.btn(time, `${s}×`, () => { g.devTimeScale = s; });
    }
    this.btn(time, 'PAUSE', () => { g.devPaused = !g.devPaused; });
    this.btn(time, 'STEP', () => {
      if (g.state === 'run' && !g.overlayOpen) g.update(1 / 60);
    });
  }
}
