// ---------------------------------------------------------------------------
// DOM overlay screens: menu, mirror, unlocks, pact, settings, how-to,
// level-up, boon pick, shop, pom, pause, death, victory, build panel, toasts.
// All state lives on Game; this layer renders it and forwards clicks.
// ---------------------------------------------------------------------------
import type { BoonChoice, Game, LevelChoice, PomChoice } from '../game/game';
import {
  CHARACTERS, FATE_COLOR, HEAT_DEFS, LEGENDARY_COLOR, MIRROR_DEFS, WEAPON_DEFS,
  WEAPON_MAX_LEVEL, boonDef, characterDef, skinUnlocked, tomeDef, weaponDef,
  weaponUnlocked,
} from '../game/data';
import {
  charStatsFor, exportSave, heatLevel, importSave, mirrorLevel,
  mirrorNextCost, persistSave, totalHeat, tryBuyMirror,
} from '../game/meta';
import { GOD_COLOR, GOD_NAME, RARITY_COLOR, type GodId } from '../game/types';
import { fmt, fmtMult } from '../engine/math';

function el(tag: string, cls = '', html = ''): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

type Mode = 'none' | 'levelup' | 'boon' | 'shop' | 'pom' | 'pause' | 'end';

export class UIManager {
  private g: Game;
  private root: HTMLElement;
  private menu!: HTMLElement;
  private charSelect!: HTMLElement;
  private mirror!: HTMLElement;
  private unlocks!: HTMLElement;
  private pact!: HTMLElement;
  private settings!: HTMLElement;
  private howto!: HTMLElement;
  private levelup!: HTMLElement;
  private boon!: HTMLElement;
  private shop!: HTMLElement;
  private pom!: HTMLElement;
  private pause!: HTMLElement;
  private endScreen!: HTMLElement;
  private build!: HTMLElement;
  private toasts!: HTMLElement;
  private pactBtn!: HTMLElement;
  private currentChoices: LevelChoice[] = [];
  private currentBoons: BoonChoice[] = [];
  private currentPoms: PomChoice[] = [];
  private currentGod: GodId = 'zeus';
  private legendaryMode = false;
  private mode: Mode = 'none';
  buildOpen = false;

  // Gamepad focus navigation
  private focusables: HTMLElement[] = [];
  private focusIdx = 0;
  private lastPadScreen: HTMLElement | null = null;

  constructor(game: Game) {
    this.g = game;
    this.root = document.getElementById('ui')!;
    this.buildScreens();
    game.ui = {
      openLevelUp: () => this.openLevelUp(),
      openBoon: (god) => this.openBoon(god),
      openLegendary: () => this.openLegendary(),
      openShop: () => this.openShop(),
      openPom: () => this.openPom(),
      showToast: (text, color) => this.showToast(text, color),
      openDeath: () => this.openEnd(false),
      openVictory: () => this.openEnd(true),
      syncMenus: () => this.syncMenus(),
    };
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.syncMenus();
  }

  isBlocking(): boolean {
    return this.mode !== 'none' || this.g.state === 'menu';
  }

  // ------------------------------------------------------------------
  // Gamepad menu navigation — call once per frame from the main loop.
  // D-pad / left stick move focus, A selects, B backs out, X rerolls.
  // ------------------------------------------------------------------

  updatePad(): void {
    const input = this.g.input;
    if (!input.padConnected) return;
    if (!this.isBlocking()) {
      this.clearPadFocus();
      return;
    }
    const screen = this.padScreen();
    if (!screen) {
      this.clearPadFocus();
      return;
    }
    if (screen !== this.lastPadScreen) {
      this.lastPadScreen = screen;
      this.collectFocusables(screen, true);
    } else if (this.focusables.length === 0 || !this.focusables[this.focusIdx]?.isConnected) {
      // The screen re-rendered under us (e.g. after a purchase)
      this.collectFocusables(screen, false);
    }
    const cur = this.focusables[this.focusIdx];
    // Sliders: left/right adjust instead of moving focus
    if (cur instanceof HTMLInputElement && cur.type === 'range'
      && input.pressed('PadLeft', 'PadRight')) {
      cur.value = String(Number(cur.value) + (input.pressed('PadRight') ? 5 : -5));
      cur.dispatchEvent(new Event('input'));
    } else if (input.pressed('PadUp', 'PadLeft')) {
      this.moveFocus(-1);
    } else if (input.pressed('PadDown', 'PadRight')) {
      this.moveFocus(1);
    }
    if (input.pressed('PadA')) {
      const el = this.focusables[this.focusIdx];
      if (el) el.click();
    }
    if (input.pressed('PadX') && (this.mode === 'levelup' || this.mode === 'boon')) {
      this.doReroll();
    }
    if (input.pressed('PadB')) this.padBack(screen);
  }

  /** The screen that should receive pad navigation right now. */
  private padScreen(): HTMLElement | null {
    if (this.howto.classList.contains('visible')) return this.howto;
    if (this.settings.classList.contains('visible')) return this.settings;
    for (const s of [this.levelup, this.boon, this.shop, this.pom, this.pause,
      this.endScreen, this.charSelect, this.mirror, this.unlocks, this.pact, this.menu]) {
      if (s.classList.contains('visible')) return s;
    }
    return null;
  }

  private collectFocusables(screen: HTMLElement, reset: boolean): void {
    const els = [...screen.querySelectorAll<HTMLElement>(
      'button:not(:disabled), .card:not(.bought), input[type=range]')]
      .filter((el) => el.offsetParent !== null);
    this.focusables = els;
    this.focusIdx = reset ? 0 : Math.min(this.focusIdx, Math.max(0, els.length - 1));
    this.applyPadFocus();
  }

