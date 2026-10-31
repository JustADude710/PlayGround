// Tiny procedural audio engine. No assets, no autoplay: init() must follow a gesture.
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.tension = 0;
    this.ambientOn = false;
    this.dripTimer = null;
    this.pulseTimer = null;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const master = this.master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.42;
    master.connect(ctx.destination);
    this.startAmbience();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.42, this.ctx.currentTime, 0.03);
    }
  }

  setTension(level) {
    this.tension = level;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.42, this.ctx.currentTime, 0.2);
  }

  startAmbience() {
    if (this.ambientOn) return;
    this.ambientOn = true;
    const ctx = this.ctx;
    const bed = ctx.createGain();
    bed.gain.value = 0.11;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    lp.Q.value = 0.7;
    bed.connect(lp).connect(this.master);

    const freqs = [55, 82.5, 110.5];
    for (const f of freqs) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = f === 55 ? 0.9 : 0.32;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.06;
      const lg = ctx.createGain();
      lg.gain.value = 1.5;
      lfo.connect(lg).connect(o.frequency);
      o.connect(g).connect(bed);
      o.start(); lfo.start();
    }

    // Water wash: looping filtered noise.
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.985 + white * 0.015;
      data[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 460;
    bp.Q.value = 0.5;
    const wg = ctx.createGain();
    wg.gain.value = 0.34;
    src.connect(bp).connect(wg).connect(this.master);
    src.start();

    const scheduleDrip = () => {
      if (!this.ctx) return;
      if (!this.muted) this.drip(0.025 + Math.random() * 0.03);
      this.dripTimer = setTimeout(scheduleDrip, 1800 + Math.random() * 4200);
    };
    this.dripTimer = setTimeout(scheduleDrip, 1400);

    // Slow heartbeat under the ambience; rises during the boss fight.
    const pulse = () => {
      if (!this.ctx) return;
      if (!this.muted && this.tension > 0) this.thump(0.05 + this.tension * 0.12);
      this.pulseTimer = setTimeout(pulse, 900);
    };
    this.pulseTimer = setTimeout(pulse, 900);
  }

  drip(vol = 0.04) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1200 + Math.random() * 900, t);
    o.frequency.exponentialRampToValueAtTime(420, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.2);
  }

  thump(vol = 0.1) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(74, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.14);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.28);
  }

  tone(f0, f1, dur, type = 'sine', vol = 0.12, delay = 0) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.03);
  }

  noise(dur = 0.12, freq = 900, q = 0.8, vol = 0.1, delay = 0) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  jump() { this.tone(260, 520, 0.12, 'triangle', 0.1); this.noise(0.05, 1100, 0.7, 0.03); }
  doubleJump() { this.tone(420, 760, 0.14, 'triangle', 0.1); this.noise(0.08, 1500, 0.7, 0.05); }
  dash() { this.noise(0.22, 1700, 0.5, 0.13); this.tone(220, 70, 0.18, 'sawtooth', 0.06); }
  attack() { this.noise(0.1, 800, 0.9, 0.09); this.tone(160, 80, 0.09, 'square', 0.05); }
  hit() { this.tone(180, 70, 0.12, 'sawtooth', 0.12); this.noise(0.1, 500, 1, 0.08); }
  hurt() { this.tone(220, 70, 0.28, 'square', 0.13); this.noise(0.22, 350, 0.6, 0.1); }
  land() { this.noise(0.06, 260, 0.6, 0.04); }
  pickup() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.22, 'triangle', 0.09, i * 0.07));
  }
  checkpoint() { [392, 523, 659].forEach((f, i) => this.tone(f, f, 0.4, 'sine', 0.08, i * 0.09)); }
  death() { [300, 240, 180, 120, 70].forEach((f, i) => this.tone(f, f * 0.9, 0.35, 'sawtooth', 0.08, i * 0.12)); }
  gate() { this.tone(90, 55, 0.2, 'square', 0.1); this.noise(0.12, 220, 0.7, 0.06); }
  roar() {
    this.tone(110, 43, 0.9, 'sawtooth', 0.15);
    this.tone(55, 31, 1.1, 'square', 0.1);
    this.noise(0.7, 260, 0.5, 0.16);
  }
  splash() { this.noise(0.3, 700, 0.4, 0.09); }
  bossHit() { this.tone(130, 48, 0.2, 'square', 0.12); this.noise(0.14, 300, 0.7, 0.1); }
}
