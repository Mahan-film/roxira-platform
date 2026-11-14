import { AudioFrame, AudioSource } from '@livekit/rtc-node';
import { OUT_RATE } from './audio.js';

const FRAME = OUT_RATE / 100; // 480 samples = 10 ms

/**
 * Ordered playback queue on top of a LiveKit AudioSource with instant flush (barge-in).
 * Every interrupt bumps the epoch; the pump drops anything from an older epoch.
 */
export class Player {
  readonly source = new AudioSource(OUT_RATE, 1, 400);
  private queue: Int16Array[] = [];
  private epoch = 0;
  private pumping = false;
  private closed = false;
  private idleWaiters: (() => void)[] = [];

  get speaking(): boolean {
    return this.pumping || this.queue.length > 0 || this.source.queuedDuration > 0;
  }

  enqueue(pcm: Int16Array) {
    if (this.closed || pcm.length === 0) return;
    this.queue.push(pcm);
    if (!this.pumping) void this.pump();
  }

  /** Stop talking now: drop queued clips and what is already buffered in the source. */
  interrupt() {
    this.epoch++;
    this.queue = [];
    try { this.source.clearQueue(); } catch { /* source closed */ }
  }

  /** Resolves when nothing is queued or playing. */
  async idle(): Promise<void> {
    if (!this.speaking) return;
    await new Promise<void>((r) => this.idleWaiters.push(r));
  }

  private async pump() {
    this.pumping = true;
    const my = this.epoch;
    try {
      while (!this.closed && this.queue.length && my === this.epoch) {
        const pcm = this.queue.shift()!;
        for (let i = 0; i < pcm.length; i += FRAME) {
          if (this.closed || my !== this.epoch) break;
          const slice = new Int16Array(FRAME); // zero-pads the last frame
          slice.set(pcm.subarray(i, Math.min(i + FRAME, pcm.length)));
          await this.source.captureFrame(new AudioFrame(slice, OUT_RATE, 1, FRAME));
        }
      }
      if (!this.closed && my === this.epoch) await this.source.waitForPlayout();
    } catch {
      /* clearQueue/close while awaiting: fine */
    } finally {
      this.pumping = false;
      if (!this.closed && this.queue.length) void this.pump();
      else if (!this.speaking) this.idleWaiters.splice(0).forEach((r) => r());
    }
  }

  async close() {
    this.closed = true;
    this.interrupt();
    this.idleWaiters.splice(0).forEach((r) => r());
    await this.source.close().catch(() => {});
  }
}
