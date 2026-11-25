import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  calculateCarrierBillableSeconds,
  calculateLiveKitBillableSeconds,
  calculateCallCost,
  isConfigEffective,
  loadPricingConfig,
  PhoneCostTracker,
  type CarrierPricing,
  type PlatformPlan,
  type PricingConfig,
  type SpendAlert,
} from './cost-caps.js';

test('loadPricingConfig loads real config and validates effective dates', () => {
  const config = loadPricingConfig();
  assert.ok(config.version);
  assert.ok(config.effective_dates.valid_from);
  assert.ok(config.effective_dates.valid_to);
  assert.equal(isConfigEffective(config.effective_dates, new Date('2026-11-24T12:00:00Z')), true);
  assert.equal(isConfigEffective(config.effective_dates, new Date('2025-01-01T00:00:00Z')), false);
  assert.equal(isConfigEffective(config.effective_dates, new Date('2029-01-01T00:00:00Z')), false);
});

test('pricing config contains required primary-check flags and notes', () => {
  const config = loadPricingConfig();
  const scalePlan = config.platform_plans.livekit_cloud_scale;
  assert.ok(scalePlan);
  assert.equal(scalePlan.monthly_fee_usd_cents, 50000); // $500/mo
  assert.equal(scalePlan.agent_minute_usd_cents, 1.0); // $0.01/agent-min
  assert.equal(scalePlan.observability_minute_usd_cents, 1.0); // $0.01/obs-min
  assert.equal(scalePlan.minimum_duration_seconds, 10); // 10s minimum
  assert.equal(scalePlan.verified, false); // requires primary check
  assert.ok(scalePlan.source);

  const telnyx = config.carriers.telnyx;
  assert.ok(telnyx);
  assert.equal(telnyx.billing_increment_seconds, 60); // 60/60 rounding
  assert.equal(telnyx.minimum_duration_seconds, 60);
  assert.equal(telnyx.verified, false);

  const twilio = config.carriers.twilio;
  assert.ok(twilio);
  assert.equal(twilio.billing_increment_seconds, 60);
  assert.equal(twilio.verified, true);
});

test('calculateCarrierBillableSeconds enforces 60/60 rounding and 1/1 increments', () => {
  const carrier60: CarrierPricing = {
    name: 'test-60',
    did_monthly_usd_cents: 100,
    inbound_per_minute_usd_cents: 0.6,
    outbound_landline_per_minute_usd_cents: 2.0,
    outbound_mobile_per_minute_usd_cents: 3.5,
    billing_increment_seconds: 60,
    minimum_duration_seconds: 60,
    verified: true,
    source: 'test',
  };

  assert.equal(calculateCarrierBillableSeconds(0, carrier60), 0);
  assert.equal(calculateCarrierBillableSeconds(5, carrier60), 60);
  assert.equal(calculateCarrierBillableSeconds(59, carrier60), 60);
  assert.equal(calculateCarrierBillableSeconds(60, carrier60), 60);
  assert.equal(calculateCarrierBillableSeconds(61, carrier60), 120);
  assert.equal(calculateCarrierBillableSeconds(120, carrier60), 120);
  assert.equal(calculateCarrierBillableSeconds(121, carrier60), 180);

  const carrier1: CarrierPricing = {
    ...carrier60,
    billing_increment_seconds: 1,
    minimum_duration_seconds: 1,
  };

  assert.equal(calculateCarrierBillableSeconds(0, carrier1), 0);
  assert.equal(calculateCarrierBillableSeconds(12, carrier1), 12);
  assert.equal(calculateCarrierBillableSeconds(75, carrier1), 75);
});

test('calculateLiveKitBillableSeconds enforces 10s minimum on Scale plan', () => {
  const planScale: PlatformPlan = {
    name: 'Scale',
    monthly_fee_usd_cents: 50000,
    agent_minute_usd_cents: 1.0,
    observability_minute_usd_cents: 1.0,
    minimum_duration_seconds: 10,
    billing_increment_seconds: 1,
    verified: false,
    source: 'test',
  };

  assert.equal(calculateLiveKitBillableSeconds(0, planScale), 0);
  assert.equal(calculateLiveKitBillableSeconds(3, planScale), 10);
  assert.equal(calculateLiveKitBillableSeconds(10, planScale), 10);
  assert.equal(calculateLiveKitBillableSeconds(45, planScale), 45);
});

