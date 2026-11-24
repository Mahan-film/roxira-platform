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
  costCents: number;
  lastCallAt: string;
}

export interface DayUsage {
  totalCalls: number;
  totalConnectedSeconds: number;
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
  monthlyVariableCents: number;
  monthlyTotalCents: number;
  dailyUsage: Record<string, DayUsage>;
  alertsSent: Record<string, SpendAlert>;
}

const DEFAULT_PRICING_REL = '../../../config/phone_pricing.json';

/** Validates whether current time falls within effective date bounds. */
export function isConfigEffective(dates: EffectiveDates, now: Date = new Date()): boolean {
  const from = new Date(dates.valid_from).getTime();
  const to = new Date(dates.valid_to).getTime();
  const t = now.getTime();
  return t >= from && t <= to;
}

/** Resolves and loads the phone pricing config from JSON. */
export function loadPricingConfig(customPath?: string): PricingConfig {
  const resolved = customPath
    ? path.resolve(customPath)
    : (process.env.PHONE_PRICING_JSON
      ? path.resolve(process.env.PHONE_PRICING_JSON)
      : path.resolve(import.meta.dirname, DEFAULT_PRICING_REL));

  if (!fs.existsSync(resolved)) {
    throw new Error(`Phone pricing configuration not found at ${resolved}`);
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

  const durationSeconds = Math.max(0, params.durationSeconds);
  const carrierBillableSeconds = calculateCarrierBillableSeconds(durationSeconds, carrier);
  const livekitBillableSeconds = calculateLiveKitBillableSeconds(durationSeconds, plan);

  // Carrier cost: (billable seconds / 60) * inbound rate + optional voice API fee
  const carrierRate = carrier.inbound_per_minute_usd_cents + (carrier.voice_api_fee_per_minute_usd_cents || 0);
  const carrierCostCents = (carrierBillableSeconds / 60) * carrierRate;

  // LiveKit cost: (billable seconds / 60) * agent rate (+ obs rate)
  const livekitAgentCostCents = (livekitBillableSeconds / 60) * plan.agent_minute_usd_cents;
  const livekitObsCostCents = params.enableObservability
    ? (livekitBillableSeconds / 60) * plan.observability_minute_usd_cents
    : 0;

  // Speech costs
  let sttCostCents = 0;
  if (params.sttKey && config.speech_models?.stt[params.sttKey]) {
    const rate = config.speech_models.stt[params.sttKey].usd_cents_per_minute || 0;
    sttCostCents = (durationSeconds / 60) * rate;
  }

  let ttsCostCents = 0;
  if (params.ttsKey && config.speech_models?.tts[params.ttsKey] && params.ttsChars) {
    const ratePer1k = config.speech_models.tts[params.ttsKey].usd_cents_per_1k_chars || 0;
    ttsCostCents = (params.ttsChars / 1000) * ratePer1k;
  }

  const totalCostCents = carrierCostCents + livekitAgentCostCents + livekitObsCostCents + sttCostCents + ttsCostCents;

  return {
    durationSeconds,
    carrierBillableSeconds,
    livekitBillableSeconds,
    carrierCostCents,
    livekitAgentCostCents,
    livekitObsCostCents,
    sttCostCents,
    ttsCostCents,
    totalCostCents,
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

  private loadState(): PhoneUsageState {
    const month = this.getCurrentMonthKey();
    const plan = this.config.platform_plans[this.planKey] ?? this.config.platform_plans.self_hosted;
    const fixedFee = plan.monthly_fee_usd_cents || 0;

    const defaultState: PhoneUsageState = {
      updatedAt: new Date().toISOString(),
      currentMonth: month,
      monthlyFixedFeeCents: fixedFee,
      monthlyVariableCents: 0,
      monthlyTotalCents: fixedFee,
      dailyUsage: {},
      alertsSent: {},
    };

    try {
      if (fs.existsSync(this.statePath)) {
        const raw = fs.readFileSync(this.statePath, 'utf8');
        const loaded = JSON.parse(raw) as PhoneUsageState;
        if (loaded.currentMonth === month) {
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

  private saveState(): void {
    try {
      const dir = path.dirname(this.statePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.state.updatedAt = new Date().toISOString();
      const tmpPath = `${this.statePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.statePath);
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

    // 1. Monthly Spend Cap
    const monthlySpend = this.state.currentMonth === month
      ? this.state.monthlyTotalCents
      : (this.config.platform_plans[this.planKey]?.monthly_fee_usd_cents || 0);

    if (monthlySpend >= caps.monthly_spend_cap.cap_usd_cents) {
      return {
        allowed: false,
        reason: 'monthly_spend_cap_exceeded',
        detail: `Monthly spend (${(monthlySpend / 100).toFixed(2)} USD) reached cap of ${(caps.monthly_spend_cap.cap_usd_cents / 100).toFixed(2)} USD`,
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

      // 4. Per-Caller Daily Caps
      if (callerId) {
        const callerUsage = day.callers[callerId];
        if (callerUsage) {
          if (callerUsage.calls >= caps.per_caller_daily.max_calls) {
            return {
              allowed: false,
              reason: 'caller_daily_calls_exceeded',
              detail: `Caller ${callerId} reached daily call cap (${caps.per_caller_daily.max_calls})`,
            };
          }
          if (callerUsage.connectedSeconds >= caps.per_caller_daily.max_connected_seconds) {
            return {
              allowed: false,
              reason: 'caller_daily_seconds_exceeded',
              detail: `Caller ${callerId} reached daily duration cap (${caps.per_caller_daily.max_connected_seconds}s)`,
            };
          }
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
    const now = params.now ?? new Date();
    const today = this.getTodayKey(now);
    const month = this.getCurrentMonthKey(now);

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
      this.state.monthlyVariableCents = 0;
      this.state.monthlyTotalCents = this.state.monthlyFixedFeeCents;
    }

    if (!this.state.dailyUsage[today]) {
      this.state.dailyUsage[today] = {
        totalCalls: 0,
        totalConnectedSeconds: 0,
        totalCostCents: 0,
        callers: {},
      };
    }

    const day = this.state.dailyUsage[today];
    day.totalCalls += 1;
    day.totalConnectedSeconds += params.durationSeconds;
    day.totalCostCents += breakdown.totalCostCents;

    if (params.callerId) {
      if (!day.callers[params.callerId]) {
        day.callers[params.callerId] = {
          calls: 0,
          connectedSeconds: 0,
          costCents: 0,
          lastCallAt: now.toISOString(),
        };
      }
      const c = day.callers[params.callerId];
      c.calls += 1;
      c.connectedSeconds += params.durationSeconds;
      c.costCents += breakdown.totalCostCents;
      c.lastCallAt = now.toISOString();
    }

    this.state.monthlyVariableCents += breakdown.totalCostCents;
    this.state.monthlyTotalCents = this.state.monthlyFixedFeeCents + this.state.monthlyVariableCents;

    // Check 80% monthly spend alert threshold
    this.checkSpendAlert(month, now);

    this.saveState();
    return breakdown;
  }

  private checkSpendAlert(month: string, now: Date): void {
    const caps = this.config.abuse_caps.monthly_spend_cap;
    const thresholdCents = caps.cap_usd_cents * caps.alert_threshold_ratio;
    const currentSpend = this.state.monthlyTotalCents;

    if (currentSpend >= thresholdCents && !this.state.alertsSent[month]) {
      const ratio = currentSpend / caps.cap_usd_cents;
      const alert: SpendAlert = {
        month,
        timestamp: now.toISOString(),
        spendCents: currentSpend,
        capCents: caps.cap_usd_cents,
        ratio,
        message: `Phone monthly spend (${(currentSpend / 100).toFixed(2)} USD) reached ${(ratio * 100).toFixed(1)}% `
          + `of ${(caps.cap_usd_cents / 100).toFixed(2)} USD cap (threshold: ${(caps.alert_threshold_ratio * 100).toFixed(0)}%)`,
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
