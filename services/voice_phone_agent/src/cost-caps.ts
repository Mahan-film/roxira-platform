import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger, type Log } from './log.js';

export interface EffectiveDates {
  valid_from: string;
  valid_to: string;
}

export interface PlatformPlan {
  name: string;
  monthly_fee_usd_cents: number;
  agent_minute_usd_cents: number;
  observability_minute_usd_cents: number;
  minimum_duration_seconds: number;
  billing_increment_seconds: number;
  verified: boolean;
  source: string;
  notes?: string;
}

export interface CarrierPricing {
  name: string;
  did_monthly_usd_cents: number;
  inbound_per_minute_usd_cents: number;
  outbound_landline_per_minute_usd_cents: number;
  outbound_mobile_per_minute_usd_cents: number;
  voice_api_fee_per_minute_usd_cents?: number;
  billing_increment_seconds: number;
  minimum_duration_seconds: number;
  verified: boolean;
  source: string;
  notes?: string;
}

export interface SpeechModelPrice {
  usd_cents_per_minute?: number;
  usd_cents_per_1k_chars?: number;
  verified: boolean;
  source: string;
}

export interface AbuseCapsConfig {
  per_caller_daily: {
    max_calls: number;
    max_connected_seconds: number;
    notes?: string;
  };
  global_daily: {
    max_calls: number;
    max_connected_seconds: number;
    notes?: string;
  };
  monthly_spend_cap: {
    cap_usd_cents: number;
    alert_threshold_ratio: number;
    notes?: string;
  };
}

export interface PricingConfig {
  version: string;
  effective_dates: EffectiveDates;
  platform_plans: Record<string, PlatformPlan>;
  carriers: Record<string, CarrierPricing>;
  speech_models: {
    stt: Record<string, SpeechModelPrice>;
    tts: Record<string, SpeechModelPrice>;
  };
  abuse_caps: AbuseCapsConfig;
}

export interface CallCostBreakdown {
  durationSeconds: number;
  carrierBillableSeconds: number;
  livekitBillableSeconds: number;
  carrierCostMicroCents: number;
  livekitAgentCostMicroCents: number;
  livekitObsCostMicroCents: number;
  sttCostMicroCents: number;
  ttsCostMicroCents: number;
  totalCostMicroCents: number;
  carrierCostCents: number;
  livekitAgentCostCents: number;
  livekitObsCostCents: number;
  sttCostCents: number;
  ttsCostCents: number;
  totalCostCents: number;
}

export interface AdmissionDecision {
  allowed: boolean;
  reason?: string;
  detail?: string;
}

export interface CallerDailyUsage {
  calls: number;
  connectedSeconds: number;
  costMicroCents?: number;
  costCents: number;
  lastCallAt: string;
}

export interface DayUsage {
  totalCalls: number;
  totalConnectedSeconds: number;
  totalCostMicroCents?: number;
  totalCostCents: number;
  callers: Record<string, CallerDailyUsage>;
}

export interface SpendAlert {
  month: string;
  timestamp: string;
  spendCents: number;
  capCents: number;
  ratio: number;
  message: string;
}

export interface PhoneUsageState {
  updatedAt: string;
  currentMonth: string;
  monthlyFixedFeeCents: number;
  monthlyVariableMicroCents?: number;
  monthlyVariableCents: number;
  monthlyTotalCents: number;
  dailyUsage: Record<string, DayUsage>;
  alertsSent: Record<string, SpendAlert>;
}

const DEFAULT_PRICING_REL = '../../../config/phone_pricing.json';
const INSTALLED_PRICING_PATH = '/usr/local/lib/phone-stack/phone_pricing.json';
const MICRO_CENTS_PER_CENT = 1_000_000n;
const HALF_CENT_IN_MICRO_CENTS = 500_000n;
const UNKNOWN_CALLER_BUCKET = '__unknown__';

/** Converts a decimal value with up to 6 fractional digits into scaled bigint units. */
function decimalToScaledBigInt(value: number, scaleDigits: number): bigint {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  const raw = value.toFixed(scaleDigits);
  const [whole, frac = ''] = raw.split('.');
  const digits = `${whole}${frac.padEnd(scaleDigits, '0').slice(0, scaleDigits)}`;
  return BigInt(digits);
}

/** Converts a USD-cent rate (up to 6 decimal places) into integer micro-cents (1e-6 cents). */
function rateCentsToMicroCents(rateCents: number): bigint {
  return decimalToScaledBigInt(rateCents, 6);
}