  private moveFocus(dir: number): void {
    if (this.focusables.length === 0) return;
    this.focusIdx = (this.focusIdx + dir + this.focusables.length) % this.focusables.length;
    this.applyPadFocus();
    this.g.audio.play('ui');
  }

  private applyPadFocus(): void {
    document.querySelectorAll('.gp-focus').forEach((el) => el.classList.remove('gp-focus'));
    const cur = this.focusables[this.focusIdx];
    if (cur) {
      cur.classList.add('gp-focus');
      cur.scrollIntoView({ block: 'nearest' });
    }
  }

  private clearPadFocus(): void {
    if (this.lastPadScreen !== null) {
      document.querySelectorAll('.gp-focus').forEach((el) => el.classList.remove('gp-focus'));
      this.lastPadScreen = null;
      this.focusables = [];
      this.focusIdx = 0;
    }
  }

  /** B button: click whatever counts as "back" on this screen. */
  private padBack(screen: HTMLElement): void {
    const b = [...screen.querySelectorAll<HTMLElement>('button')]
      .find((el) => /^(BACK|CLOSE|RESUME|LEAVE)/.test(el.textContent ?? ''));
    b?.click();
  }

  private setMode(m: Mode): void {
    this.mode = m;
    this.g.setOverlayOpen(m !== 'none');
  }

  // ------------------------------------------------------------------
  // Construction
  // ------------------------------------------------------------------

  private buildScreens(): void {
    // Menu
    this.menu = el('div', 'screen center', '');
    const mi = el('div', 'menu-inner');
    mi.append(
      el('h1', 'title', 'HUBRIS'),
      el('p', 'subtitle', 'Grow beyond the gods’ patience.'),
    );
    const stats = el('div', 'menu-stats');
    stats.id = 'menu-stats';
    mi.append(stats);
    const bStart = el('button', 'btn primary', 'BEGIN DESCENT');
    bStart.onclick = () => {
      this.g.audio.unlock();
      this.g.audio.play('ui');
      this.renderCharSelect();
      this.menu.classList.remove('visible');
      this.charSelect.classList.add('visible');
    };
    const bMirror = el('button', 'btn', 'MIRROR OF HUBRIS');
    bMirror.onclick = () => this.showSubScreen(this.mirror, () => this.renderMirror());
    const bUnlocks = el('button', 'btn', 'UNLOCKS');
    bUnlocks.onclick = () => this.showSubScreen(this.unlocks, () => this.renderUnlocks());
    this.pactBtn = el('button', 'btn', 'PACT OF PUNISHMENT');
    this.pactBtn.onclick = () => this.showSubScreen(this.pact, () => this.renderPact());
    const bSettings = el('button', 'btn', 'SETTINGS');
    bSettings.onclick = () => this.showSubScreen(this.settings, () => this.renderSettings());
    const bHow = el('button', 'btn', 'HOW TO PLAY');
    bHow.onclick = () => {
      this.g.audio.play('ui');
      this.howto.classList.add('visible');
    };
    mi.append(bStart, bMirror, bUnlocks, this.pactBtn, bSettings, bHow,
      el('p', 'footnote', 'A roguelite of chambers & hordes — Hades × Megabonk'));
    this.menu.append(mi);

    // Sub-screens (filled lazily). Settings is 'raised' so it stacks above
    // the pause overlay when opened mid-run.
    this.charSelect = el('div', 'screen center');
    this.mirror = el('div', 'screen center');
    this.unlocks = el('div', 'screen center');
    this.pact = el('div', 'screen center');
    this.settings = el('div', 'screen center raised');

    // How to play
    this.howto = el('div', 'screen center modal');
    const hp = el('div', 'panel howto');
    hp.append(
      el('h2', 'panel-title', 'HOW TO PLAY'),
      el('div', 'howto-grid', `
        <div><b>WASD</b></div><div>move</div>
        <div><b>MOUSE</b></div><div>aim · hold <b>LMB</b> to strike (3-hit combo, parries shots)</div>
        <div><b>SPACE / SHIFT</b></div><div>dash — invulnerable while dashing</div>
        <div><b>GAMEPAD</b></div><div>sticks move/aim · A/RT strike · B/RB dash · Start pause<br>menus: D-pad/stick navigate · A select · B back · X reroll</div>
        <div><b>TAB</b></div><div>build panel</div>
        <div><b>ESC</b></div><div>pause</div>
      `),
      el('p', 'howto-text', `
        Slay <span class="hl-purple">every foe</span> in the chamber, then walk into a door — doors show their reward.
        Chain kills quickly for a <span class="hl-gold">Massacre</span> bonus — the streak multiplies your XP but fades fast, so keep the horde falling.
        Glowing <span class="hl-gold">obelisks</span> can be captured mid-fight: stand in the ring to channel (a wave will contest you) for powerful timed buffs — unclaimed obelisks crumble when the chamber clears.
        Collect <span class="hl-cyan">XP gems</span> to level up and stack <b>auto-weapons</b> and <b>tomes</b>.
        Doors marked <span class="hl-gold">Z / A / H</span> grant god boons with rarities; two gods' boons can unlock <span class="hl-gold">Duo boons</span>,
        and <span class="hl-gold">Poms</span> raise a boon's rarity. Spend gold at <span class="hl-purple">Charon's Wares</span>.
        Damage bonuses in <i>different</i> brackets multiply each other — diversify to go exponential.
        <span class="hl-pink">Ichor</span> from elites & bosses is permanent: spend it in the Mirror of Hubris.
        Slay the Gatekeeper, then keep descending — <b>endless</b> chambers await, with a boss every five.
      `),
    );
    const hClose = el('button', 'btn', 'CLOSE');
    hClose.onclick = () => this.howto.classList.remove('visible');
    hp.append(hClose);
    this.howto.append(hp);

    // Choice overlays
    this.levelup = el('div', 'screen center overlay');
    this.boon = el('div', 'screen center overlay');
    this.shop = el('div', 'screen center overlay');
    this.pom = el('div', 'screen center overlay');

    // Pause
    this.pause = el('div', 'screen center overlay');
    const pp = el('div', 'panel');
    pp.append(el('h2', 'panel-title', 'PAUSED'));
    const pResume = el('button', 'btn primary', 'RESUME');
    pResume.onclick = () => this.togglePause();
    const pSettings = el('button', 'btn', 'SETTINGS');
    pSettings.onclick = () => {
      this.renderSettings();
      this.settings.classList.add('visible');
    };
    const pAbandon = el('button', 'btn danger', 'ABANDON RUN');
    pAbandon.onclick = () => {
      this.setMode('none');
      this.hideAll();
      this.g.abandonRun();
    };
    pp.append(pResume, pSettings, pAbandon);
    this.pause.append(pp);

    // End screen (death & victory share it)
    this.endScreen = el('div', 'screen center overlay');

    // Build panel
    this.build = el('div', 'buildpanel');

    // Toasts
    this.toasts = el('div', 'toasts');

    this.root.append(
      this.menu, this.charSelect, this.mirror, this.unlocks, this.pact, this.settings,
      this.levelup, this.boon, this.shop, this.pom,
      this.pause, this.endScreen, this.howto, this.build, this.toasts,
    );
  }

