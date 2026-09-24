// Procedural sound design (Web Audio, no files). Starts on the first user gesture (browser policy).
// Layers: an airy drone with laptop-audible harmonics, a slow heartbeat (louder in vessel mode),
// a whoosh driven by how fast the eye is being taken apart, hover ticks and a focus chime.
export class Sound {
  constructor() { this.ctx = null; this.enabled = true; this.started = false; this.vessels = 0; this.nextBeat = 0; }

  start() {
    if (this.started) { this.ctx?.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC(); this.started = true;
    const master = this.master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);
    master.gain.linearRampToValueAtTime(this.enabled ? 0.7 : 0, ctx.currentTime + 2.5);

    // Reverb (generated impulse)
    const verb = this.verb = ctx.createConvolver();
    const len = ctx.sampleRate * 3.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    verb.buffer = ir; const verbGain = ctx.createGain(); verbGain.gain.value = 0.42; verb.connect(verbGain).connect(master);
    this.dry = ctx.createGain(); this.dry.gain.value = 1; this.dry.connect(master); this.dry.connect(verb);

    // Drone: fifths around A2 with slow filter breathing (fundamentals + harmonics audible on small speakers)
    const droneBus = this.droneBus = ctx.createGain(); droneBus.gain.value = 0.085;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.6;
    droneBus.connect(lp).connect(this.dry);
    for (const [f, type, g, det] of [[110, 'sawtooth', 0.28, -6], [110, 'sawtooth', 0.28, 7], [165, 'triangle', 0.35, 0], [220, 'sine', 0.3, 3], [330, 'sine', 0.12, -4], [440, 'sine', 0.06, 0]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det;
      const og = ctx.createGain(); og.gain.value = g; o.connect(og).connect(droneBus); o.start();
    }
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lfoG = ctx.createGain(); lfoG.gain.value = 380;
    lfo.connect(lfoG).connect(lp.frequency); lfo.start();

    // Air: filtered noise
    const noise = this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noise.getChannelData(0); let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < nd.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.997 * b0 + w * 0.029591; b1 = 0.985 * b1 + w * 0.032534; b2 = 0.95 * b2 + w * 0.048056; nd[i] = (b0 + b1 + b2 + w * 0.04) * 0.9; }
    const air = ctx.createBufferSource(); air.buffer = noise; air.loop = true;
    const airF = ctx.createBiquadFilter(); airF.type = 'bandpass'; airF.frequency.value = 1400; airF.Q.value = 0.5;
    const airG = ctx.createGain(); airG.gain.value = 0.035; air.connect(airF).connect(airG).connect(this.dry); air.start();

    // Whoosh (explode speed)
    const wsrc = ctx.createBufferSource(); wsrc.buffer = noise; wsrc.loop = true;
    const wf = this.whooshF = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 500; wf.Q.value = 1.1;
    const wg = this.whooshG = ctx.createGain(); wg.gain.value = 0;
    wsrc.connect(wf).connect(wg).connect(this.dry); wsrc.start();

    // Vessel shimmer
    const sh = this.shimmer = ctx.createGain(); sh.gain.value = 0; sh.connect(this.dry);
    for (const f of [880, 1318.5, 1760, 2217]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const t = ctx.createOscillator(); t.frequency.value = 3 + Math.random() * 3; const tg = ctx.createGain(); tg.gain.value = 0.5;
      const og = ctx.createGain(); og.gain.value = 0.012; t.connect(tg).connect(og.gain); o.connect(og).connect(sh); o.start(); t.start();
    }
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.7 : 0, this.ctx.currentTime, 0.25);
  }

  thump(when, gain) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(140, when); o.frequency.exponentialRampToValueAtTime(52, when + 0.16);
    g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(gain, when + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);
    o.connect(g).connect(this.dry); o.start(when); o.stop(when + 0.32);
    // body: short filtered noise so the beat reads on laptop speakers
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuffer; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 210; f.Q.value = 1.4;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, when); ng.gain.exponentialRampToValueAtTime(gain * 0.9, when + 0.01); ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
    n.connect(f).connect(ng).connect(this.dry); n.start(when, Math.random()); n.stop(when + 0.14);
  }

  update(dt, { explodeSpeed = 0, vessels = 0, heartRate = 62 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const sp = Math.min(1, Math.abs(explodeSpeed) * 1.6);
    this.whooshG.gain.setTargetAtTime(sp * 0.22, now, 0.08);
    this.whooshF.frequency.setTargetAtTime(380 + sp * 1600, now, 0.12);
    this.shimmer.gain.setTargetAtTime(vessels * 1.0, now, 0.4);
    this.droneBus.gain.setTargetAtTime(0.085 * (1 - vessels * 0.35), now, 0.5);
    if (now >= this.nextBeat) {
      const g = 0.05 + vessels * 0.3;
      this.thump(now + 0.02, g); this.thump(now + 0.3, g * 0.62);
      this.nextBeat = now + 60 / heartRate;
    }
  }

  tick() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 2400; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.dry); o.start(t); o.stop(t + 0.06);
  }

  chime(index = 0) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const scale = [0, 3, 5, 7, 10, 12, 15, 17];
    const f = 330 * Math.pow(2, scale[index % scale.length] / 12);
    for (const [m, a] of [[1, 0.07], [2.01, 0.025], [3.98, 0.012]]) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f * m;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      o.connect(g).connect(this.dry); o.start(t); o.stop(t + 2.3);
    }
  }

  swell() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime, n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = this.noiseBuffer; f.type = 'lowpass'; f.frequency.setValueAtTime(200, t); f.frequency.exponentialRampToValueAtTime(3000, t + 1.4);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    n.connect(f).connect(g).connect(this.dry); n.start(t); n.stop(t + 2.5);
  }
}
