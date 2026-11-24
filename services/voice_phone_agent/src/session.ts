import {
  AccessToken, RoomServiceClient,
} from 'livekit-server-sdk';
import {
  AudioStream, LocalAudioTrack, Room, RoomEvent, TrackKind, TrackPublishOptions, TrackSource,
  type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication,
} from '@livekit/rtc-node';
import { IN_RATE, concat, wav } from './audio.js';
import { JudgeError, askJudge, type JudgeInfo, type Turn } from './brain.js';
import { cfg } from './config.js';
import { logger, type Log } from './log.js';
import { Player } from './player.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { transcribeDetailed } from './stt.js';
import { synthesizeStream } from './tts.js';
import { looksIncomplete, stripEcho } from './turn.js';
import { EnergyVad } from './vad.js';

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  if (signal.aborted) return resolve();
  const t = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

/** One sentence being synthesized: buffers PCM until it is its turn to play, then streams it live. */
class StreamedClip {
  private buf: Int16Array[] = [];
  private sink: ((pcm: Int16Array) => void) | null = null;
  readonly done: Promise<void>;
  constructor(text: string, signal: AbortSignal) {
    this.done = synthesizeStream(text, signal, (pcm) => (this.sink ? this.sink(pcm) : this.buf.push(pcm)));
    this.done.catch(() => {}); // awaited by the playback chain
  }
  attach(sink: (pcm: Int16Array) => void) {
    this.buf.splice(0).forEach(sink);
    this.sink = sink;
  }
}

export interface Prompts {
  greeting: Int16Array; repeat: Int16Array;
  /** one per cfg.fillerTexts entry, used in turn */
  filler: Int16Array[];
  error: Int16Array; busy: Int16Array; goodbye: Int16Array;
  /** said after an answer without any source; empty = off */
  noSource: Int16Array;
}

export class CallSession {
  private room = new Room();
  private player = new Player();
  private fillerTurn = 0;
  private log: Log;
  private history: Turn[] = [];
  private turnCtl: AbortController | null = null;
  private turnBusy = false;
  /**
   * Caller audio of the turn not answered yet. A new utterance that arrives before the answer
   * starts playing is the caller continuing the same thought: it is appended and the whole turn
   * is transcribed again, instead of answering half a sentence.
   */
  private pending: Int16Array[] = [];
  private pendingMs = 0;
  public callerId = '';
  private turnNo = 0;
  private lastActivity = Date.now();
  private timers: NodeJS.Timeout[] = [];
  private listening = false;
  private ended = false;
  readonly startedAt = Date.now();

  constructor(
    readonly roomName: string,
    private prompts: Prompts,
    private rooms: RoomServiceClient,
    private onEnd: (s: CallSession) => void,
    private busyOnly = false,
    callerId = '',
    private refusalReason?: string,
  ) {
    this.callerId = callerId;
    this.log = logger(roomName.slice(0, 40));
  }