  private showSubScreen(screen: HTMLElement, renderFn: () => void): void {
    this.g.audio.play('ui');
    renderFn();
    this.menu.classList.remove('visible');
    screen.classList.add('visible');
  }

  private backToMenu(from: HTMLElement): HTMLElement {
    const back = el('button', 'btn', 'BACK');
    back.onclick = () => {
      from.classList.remove('visible');
      this.syncMenus();
    };
    return back;
  }

  // ------------------------------------------------------------------
  // Menu / Mirror / Unlocks / Pact / Settings
  // ------------------------------------------------------------------

  syncMenus(): void {
    this.hideAll();
    if (this.g.state === 'menu') {
      const s = this.g.save;
      const stats = document.getElementById('menu-stats');
      if (stats) {
        stats.innerHTML = `
          <span>⬥ <b>${fmt(s.ichor)}</b> ichor</span>
          <span>${s.runs} runs</span>
          <span>${s.wins} escapes</span>
          <span>best: chamber ${s.bestChamber || '—'}</span>`;
      }
      // The Pact only opens once you have escaped
      this.pactBtn.style.display = s.wins > 0 ? '' : 'none';
      this.menu.classList.add('visible');
    }
  }

  private renderCharSelect(): void {
    const g = this.g;
    this.charSelect.innerHTML = '';
    const panel = el('div', 'choice-wrap');
    panel.append(
      el('h2', 'choice-title', 'CHOOSE YOUR SHADE'),
      el('p', 'choice-sub', 'each descends in their own way'),
    );
    const row = el('div', 'cards');
    CHARACTERS.forEach((c, i) => {
      const card = el('div', 'card char-card');
      card.style.setProperty('--accent', c.color);
      const last = g.save.lastCharacter === c.id;
      const skin = g.selectedSkin(c.id);
      card.innerHTML = `
        <div class="card-key">${i + 1}</div>
        <div class="card-icon" style="color:${skin.body}">${c.glyph}</div>
        ${last ? '<div class="card-tag gold">LAST PLAYED</div>' : `<div class="card-tag">${c.weapon}</div>`}
        <div class="card-name">${c.name}</div>
        <div class="card-desc">${c.attackDesc}</div>
        <div class="card-desc" style="color:${c.color}">${c.passiveDesc}</div>`;
      // Skin swatches: pick a look, or see what feat unlocks it
      const cs = charStatsFor(g.save, c.id);
      const swatches = el('div', 'skin-row');
      for (const s of c.skins) {
        const unlocked = skinUnlocked(s, cs);
        const dot = el('button', `skin-dot ${unlocked ? '' : 'locked'} ${skin.id === s.id ? 'active' : ''}`);
        dot.style.background = s.body;
        dot.title = unlocked ? s.name : `${s.name} — ${s.unlock!.desc}`;
        dot.onclick = (ev) => {
          ev.stopPropagation();
          if (unlocked) {
            g.save.skins[c.id] = s.id;
            persistSave(g.save);
            g.audio.play('ui');
            this.renderCharSelect();
          } else {
            const [cur, goal] = s.unlock!.progress(cs);
            this.showToast(`${s.name}: ${s.unlock!.desc} (${fmt(cur)}/${fmt(goal)})`, '#8a93b8');
          }
        };
        if (!unlocked) dot.append(el('span', 'skin-lock', '🔒'));
        swatches.append(dot);
      }
      const skinName = el('div', 'skin-name', skin.name);
      skinName.style.color = skin.body;
      card.append(swatches, skinName);
      card.onclick = () => {
        this.g.audio.play('ui');
        this.hideAll();
        this.g.startRun(c.id);
      };
      row.append(card);
    });
    panel.append(row);
    const back = el('button', 'btn small', 'BACK');
    back.onclick = () => {
      this.charSelect.classList.remove('visible');
      this.syncMenus();
    };
    panel.append(back);
    this.charSelect.append(panel);
  }