/** Integer half-up proration in micro-cents: round((units * rateMicroCents) / divisor). */
function prorateMicroCents(units: number, rateMicroCents: bigint, divisor: bigint): bigint {
  if (units <= 0 || rateMicroCents <= 0n || divisor <= 0n) return 0n;
  const numerator = BigInt(Math.round(units)) * rateMicroCents;
  return (numerator + divisor / 2n) / divisor;
}

/** Rounds micro-cents to nearest integer USD cent using integer division. */
function microCentsToIntegerCents(microCents: bigint): bigint {
  if (microCents <= 0n) return 0n;
  return (microCents + HALF_CENT_IN_MICRO_CENTS) / MICRO_CENTS_PER_CENT;
}

/** Safely converts a bigint integer to JS number for JSON serialization. */
function bigintToSafeInt(v: bigint): number {
  if (v < BigInt(Number.MIN_SAFE_INTEGER) || v > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Integer out of safe JS range: ${v}`);
  }
  return parseInt(v.toString(), 10);
}

/** Formats integer USD cents as "$D.CC" using integer arithmetic only. */
function formatUsdFromCents(cents: bigint): string {
  const neg = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  const dollars = abs / 100n;
  const rem = abs % 100n;
  return `${neg}${dollars}.${rem.toString().padStart(2, '0')}`;
}

/** Validates whether current time falls within effective date bounds. */
export function isConfigEffective(dates: EffectiveDates, now: Date = new Date()): boolean {
  const from = new Date(dates.valid_from).getTime();
  const to = new Date(dates.valid_to).getTime();
  const t = now.getTime();
  return t >= from && t <= to;
}

/** Resolves and loads the phone pricing config from JSON. */
export function loadPricingConfig(customPath?: string): PricingConfig {
  const candidates: string[] = [];
  if (customPath) {
    candidates.push(path.resolve(customPath));
  } else if (process.env.PHONE_PRICING_JSON) {
    candidates.push(path.resolve(process.env.PHONE_PRICING_JSON));
  } else {
    candidates.push(path.resolve(import.meta.dirname, DEFAULT_PRICING_REL));
    candidates.push(INSTALLED_PRICING_PATH);
  }

  const resolved = candidates.find((p) => fs.existsSync(p));
  if (!resolved) {
    throw new Error(`Phone pricing configuration not found (checked: ${candidates.join(', ')})`);
  }

  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = JSON.parse(raw) as PricingConfig;

  if (!parsed.effective_dates?.valid_from || !parsed.effective_dates?.valid_to) {
    throw new Error(`Pricing config at ${resolved} is missing effective_dates`);
  }

  return parsed;
}

/**
 * Calculates carrier billable seconds.
 * Implements carrier rounding (e.g. 60/60 rounding: each partial minute rounds up to 60s increment).
 */
export function calculateCarrierBillableSeconds(durationSeconds: number, carrier: CarrierPricing): number {
  if (durationSeconds <= 0) return 0;
  const inc = carrier.billing_increment_seconds > 0 ? carrier.billing_increment_seconds : 1;
  const rounded = Math.ceil(durationSeconds / inc) * inc;
  return Math.max(rounded, carrier.minimum_duration_seconds || 0);
}

/**
 * Calculates LiveKit billable seconds.
 * Implements LiveKit minimum duration requirement (e.g. 10s minimum on Scale plan).
 */
export function calculateLiveKitBillableSeconds(durationSeconds: number, plan: PlatformPlan): number {
  if (durationSeconds <= 0) return 0;
  return Math.max(durationSeconds, plan.minimum_duration_seconds || 0);
}

export interface CostCalculationParams {
  durationSeconds: number;
  carrierKey?: string;
  planKey?: string;
  sttKey?: string;
  ttsKey?: string;
  ttsChars?: number;
  enableObservability?: boolean;
}

/**
 * Computes exact call cost breakdown based on effective-dated rates and rounding rules.
 */
export function calculateCallCost(
  params: CostCalculationParams,
  config: PricingConfig,
): CallCostBreakdown {
  const carrierKey = params.carrierKey ?? 'sabanet';
  const planKey = params.planKey ?? 'self_hosted';
  const carrier = config.carriers[carrierKey] ?? config.carriers.sabanet;
  const plan = config.platform_plans[planKey] ?? config.platform_plans.self_hosted;

  const durationSeconds = Math.max(0, Math.round(params.durationSeconds));
  const carrierBillableSeconds = calculateCarrierBillableSeconds(durationSeconds, carrier);
  const livekitBillableSeconds = calculateLiveKitBillableSeconds(durationSeconds, plan);

  // Carrier cost in integer micro-cents (1 cent = 1,000,000 micro-cents)
  const inboundMicro = rateCentsToMicroCents(carrier.inbound_per_minute_usd_cents);
  const voiceApiMicro = rateCentsToMicroCents(carrier.voice_api_fee_per_minute_usd_cents || 0);
  const carrierCostMicroBig = prorateMicroCents(carrierBillableSeconds, inboundMicro + voiceApiMicro, 60n);

  // LiveKit cost in integer micro-cents
  const agentMicro = rateCentsToMicroCents(plan.agent_minute_usd_cents);
  const obsMicro = rateCentsToMicroCents(plan.observability_minute_usd_cents);
  const livekitAgentCostMicroBig = prorateMicroCents(livekitBillableSeconds, agentMicro, 60n);
  const livekitObsCostMicroBig = params.enableObservability
    ? prorateMicroCents(livekitBillableSeconds, obsMicro, 60n)
    : 0n;

  // Speech costs in integer micro-cents
  let sttCostMicroBig = 0n;
  if (params.sttKey && config.speech_models?.stt[params.sttKey]) {
    const rateMicro = rateCentsToMicroCents(config.speech_models.stt[params.sttKey].usd_cents_per_minute || 0);
    sttCostMicroBig = prorateMicroCents(durationSeconds, rateMicro, 60n);
  }

  let ttsCostMicroBig = 0n;
  if (params.ttsKey && config.speech_models?.tts[params.ttsKey] && params.ttsChars) {
    const ratePer1kMicro = rateCentsToMicroCents(config.speech_models.tts[params.ttsKey].usd_cents_per_1k_chars || 0);
    ttsCostMicroBig = prorateMicroCents(params.ttsChars, ratePer1kMicro, 1000n);
  }

  const totalCostMicroBig =
    carrierCostMicroBig + livekitAgentCostMicroBig + livekitObsCostMicroBig + sttCostMicroBig + ttsCostMicroBig;

  return {
    durationSeconds,
    carrierBillableSeconds,
    livekitBillableSeconds,
    carrierCostMicroCents: bigintToSafeInt(carrierCostMicroBig),
    livekitAgentCostMicroCents: bigintToSafeInt(livekitAgentCostMicroBig),
    livekitObsCostMicroCents: bigintToSafeInt(livekitObsCostMicroBig),
    sttCostMicroCents: bigintToSafeInt(sttCostMicroBig),
    ttsCostMicroCents: bigintToSafeInt(ttsCostMicroBig),
    totalCostMicroCents: bigintToSafeInt(totalCostMicroBig),
    carrierCostCents: bigintToSafeInt(microCentsToIntegerCents(carrierCostMicroBig)),
    livekitAgentCostCents: bigintToSafeInt(microCentsToIntegerCents(livekitAgentCostMicroBig)),
    livekitObsCostCents: bigintToSafeInt(microCentsToIntegerCents(livekitObsCostMicroBig)),
    sttCostCents: bigintToSafeInt(microCentsToIntegerCents(sttCostMicroBig)),
    ttsCostCents: bigintToSafeInt(microCentsToIntegerCents(ttsCostMicroBig)),
    totalCostCents: bigintToSafeInt(microCentsToIntegerCents(totalCostMicroBig)),
  };
}

export interface CostTrackerOptions {
  config?: PricingConfig;
  configPath?: string;
  statePath?: string;
  carrierKey?: string;
  planKey?: string;
  enableObservability?: boolean;
  onAlert?: (alert: SpendAlert) => void;
}

/**
 * Manages phone cost caps, daily limits per caller, global circuit breakers, and monthly spend alerts.
 */
export class PhoneCostTracker {
  private config: PricingConfig;
  private state: PhoneUsageState;
  private statePath: string;
  private stateMtimeMs = 0;
  private carrierKey: string;
  private planKey: string;
  private enableObservability: boolean;
  private log: Log;
  private onAlert?: (alert: SpendAlert) => void;

  constructor(options: CostTrackerOptions = {}) {
    this.log = logger('cost-caps');
    this.config = options.config ?? loadPricingConfig(options.configPath);
    this.carrierKey = options.carrierKey ?? process.env.PHONE_CARRIER ?? 'sabanet';
    this.planKey = options.planKey ?? process.env.PHONE_PLATFORM_PLAN ?? 'self_hosted';
    this.enableObservability = options.enableObservability
      ?? (process.env.LIVEKIT_OBSERVABILITY === 'true' || process.env.LIVEKIT_OBSERVABILITY === '1');
    this.onAlert = options.onAlert;

    // Resolve state persistence path: prefer /srv/data/phone/state if accessible, otherwise local cache
    if (options.statePath) {
      this.statePath = path.resolve(options.statePath);
    } else if (process.env.PHONE_STATE_FILE) {
      this.statePath = path.resolve(process.env.PHONE_STATE_FILE);
    } else {
      const srvDir = '/srv/data/phone/state';
      try {
        if (fs.existsSync(srvDir)) {
          this.statePath = path.join(srvDir, 'phone_usage_state.json');
        } else {
          const localCache = path.resolve(import.meta.dirname, '..', 'cache');
          this.statePath = path.join(localCache, 'phone_usage_state.json');
        }
      } catch {
        const localCache = path.resolve(import.meta.dirname, '..', 'cache');
        this.statePath = path.join(localCache, 'phone_usage_state.json');
      }
    }

    this.state = this.loadState();
  }

  private getTodayKey(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10);
  }

  private getCurrentMonthKey(now: Date = new Date()): string {
    return now.toISOString().slice(0, 7);
  }

  private normalizeCallerKey(callerId: string): string {
    const trimmed = callerId.trim();
    return trimmed || UNKNOWN_CALLER_BUCKET;
  }

  private loadState(): PhoneUsageState {
    const month = this.getCurrentMonthKey();
    const plan = this.config.platform_plans[this.planKey] ?? this.config.platform_plans.self_hosted;
    const fixedFee = plan.monthly_fee_usd_cents || 0;

    const defaultState: PhoneUsageState = {
      updatedAt: new Date().toISOString(),
      currentMonth: month,
      monthlyFixedFeeCents: fixedFee,
      monthlyVariableMicroCents: 0,
      monthlyVariableCents: 0,
      monthlyTotalCents: fixedFee,
      dailyUsage: {},
      alertsSent: {},
    };

    try {
      if (fs.existsSync(this.statePath)) {
        const st = fs.statSync(this.statePath);
        this.stateMtimeMs = st.mtimeMs;
        const raw = fs.readFileSync(this.statePath, 'utf8');
        const loaded = JSON.parse(raw) as PhoneUsageState;
        if (loaded.currentMonth === month) {
          if (loaded.monthlyVariableMicroCents === undefined) {
            loaded.monthlyVariableMicroCents = bigintToSafeInt(
              BigInt(loaded.monthlyVariableCents || 0) * MICRO_CENTS_PER_CENT,
            );
          }
          return loaded;
        }
        // Month boundary roll: reset monthly counters, keep old month archived in dailyUsage
        return {
          ...defaultState,
          dailyUsage: loaded.dailyUsage ?? {},
        };
      }
    } catch (e: any) {
      this.log.warn(`Could not read state file at ${this.statePath}: ${e?.message ?? e}`);
    }

    return defaultState;
  }

  private withStateLock<T>(fn: () => T): T {
    const dir = path.dirname(this.statePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const lockPath = `${this.statePath}.lock`;
    let acquired = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const fd = fs.openSync(lockPath, 'wx');
        fs.closeSync(fd);
        acquired = true;
        break;
      } catch (err: any) {
        if (err?.code !== 'EEXIST') break;
        try {
          const st = fs.statSync(lockPath);
          if (Date.now() - st.mtimeMs > 10_000) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch {
          // lock released concurrently
        }
        // short synchronous spin-wait up to ~10ms
        const until = Date.now() + 5;
        while (Date.now() < until) { /* wait */ }
      }
    }
    try {
      return fn();
    } finally {
      if (acquired) {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // already removed
        }
      }
    }
  }

  private saveState(): void {
    try {
      const dir = path.dirname(this.statePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.state.updatedAt = new Date().toISOString();
      const tmpPath = `${this.statePath}.tmp.${process.pid}.${Date.now()}`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.statePath);
      try {
        this.stateMtimeMs = fs.statSync(this.statePath).mtimeMs;
      } catch {
        // ignore stat race
      }
    } catch (e: any) {
      this.log.error(`Failed to save state to ${this.statePath}: ${e?.message ?? e}`);
    }
  }

  /**
   * Evaluates if a call from callerId can be admitted.
   * Checks monthly budget, global daily limits, and per-caller daily limits.
   */
  checkCallAdmission(callerId: string, now: Date = new Date()): AdmissionDecision {
    if (!isConfigEffective(this.config.effective_dates, now)) {
      this.log.warn(`Phone pricing config is expired or not yet effective!`);
    }

    const month = this.getCurrentMonthKey(now);
    const today = this.getTodayKey(now);
    const caps = this.config.abuse_caps;
    const callerKey = this.normalizeCallerKey(callerId);

    // 1. Monthly Spend Cap
    const monthlySpend = BigInt(
      this.state.currentMonth === month
        ? this.state.monthlyTotalCents
        : (this.config.platform_plans[this.planKey]?.monthly_fee_usd_cents || 0),
    );
    const monthlyCap = BigInt(caps.monthly_spend_cap.cap_usd_cents);

    if (monthlySpend >= monthlyCap) {
      return {
        allowed: false,
        reason: 'monthly_spend_cap_exceeded',
        detail: `Monthly spend ($${formatUsdFromCents(monthlySpend)} USD) reached cap of $${formatUsdFromCents(monthlyCap)} USD`,
      };
    }

    const day = this.state.dailyUsage[today];
    if (day) {
      // 2. Global Daily Call Cap
      if (day.totalCalls >= caps.global_daily.max_calls) {
        return {
          allowed: false,
          reason: 'global_daily_calls_exceeded',
          detail: `Global daily call limit (${caps.global_daily.max_calls}) reached for ${today}`,
        };
      }

      // 3. Global Daily Duration Cap
      if (day.totalConnectedSeconds >= caps.global_daily.max_connected_seconds) {
        return {
          allowed: false,
          reason: 'global_daily_seconds_exceeded',
          detail: `Global daily duration limit (${caps.global_daily.max_connected_seconds}s) reached for ${today}`,
        };
      }

      // 4. Per-Caller Daily Caps (empty callerId maps to dedicated unknown bucket)
      const callerUsage = day.callers[callerKey];
      if (callerUsage) {
        if (callerUsage.calls >= caps.per_caller_daily.max_calls) {
          return {
            allowed: false,
            reason: 'caller_daily_calls_exceeded',
            detail: `Caller ${callerKey} reached daily call cap (${caps.per_caller_daily.max_calls})`,
          };
        }
        if (callerUsage.connectedSeconds >= caps.per_caller_daily.max_connected_seconds) {
          return {
            allowed: false,
            reason: 'caller_daily_seconds_exceeded',
            detail: `Caller ${callerKey} reached daily duration cap (${caps.per_caller_daily.max_connected_seconds}s)`,
          };
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Records a completed call, calculates costs, updates usage counters, checks 80% alert threshold,
   * and persists state.
   */
  recordCompletedCall(params: {
    callerId: string;
    roomName: string;
    durationSeconds: number;
    ttsChars?: number;
    sttKey?: string;
    ttsKey?: string;
    now?: Date;
  }): CallCostBreakdown {
    return this.withStateLock(() => {
      try {
        if (fs.existsSync(this.statePath)) {
          const st = fs.statSync(this.statePath);
          if (st.mtimeMs > this.stateMtimeMs) {
            this.state = this.loadState();
          }
        }
      } catch {
        // keep current in-memory state if stat fails
      }

      const now = params.now ?? new Date();
      const today = this.getTodayKey(now);
      const month = this.getCurrentMonthKey(now);
      const callerKey = this.normalizeCallerKey(params.callerId);

      const breakdown = calculateCallCost({
        durationSeconds: params.durationSeconds,
        carrierKey: this.carrierKey,
        planKey: this.planKey,
        sttKey: params.sttKey,
        ttsKey: params.ttsKey,
        ttsChars: params.ttsChars,
        enableObservability: this.enableObservability,
      }, this.config);

      if (this.state.currentMonth !== month) {
        this.state.currentMonth = month;
        const plan = this.config.platform_plans[this.planKey] ?? this.config.platform_plans.self_hosted;
        this.state.monthlyFixedFeeCents = plan.monthly_fee_usd_cents || 0;
        this.state.monthlyVariableMicroCents = 0;
        this.state.monthlyVariableCents = 0;
        this.state.monthlyTotalCents = this.state.monthlyFixedFeeCents;
      }

      if (!this.state.dailyUsage[today]) {
        this.state.dailyUsage[today] = {
          totalCalls: 0,
          totalConnectedSeconds: 0,
          totalCostMicroCents: 0,
          totalCostCents: 0,
          callers: {},
        };
      }

      const day = this.state.dailyUsage[today];
      day.totalCalls += 1;
      day.totalConnectedSeconds += params.durationSeconds;
      const dayMicro = BigInt(day.totalCostMicroCents ?? bigintToSafeInt(BigInt(day.totalCostCents) * MICRO_CENTS_PER_CENT))
        + BigInt(breakdown.totalCostMicroCents);
      day.totalCostMicroCents = bigintToSafeInt(dayMicro);
      day.totalCostCents = bigintToSafeInt(microCentsToIntegerCents(dayMicro));

      if (!day.callers[callerKey]) {
        day.callers[callerKey] = {
          calls: 0,
          connectedSeconds: 0,
          costMicroCents: 0,
          costCents: 0,
          lastCallAt: now.toISOString(),
        };
      }
      const c = day.callers[callerKey];
      c.calls += 1;
      c.connectedSeconds += params.durationSeconds;
      const callerMicro = BigInt(c.costMicroCents ?? bigintToSafeInt(BigInt(c.costCents) * MICRO_CENTS_PER_CENT))
        + BigInt(breakdown.totalCostMicroCents);
      c.costMicroCents = bigintToSafeInt(callerMicro);
      c.costCents = bigintToSafeInt(microCentsToIntegerCents(callerMicro));
      c.lastCallAt = now.toISOString();

      // Respect direct monthlyVariableCents edits in state if out of sync with micro-cents
      const currentVarMicro = this.state.monthlyVariableMicroCents;
      const syncedBaseMicro =
        currentVarMicro !== undefined
        && microCentsToIntegerCents(BigInt(currentVarMicro)) === BigInt(this.state.monthlyVariableCents)
          ? BigInt(currentVarMicro)
          : BigInt(this.state.monthlyVariableCents) * MICRO_CENTS_PER_CENT;

      const updatedVarMicro = syncedBaseMicro + BigInt(breakdown.totalCostMicroCents);
      this.state.monthlyVariableMicroCents = bigintToSafeInt(updatedVarMicro);
      this.state.monthlyVariableCents = bigintToSafeInt(microCentsToIntegerCents(updatedVarMicro));
      this.state.monthlyTotalCents = this.state.monthlyFixedFeeCents + this.state.monthlyVariableCents;

      // Check 80% monthly spend alert threshold
      this.checkSpendAlert(month, now);

      this.saveState();
      return breakdown;
    });
  }

  private checkSpendAlert(month: string, now: Date): void {
    const caps = this.config.abuse_caps.monthly_spend_cap;
    const capCents = BigInt(caps.cap_usd_cents);
    const thresholdBps = decimalToScaledBigInt(caps.alert_threshold_ratio, 4);
    const thresholdCents = (capCents * thresholdBps) / 10_000n;
    const currentSpend = BigInt(this.state.monthlyTotalCents);

    if (currentSpend >= thresholdCents && !this.state.alertsSent[month]) {
      const ratioBps = capCents > 0n ? (currentSpend * 10_000n) / capCents : 0n;
      const pctWhole = ratioBps / 100n;
      const pctTenth = (ratioBps % 100n) / 10n;
      const thresholdPctWhole = thresholdBps / 100n;
      const ratio = parseInt(ratioBps.toString(), 10) / 10_000;
      const alert: SpendAlert = {
        month,
        timestamp: now.toISOString(),
        spendCents: this.state.monthlyTotalCents,
        capCents: caps.cap_usd_cents,
        ratio,
        message: `Phone monthly spend ($${formatUsdFromCents(currentSpend)} USD) reached ${pctWhole}.${pctTenth}% `
          + `of $${formatUsdFromCents(capCents)} USD cap (threshold: ${thresholdPctWhole}%)`,
      };

      this.state.alertsSent[month] = alert;
      this.log.warn(`SPEND ALERT: ${alert.message}`);

      if (this.onAlert) {
        try {
          this.onAlert(alert);
        } catch (e: any) {
          this.log.error(`Alert callback failed: ${e?.message ?? e}`);
        }
      }
    }
  }

  getState(): PhoneUsageState {
    return this.state;
  }

  getConfig(): PricingConfig {
    return this.config;
  }
}
