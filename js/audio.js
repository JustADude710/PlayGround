// Tiny procedural sound engine. No assets, everything is synthesized.
export class SumpAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.noise = null;
    this.muted = localStorage.getItem('sumpcity.muted') === '1';
    this.bossMode = false;
    this.step = 0;
    this.nextNote = 0;
    this.timer = null;
    this.started = false;
  }

  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.0;
    this.musicGain.connect(this.master);

    this.noise = this._noiseBuffer(2);
    this._ambient();
    this.started = true;
    this.nextNote = this.ctx.currentTime + 0.4;
    this.timer = setInterval(() => this._schedule(), 120);
  }

  _noiseBuffer(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buf;
  }

  _ambient() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 420;
    filt.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0.11;
    src.connect(filt).connect(g).connect(this.master);
    src.start();

    // low sewer drone
    const drone = ctx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 43;
    const dg = ctx.createGain();
    dg.gain.value = 0.055;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.055;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.025;
    lfo.connect(lfoG).connect(dg.gain);
    drone.connect(dg).connect(this.master);
    drone.start();
    lfo.start();
  }

  setMuted(muted) {
    this.muted = muted;
    localStorage.setItem('sumpcity.muted', muted ? '1' : '0');
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  _env(node, gain, t, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g);
    return g;
  }

  _tone(freq, type, gain, attack, decay, slideTo, dest) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + attack + decay);
    const g = this._env(o, gain, t, attack, decay);
    g.connect(dest || this.master);
    o.start(t);
    o.stop(t + attack + decay + 0.02);
  }

  _noiseBurst(gain, freq, q, decay, type = 'bandpass', slideTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + decay);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + decay + 0.02);
  }

  sfx(name) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'jump': this._tone(210, 'square', 0.06, 0.005, 0.14, 400); break;
      case 'doublejump': this._tone(330, 'triangle', 0.075, 0.005, 0.18, 660); break;
      case 'land': this._noiseBurst(0.04, 220, 1.2, 0.09, 'lowpass'); break;
      case 'swing': this._noiseBurst(0.085, 1800, 1.4, 0.1, 'bandpass', 500); break;
      case 'hit': this._noiseBurst(0.1, 900, 0.8, 0.1, 'bandpass', 240); this._tone(120, 'square', 0.055, 0.004, 0.09, 60); break;
      case 'kill': this._noiseBurst(0.12, 500, 0.7, 0.26, 'lowpass', 120); this._tone(160, 'sawtooth', 0.05, 0.005, 0.3, 40); break;
      case 'hurt': this._tone(190, 'sawtooth', 0.11, 0.005, 0.3, 55); this._noiseBurst(0.08, 300, 0.8, 0.22, 'lowpass'); break;
      case 'dash': this._noiseBurst(0.075, 400, 0.8, 0.22, 'bandpass', 2600); break;
      case 'pickup': [523, 659, 880].forEach((f, i) => setTimeout(() => this._tone(f, 'triangle', 0.08, 0.005, 0.28), i * 70)); break;
      case 'relic': [392, 523, 659, 1046].forEach((f, i) => setTimeout(() => this._tone(f, 'triangle', 0.09, 0.005, 0.5), i * 110)); break;
      case 'save': [523, 784, 1046, 1318].forEach((f, i) => setTimeout(() => this._tone(f, 'sine', 0.07, 0.01, 0.6), i * 90)); break;
      case 'token': this._tone(1046, 'square', 0.04, 0.004, 0.12, 1568); break;
      case 'note': this._noiseBurst(0.05, 3000, 2, 0.12, 'highpass'); break;
      case 'door': this._noiseBurst(0.06, 700, 0.5, 0.45, 'lowpass', 120); break;
      case 'splash': this._noiseBurst(0.12, 900, 0.5, 0.4, 'lowpass', 90); break;
      case 'boss': this._tone(52, 'sawtooth', 0.16, 0.05, 1.2, 30); this._noiseBurst(0.12, 300, 0.6, 1.1, 'lowpass', 60); break;
      case 'roar': this._tone(75, 'sawtooth', 0.13, 0.06, 0.9, 38); this._noiseBurst(0.14, 600, 0.5, 0.8, 'lowpass', 80); break;
      case 'slam': this._tone(64, 'sine', 0.16, 0.005, 0.4, 28); this._noiseBurst(0.14, 280, 0.6, 0.5, 'lowpass'); break;
      case 'death': [330, 277, 220, 165, 110].forEach((f, i) => setTimeout(() => this._tone(f, 'triangle', 0.07, 0.01, 0.5), i * 130)); break;
      case 'menu': this._tone(660, 'square', 0.03, 0.003, 0.05); break;
    }
  }

  startMusic() {
    if (!this.ctx) return;
    this.musicGain.gain.setTargetAtTime(0.45, this.ctx.currentTime, 1.5);
  }

  setBossMode(on) {
    this.bossMode = on;
    if (this.ctx) this.musicGain.gain.setTargetAtTime(on ? 0.6 : 0.45, this.ctx.currentTime, 0.6);
  }

  _schedule() {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    while (this.nextNote < now + 0.35) {
      this._musicStep(this.nextNote);
      this.nextNote += this.bossMode ? 0.26 : 0.42;
      this.step++;
    }
  }

  _musicStep(t) {
    const scale = [110, 130.81, 146.83, 164.81, 196, 220, 261.63, 293.66];
    const bass = [55, 55, 65.41, 49];
    const step = this.step;
    const g = this.musicGain;
    const play = (freq, type, gain, dur, delay = 0) => {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const e = this.ctx.createGain();
      e.gain.setValueAtTime(0.0001, t + delay);
      e.gain.exponentialRampToValueAtTime(gain, t + delay + 0.02);
      e.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      o.connect(e).connect(g);
      o.start(t + delay);
      o.stop(t + delay + dur + 0.05);
    };
    if (step % 4 === 0) play(bass[(step / 4) % bass.length | 0], 'triangle', 0.16, this.bossMode ? 0.4 : 0.9);
    if (step % 8 === 0) play(scale[0], 'sine', 0.06, 2.2);
    if (this.bossMode) {
      if (step % 2 === 0) play(scale[(step * 3) % scale.length] * 2, 'square', 0.018, 0.16);
      if (step % 4 === 2) play(scale[(step * 5) % scale.length], 'sawtooth', 0.022, 0.3);
    } else {
      if (step % 4 === 2) play(scale[(step * 3 + 2) % scale.length] * 2, 'triangle', 0.026, 0.55);
      if (step % 16 === 6) play(scale[4] * 4, 'sine', 0.02, 1.8);
    }
  }
}