  private renderMirror(): void {
    const g = this.g;
    this.mirror.innerHTML = '';
    const panel = el('div', 'panel mirror');
    panel.append(el('h2', 'panel-title', 'MIRROR OF HUBRIS'));
    panel.append(el('div', 'mirror-balance', `⬥ ${fmt(g.save.ichor)} ichor`));
    const grid = el('div', 'mirror-grid');
    for (const def of MIRROR_DEFS) {
      const lvl = mirrorLevel(g.save, def.id);
      const cost = mirrorNextCost(g.save, def.id);
      const card = el('div', 'mirror-card');
      const pips = Array.from({ length: def.maxLevel }, (_, i) =>
        `<span class="pip ${i < lvl ? 'on' : ''}"></span>`).join('');
      card.innerHTML = `
        <div class="mc-head"><b>${def.name}</b><span class="pips">${pips}</span></div>
        <div class="mc-desc">${def.desc}</div>`;
      const btn = el('button', 'btn tiny', cost === null ? 'MAXED' : `BUY · ⬥${cost}`) as HTMLButtonElement;
      btn.disabled = cost === null || g.save.ichor < cost;
      btn.onclick = () => {
        if (tryBuyMirror(g.save, def.id)) {
          g.audio.play('boon');
          this.renderMirror();
        }
      };
      card.append(btn);
      grid.append(card);
    }
    panel.append(grid, this.backToMenu(this.mirror));
    this.mirror.append(panel);
  }

  private renderUnlocks(): void {
    const g = this.g;
    this.unlocks.innerHTML = '';
    const panel = el('div', 'panel mirror');
    panel.append(el('h2', 'panel-title', 'ARSENAL'));
    panel.append(el('p', 'end-hint', 'Weapons join the level-up pool once earned.'));
    const grid = el('div', 'unlock-list');
    for (const def of WEAPON_DEFS) {
      const unlocked = weaponUnlocked(def, g.save);
      const row = el('div', `unlock-row ${unlocked ? '' : 'locked'}`);
      let right: string;
      if (!def.unlock) {
        right = `<span class="ur-status">STARTER</span>`;
      } else if (unlocked) {
        right = `<span class="ur-status unlocked">UNLOCKED</span>`;
      } else {
        const [cur, goal] = def.unlock.progress(g.save);
        const pct = Math.round((cur / goal) * 100);
        right = `
          <div class="ur-progress">
            <div class="ur-quest">${def.unlock.desc}</div>
            <div class="ur-bar"><div class="ur-fill" style="width:${pct}%"></div></div>
            <div class="ur-count">${fmt(cur)} / ${fmt(goal)}</div>
          </div>`;
      }
      row.innerHTML = `
        <span class="ur-icon" style="color:${def.color}">${def.icon}</span>
        <div class="ur-main">
          <b>${def.name}</b>
          <span class="ur-desc">${def.describe(1)}</span>
        </div>
        ${right}`;
      grid.append(row);
    }
    panel.append(grid, this.backToMenu(this.unlocks));
    this.unlocks.append(panel);
  }

  private renderPact(): void {
    const g = this.g;
    this.pact.innerHTML = '';
    const panel = el('div', 'panel mirror');
    panel.append(el('h2', 'panel-title', 'PACT OF PUNISHMENT'));
    const heat = totalHeat(g.save);
    panel.append(el('p', 'end-hint',
      `Turn up the heat for +2 ichor per rank on every victory. Current heat: <b style="color:#ff5a5a">${heat}</b>`));
    const grid = el('div', 'unlock-list');
    for (const def of HEAT_DEFS) {
      const lvl = heatLevel(g.save, def.id);
      const row = el('div', 'unlock-row');
      const pips = Array.from({ length: def.maxLevel }, (_, i) =>
        `<span class="pip ${i < lvl ? 'hot' : ''}"></span>`).join('');
      row.innerHTML = `
        <span class="ur-icon" style="color:#ff5a5a">♆</span>
        <div class="ur-main">
          <b>${def.name}</b>
          <span class="ur-desc">${def.desc}</span>
        </div>
        <span class="pips">${pips}</span>`;
      const controls = el('div', 'pact-controls');
      const minus = el('button', 'btn tiny', '−') as HTMLButtonElement;
      minus.disabled = lvl <= 0;
      minus.onclick = () => {
        g.save.heat[def.id] = Math.max(0, lvl - 1);
        persistSave(g.save);
        g.audio.play('ui');
        this.renderPact();
      };
      const plus = el('button', 'btn tiny', '+') as HTMLButtonElement;
      plus.disabled = lvl >= def.maxLevel;
      plus.onclick = () => {
        g.save.heat[def.id] = Math.min(def.maxLevel, lvl + 1);
        persistSave(g.save);
        g.audio.play('ui');
        this.renderPact();
      };
      controls.append(minus, plus);
      row.append(controls);
      grid.append(row);
    }
    panel.append(grid, this.backToMenu(this.pact));
    this.pact.append(panel);
  }

