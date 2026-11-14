// Everything you hear is synthesized: effects are one-shot oscillator and noise
// voices, the soundtrack is a small step sequencer. No AudioContext exists until
// a user gesture calls unlock().
const MAX_VOICES = 40;
const midi = note => 440 * 2 ** ((note - 69) / 12);

// Four-bar loops. Each chord is [root, third, fifth] as MIDI notes.
const SONGS = [
  { bpm: 112, chords: [[45, 48, 52], [41, 45, 48], [48, 52, 55], [43, 47, 50]] },   // Am F C G
  { bpm: 120, chords: [[50, 53, 57], [46, 50, 53], [41, 45, 48], [48, 52, 55]] },   // Dm Bb F C
  { bpm: 128, chords: [[52, 55, 59], [48, 52, 55], [50, 54, 57], [47, 50, 54]] },   // Em C D Bm
];
const ARP = [0, 1, 2, 1, 3, 2, 1, 2, 0, 2, 1, 3, 2, 1, 2, 1];   // indices into root, third, fifth, octave

export class AudioEngine {
  constructor({ sfx = 0.8, music = 0.55, muted = false } = {}) {
    this.context = null;
    this.voices = 0;
    this.lastPlayed = new Map();
    this.volume = { sfx, music };
    this.muted = muted;
    this.scene = { mode: 'off', sector: 0 };
    this.step = 0;
    this.nextStep = 0;
  }