test('calculateCallCost accurately models carrier rounding and LiveKit Scale fee in integer micro-cents', () => {
  const config = loadPricingConfig();
  // 65s call on Telnyx (60s rounding -> 120s billable) on LiveKit Scale
  const cost = calculateCallCost({
    durationSeconds: 65,
    carrierKey: 'telnyx',
    planKey: 'livekit_cloud_scale',
    enableObservability: true,
  }, config);

  assert.equal(cost.durationSeconds, 65);
  assert.equal(cost.carrierBillableSeconds, 120); // 65s rounded up to 2 mins
  assert.equal(cost.livekitBillableSeconds, 65);

  // Telnyx inbound: (0.32 + 0.20) = 0.52 cents/min * 2 mins = 1.04 cents = 1,040,000 micro-cents
  assert.equal(cost.carrierCostMicroCents, 1_040_000);
  assert.equal(cost.carrierCostCents, 1);
  // LiveKit: (65 / 60) * 1.0 = 1.083333 cents = 1,083,333 micro-cents each
  assert.equal(cost.livekitAgentCostMicroCents, 1_083_333);
  assert.equal(cost.livekitObsCostMicroCents, 1_083_333);
  assert.equal(cost.totalCostMicroCents, 3_206_666);
  assert.equal(cost.totalCostCents, 3);
});

test('calculateCallCost uses outbound_landline and outbound_mobile rates when direction is specified', () => {
  const config = loadPricingConfig();
  const carrier = config.carriers.telnyx;
  const landline = calculateCallCost({
    durationSeconds: 60,
    direction: 'outbound_landline',
    carrierKey: 'telnyx',
    planKey: 'self_hosted',
  }, config);
  const mobile = calculateCallCost({
    durationSeconds: 60,
    direction: 'outbound_mobile',
    carrierKey: 'telnyx',
    planKey: 'self_hosted',
  }, config);

  const expectedLandlineMicro = Math.round((carrier.outbound_landline_per_minute_usd_cents + (carrier.voice_api_fee_per_minute_usd_cents || 0)) * 1_000_000);
  const expectedMobileMicro = Math.round((carrier.outbound_mobile_per_minute_usd_cents + (carrier.voice_api_fee_per_minute_usd_cents || 0)) * 1_000_000);
  assert.equal(landline.carrierCostMicroCents, expectedLandlineMicro);
  assert.equal(mobile.carrierCostMicroCents, expectedMobileMicro);
});