  private renderSettings(): void {
    const g = this.g;
    this.settings.innerHTML = '';
    const panel = el('div', 'panel settings-panel');
    panel.append(el('h2', 'panel-title', 'SETTINGS'));

    const slider = (label: string, get: () => number, set: (v: number) => void): HTMLElement => {
      const row = el('div', 'setting-row');
      const val = el('span', 'setting-val', `${Math.round(get() * 100)}`);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.value = String(Math.round(get() * 100));
      input.oninput = () => {
        set(Number(input.value) / 100);
        val.textContent = input.value;
        g.applySettings();
      };
      row.append(el('span', 'setting-label', label), input, val);
      return row;
    };

    const cycle = (label: string, options: [string, () => boolean, () => void][]): HTMLElement => {
      const row = el('div', 'setting-row');
      const current = options.find(([, isActive]) => isActive());
      const btn = el('button', 'btn tiny', current ? current[0] : options[0][0]);
      btn.onclick = () => {
        const idx = options.findIndex(([, isActive]) => isActive());
        const next = options[(idx + 1) % options.length];
        next[2]();
        btn.textContent = next[0];
        g.applySettings();
        g.audio.play('ui');
      };
      row.append(el('span', 'setting-label', label), el('span'), btn);
      return row;
    };

    const st = g.save.settings;
    panel.append(
      slider('Master volume', () => st.master, (v) => { st.master = v; }),
      slider('Music', () => st.music, (v) => { st.music = v; }),
      slider('Sound effects', () => st.sfx, (v) => { st.sfx = v; }),
      cycle('Screen shake', [
        ['FULL', () => st.shake === 1, () => { st.shake = 1; }],
        ['REDUCED', () => st.shake === 0.4, () => { st.shake = 0.4; }],
        ['OFF', () => st.shake === 0, () => { st.shake = 0; }],
      ]),
      cycle('Damage numbers', [
        ['FULL', () => st.dmgNumbers === 'full', () => { st.dmgNumbers = 'full'; }],
        ['REDUCED', () => st.dmgNumbers === 'reduced', () => { st.dmgNumbers = 'reduced'; }],
        ['OFF', () => st.dmgNumbers === 'off', () => { st.dmgNumbers = 'off'; }],
      ]),
      cycle('Audio', [
        ['ON', () => !g.save.muted, () => { g.save.muted = false; g.audio.setMuted(false); }],
        ['MUTED', () => g.save.muted, () => { g.save.muted = true; g.audio.setMuted(true); }],
      ]),
      el('div', 'settings-divider', 'ACCESSIBILITY'),
      cycle('Auto-aim (nearest enemy)', [
        ['OFF', () => !st.autoAim, () => { st.autoAim = false; }],
        ['ON', () => st.autoAim, () => { st.autoAim = true; }],
      ]),
      cycle('Auto-fire (in range)', [
        ['OFF', () => !st.autoFire, () => { st.autoFire = false; }],
        ['ON', () => st.autoFire, () => { st.autoFire = true; }],
      ]),
    );

    // Save-data management — only from the main menu, never mid-run
    if (g.state === 'menu') {
      panel.append(el('div', 'settings-divider', 'SAVE DATA'));
      const dataRow = el('div', 'data-row');
      const copyBtn = el('button', 'btn tiny', 'COPY SAVE CODE');
      copyBtn.onclick = () => {
        const code = exportSave(g.save);
        if (navigator.clipboard) {
          navigator.clipboard.writeText(code).then(
            () => this.showToast('Save code copied to clipboard', '#7bf1a8'),
            () => { window.prompt('Copy your save code:', code); },
          );
        } else {
          window.prompt('Copy your save code:', code);
        }
      };
      const importBtn = el('button', 'btn tiny', 'IMPORT SAVE CODE');
      importBtn.onclick = () => {
        const code = window.prompt('Paste a save code:');
        if (!code) return;
        const save = importSave(code);
        if (save) {
          g.adoptSave(save);
          this.showToast('Save imported', '#7bf1a8');
          this.renderSettings();
          this.settings.classList.add('visible');
        } else {
          this.showToast('Invalid save code', '#ee4266');
        }
      };
      dataRow.append(copyBtn, importBtn);
      panel.append(dataRow);

      // Wipe requires a second, explicit confirmation click
      const wipeBtn = el('button', 'btn danger', 'WIPE SAVE DATA');
      let armed = false;
      wipeBtn.onclick = () => {
        if (!armed) {
          armed = true;
          wipeBtn.textContent = 'CONFIRM WIPE — CANNOT BE UNDONE';
          wipeBtn.classList.add('armed');
          window.setTimeout(() => {
            if (armed) {
              armed = false;
              wipeBtn.textContent = 'WIPE SAVE DATA';
              wipeBtn.classList.remove('armed');
            }
          }, 4000);
        } else {
          armed = false;
          g.wipeSave();
          this.showToast('Save data wiped — a clean slate', '#8a93b8');
          this.renderSettings();
          this.settings.classList.add('visible');
        }
      };
      panel.append(wipeBtn);
    }

    const close = el('button', 'btn', 'CLOSE');
    close.onclick = () => {
      this.settings.classList.remove('visible');
      if (this.g.state === 'menu') this.syncMenus();
    };
    panel.append(close);
    this.settings.append(panel);
  }

  // ------------------------------------------------------------------
  // Level-up
  // ------------------------------------------------------------------

  private openLevelUp(): void {
    this.setMode('levelup');
    this.currentChoices = this.g.genLevelChoices(3);
    this.renderLevelUp();
    this.levelup.classList.add('visible');
  }

