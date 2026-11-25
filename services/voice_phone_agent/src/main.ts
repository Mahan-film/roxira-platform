import * as path from 'node:path';
import { RoomServiceClient, SipClient } from 'livekit-server-sdk';
import { dispose } from '@livekit/rtc-node';
import { cfg, validateConfig } from './config.js';
import { PhoneCostTracker, type AdmissionDecision } from './cost-caps.js';
import { closeHttp, fetchDirect } from './http.js';
import { logger } from './log.js';
import { CallSession, type Prompts } from './session.js';
import { keepSipRouting } from './sip.js';
import { cachedPrompt } from './tts.js';

const log = logger('main');
let rooms: RoomServiceClient;
let costTracker: PhoneCostTracker;
const sessions = new Map<string, CallSession>();
const finished = new Map<string, number>(); // room -> ended at (avoid re-joining a closing room)
let stopping = false;

async function waitForTts() {
  if (cfg.ttsProvider !== 'edge') return;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetchDirect(`${cfg.edgeTtsUrl}/health`);
      if (r.ok) return;
    } catch { /* sidecar still starting */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  log.warn('TTS sidecar not reachable at', cfg.edgeTtsUrl);
}

async function loadPrompts(): Promise<Prompts> {
  const welcomeWav = path.resolve(cfg.root, '..', 'welcome.wav');
  const t0 = Date.now();
  const [greeting, filler, repeat, error, busy, goodbye, noSource] = await Promise.all([
    cachedPrompt(cfg.greetingText, welcomeWav),
    Promise.all(cfg.fillerTexts.map((t) => cachedPrompt(t))),
    cachedPrompt(cfg.repeatText),
    cachedPrompt(cfg.errorText),
    cachedPrompt(cfg.busyText),
    cachedPrompt(cfg.goodbyeText),
    cfg.noSourceText ? cachedPrompt(cfg.noSourceText) : Promise.resolve(new Int16Array(0)),
  ]);
  log.info(`prompts ready in ${Date.now() - t0} ms (greeting ${(greeting.length / 48000).toFixed(1)} s)`);
  return { greeting, filler, repeat, error, busy, goodbye, noSource };
}

async function poll(prompts: Prompts) {
  const now = Date.now();
  for (const [r, t] of finished) if (now - t > 10 * 60_000) finished.delete(r);
  const list = await rooms.listRooms();
  for (const r of list) {
    if (!r.name.startsWith(cfg.roomPrefix) || sessions.has(r.name) || finished.has(r.name)) continue;
    if (r.numParticipants < 1) continue;
    // join only real calls: a sip_ caller is present and no agent is in the room yet
    const ps = await rooms.listParticipants(r.name).catch(() => []);
    if (!ps.some((p) => p.identity.startsWith(cfg.sipIdentityPrefix))) continue;
    if (ps.some((p) => p.identity === cfg.agentIdentity)) continue;
    const callerId = ps.find((p) => p.identity.startsWith(cfg.sipIdentityPrefix))?.identity ?? '';
    let admission: AdmissionDecision;
    try {
      admission = costTracker.checkCallAdmission(callerId);
    } catch (e) {
      log.error('costTracker.checkCallAdmission failed (failing closed):', (e as Error)?.message ?? e);
      admission = { allowed: false, reason: 'cost_tracker_error' };
    }
    const busy = !admission.allowed || sessions.size >= cfg.maxConcurrentCalls;
    const refusalReason = !admission.allowed
      ? admission.reason
      : (sessions.size >= cfg.maxConcurrentCalls ? 'max_concurrent_calls' : undefined);

    const s = new CallSession(r.name, prompts, rooms, (done) => {
      sessions.delete(done.roomName);
      finished.set(done.roomName, Date.now());
      const durationSeconds = Math.max(0, Math.round((Date.now() - done.startedAt) / 1000));
      try {
        costTracker.recordCompletedCall({
          callerId: done.callerId || callerId,
          roomName: done.roomName,
          durationSeconds,
        });
      } catch (e) {
        log.error('costTracker.recordCompletedCall failed:', (e as Error)?.message ?? e);
      }
      log.info(`active calls: ${sessions.size}`);
    }, busy, callerId, refusalReason);
    sessions.set(r.name, s);
    log.info(`${busy ? `REFUSED(${refusalReason}) ` : ''}new call ${r.name} (active ${sessions.size})`);
    s.start().catch((e) => {
      log.error('session start failed', r.name, e?.message ?? e);
      void s.end('start failed');
    });
  }
}

async function main() {
  validateConfig();
  costTracker = new PhoneCostTracker();
  rooms = new RoomServiceClient(cfg.livekitHttp, cfg.livekitKey, cfg.livekitSecret);
  log.info(`STT=${cfg.sttProvider} TTS=${cfg.ttsProvider}(${cfg.ttsVoice}) brain=${cfg.judgeBase} max_calls=${cfg.maxConcurrentCalls}`);
  // Inbound trunk + dispatch rule live only in LiveKit's Redis; re-create them if missing (#1039).
  // Runs in the background with retries, so a LiveKit that is still starting never blocks or kills the agent.
  void keepSipRouting(new SipClient(cfg.livekitHttp, cfg.livekitKey, cfg.livekitSecret),
    { roomPrefix: cfg.roomPrefix, numbers: cfg.sipTrunkNumbers }, logger('sip'), () => stopping);
  await waitForTts();
  const prompts = await loadPrompts();
  log.info('ready for incoming calls');
  while (!stopping) {
    try { await poll(prompts); } catch (e) { log.warn('poll', (e as Error).message); }
    await new Promise((r) => setTimeout(r, cfg.pollMs));
  }
}

async function shutdown(sig: string) {
  if (stopping) return;
  stopping = true;
  log.info(`${sig}: closing ${sessions.size} call(s)`);
  await Promise.allSettled([...sessions.values()].map((s) => s.end('shutdown')));
  await closeHttp();
  await dispose().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (e) => log.error('unhandledRejection', (e as Error)?.message ?? e));

main().catch((e) => { log.error('fatal', e); process.exit(1); });
