/**
 * All audio is synthesized with WebAudio — no asset files.
 * SFX are short envelope-shaped oscillator/noise hits; music is a small
 * generative system in D minor with three moods (calm / combat / boss) and
 * per-biome chord progressions. Volumes come from user settings.
 */
import { choice, rand } from './math';
import type { Settings } from '../game/meta';

type SfxName =
  | 'hit' | 'crit' | 'dash' | 'pickup' | 'gold' | 'levelup' | 'boon' | 'hurt'
  | 'enemyDie' | 'door' | 'bolt' | 'nova' | 'bossRoar' | 'defiance' | 'ui'
  | 'transcend' | 'ichor' | 'unlock' | 'buy'
  | 'hexCast' | 'slam' | 'blink';

const THROTTLE_MS: Partial<Record<SfxName, number>> = {
  hit: 45, enemyDie: 40, pickup: 30, bolt: 70, hurt: 120, gold: 40,
  hexCast: 90, slam: 110, blink: 70,
};

export type MusicMood = 'calm' | 'combat' | 'boss';

// Chord voicings (Hz)
const DM = [146.83, 174.61, 220.0];        // D F A
const BB = [116.54, 146.83, 174.61];       // Bb D F
const F = [174.61, 220.0, 261.63];         // F A C
const C = [130.81, 164.81, 196.0];         // C E G
const GM = [98.0, 116.54, 146.83];         // G Bb D
const A = [110.0, 138.59, 164.81];         // A C# E

const PROGRESSIONS: Record<string, number[][]> = {
  hollows: [DM, BB, F, C],
  ember: [DM, GM, BB, A],
  boss: [DM, DM, BB, A],
};