  private renderLevelUp(): void {
    this.levelup.innerHTML = '';
    const panel = el('div', 'choice-wrap');
    panel.append(
      el('h2', 'choice-title', `LEVEL ${this.g.level}`),
      el('p', 'choice-sub', this.g.pendingLevelUps > 1
        ? `choose an upgrade · ${this.g.pendingLevelUps} pending`
        : 'choose an upgrade'),
    );
    const row = el('div', 'cards');
    this.currentChoices.forEach((c, i) => {
      const card = el('div', 'card');
      card.style.setProperty('--accent', c.color);
      card.innerHTML = `
        <div class="card-key">${i + 1}</div>
        <div class="card-icon" style="color:${c.color}">${c.icon}</div>
        <div class="card-tag ${c.tag === 'TRANSCEND' ? 'gold' : ''}">${c.tag}</div>
        <div class="card-name">${c.name}</div>
        <div class="card-desc">${c.desc}</div>`;
      card.onclick = () => this.pickLevelChoice(c);
      row.append(card);
    });
    panel.append(row);
    panel.append(this.rerollButton(() => {
      this.currentChoices = this.g.genLevelChoices(3);
      this.renderLevelUp();
    }));
    this.levelup.append(panel);
  }

  private pickLevelChoice(c: LevelChoice): void {
    this.g.audio.play('ui');
    this.g.applyLevelChoice(c);
    this.g.pendingLevelUps--;
    if (this.g.pendingLevelUps > 0) {
      this.currentChoices = this.g.genLevelChoices(3);
      this.renderLevelUp();
    } else {
      this.levelup.classList.remove('visible');
      this.setMode('none');
    }
    this.refreshBuild();
  }

  // ------------------------------------------------------------------
  // Boons
  // ------------------------------------------------------------------

  private openBoon(god: GodId): void {
    this.setMode('boon');
    this.legendaryMode = false;
    this.currentGod = god;
    this.currentBoons = this.g.genBoonChoices(god);
    this.renderBoon();
    this.boon.classList.add('visible');
  }

  /** Boss reward: choose one Legendary — no rerolls, the gods insist. */
  private openLegendary(): void {
    this.setMode('boon');
    this.legendaryMode = true;
    this.currentBoons = this.g.genLegendaryChoices();
    this.renderBoon();
    this.boon.classList.add('visible');
  }

  private renderBoon(): void {
    const god = this.currentGod;
    this.boon.innerHTML = '';
    const panel = el('div', 'choice-wrap');
    const title = this.legendaryMode
      ? el('h2', 'choice-title god', 'THE GODS BESTOW A LEGEND')
      : el('h2', 'choice-title god', `${GOD_NAME[god]} OFFERS A BOON`);
    title.style.color = this.legendaryMode ? LEGENDARY_COLOR : GOD_COLOR[god];
    panel.append(title, el('p', 'choice-sub',
      this.legendaryMode ? 'a spoil of the fallen gate — choose one' : 'take one blessing'));
    const row = el('div', 'cards');
    this.currentBoons.forEach((c, i) => {
      const rarityColor = c.rarity === 'duo' ? '#f0c75e'
        : c.rarity === 'legendary' ? LEGENDARY_COLOR
        : RARITY_COLOR[c.rarity];
      const godColor = c.rarity === 'legendary'
        ? LEGENDARY_COLOR
        : GOD_COLOR[god];
      const card = el('div', 'card boon-card');
      card.style.setProperty('--accent', rarityColor);
      card.innerHTML = `
        <div class="card-key">${i + 1}</div>
        <div class="card-tag" style="color:${rarityColor};border-color:${rarityColor}">
          ${c.rarity.toUpperCase()}</div>
        <div class="card-god" style="color:${godColor}">${c.godLabel}</div>
        <div class="card-name">${c.name}</div>
        <div class="card-desc">${c.desc}</div>`;
      card.onclick = () => this.pickBoon(c);
      row.append(card);
    });
    panel.append(row);
    if (!this.legendaryMode) {
      panel.append(this.rerollButton(() => {
        this.currentBoons = this.g.genBoonChoices(god);
        this.renderBoon();
      }));
    }
    this.boon.append(panel);
  }

  private pickBoon(c: BoonChoice): void {
    this.g.applyBoonChoice(c);
    this.boon.classList.remove('visible');
    this.setMode('none');
    if (!this.legendaryMode) this.g.afterBoonPicked();
    this.legendaryMode = false;
    this.g.maybeOpenLevelUp();
    this.refreshBuild();
  }

  private rerollButton(onReroll: () => void): HTMLElement {
    const g = this.g;
    const cost = g.rerollCost();
    const label = cost === null
      ? `REROLL (${g.freeRerolls} free) — R`
      : `REROLL · ◈${cost} — R`;
    const btn = el('button', 'btn reroll', label) as HTMLButtonElement;
    btn.disabled = cost !== null && g.gold < cost;
    btn.onclick = () => {
      if (g.payReroll()) {
        g.audio.play('ui');
        onReroll();
      }
    };
    return btn;
  }

  // ------------------------------------------------------------------
  // Charon's shop
  // ------------------------------------------------------------------

  private openShop(): void {
    this.setMode('shop');
    this.renderShop();
    this.shop.classList.add('visible');
  }

  private renderShop(): void {
    const g = this.g;
    this.shop.innerHTML = '';
    const panel = el('div', 'choice-wrap');
    const title = el('h2', 'choice-title god', 'CHARON’S WARES');
    title.style.color = '#9b5de5';
    panel.append(title,
      el('p', 'choice-sub', `the boatman accepts gold · you carry ◈ ${fmt(g.gold)}`));
    const row = el('div', 'cards');
    for (const item of g.shopItems) {
      const card = el('div', `card shop-card ${item.bought ? 'bought' : ''}`);
      card.style.setProperty('--accent', item.color);
      card.innerHTML = `
        <div class="card-icon" style="color:${item.color}">${item.icon}</div>
        <div class="card-name">${item.name}</div>
        <div class="card-desc">${item.desc}</div>
        <div class="card-cost ${g.gold < item.cost && !item.bought ? 'poor' : ''}">
          ${item.bought ? 'SOLD' : `◈ ${item.cost}`}</div>`;
      if (!item.bought) {
        card.onclick = () => {
          if (g.buyShopItem(item)) this.renderShop();
        };
      }
      row.append(card);
    }
    panel.append(row);
    const leave = el('button', 'btn reroll', 'LEAVE — ESC');
    leave.onclick = () => this.leaveShop();
    panel.append(leave);
    this.shop.append(panel);
  }

