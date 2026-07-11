import { Input } from './engine/input';
import { AudioSys } from './engine/audio';
import { Game } from './game/game';
import { render } from './game/render';
import { UIManager } from './ui/overlays';
import { DevPanel } from './ui/devpanel';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const input = new Input(document.body, canvas);
const audio = new AudioSys();
const game = new Game(input, audio);
const ui = new UIManager(game);
const devPanel = new DevPanel(game, ui);

// Touch devices: default the accessibility assists ON for fresh saves —
// twin-stick-with-assists is the intended mobile experience.
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (isTouchDevice && game.save.runs === 0
  && !game.save.settings.autoAim && !game.save.settings.autoFire) {
  game.save.settings.autoAim = true;
  game.save.settings.autoFire = true;
  game.applySettings();
}

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Fall back to a sane default when layout hasn't happened yet (hidden tabs
  // can report 0x0 until first paint).
  const w = window.innerWidth || 1280;
  const h = window.innerHeight || 720;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  game.cam.viewW = w;
  game.cam.viewH = h;
  input.viewW = w;
  input.dashBtnX = w - 84;
  input.dashBtnY = h - 130;
}
window.addEventListener('resize', resize);
resize();

// WebAudio needs a user gesture before it can start
const unlock = (): void => {
  audio.unlock();
  audio.setMuted(game.save.muted);
};
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });

// Pause when the tab is hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'run' && !game.overlayOpen) {
    ui.togglePause();
  }
});

// Fixed-timestep loop with render interpolation left out on purpose:
// at 60 steps/sec the sim is smooth enough and stays deterministic.
const STEP = 1 / 60;
let last = performance.now();
let acc = 0;
let buildRefreshT = 0;
let padWasConnected = false;

function frame(now: number): void {
  const elapsed = Math.min(0.25, (now - last) / 1000);
  last = now;

  // Catch late layout: keep canvas in sync with the real viewport
  if (window.innerWidth && (window.innerWidth !== game.cam.viewW || window.innerHeight !== game.cam.viewH)) {
    resize();
  }

  input.pollGamepad();
  if (input.padConnected !== padWasConnected) {
    padWasConnected = input.padConnected;
    ui.showToast(
      input.padConnected ? '🎮 Controller connected' : 'Controller disconnected',
      input.padConnected ? '#7bf1a8' : '#8a93b8',
    );
  }
  if (input.pressed('PadStart')) ui.togglePause();
  if (input.pressed('Backquote') && game.save.settings.devMode) devPanel.toggle();
  ui.updatePad();
  devPanel.tick();

  if (game.state === 'run' && !game.overlayOpen && !game.devPaused) {
    acc += elapsed * game.devTimeScale;
    // Faster dev time scales need more catch-up steps per frame
    const maxSteps = Math.max(5, Math.ceil(game.devTimeScale * 5));
    let steps = 0;
    while (acc >= STEP && steps < maxSteps) {
      game.update(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === maxSteps) acc = 0; // dropped frames: don't spiral
  } else {
    acc = 0;
  }

  render(game, ctx);

  // Keep the build panel live while it's open
  if (ui.buildOpen) {
    buildRefreshT += elapsed;
    if (buildRefreshT > 0.5) {
      buildRefreshT = 0;
      ui.refreshBuild();
    }
  }

  input.endFrame();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Debug/test hooks: lets tooling step the simulation deterministically
// (e.g. when rAF is throttled in hidden tabs). No effect on normal play.
declare global {
  interface Window { __game: Game; __ui: UIManager; __step: (n: number) => void }
}
window.__game = game;
window.__ui = ui;
window.__step = (n: number) => {
  for (let i = 0; i < n; i++) {
    if (game.state === 'run' && !game.overlayOpen) game.update(STEP);
    input.endFrame();
  }
  render(game, ctx);
};