test('PhoneCostTracker accumulates micro-cents without sub-cent rounding loss and buckets empty callerId', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-test-'));
  const statePath = path.join(tmpDir, 'usage.json');
  const config = loadPricingConfig();

  const tracker = new PhoneCostTracker({
    config,
    statePath,
    planKey: 'livekit_cloud_scale',
    carrierKey: 'telnyx',
  });

  const now = new Date('2026-11-24T10:00:00Z');
  // Five 20s calls with empty callerId -> hits per-caller cap in __unknown__ bucket
  // Each 20s Telnyx + LiveKit Scale call: 60s carrier (520,000 uC) + 20s LK (333,333 uC) = 853,333 uC
  for (let i = 0; i < 5; i++) {
    assert.equal(tracker.checkCallAdmission('', now).allowed, true);
    tracker.recordCompletedCall({
      callerId: '',
      roomName: `unknown-${i}`,
      durationSeconds: 20,
      now,
    });
  }

  const denied = tracker.checkCallAdmission('', now);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'caller_daily_calls_exceeded');

  // 5 * 853,333 = 4,266,665 uC -> 4 cents (whereas rounding 1 cent per call would lose/drift to 5)
  const st = tracker.getState();
  assert.equal(st.monthlyVariableMicroCents, 4_266_665);
  assert.equal(st.monthlyVariableCents, 4);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('PhoneCostTracker enforces per-caller daily call cap', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-test-'));
  const statePath = path.join(tmpDir, 'usage.json');
  const config = loadPricingConfig();

  const tracker = new PhoneCostTracker({
    config,
    statePath,
    planKey: 'self_hosted',
    carrierKey: 'sabanet',
  });

  const caller = 'sip_+989121111111';
  const now = new Date('2026-11-24T10:00:00Z');

  // Cap is 5 calls/day
  for (let i = 0; i < 5; i++) {
    const admission = tracker.checkCallAdmission(caller, now);
    assert.equal(admission.allowed, true, `Call ${i + 1} should be admitted`);
    tracker.recordCompletedCall({
      callerId: caller,
      roomName: `call-${i}`,
      durationSeconds: 60,
      now,
    });
  }

  // 6th call from same caller is denied
  const admissionDenied = tracker.checkCallAdmission(caller, now);
  assert.equal(admissionDenied.allowed, false);
  assert.equal(admissionDenied.reason, 'caller_daily_calls_exceeded');

  // Another caller is still admitted
  const otherCaller = 'sip_+989122222222';
  assert.equal(tracker.checkCallAdmission(otherCaller, now).allowed, true);

  // Next day, previous caller is admitted again
  const nextDay = new Date('2026-11-25T10:00:00Z');
  assert.equal(tracker.checkCallAdmission(caller, nextDay).allowed, true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('PhoneCostTracker enforces per-caller daily duration cap', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-test-'));
  const statePath = path.join(tmpDir, 'usage.json');
  const config = loadPricingConfig();

  const tracker = new PhoneCostTracker({
    config,
    statePath,
    planKey: 'self_hosted',
    carrierKey: 'sabanet',
  });

  const caller = 'sip_+989123333333';
  const now = new Date('2026-11-24T10:00:00Z');

  // Record a call that uses 1800s (max duration)
  tracker.recordCompletedCall({
    callerId: caller,
    roomName: 'call-long',
    durationSeconds: 1800,
    now,
  });

  // Next call should be denied due to duration limit
  const decision = tracker.checkCallAdmission(caller, now);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'caller_daily_seconds_exceeded');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('PhoneCostTracker triggers alert at 80% monthly spend and blocks at 100%', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-test-'));
  const statePath = path.join(tmpDir, 'usage.json');
  const config = loadPricingConfig();

  const alerts: SpendAlert[] = [];
  const tracker = new PhoneCostTracker({
    config,
    statePath,
    planKey: 'livekit_cloud_scale', // $500 (50,000 cents) monthly fixed fee
    carrierKey: 'telnyx',
    onAlert: (alert) => alerts.push(alert),
  });

  const now = new Date('2026-11-24T12:00:00Z');
  // Monthly spend cap is 100,000 cents ($1,000).
  // Fixed fee is 50,000 cents ($500).
  // 80% threshold is 80,000 cents ($800).
  // Initial spend is 50,000 cents (50% of cap), so no alert yet.
  assert.equal(alerts.length, 0);

  // Add calls totaling 31,000 cents variable spend -> total 81,000 cents (81%)
  // At Telnyx rates (~$0.03/min with speech), let's record a simulated heavy call batch:
  tracker.recordCompletedCall({
    callerId: 'sip_+989129999999',
    roomName: 'call-batch',
    durationSeconds: 100,
    now,
  });

  // Artificially increment variable spend to test threshold transition
  const state = tracker.getState();
  state.monthlyVariableCents = 31000;
  state.monthlyTotalCents = state.monthlyFixedFeeCents + state.monthlyVariableCents; // 81,000 cents

  tracker.recordCompletedCall({
    callerId: 'sip_+989120000000',
    roomName: 'trigger-call',
    durationSeconds: 10,
    now,
  });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].month, '2026-11');
  assert.ok(alerts[0].ratio >= 0.80);
  assert.ok(alerts[0].message.includes('reached'));

  // Ensure duplicate alert is not sent on subsequent calls in the same month
  tracker.recordCompletedCall({
    callerId: 'sip_+989120000001',
    roomName: 'subsequent-call',
    durationSeconds: 10,
    now,
  });
  assert.equal(alerts.length, 1);

  // Reach 100% cap (100,000 cents)
  state.monthlyVariableCents = 55000;
  state.monthlyTotalCents = 105000;

  const decision = tracker.checkCallAdmission('sip_+989127777777', now);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'monthly_spend_cap_exceeded');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