  private leaveShop(): void {
    this.shop.classList.remove('visible');
    this.setMode('none');
    this.g.leaveShop();
    this.g.maybeOpenLevelUp();
  }

  // ------------------------------------------------------------------
  // Pom of Power
  // ------------------------------------------------------------------

  private openPom(): void {
    this.setMode('pom');
    this.currentPoms = this.g.genPomChoices();
    this.renderPom();
    this.pom.classList.add('visible');
  }

  private renderPom(): void {
    this.pom.innerHTML = '';
    const panel = el('div', 'choice-wrap');
    const title = el('h2', 'choice-title', 'POM OF POWER');
    panel.append(title, el('p', 'choice-sub', 'empower one of your boons'));
    const row = el('div', 'cards');
    this.currentPoms.forEach((c, i) => {
      const toColor = RARITY_COLOR[c.to];
      const card = el('div', 'card boon-card');
      card.style.setProperty('--accent', toColor);
      card.innerHTML = `
        <div class="card-key">${i + 1}</div>
        <div class="card-god" style="color:${GOD_COLOR[c.god]}">${GOD_NAME[c.god]}</div>
        <div class="card-name">${c.name}</div>
        <div class="card-desc">
          <span style="color:${RARITY_COLOR[c.from]}">${c.from.toUpperCase()}</span>
          &nbsp;→&nbsp;
          <span style="color:${toColor}">${c.to.toUpperCase()}</span>
        </div>`;
      card.onclick = () => this.pickPom(c);
      row.append(card);
    });
    panel.append(row);
    this.pom.append(panel);
  }

  private pickPom(c: PomChoice): void {
    this.pom.classList.remove('visible');
    this.setMode('none');
    this.g.applyPom(c);
    this.refreshBuild();
  }

  // ------------------------------------------------------------------
  // Pause / End / Build
  // ------------------------------------------------------------------

  togglePause(): void {
    if (this.g.state !== 'run') return;
    if (this.mode === 'pause') {
      this.pause.classList.remove('visible');
      this.settings.classList.remove('visible');
      this.setMode('none');
    } else if (this.mode === 'none') {
      this.setMode('pause');
      this.pause.classList.add('visible');
    }
  }

  private openEnd(win: boolean): void {
    this.setMode('end');
    const g = this.g;
    this.endScreen.innerHTML = '';
    const panel = el('div', 'panel end');
    panel.append(el('h2', `end-title ${win ? 'win' : 'lose'}`, win ? 'ASCENDED' : 'SLAIN'));
    panel.append(el('p', 'end-sub', win
      ? 'The final gates fall. The gods take notice.'
      : `The underworld keeps you — chamber ${g.chamber}.`));
    const t = g.totals;
    panel.append(el('div', 'end-stats', `
      <div><span>${fmt(t.kills)}</span>kills</div>
      <div><span>${fmt(t.damageDealt)}</span>damage dealt</div>
      <div><span>${fmt(t.peakHit)}</span>biggest hit</div>
      <div><span>${fmt(t.goldEarned)}</span>gold earned</div>
      <div class="ichor"><span>⬥ ${fmt(t.ichorEarned)}</span>ichor banked</div>
      <div><span>LV ${g.level}</span>final level</div>
    `));
    if (g.lastUnlocks.length > 0) {
      panel.append(el('div', 'unlock-banner',
        `⚔ NEW WEAPON${g.lastUnlocks.length > 1 ? 'S' : ''} UNLOCKED: <b>${g.lastUnlocks.join(', ')}</b>`));
    }
    if (win) {
      const descend = el('button', 'btn primary', 'DESCEND DEEPER — ENDLESS');
      descend.onclick = () => {
        this.setMode('none');
        this.endScreen.classList.remove('visible');
        this.g.continueEndless();
      };
      panel.append(descend);
    } else {
      panel.append(el('p', 'end-hint', 'Spend ichor in the Mirror of Hubris to grow stronger.'));
    }
    const btn = el('button', `btn ${win ? '' : 'primary'}`, 'RETURN TO SANCTUM');
    btn.onclick = () => {
      this.setMode('none');
      this.endScreen.classList.remove('visible');
      this.g.finishToMenu();
    };
    panel.append(btn);
    this.endScreen.append(panel);
    this.endScreen.classList.add('visible');
  }

  toggleBuild(): void {
    if (this.g.state !== 'run') return;
    this.buildOpen = !this.buildOpen;
    if (this.buildOpen) {
      this.refreshBuild();
      this.build.classList.add('visible');
    } else {
      this.build.classList.remove('visible');
    }
  }

