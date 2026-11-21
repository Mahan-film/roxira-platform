// LiveKit SIP routing for the local carrier bridge (#1039).
// Asterisk (lk-sabanet-bridge, host network) forwards carrier calls to LiveKit SIP on 127.0.0.1.
// LiveKit rejects every call unless an inbound trunk matches it and a dispatch rule puts it in a
// room, and both live only in LiveKit's Redis, so a fresh Redis loses them. The agent makes sure
// both exist on every start: reuse what is there, create only what is missing, never duplicate.
// Logs only ids and counts: no keys, no phone numbers, no raw API errors (they can quote numbers).
import type { Log } from './log.js';

export const LOCAL_TRUNK_NAME = 'roxira-local-bridge';
export const LOCAL_BRIDGE_CIDR = '127.0.0.1/32';

/** The part of livekit-server-sdk's SipClient this module uses (tests pass a fake). */
export interface SipApi {
  listSipInboundTrunk(): Promise<Array<{ sipTrunkId: string; name: string; allowedAddresses: string[] }>>;
  createSipInboundTrunk(name: string, numbers: string[], opts?: { allowedAddresses?: string[] }):
    Promise<{ sipTrunkId: string }>;
  listSipDispatchRule(): Promise<Array<{
    sipDispatchRuleId: string;
    trunkIds: string[];
    rule?: { rule: { case?: string; value?: unknown } };
  }>>;
  createSipDispatchRule(rule: { type: 'individual'; roomPrefix: string },
    opts?: { name?: string; trunkIds?: string[] }): Promise<{ sipDispatchRuleId: string }>;
}

export interface SipRoutingResult {
  trunkId: string;
  ruleId: string;
  createdTrunk: boolean;
  createdRule: boolean;
}

/** Error text safe for logs: status/code plus the message with IPs and digit runs masked. */
export function safeError(e: unknown): string {
  const err = e as { code?: unknown; status?: unknown; message?: unknown };
  const code = [err?.status, err?.code].filter((x) => x !== undefined && x !== '').join(' ');
  const msg = String(err?.message ?? e)
    .replace(/\d{1,3}(\.\d{1,3}){3}(\/\d+)?/g, 'x.x.x.x')
    .replace(/\+?\d{4,}/g, '<num>')
    .slice(0, 200);
  return code ? `${code}: ${msg}` : msg;
}

/** Parses SIP_TRUNK_NUMBERS (comma list). Empty = default trunk that accepts any called number. */
export function parseNumbers(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Makes sure the inbound trunk for the local bridge and its individual dispatch rule exist.
 * Throws on API errors (the caller retries). An empty `numbers` list makes this LiveKit's default
 * trunk (any called number); that is valid only because allowedAddresses is set, and LiveKit allows
 * one default trunk, which is why an existing trunk that already allows 127.0.0.1/32 is reused.
 */
export async function ensureSipRouting(
  sip: SipApi, opts: { roomPrefix: string; numbers: string[] }, log: Log,
): Promise<SipRoutingResult> {
  const trunks = await sip.listSipInboundTrunk();
  let trunk = trunks.find((t) => t.name === LOCAL_TRUNK_NAME)
    ?? trunks.find((t) => (t.allowedAddresses ?? []).includes(LOCAL_BRIDGE_CIDR));
  let createdTrunk = false;
  if (!trunk) {
    const made = await sip.createSipInboundTrunk(LOCAL_TRUNK_NAME, opts.numbers,
      { allowedAddresses: [LOCAL_BRIDGE_CIDR] });
    trunk = { sipTrunkId: made.sipTrunkId, name: LOCAL_TRUNK_NAME, allowedAddresses: [LOCAL_BRIDGE_CIDR] };
    createdTrunk = true;
    log.info(`sip: created inbound trunk ${made.sipTrunkId} (${opts.numbers.length} number(s))`);
  } else {
    log.info(`sip: inbound trunk ${trunk.sipTrunkId} present (${trunks.length} trunk(s) total)`);
  }
  const trunkId = trunk.sipTrunkId;

  const rules = await sip.listSipDispatchRule();
  // Only rules explicitly bound to this trunk count; a wildcard rule (no trunk ids) may route elsewhere.
  const bound = rules.filter((r) => (r.trunkIds ?? []).includes(trunkId));
  const isOurs = (r: (typeof rules)[number]) => r.rule?.rule.case === 'dispatchRuleIndividual'
    && (r.rule.rule.value as { roomPrefix?: string } | undefined)?.roomPrefix === opts.roomPrefix;
  const rule = bound.find(isOurs) ?? bound[0];
  if (rule) {
    if (!isOurs(rule)) {
      log.warn(`sip: dispatch rule ${rule.sipDispatchRuleId} on trunk ${trunkId} is not individual with the agent's room prefix; reusing it, not creating a second one`);
    } else {
      log.info(`sip: dispatch rule ${rule.sipDispatchRuleId} present (${bound.length} on this trunk)`);
    }
    return { trunkId, ruleId: rule.sipDispatchRuleId, createdTrunk, createdRule: false };
  }
  const made = await sip.createSipDispatchRule({ type: 'individual', roomPrefix: opts.roomPrefix },
    { name: `${LOCAL_TRUNK_NAME}-individual`, trunkIds: [trunkId] });
  log.info(`sip: created dispatch rule ${made.sipDispatchRuleId} for trunk ${trunkId}`);
  return { trunkId, ruleId: made.sipDispatchRuleId, createdTrunk, createdRule: true };
}

/**
 * Retries ensureSipRouting with capped backoff until it succeeds or `stopped()` is true. LiveKit is
 * often not up yet when the agent starts (phone-stack up restarts both together), so a single try
 * would leave the line dead. Never throws, so the agent keeps running and never crash-loops.
 */
export async function keepSipRouting(
  sip: SipApi, opts: { roomPrefix: string; numbers: string[] }, log: Log,
  stopped: () => boolean, delays = { firstMs: 2000, maxMs: 60_000 },
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
): Promise<SipRoutingResult | null> {
  let wait = delays.firstMs;
  for (let attempt = 1; !stopped(); attempt++) {
    try {
      return await ensureSipRouting(sip, opts, log);
    } catch (e) {
      log.warn(`sip: routing check failed (attempt ${attempt}, retry in ${Math.round(wait / 1000)} s): ${safeError(e)}`);
    }
    await sleep(wait);
    wait = Math.min(wait * 2, delays.maxMs);
  }
  return null;
}