  unlock() {
    try {
      if (!this.context) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return;
        const ctx = this.context = new Context();
        this.limiter = ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -14;
        this.limiter.ratio.value = 6;
        this.master = ctx.createGain();
        this.sfxBus = ctx.createGain();
        this.musicBus = ctx.createGain();
        this.echo = ctx.createDelay(1);
        this.echo.delayTime.value = 0.32;
        this.echoFeedback = ctx.createGain();
        this.echoFeedback.gain.value = 0.34;
        this.echo.connect(this.echoFeedback).connect(this.echo);
        this.echo.connect(this.musicBus);
        this.sfxBus.connect(this.master);
        this.musicBus.connect(this.master);
        this.master.connect(this.limiter).connect(ctx.destination);
        this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        this.applyVolume(0);
      }
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    } catch {
      // A missing or blocked audio device must never stop gameplay.
      this.context = null;
    }
  }

  get ready() { return Boolean(this.context) && this.context.state === 'running'; }

  applyVolume(glide = 0.03) {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, now, glide || 0.001);
    this.sfxBus.gain.setTargetAtTime(this.volume.sfx, now, glide || 0.001);
    this.musicBus.gain.setTargetAtTime(this.volume.music * 0.55, now, glide || 0.001);
  }

  setVolume(kind, value) {
    this.volume[kind] = Math.max(0, Math.min(1, value));
    this.applyVolume();
  }

  setMuted(value) {
    this.muted = Boolean(value);
    this.applyVolume();
    return this.muted;
  }

  // ───────────────────────────── Voices ─────────────────────────────

  envelope(source, output, bus, start, duration, volume, attack = 0.006) {
    const ctx = this.context;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0002), start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    output.connect(gain);
    gain.connect(bus);
    this.voices++;
    source.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      source.disconnect();
      if (output !== source) output.disconnect();
      gain.disconnect();
    };
    source.start(start);
    source.stop(start + duration + 0.02);
    return gain;
  }

  tone(from, to, duration, type, volume, delay = 0, bus = this.sfxBus) {
    if (this.voices >= MAX_VOICES) return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(to, 1), start + duration);
    this.envelope(oscillator, oscillator, bus, start, duration, volume);
  }

  noise(duration, volume, from, to = from, type = 'lowpass', delay = 0, bus = this.sfxBus) {
    if (this.voices >= MAX_VOICES) return;
    const start = this.context.currentTime + delay;
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = this.context.createBiquadFilter();
    filter.type = type;
    filter.Q.value = type === 'bandpass' ? 1.4 : 0.7;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(to, 20), start + duration);
    source.connect(filter);
    this.envelope(source, filter, bus, start, duration, volume);
  }

  // ───────────────────────────── Effects ─────────────────────────────

  play(name, data = {}) {
    if (!this.ready || this.muted) return;
    const now = this.context.currentTime;
    const cooldown = { shoot: 0.075, explode: 0.05, graze: 0.045, convert: 0.022, mote: 0.06, spark: 0.2, bounce: 0.08 }[name] ?? 0.02;
    if (now - (this.lastPlayed.get(name) ?? -Infinity) < cooldown) return;
    this.lastPlayed.set(name, now);

    switch (name) {
      case 'shoot':
        this.tone(1120, 620, 0.055, 'triangle', 0.075);
        break;
      case 'graze':
        this.tone(2500, 3300, 0.035, 'sine', 0.11);
        break;
      case 'convert': {
        // Each converted bullet climbs a semitone: a drift through a wall sings.
        const pitch = 660 * 2 ** (Math.min(data.count ?? 1, 26) / 12);
        this.tone(pitch, pitch * 1.01, 0.12, 'triangle', 0.16);
        break;
      }
      case 'mote':
        this.tone(1760, 2100, 0.03, 'sine', 0.05);
        break;
      case 'drift':
        this.noise(0.28, 0.42, 500, 4200, 'bandpass');
        this.tone(220, 990, 0.24, 'sawtooth', 0.12);
        break;
      case 'driftEnd':
        if (data.clean) [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this.tone(f, f, 0.22, 'triangle', 0.2, i * 0.045));
        break;
      case 'flux':
        this.tone(660, 990, 0.12, 'sine', 0.2);
        this.tone(990, 1320, 0.16, 'triangle', 0.16, 0.07);
        break;
      case 'overdrive':
        this.tone(220, 1760, 0.5, 'sawtooth', 0.12);
        [880, 1108.7, 1318.5, 1760].forEach((f, i) => this.tone(f, f, 0.3, 'triangle', 0.18, 0.1 + i * 0.06));
        break;
      case 'hit':
        this.noise(0.3, 0.6, 900, 120);
        this.tone(220, 48, 0.32, 'sawtooth', 0.3);
        break;
      case 'shield':
        this.noise(0.25, 0.3, 6000, 1200, 'bandpass');
        this.tone(1320, 330, 0.3, 'triangle', 0.22);
        break;
      case 'explode': {
        const big = (data.size ?? 14) > 19;
        this.noise(big ? 0.34 : 0.17, big ? 0.36 : 0.24, big ? 1600 : 1900, 180);
        this.tone(big ? 130 : 170, 36, big ? 0.3 : 0.17, 'triangle', big ? 0.3 : 0.18);
        break;
      }
      case 'bomb':
        this.noise(0.9, 0.6, 2400, 90);
        this.tone(360, 36, 0.8, 'sine', 0.5);
        this.tone(1400, 160, 0.5, 'triangle', 0.2);
        break;
      case 'pickup':
        this.tone(880, 1046.5, 0.11, 'sine', 0.24);
        this.tone(1318.5, 1568, 0.18, 'triangle', 0.2, 0.08);
        break;
      case 'phase':
        [0, 0.15, 0.3].forEach((delay, i) => this.tone(294 + i * 110, 294 + i * 110, 0.12, 'square', 0.11, delay));
        this.noise(0.5, 0.2, 300, 3000, 'bandpass');
        break;
      case 'warning':
        for (let i = 0; i < 3; i++) {
          this.tone(466, 466, 0.2, 'square', 0.1, i * 0.5);
          this.tone(349, 349, 0.2, 'square', 0.1, i * 0.5 + 0.24);
        }
        break;
      case 'beamWarn':
        this.tone(320, 1280, 0.7, 'sine', 0.07);
        break;
      case 'beamFire':
        this.noise(0.4, 0.26, 3600, 500, 'bandpass');
        this.tone(1500, 190, 0.36, 'sawtooth', 0.15);
        break;
      case 'bounce':
        this.tone(1900, 1500, 0.04, 'sine', 0.06);
        break;
      case 'bossDown':
        this.noise(1.9, 0.6, 1500, 60);
        this.tone(190, 30, 1.7, 'sawtooth', 0.34);
        this.noise(1.0, 0.5, 5000, 200, 'lowpass', 1.5);
        this.tone(90, 28, 1.1, 'sine', 0.6, 1.5);
        break;
      case 'sectorClear':
      case 'victory':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, f, 0.4, 'triangle', 0.26, 1.7 + i * 0.13));
        if (name === 'victory') [1318.5, 1568, 2093].forEach((f, i) => this.tone(f, f, 0.6, 'triangle', 0.22, 2.3 + i * 0.16));
        break;
      case 'gameover':
        [330, 277.18, 220, 164.81].forEach((f, i) => this.tone(f, f * 0.97, 0.36, 'triangle', 0.24, 0.35 + i * 0.2));
        this.noise(0.9, 0.5, 1800, 80);
        break;
      case 'start':
      case 'sector':
        this.tone(330, 660, 0.16, 'triangle', 0.2);
        this.tone(660, 990, 0.2, 'triangle', 0.2, 0.1);
        break;
      case 'ui':
        this.tone(1320, 1320, 0.04, 'sine', 0.1);
        break;
      default:
        break;
    }
  }

  // ───────────────────────────── Soundtrack ─────────────────────────────

  // mode: 'off' | 'title' | 'stage' | 'boss'
  setScene(mode, sector = 0) {
    if (this.scene.mode === mode && this.scene.sector === sector) return;
    const restart = this.scene.mode === 'off' || this.scene.sector !== sector;
    this.scene = { mode, sector };
    if (restart) { this.step = 0; this.nextStep = 0; }
  }

  // Called every frame: schedules the steps that fall inside a short look-ahead.
  tick() {
    if (!this.ready || this.scene.mode === 'off' || this.volume.music <= 0 || this.muted) { this.nextStep = 0; return; }
    const ctx = this.context;
    const { mode, sector } = this.scene;
    const song = SONGS[sector] ?? SONGS[0];
    const bpm = song.bpm + (mode === 'boss' ? 10 : mode === 'title' ? -22 : 0);
    const stepTime = 60 / bpm / 4;
    if (this.nextStep < ctx.currentTime) this.nextStep = ctx.currentTime + 0.05;
    while (this.nextStep < ctx.currentTime + 0.14) {
      this.sequence(this.step, this.nextStep, stepTime, song, mode);
      this.step = (this.step + 1) % 64;
      this.nextStep += stepTime;
    }
  }

  sequence(step, time, stepTime, song, mode) {
    const bus = this.musicBus;
    const delay = time - this.context.currentTime;
    const beat = step % 16;
    const chord = song.chords[Math.floor(step / 16)];
    const drums = mode !== 'title';
    const boss = mode === 'boss';

    if (beat === 0) {
      // Pad: two detuned saws per chord tone, swelling over the bar.
      for (const note of chord) {
        for (const detune of [-6, 6]) this.pad(midi(note + 12) * 2 ** (detune / 1200), time, stepTime * 16, 0.035);
      }
    }
    if (drums && beat % 4 === 0) {
      this.tone(150, 42, 0.2, 'sine', 0.55, delay, bus);
    }
    if (drums && beat % 8 === 4) {
      this.noise(0.13, 0.2, 1900, 1500, 'bandpass', delay, bus);
    }
    if (drums && (beat % 4 === 2 || (boss && beat % 2 === 1))) {
      this.noise(0.04, beat % 4 === 2 ? 0.1 : 0.05, 8000, 8000, 'highpass', delay, bus);
    }
    if (beat % 2 === 0) {
      const octave = boss && beat % 4 === 2 ? 12 : 0;
      this.pluck(midi(chord[0] - 12 + octave), time, stepTime * 1.7, 'sawtooth', 0.2, 520, bus);
    }
    const order = ARP[beat];
    const note = order === 3 ? chord[0] + 12 : chord[order];
    const high = mode === 'title' ? 12 : 24;
    if (mode !== 'title' || beat % 2 === 0) {
      this.pluck(midi(note + high), time, stepTime * 1.4, boss ? 'square' : 'triangle', boss ? 0.045 : 0.07, 3600, this.echo);
    }
  }

  pluck(frequency, time, duration, type, volume, cutoff, bus) {
    if (this.voices >= MAX_VOICES) return;
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff * 2.2, time);
    filter.frequency.exponentialRampToValueAtTime(cutoff * 0.5, time + duration);
    oscillator.connect(filter);
    this.envelope(oscillator, filter, bus, time, duration, volume, 0.004);
  }

  pad(frequency, time, duration, volume) {
    if (this.voices >= MAX_VOICES) return;
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(frequency, time);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(700, time);
    filter.frequency.linearRampToValueAtTime(1500, time + duration * 0.5);
    filter.frequency.linearRampToValueAtTime(700, time + duration);
    oscillator.connect(filter);
    this.envelope(oscillator, filter, this.musicBus, time, duration * 1.05, volume, duration * 0.3);
  }
}