  async start() {
    const at = new AccessToken(cfg.livekitKey, cfg.livekitSecret, { identity: cfg.agentIdentity, ttl: '2h' });
    at.addGrant({ roomJoin: true, room: this.roomName, canPublish: true, canSubscribe: true });
    this.room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, p: RemoteParticipant) => {
      if (track.kind === TrackKind.KIND_AUDIO && p.identity.startsWith(cfg.sipIdentityPrefix)) this.listen(track);
    });
    this.room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      if (p.identity.startsWith(cfg.sipIdentityPrefix)) void this.end('caller hung up');
    });
    this.room.on(RoomEvent.Disconnected, () => void this.end('room disconnected'));

    await this.room.connect(cfg.livekitWs, await at.toJwt(), { autoSubscribe: true, dynacast: false });
    const track = LocalAudioTrack.createAudioTrack('agent-voice', this.player.source);
    const opts = new TrackPublishOptions();
    opts.source = TrackSource.SOURCE_MICROPHONE;
    await this.room.localParticipant!.publishTrack(track, opts);
    this.log.info('joined; caller =', [...this.room.remoteParticipants.keys()].join(',') || '(waiting)');

    // caller track may already be subscribed before our listener was attached
    for (const p of this.room.remoteParticipants.values()) {
      if (!p.identity.startsWith(cfg.sipIdentityPrefix)) continue;
      for (const pub of p.trackPublications.values()) {
        if (pub.track && pub.track.kind === TrackKind.KIND_AUDIO) this.listen(pub.track as RemoteTrack);
      }
    }

    if (this.busyOnly) {
      if (this.refusalReason) {
        this.log.info(`refusing call (${this.refusalReason})`);
      }
      this.player.enqueue(this.prompts.busy);
      await this.player.idle();
      return this.hangup(this.refusalReason ?? 'busy');
    }

    this.player.enqueue(this.prompts.greeting);
    this.noteSaid(cfg.greetingText);
    this.timers.push(setTimeout(() => void this.sayGoodbye('max duration'), cfg.maxCallSeconds * 1000));
    this.timers.push(setInterval(() => {
      if (!this.turnBusy && !this.player.speaking && Date.now() - this.lastActivity > cfg.idleHangupSeconds * 1000) {
        void this.sayGoodbye('idle');
      }
    }, 5000));
  }

  private listen(track: RemoteTrack) {
    if (this.listening || this.busyOnly) return;
    this.listening = true;
    const remoteId = [...this.room.remoteParticipants.keys()].find((k) => k.startsWith(cfg.sipIdentityPrefix));
    if (remoteId) this.callerId = remoteId;
    this.log.info('listening to caller audio');
    const stream = new AudioStream(track, { sampleRate: IN_RATE, numChannels: 1, frameSizeMs: 20 });
    const vad = new EnergyVad({
      onSpeechStart: () => { this.lastActivity = Date.now(); },
      onBargeIn: () => {
        if (this.player.speaking || this.turnBusy) {
          this.log.info('barge-in: stopping playback');
          this.turnCtl?.abort();
          this.player.interrupt();
        }
      },
      onUtterance: (pcm, ms) => {
        this.lastActivity = Date.now();
        this.pending.push(pcm);
        this.pendingMs += ms;
        void this.handleTurn();
      },
    });
    void (async () => {
      try {
        for await (const frame of stream) {
          if (this.ended) break;
          vad.push(frame.data);
        }
      } catch (e) {
        if (!this.ended) this.log.warn('audio stream error', (e as Error).message);
      }
    })();
  }

  private clearPending() {
    this.pending = [];
    this.pendingMs = 0;
  }

  /** What the agent said recently: its echo on the line is removed from the caller's transcript. */
  private said: { text: string; at: number }[] = [];
  private noteSaid(text: string) {
    const now = Date.now();
    this.said = this.said.filter((s) => now - s.at < 45_000);
    this.said.push({ text, at: now });
  }
  private recentSaid(): string[] {
    const now = Date.now();
    return this.said.filter((s) => now - s.at < 45_000).map((s) => s.text);
  }

  /** Ask the caller to say it again (unclear audio). Pure noise blips are dropped silently. */
  private askRepeat(m: Record<string, number>, why: string) {
    const ms = this.pendingMs;
    this.clearPending();
    if (ms < 800) { this.log.info(`${why}; ignored (short)`, m); return; }
    this.player.interrupt();
    this.player.enqueue(this.prompts.repeat);
    this.log.info(`${why}; asked to repeat`, m);
  }

  private async handleTurn() {
    this.turnCtl?.abort();
    const ctl = new AbortController();
    this.turnCtl = ctl;
    this.turnBusy = true;
    const t0 = Date.now();
    const pcm = concat(this.pending);
    const m: Record<string, number> = { speech_ms: Math.round(this.pendingMs), segments: this.pending.length };
    // "one moment" if nothing is audible FILLER_DELAY_MS after the caller stopped; not for echo or noise
    let noFiller = false;
    const fillerTimer = setTimeout(() => {
      const n = this.prompts.filler.length;
      if (ctl.signal.aborted || m.first_audio_ms || noFiller || !n) return;
      const i = this.fillerTurn++ % n;
      this.player.enqueue(this.prompts.filler[i]);
      this.noteSaid(cfg.fillerTexts[i]);
    }, cfg.fillerDelayMs);
    try {
      const tr = await transcribeDetailed(pcm, ctl.signal, undefined, (w) => {
        const unsure = !w.text || (w.logprob !== null && w.logprob < cfg.sttMinLogprob);
        if (unsure || !stripEcho(w.text, this.recentSaid()).text) noFiller = true;
      });
      m.stt_ms = Date.now() - t0;
      if (ctl.signal.aborted) return; // caller went on talking: the next utterance merges with this one
      if (tr.logprob !== null) m.logprob = Math.round(tr.logprob * 100) / 100;
      this.record(pcm, tr.text, tr.logprob);
      if (!tr.text) return this.askRepeat(m, 'empty transcript');
      if (tr.logprob !== null && tr.logprob < cfg.sttMinLogprob) {
        // a garbled transcript sent to the brain gets a confident answer to the wrong question
        return this.askRepeat(m, `low-confidence transcript "${tr.text.slice(0, 80)}"`);
      }
      // the agent's own voice coming back on the line (speakerphone / line echo)
      const echo = stripEcho(tr.text, this.recentSaid());
      if (echo.removed) this.log.info(`echo removed: "${echo.removed.slice(0, 80)}"`);
      if (!echo.text) {
        this.clearPending();
        this.log.info('only echo of the agent; ignored', m);
        return;
      }
      const text = echo.text;
      if (looksIncomplete(text)) {
        m.hold_ms = cfg.turnHoldMs;
        await sleep(cfg.turnHoldMs, ctl.signal);
        if (ctl.signal.aborted) return; // the caller continued: merged into the next turn
      }
      this.log.info('caller:', text, `[${tr.provider.split(' ')[0]}]`, ...(tr.note ? [tr.note] : []));

      let answer = '';
      let chain: Promise<void> = Promise.resolve();
      let first = true;
      const info: JudgeInfo = { noSource: false };
      for await (const sentence of askJudge(text, this.history, ctl.signal, info)) {
        if (ctl.signal.aborted) break;
        if (first) { m.first_sentence_ms = Date.now() - t0; first = false; }
        answer += sentence + ' ';
        // synthesis of every sentence starts now; playback stays in sentence order
        const clip = new StreamedClip(sentence, ctl.signal);
        chain = chain.then(async () => {
          if (ctl.signal.aborted) return;
          this.noteSaid(sentence);
          clip.attach((pcm) => {
            if (ctl.signal.aborted) return;
            if (!m.first_audio_ms) {
              m.first_audio_ms = Date.now() - t0;
              clearTimeout(fillerTimer);
              this.clearPending(); // the answer is audible now: later speech is a new turn
            }
            this.player.enqueue(pcm);
          });
          try {
            await clip.done;
          } catch (e) {
            if (!ctl.signal.aborted) this.log.warn('tts failed for a sentence:', (e as Error).message);
          }
        });
      }
      await chain;
      if (ctl.signal.aborted) return;
      if (info.noSource && answer.trim() && this.prompts.noSource.length) {
        // the caller must know this answer rests on no law, ruling or regulation
        this.player.enqueue(this.prompts.noSource);
        this.noteSaid(cfg.noSourceText);
        answer += cfg.noSourceText + ' ';
        m.no_source = 1;
      }
      this.clearPending();
      m.total_ms = Date.now() - t0;
      this.log.info('agent:', answer.trim().slice(0, 300), m);
      this.history.push({ role: 'user', content: text }, { role: 'assistant', content: answer.trim() });
      this.history = this.history.slice(-12);
    } catch (e) {
      if (ctl.signal.aborted) return;
      const err = e as Error;
      this.log.error('turn failed:', err instanceof JudgeError ? `judge ${err.status} ${err.message}` : err.message, m);
      this.clearPending();
      this.player.interrupt();
      this.player.enqueue(this.prompts.error);
    } finally {
      clearTimeout(fillerTimer);
      if (this.turnCtl === ctl) { this.turnBusy = false; this.lastActivity = Date.now(); }
    }
  }

  /** Testing aid, off unless DEBUG_RECORD_CALLERS lists this caller: turn audio + transcript, kept 48 h. */
  private record(pcm: Int16Array, text: string, logprob: number | null) {
    if (!this.callerId || !cfg.debugRecordCallers.includes(this.callerId)) return;
    try {
      const dir = cfg.debugRecordDir;
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const base = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-t${++this.turnNo}`);
      fs.writeFileSync(`${base}.wav`, wav(pcm, IN_RATE), { mode: 0o600 });
      fs.writeFileSync(`${base}.json`, JSON.stringify({ room: this.roomName, text, logprob }), { mode: 0o600 });
      const cutoff = Date.now() - 48 * 3600_000;
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
      }
    } catch (e) {
      this.log.warn('debug record failed:', (e as Error).message);
    }
  }

  private async sayGoodbye(reason: string) {
    if (this.ended) return;
    this.turnCtl?.abort();
    this.player.interrupt();
    this.player.enqueue(this.prompts.goodbye);
    await this.player.idle();
    await this.hangup(reason);
  }

  /** Deleting the room makes livekit-sip send BYE to the caller. */
  private async hangup(reason: string) {
    this.log.info('hanging up:', reason);
    await this.rooms.deleteRoom(this.roomName).catch((e) => this.log.warn('deleteRoom', e.message));
    await this.end(reason);
  }

  async end(reason: string) {
    if (this.ended) return;
    this.ended = true;
    this.turnCtl?.abort();
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    await this.player.close();
    await this.room.disconnect().catch(() => {});
    this.room.removeAllListeners();
    this.log.info(`ended (${reason}) after ${Math.round((Date.now() - this.startedAt) / 1000)} s`);
    this.onEnd(this);
  }
}
