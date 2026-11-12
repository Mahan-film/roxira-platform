import {
  AccessToken, RoomServiceClient,
} from 'livekit-server-sdk';
import {
  AudioStream, LocalAudioTrack, Room, RoomEvent, TrackKind, TrackPublishOptions, TrackSource,
  type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication,
} from '@livekit/rtc-node';
import { IN_RATE } from './audio.js';
import { JudgeError, askJudge, type Turn } from './brain.js';
import { cfg } from './config.js';
import { logger, type Log } from './log.js';
import { Player } from './player.js';
import { transcribe } from './stt.js';
import { synthesize } from './tts.js';
import { EnergyVad } from './vad.js';

export interface Prompts {
  greeting: Int16Array; filler: Int16Array; repeat: Int16Array;
  error: Int16Array; busy: Int16Array; goodbye: Int16Array;
}

export class CallSession {
  private room = new Room();
  private player = new Player();
  private log: Log;
  private history: Turn[] = [];
  private turnCtl: AbortController | null = null;
  private turnBusy = false;
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
  ) {
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
      this.player.enqueue(this.prompts.busy);
      await this.player.idle();
      return this.hangup('busy');
    }

    this.player.enqueue(this.prompts.greeting);
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
        void this.handleTurn(pcm, ms);
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

  private async handleTurn(pcm: Int16Array, voicedMs: number) {
    this.turnCtl?.abort();
    const ctl = new AbortController();
    this.turnCtl = ctl;
    this.turnBusy = true;
    const t0 = Date.now();
    const m: Record<string, number> = { speech_ms: Math.round(voicedMs) };
    // latency masking: filler plays while STT + Smart Judge work
    this.player.interrupt();
    this.player.enqueue(this.prompts.filler);
    try {
      const text = await transcribe(pcm, ctl.signal);
      m.stt_ms = Date.now() - t0;
      if (ctl.signal.aborted) return;
      if (!text) {
        this.player.interrupt();
        this.player.enqueue(this.prompts.repeat);
        this.log.info('empty transcript', m);
        return;
      }
      this.log.info('caller:', text);

      let answer = '';
      let chain: Promise<void> = Promise.resolve();
      let first = true;
      for await (const sentence of askJudge(text, this.history, ctl.signal)) {
        if (ctl.signal.aborted) break;
        if (first) { m.first_sentence_ms = Date.now() - t0; first = false; }
        answer += sentence + ' ';
        const pending = synthesize(sentence, ctl.signal);
        pending.catch(() => {}); // awaited in order below
        chain = chain.then(async () => {
          try {
            const audio = await pending;
            if (ctl.signal.aborted) return;
            if (!m.first_audio_ms) m.first_audio_ms = Date.now() - t0;
            this.player.enqueue(audio);
          } catch (e) {
            if (!ctl.signal.aborted) this.log.warn('tts failed for a sentence:', (e as Error).message);
          }
        });
      }
      await chain;
      if (ctl.signal.aborted) return;
      m.total_ms = Date.now() - t0;
      this.log.info('agent:', answer.trim().slice(0, 300), m);
      this.history.push({ role: 'user', content: text }, { role: 'assistant', content: answer.trim() });
      this.history = this.history.slice(-12);
    } catch (e) {
      if (ctl.signal.aborted) return;
      const err = e as Error;
      this.log.error('turn failed:', err instanceof JudgeError ? `judge ${err.status} ${err.message}` : err.message, m);
      this.player.interrupt();
      this.player.enqueue(this.prompts.error);
    } finally {
      if (this.turnCtl === ctl) { this.turnBusy = false; this.lastActivity = Date.now(); }
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
