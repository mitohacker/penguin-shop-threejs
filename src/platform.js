const KEY = 'penguin-threejs-save-v1';
const BACKUP = KEY + '-backup';

export class Platform {
  constructor() { this.sdk = null; this.playing = false; this.error = null; }
  async init() {
    const requested = new URLSearchParams(location.search).get('platform') === 'crazygames';
    if (!requested && !/(^|\.)crazygames\.com$/.test(location.hostname)) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'https://sdk.crazygames.com/crazygames-sdk-v3.js'; script.onload = resolve; script.onerror = () => reject(new Error('CrazyGames SDK could not load.')); document.head.append(script);
    });
    await window.CrazyGames.SDK.init();
    if (window.CrazyGames.SDK.environment !== 'disabled') this.sdk = window.CrazyGames.SDK;
    this.sdk?.game.loadingStart();
  }
  loaded() { this.sdk?.game.loadingStop(); }
  start() { if (!this.playing) { this.sdk?.game.gameplayStart(); this.playing = true; } }
  stop() { if (this.playing) { this.sdk?.game.gameplayStop(); this.playing = false; } }
  storage() { return this.sdk ? this.sdk.data : window.localStorage; }
  candidates() {
    const store = this.storage(), result = [];
    for (const key of [KEY, BACKUP]) {
      const text = store.getItem(key); if (!text) continue;
      try { result.push({ data: JSON.parse(text), backup: key === BACKUP }); } catch { /* A valid backup may still be recoverable. */ }
    }
    return result;
  }
  save(data, keepBackup = true) {
    const store = this.storage(), text = JSON.stringify(data);
    // CrazyGames allows 1 MiB total. Leave headroom for two generations.
    if (new TextEncoder().encode(text).length > 490000) throw new Error('Save exceeds the platform storage budget. Export a copy of your progress.');
    const old = store.getItem(KEY);
    if (keepBackup && old) store.setItem(BACKUP, old);
    else store.removeItem(BACKUP);
    store.setItem(KEY, text);
  }
  get crazygames() { return !!this.sdk; }
}

export class Sound {
  constructor() { this.enabled = true; this.music = false; this.context = null; this.nextNote = 0; this.note = 0; }
  unlock() { this.context ??= new AudioContext(); if (this.context.state !== 'running') this.context.resume().catch(() => {}); }
  tone(freq, duration = .12, volume = .05, delay = 0) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const ctx = this.context, oscillator = ctx.createOscillator(), gain = ctx.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = freq; const t = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(volume, t + .015); gain.gain.exponentialRampToValueAtTime(.0001, t + duration);
    oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(t); oscillator.stop(t + duration + .01);
  }
  play(kind) {
    if (kind === 'pick') this.tone(523);
    if (kind === 'place') { this.tone(659); this.tone(784, .18, .04, .07); }
    if (kind === 'bonus') [523, 659, 784, 1046].forEach((f, i) => this.tone(f, .25, .035, i * .08));
    if (kind === 'error') this.tone(196, .15, .03);
    if (kind === 'upgrade') { this.tone(784); this.tone(1046, .2, .04, .12); }
  }
  tick(time, playing) {
    if (!this.music || !playing || !this.enabled || time < this.nextNote) return;
    this.nextNote = time + .8;
    const melody = [261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 349.23, 261.63, 392, 523.25, 392, 246.94, 293.66, 392, 293.66];
    this.tone(melody[this.note++ % melody.length], .7, .013);
  }
}
