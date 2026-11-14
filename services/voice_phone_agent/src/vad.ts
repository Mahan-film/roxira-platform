import { IN_RATE, concat, rms } from './audio.js';
import { cfg } from './config.js';

export interface VadEvents {
  /** Caller started talking (fires after VAD_START_MS of speech). */
  onSpeechStart(): void;
  /** Speech has lasted BARGE_IN_MS: strong enough to interrupt the agent. */
  onBargeIn(): void;
  /** One complete utterance, 16 kHz mono PCM. */
  onUtterance(pcm: Int16Array, durMs: number): void;
}

/**
 * Energy VAD with an adaptive noise floor. Phone audio (8 kHz narrowband, AGC'd by the
 * carrier) is well suited to this, and it costs ~0 RAM/CPU per call compared to an ONNX model.
 */
export class EnergyVad {
  private floor = 200;
  private speaking = false;
  private speechMs = 0;
  private silenceMs = 0;
  private uttMs = 0;
  private bargeFired = false;
  private chunks: Int16Array[] = [];
  private preroll: Int16Array[] = [];
  private readonly prerollMax = 15; // frames (~300 ms at 20 ms)

  constructor(private ev: VadEvents) {}

  push(frame: Int16Array) {
    const ms = (frame.length / IN_RATE) * 1000;
    const e = rms(frame);
    const threshold = Math.max(cfg.vadMinRms, this.floor * cfg.vadEnergyRatio);
    const voiced = e > threshold;

    if (!this.speaking) {
      // track background noise only while nobody is talking
      if (!voiced) this.floor = this.floor * 0.97 + e * 0.03;
      this.preroll.push(frame);
      if (this.preroll.length > this.prerollMax) this.preroll.shift();
      this.speechMs = voiced ? this.speechMs + ms : Math.max(0, this.speechMs - ms);
      if (this.speechMs >= cfg.vadStartMs) {
        this.speaking = true;
        this.bargeFired = false;
        this.silenceMs = 0;
        this.chunks = [...this.preroll];
        this.uttMs = this.chunks.length * ms;
        this.preroll = [];
        this.ev.onSpeechStart();
      }
      return;
    }

    this.chunks.push(frame);
    this.uttMs += ms;
    if (voiced) {
      this.silenceMs = 0;
      this.speechMs += ms;
    } else {
      this.silenceMs += ms;
    }
    if (!this.bargeFired && this.speechMs >= cfg.bargeInMs) {
      this.bargeFired = true;
      this.ev.onBargeIn();
    }
    if (this.silenceMs >= cfg.vadEndSilenceMs || this.uttMs >= cfg.vadMaxUtteranceMs) {
      const pcm = concat(this.chunks);
      const voicedMs = this.speechMs;
      this.reset();
      if (voicedMs >= cfg.vadMinUtteranceMs) this.ev.onUtterance(pcm, voicedMs);
    }
  }

  reset() {
    this.speaking = false;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.uttMs = 0;
    this.chunks = [];
    this.preroll = [];
  }
}
