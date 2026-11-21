import {
  A2UIError,
  A2UI_MASK_PLACEHOLDER,
  prepareModelSafeToolResult,
  validateAndBindA2UISurface,
} from './a2ui-surface';

describe('T167 A2UI spike for assistant answers', () => {
  const rawToolResult = {
    summary: { openInvoices: 12, overdueCount: 3 },
    rows: [
      {
        invoiceNo: 'INV-101',
        customer: 'Acme GmbH',
        iban: 'DE89370400440532013000',
        nationalId: '0012345678',
      },
    ],
    chartSeries: [
      { month: '2026-09', value: 120 },
      { month: '2026-10', value: 145 },
    ],
    confirmPayload: { action: 'send_reminder', invoiceNo: 'INV-101' },
  };
  const maskedFields = ['iban', 'nationalId'] as const;

  it('rejects any unknown component type fail-closed', () => {
    expect(() =>
      validateAndBindA2UISurface({
        rawSurface: {
          surfaceId: 's-bad',
          components: [{ id: 'c1', type: 'raw_html', bind: 'rows' }],
        },
        toolResult: rawToolResult,
        maskedFields,
        context: { surface: 'home_hub', a2uiHomeHubEnabled: true },
      }),
    ).toThrow(A2UIError);

    try {
      validateAndBindA2UISurface({
        rawSurface: {
          surfaceId: 's-bad',
          components: [{ id: 'c1', type: 'script_widget' }],
        },
        toolResult: rawToolResult,
        maskedFields,
        context: { surface: 'home_hub', a2uiHomeHubEnabled: true },
      });
    } catch (err) {
      expect((err as A2UIError).code).toBe('A2UI_UNKNOWN_COMPONENT');
    }
  });

  it('never leaks a masked value into the model payload or bound surface', () => {
    const modelPayload = prepareModelSafeToolResult(rawToolResult, maskedFields);
    const serialized = JSON.stringify(modelPayload);
    expect(serialized).not.toContain('DE89370400440532013000');
    expect(serialized).not.toContain('0012345678');
    expect(serialized).toContain(A2UI_MASK_PLACEHOLDER);

    const surface = validateAndBindA2UISurface({
      rawSurface: {
        surfaceId: 's-masked',
        components: [{ id: 't1', type: 'table', title: 'Invoices', bind: 'rows' }],
      },
      toolResult: rawToolResult,
      maskedFields,
      context: { surface: 'home_hub', a2uiHomeHubEnabled: true },
    });
    const boundJson = JSON.stringify(surface);
    expect(boundJson).not.toContain('DE89370400440532013000');
    expect(boundJson).not.toContain('0012345678');
    expect((surface.components[0].data as Array<Record<string, unknown>>)[0].iban).toBe(
      A2UI_MASK_PLACEHOLDER,
    );
  });

  it('enforces Home-hub-only feature flag', () => {
    expect(() =>
      validateAndBindA2UISurface({
        rawSurface: { surfaceId: 's-off', components: [] },
        toolResult: rawToolResult,
        maskedFields,
        context: { surface: 'home_hub', a2uiHomeHubEnabled: false },
      }),
    ).toThrow(/disabled/i);

    expect(() =>
      validateAndBindA2UISurface({
        rawSurface: { surfaceId: 's-other', components: [] },
        toolResult: rawToolResult,
        maskedFields,
        context: { surface: 'accounting_ledger', a2uiHomeHubEnabled: true },
      }),
    ).toThrow(/home_hub/i);
  });

  it('binds all four whitelisted component types (table, kpi_tile, chart, confirm_form)', () => {
    const surface = validateAndBindA2UISurface({
      rawSurface: {
        surfaceId: 's-all',
        components: [
          { id: 'c1', type: 'kpi_tile', title: 'Open invoices', bind: 'summary.openInvoices' },
          { id: 'c2', type: 'table', title: 'Invoices', bind: 'rows' },
          { id: 'c3', type: 'chart', title: 'Trend', bind: 'chartSeries' },
          { id: 'c4', type: 'confirm_form', title: 'Confirm', bind: 'confirmPayload' },
        ],
      },
      toolResult: rawToolResult,
      maskedFields,
      context: { surface: 'home_hub', a2uiHomeHubEnabled: true },
    });

    expect(surface.components).toHaveLength(4);
    expect(surface.components[0].data).toBe(12);
    expect(surface.components[2].type).toBe('chart');
    expect(surface.components[3].data).toEqual({
      action: 'send_reminder',
      invoiceNo: 'INV-101',
    });
  });
});
