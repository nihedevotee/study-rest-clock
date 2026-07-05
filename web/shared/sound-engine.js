/**
 * sound-engine.js
 * ---------------------------------------------------------------------------
 * All audio is synthesized with the Web Audio API — no sound files to ship
 * or license. Everything here runs identically in a browser tab and inside
 * an Electron renderer, so this file is shared by both builds.
 *
 * Sounds are deliberately understated, modeled after a physical chess
 * clock: a dry mechanical "tick" while a side counts down, a slightly
 * louder "clack" when sides switch, and a short two-note chime at zero.
 */

export class SoundEngine {
  constructor({ getSettings } = {}) {
    // getSettings() should return { soundEnabled, tickEnabled, volume }
    this.getSettings = typeof getSettings === "function" ? getSettings : () => ({});
    this.audioContext = null;
    this.tickTimer = null;
  }

  _ensureContext() {
    if (!this.audioContext) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.audioContext = new Ctx();
    }
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().catch(() => {});
    }
    return this.audioContext;
  }

  _volume() {
    const { volume } = this.getSettings();
    return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.6;
  }

  /** Short, dry mechanical tick — like a chess clock's escapement. */
  playTick() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 900;

    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(1200, now);

    const peak = 0.12 * this._volume();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  /** Louder "clack" for switching sides — the plunger hitting the button. */
  playSwitchClick() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const gain = ctx.createGain();
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.06);

    const peak = 0.35 * this._volume();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  /** Short two-note chime when a timer reaches zero. */
  playChime() {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [880, 660];

    notes.forEach((freq, i) => {
      const startAt = now + i * 0.16;
      const gain = ctx.createGain();
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startAt);

      const peak = 0.22 * this._volume();
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + 0.32);
    });
  }

  /** Begin the once-per-second ticking loop. Safe to call repeatedly. */
  startTicking() {
    this.stopTicking();
    this.tickTimer = window.setInterval(() => {
      const { soundEnabled, tickEnabled } = this.getSettings();
      if (soundEnabled !== false && tickEnabled !== false) {
        this.playTick();
      }
    }, 1000);
  }

  stopTicking() {
    if (this.tickTimer) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }
}