export class AudioSys {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private lastPlayed = new Map<SfxName, number>();
  private musicTimer: number | null = null;
  private nextBarTime = 0;
  private barIndex = 0;
  private settings: Settings = {
    master: 0.8, music: 0.6, sfx: 0.9, shake: 1, dmgNumbers: 'full',
    autoAim: false, autoFire: false, hudSize: 'default', devMode: false,
  };
  private ducked = false;
  mood: MusicMood = 'calm';
  biome = 0;
  muted = false;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    // 1s of white noise, reused by every noise-based sound
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startMusic();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolumes();
  }

  setSettings(s: Settings): void {
    this.settings = s;
    this.applyVolumes();
  }

  /** Lower music while choice overlays are up. */
  setDucked(d: boolean): void {
    this.ducked = d;
    if (this.ctx) {
      const target = this.musicGain();
      this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
      this.musicBus.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 0.25);
    }
  }

  setScene(mood: MusicMood, biome: number): void {
    this.mood = mood;
    this.biome = biome;
  }

  private musicGain(): number {
    return 0.5 * this.settings.music * (this.ducked ? 0.3 : 1);
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.muted ? 0 : 0.55 * this.settings.master;
    this.sfxBus.gain.value = 0.9 * this.settings.sfx;
    this.musicBus.gain.value = this.musicGain();
  }

  // ---------------- SFX primitives ----------------

  private tone(
    freq: number, dur: number, type: OscillatorType, vol: number,
    slideTo?: number, delay = 0,
  ): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, filterFreq: number, filterType: BiquadFilterType = 'lowpass', delay = 0): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, rand(0.8));
    src.stop(t + dur + 0.02);
  }

  play(name: SfxName): void {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    const throttle = THROTTLE_MS[name];
    if (throttle) {
      const last = this.lastPlayed.get(name) ?? -1e9;
      if (now - last < throttle) return;
      this.lastPlayed.set(name, now);
    }
    switch (name) {
      case 'hit':
        this.tone(rand(170, 210), 0.07, 'square', 0.12, 90);
        break;
      case 'crit':
        this.tone(340, 0.1, 'square', 0.16, 140);
        this.noise(0.08, 0.1, 3200, 'highpass');
        break;
      case 'dash':
        this.noise(0.16, 0.14, 1200, 'bandpass');
        break;
      case 'pickup':
        this.tone(rand(620, 700), 0.07, 'sine', 0.09, 990);
        break;
      case 'gold':
        this.tone(880, 0.05, 'triangle', 0.08, 1320);
        this.tone(1320, 0.06, 'triangle', 0.06, 1760, 0.03);
        break;
      case 'buy':
        this.tone(660, 0.08, 'triangle', 0.1, 880);
        this.tone(990, 0.12, 'triangle', 0.08, 1320, 0.06);
        break;
      case 'levelup':
        [523, 659, 784].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.12, undefined, i * 0.07));
        break;
      case 'boon':
        [294, 440, 587, 880].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.09, undefined, i * 0.09));
        this.noise(0.6, 0.03, 5000, 'highpass');
        break;
      case 'transcend':
        [294, 370, 440, 587, 740, 880].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.1, undefined, i * 0.06));
        break;
      case 'unlock':
        [392, 494, 587, 784, 988].forEach((f, i) => this.tone(f, 0.45, 'triangle', 0.11, undefined, i * 0.09));
        break;
      case 'hurt':
        this.tone(110, 0.18, 'sawtooth', 0.2, 55);
        this.noise(0.12, 0.15, 700);
        break;
      case 'enemyDie':
        this.noise(0.1, 0.1, rand(900, 1400), 'bandpass');
        break;
      case 'door':
        this.tone(140, 0.5, 'sine', 0.14, 70);
        this.noise(0.5, 0.06, 500);
        break;
      case 'bolt':
        this.noise(0.09, 0.16, 4500, 'highpass');
        this.tone(rand(700, 900), 0.07, 'sawtooth', 0.06, 200);
        break;
      case 'nova':
        this.tone(220, 0.25, 'sine', 0.12, 60);
        this.noise(0.2, 0.07, 900);
        break;
      case 'bossRoar':
        this.tone(80, 0.9, 'sawtooth', 0.22, 45);
        this.noise(0.8, 0.12, 400);
        break;
      case 'defiance':
        [880, 660, 880, 1174].forEach((f, i) => this.tone(f, 0.3, 'sine', 0.12, undefined, i * 0.08));
        break;
      case 'ichor':
        this.tone(392, 0.2, 'sine', 0.1, 784);
        this.tone(784, 0.25, 'sine', 0.07, 1568, 0.08);
        break;
      case 'ui':
        this.tone(440, 0.05, 'sine', 0.06, 520);
        break;
      case 'hexCast':
        // Eerie warble: two detuned voices sliding down an octave
        this.tone(520, 0.32, 'sine', 0.09, 260);
        this.tone(526, 0.3, 'triangle', 0.06, 264, 0.02);
        break;
      case 'slam':
        // Ground-shaking thud: deep saw drop under a dirt burst
        this.tone(95, 0.32, 'sawtooth', 0.22, 38);
        this.noise(0.24, 0.16, 320);
        break;
      case 'blink':
        // Teleport zip: fast rising whistle with a sparkle tail
        this.tone(680, 0.13, 'sine', 0.1, 1700);
        this.noise(0.1, 0.05, 6000, 'highpass');
        break;
    }
  }

  // ---------------- Generative music ----------------

  private startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    this.nextBarTime = this.ctx.currentTime + 0.1;
    this.barIndex = 0;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 250);
  }

  private bpm(): number {
    return this.mood === 'boss' ? 122 : this.mood === 'combat' ? 96 : 84;
  }

  private progression(): number[][] {
    if (this.mood === 'boss') return PROGRESSIONS.boss;
    return this.biome === 1 ? PROGRESSIONS.ember : PROGRESSIONS.hollows;
  }

  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) {
      if (ctx && this.muted) this.nextBarTime = ctx.currentTime + 0.1;
      return;
    }
    const beat = 60 / this.bpm();
    const barLen = beat * 4;
    if (this.nextBarTime < ctx.currentTime - 0.5) {
      // Timer was throttled (hidden tab) — resync instead of burst-scheduling
      this.nextBarTime = ctx.currentTime + 0.05;
    }
    while (this.nextBarTime < ctx.currentTime + barLen) {
      this.scheduleBar(this.nextBarTime, this.barIndex, beat);
      this.nextBarTime += barLen;
      this.barIndex++;
    }
  }

  private mtone(
    freq: number, start: number, dur: number, type: OscillatorType, vol: number, detune = 0,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + Math.min(0.05, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(this.musicBus);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  private hat(tt: number, vol: number): void {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx!.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 8000;
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(vol, tt);
    g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.05);
    src.connect(f).connect(g).connect(this.musicBus);
    src.start(tt, rand(0.8));
    src.stop(tt + 0.08);
  }

  private scheduleBar(t0: number, bar: number, beat: number): void {
    const mood = this.mood;
    const prog = this.progression();
    const chord = prog[bar % prog.length];
    const root = chord[0];
    const padVol = mood === 'calm' ? 0.014 : 0.018;
    const arpSkip = mood === 'boss' ? 0.18 : mood === 'combat' ? 0.35 : 0.6;

    // Pad: two detuned saws + sine, whole bar
    this.mtone(chord[0], t0, beat * 4, 'sawtooth', padVol, -6);
    this.mtone(chord[1], t0, beat * 4, 'sawtooth', padVol * 0.8, 6);
    this.mtone(chord[2], t0, beat * 4, 'sine', padVol * 1.1);

    // Bass: root on beats 1 & 3; boss adds a low pounding sub on every beat
    this.mtone(root / 2, t0, beat * 0.9, 'triangle', 0.09);
    this.mtone(root / 2, t0 + beat * 2, beat * 0.9, 'triangle', 0.07);
    if (mood === 'boss') {
      for (let i = 0; i < 4; i++) {
        this.mtone(root / 4, t0 + i * beat, beat * 0.5, 'sawtooth', 0.05);
      }
    }

    // Arpeggio: 8th notes over chord tones
    for (let i = 0; i < 8; i++) {
      if (Math.random() < arpSkip) continue;
      const f = choice(chord) * choice([2, 2, 4]);
      this.mtone(f, t0 + i * beat * 0.5, beat * 0.45, 'triangle', mood === 'boss' ? 0.034 : 0.028);
    }

    // Hats: off-beats in combat, 8ths in boss, none when calm
    if (this.noiseBuf && mood !== 'calm') {
      const n = mood === 'boss' ? 8 : 4;
      for (let i = 0; i < n; i++) {
        const tt = mood === 'boss' ? t0 + i * beat * 0.5 : t0 + (i + 0.5) * beat;
        this.hat(tt, mood === 'boss' ? 0.03 : 0.025);
      }
    }
  }
}
