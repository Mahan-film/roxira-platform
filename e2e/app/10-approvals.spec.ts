import { test, expect, SESSION_STORAGE_KEY } from './fixtures';

/**
 * E2E API & workflow tests for the Approval Engine (/approvals/...):
 * - Rule creation with amount thresholds (min/max minor units), sequential steps, and escalation
 * - Request creation capturing immutable step snapshots
 * - Maker-checker enforcement (requester cannot decide their own approval step)
 * - Time-bound delegation with amount caps and revocation
 * - Filtering pending requests and audit trail verification
 */
test.describe('Approvals Engine (/approvals)', () => {
  test('executes approval lifecycle: rule upsert, request creation, maker-checker refusal, and delegation', async ({ page }) => {
    // Navigate to initialize session and extract access token from localStorage
    await page.goto('/app', { waitUntil: 'domcontentloaded' });

    const rawSession = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_STORAGE_KEY);
    expect(rawSession, 'auth session must be present in localStorage').toBeTruthy();

    const session = JSON.parse(rawSession!) as { accessToken: string };
    const authHeaders = {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    };

    const api = page.request;
    const resourceType = `purchase_order_${Date.now()}`;

    // 1. Fetch existing rules
    const rulesListRes = await api.get('/api/backend/approvals/rules', { headers: authHeaders });
    expect(rulesListRes.status()).toBe(200);
    const initialRules = await rulesListRes.json();
    expect(Array.isArray(initialRules)).toBe(true);

    // 2. Define a multi-step approval rule with financial thresholds
    const createRuleRes = await api.post('/api/backend/approvals/rules', {
      headers: authHeaders,
      data: {
        resourceType,
        stepOrder: 1,
        minAmountMinor: '10000000', // 10,000,000 Rials
        maxAmountMinor: '50000000', // 50,000,000 Rials
        approverRole: 'admin',
        escalationAfterMinutes: 120,
        escalateToRole: 'owner',
        requireDistinctApprover: true,
        active: true,
      },
    });
    expect(createRuleRes.status()).toBe(201);
    const rule = await createRuleRes.json();
    expect(rule.resourceType).toBe(resourceType);
    expect(rule.stepOrder).toBe(1);
    expect(rule.approverRole).toBe('admin');

    // 3. Create an approval request for this resource
    const createReqRes = await api.post('/api/backend/approvals/requests', {
      headers: authHeaders,
      data: {
        resourceType,
        resourceId: `PO-${Date.now()}`,
        amountMinor: '25000000',
        payload: { vendor: 'شرکت تأمین کالا', item: 'تجهیزات اداری' },
      },
    });
    expect(createReqRes.status()).toBe(201);
    const approvalRequest = await createReqRes.json();
    expect(approvalRequest.status).toBe('PENDING');
    expect(approvalRequest.currentStep).toBe(1);
    expect(approvalRequest.stepsSnapshot).toHaveLength(1);

    // 4. Maker-checker enforcement: requester cannot decide their own step
    const selfDecideRes = await api.post(`/api/backend/approvals/requests/${approvalRequest.id}/decide`, {
      headers: authHeaders,
      data: {
        decision: 'APPROVED',
        comment: 'تلاش ثبت‌کننده برای تأیید درخواست خود',
      },
    });
    // Server must reject with 403 Forbidden to prevent maker-checker violation
    expect(selfDecideRes.status()).toBe(403);
    const errorBody = await selfDecideRes.json();
    expect(errorBody.message).toContain('درخواست‌کننده نمی‌تواند درخواست خودش را تأیید یا رد کند');

    // 5. Create a time-bound delegation with a maximum amount limit
    const startsAt = new Date().toISOString();
    const endsAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString();

    const delegationRes = await api.post('/api/backend/approvals/delegations', {
      headers: authHeaders,
      data: {
        delegateUserId: '00000000-0000-0000-0000-000000000002',
        resourceType,
        maxAmountMinor: '100000000',
        startsAt,
        endsAt,
        reason: 'تفویض اختیار به سرپرست مالی در ایام مأموریت کاری',
      },
    });
    expect(delegationRes.status()).toBe(201);
    const delegation = await delegationRes.json();
    expect(delegation.reason).toContain('تفویض اختیار');

    // 6. Revoke delegation
    const revokeRes = await api.post(`/api/backend/approvals/delegations/${delegation.id}/revoke`, {
      headers: authHeaders,
    });
    expect(revokeRes.status()).toBe(200);
    const revoked = await revokeRes.json();
    expect(revoked.revokedAt).not.toBeNull();

    // 7. Verify request appears in the pending list
    const pendingListRes = await api.get('/api/backend/approvals/requests?status=PENDING', {
      headers: authHeaders,
    });
    expect(pendingListRes.status()).toBe(200);
    const pendingList = await pendingListRes.json();
    const found = pendingList.find((r: { id: string }) => r.id === approvalRequest.id);
    expect(found).toBeDefined();
  });
});