  refreshBuild(): void {
    if (!this.buildOpen) return;
    const g = this.g;
    const s = g.stats;
    const strikeMult = g.damageMult('strike', false);
    const autoMult = g.damageMult('auto', false);
    const rows = (pairs: [string, string][]) =>
      pairs.map(([k, v]) => `<div class="bp-row"><span>${k}</span><b>${v}</b></div>`).join('');
    const weapons = g.weapons.map((w) => {
      const d = weaponDef(w.id);
      const star = w.level >= WEAPON_MAX_LEVEL ? ' ★' : '';
      return `<div class="bp-row"><span style="color:${d.color}">${d.icon} ${d.name}</span><b>Lv ${w.level}${star}</b></div>`;
    }).join('') || '<div class="bp-none">none yet</div>';
    const tomes = Object.entries(g.tomes).map(([id, lvl]) => {
      const d = tomeDef(id);
      return `<div class="bp-row"><span style="color:${d.color}">${d.icon} ${d.name}</span><b>${lvl}</b></div>`;
    }).join('') || '<div class="bp-none">none yet</div>';
    const boons = g.boons.map((b) => {
      const d = boonDef(b.id);
      const col = d.duo ? '#f0c75e' : GOD_COLOR[d.god];
      const tag = d.duo ? 'DUO' : b.rarity;
      return `<div class="bp-row"><span style="color:${col}">${d.name}</span><b style="color:${d.duo ? '#f0c75e' : RARITY_COLOR[b.rarity]}">${tag}</b></div>`;
    }).join('') || '<div class="bp-none">none yet</div>';
    const fates = g.fates.map((f) =>
      `<div class="bp-row"><span style="color:${FATE_COLOR[f.polarity]}">✺ ${f.name}</span><b>${f.desc}</b></div>`,
    ).join('');

    const cd = characterDef(g.character);
    this.build.innerHTML = `
      <h3>BUILD</h3>
      <div class="bp-row"><span style="color:${cd.color}">${cd.glyph} ${cd.name}</span><b>${cd.weapon}</b></div>
      <div class="bp-mult">strike ${fmtMult(strikeMult)} · auto ${fmtMult(autoMult)}</div>
      <div class="bp-section">STATS</div>
      ${rows([
        ['Might', `+${Math.round(s.might * 100)}%`],
        ['Strike dmg', `+${Math.round(s.strikePct * 100)}%`],
        ['Auto dmg', `+${Math.round(s.autoPct * 100)}%`],
        ['Frenzy', `+${Math.round(g.frenzyBonus() * 100)}%`],
        ['Crit', `${Math.round(s.critChance * 100)}% ×${s.critMult}`],
        ['Attack speed', `+${Math.round(s.atkSpeed * 100)}%`],
        ['Move speed', `+${Math.round(s.moveSpeed * 100)}%`],
        ['XP gain', `+${Math.round(s.xpGain * 100)}%`],
        ['Gold gain', `+${Math.round(s.goldGain * 100)}%`],
        ['Luck', `${s.luck}`],
      ])}
      <div class="bp-section">WEAPONS ${g.weapons.length}/5</div>${weapons}
      <div class="bp-section">TOMES</div>${tomes}
      <div class="bp-section">BOONS</div>${boons}
      ${fates ? `<div class="bp-section">FATES</div>${fates}` : ''}`;
  }

  // ------------------------------------------------------------------
  // Toasts & keys
  // ------------------------------------------------------------------

  showToast(text: string, color = '#eef2ff'): void {
    const t = el('div', 'toast', text);
    t.style.borderColor = color;
    t.style.color = color;
    this.toasts.append(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild?.remove();
    setTimeout(() => t.remove(), 2400);
  }

  private hideAll(): void {
    for (const s of [this.menu, this.charSelect, this.mirror, this.unlocks, this.pact,
      this.settings, this.howto, this.levelup, this.boon, this.shop, this.pom,
      this.pause, this.endScreen]) {
      s.classList.remove('visible');
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'Escape') {
      if (this.howto.classList.contains('visible')) {
        this.howto.classList.remove('visible');
        return;
      }
      if (this.settings.classList.contains('visible')) {
        this.settings.classList.remove('visible');
        if (this.g.state === 'menu') this.syncMenus();
        return;
      }
      if (this.mode === 'shop') {
        this.leaveShop();
        return;
      }
      if (this.charSelect.classList.contains('visible')) {
        this.charSelect.classList.remove('visible');
        this.syncMenus();
        return;
      }
      if (this.mode === 'none' || this.mode === 'pause') this.togglePause();
      return;
    }
    if (e.code === 'Tab') {
      e.preventDefault();
      this.toggleBuild();
      return;
    }
    // Character select: 1/2/3 pick directly
    if (this.charSelect.classList.contains('visible')) {
      const idx = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
      if (idx >= 0 && CHARACTERS[idx]) {
        this.g.audio.play('ui');
        this.hideAll();
        this.g.startRun(CHARACTERS[idx].id);
      }
      return;
    }
    if (this.mode === 'levelup' || this.mode === 'boon' || this.mode === 'pom') {
      // Digit4 serves the Council of Gods' extra boon offering
      const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (idx >= 0) {
        if (this.mode === 'levelup' && this.currentChoices[idx]) this.pickLevelChoice(this.currentChoices[idx]);
        else if (this.mode === 'boon' && this.currentBoons[idx]) this.pickBoon(this.currentBoons[idx]);
        else if (this.mode === 'pom' && this.currentPoms[idx]) this.pickPom(this.currentPoms[idx]);
      } else if (e.code === 'KeyR' && this.mode !== 'pom') {
        this.doReroll();
      }
    }
  }

  private doReroll(): void {
    if (this.mode !== 'levelup' && this.mode !== 'boon') return;
    if (this.g.payReroll()) {
      this.g.audio.play('ui');
      if (this.mode === 'levelup') {
        this.currentChoices = this.g.genLevelChoices(3);
        this.renderLevelUp();
      } else {
        this.currentBoons = this.g.genBoonChoices(this.currentGod);
        this.renderBoon();
      }
    }
  }
}
