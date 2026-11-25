import {
  CanonicalRemunerationCode,
  PayrollGlRole,
  RemunerationLineItem,
  RemunerationSummary,
} from './remuneration-taxonomy';

/**
 * Execution seam for country-pack payroll engines (T260 / #1055, R24).
 *
 * - `native`: calculated directly inside Roxira's TypeScript bitemporal kernel
 *   (e.g. default pack and future native packs).
 * - `partner_handoff`: validated and exported to a certified external payroll engine
 *   (e.g. DATEV Lohn-Datenservices) without self-certifying local payroll authorities.
 */
export type PayrollExecutionMode = 'native' | 'partner_handoff';

export interface PayrollEmployeeInput {
  readonly employeeId: string;
  readonly contractId: string;
  readonly costCenterCode?: string | null;
  readonly branchId?: string | null;
  /** Base and variable pay inputs expressed in canonical codes and integer minor units. */
  readonly inputLines: readonly RemunerationLineItem[];
}

export interface PayrollExecutionContext {
  readonly tenantId: string;
  readonly payrunId: string;
  readonly packCode: string;
  readonly currency: string;
  /** Pay period start/end (ISO calendar dates YYYY-MM-DD). */
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Bitemporal evaluation date (ISO-8601 UTC) determining which effective-dated rules apply. */
  readonly evaluationDate: string;
  readonly employees: readonly PayrollEmployeeInput[];
}

export interface PayrollValidationIssue {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
  readonly employeeId?: string;
}

export interface PayrollValidationResult {
  readonly valid: boolean;
  readonly issues: readonly PayrollValidationIssue[];
}

export interface EmployeePayrunResult {
  readonly employeeId: string;
  readonly lines: readonly RemunerationLineItem[];
  readonly summary: RemunerationSummary;
}

export interface PayrollGlPostingLine {
  readonly glRole: PayrollGlRole;
  readonly debitMinor: bigint;
  readonly creditMinor: bigint;
  readonly costCenterCode?: string | null;
  readonly branchId?: string | null;
}

export interface PayrollExecutionResult {
  readonly providerId: string;
  readonly packCode: string;
  readonly payrunId: string;
  readonly mode: PayrollExecutionMode;
  readonly currency: string;
  readonly calculatedAt: string;
  readonly employees: readonly EmployeePayrunResult[];
  /** Exact sum of every employee's netPayMinor (must equal bank disbursement total). */
  readonly totalNetPayMinor: bigint;
  readonly totalEmployerCostMinor: bigint;
  /** Balanced GL posting proposal lines (sum(debitMinor) === sum(creditMinor)). */
  readonly glPostingLines: readonly PayrollGlPostingLine[];
}

export interface PayrollExportContext {
  readonly tenantId: string;
  readonly payrunId: string;
  readonly packCode: string;
  readonly format: 'bank_file' | 'statutory_filing' | 'partner_handoff';
  readonly executionResult: PayrollExecutionResult;
}

export interface PayrollSubmissionArtifact {
  readonly format: PayrollExportContext['format'];
  readonly filename: string;
  readonly mimeType: string;
  readonly sha256: string;
  readonly payload: Buffer;
}

export interface PayrollExecutionProvider {
  readonly providerId: string;
  readonly packCode: string;
  readonly mode: PayrollExecutionMode;
  readonly supportsRetroDelta: boolean;
  readonly supportedComponentCodes: ReadonlySet<CanonicalRemunerationCode>;

  validateInputs(ctx: PayrollExecutionContext): Promise<PayrollValidationResult>;
  executePayrun(ctx: PayrollExecutionContext): Promise<PayrollExecutionResult>;
  exportSubmission?(ctx: PayrollExportContext): Promise<PayrollSubmissionArtifact>;
}

/** NestJS DI multi-provider token for registered PayrollExecutionProvider implementations. */
export const PAYROLL_EXECUTION_PROVIDERS = Symbol('PAYROLL_EXECUTION_PROVIDERS');

/**
 * Fail-closed registry for `PayrollExecutionProvider` implementations.
 * Never falls back to another pack when a requested pack/provider is missing.
 */
export class PayrollExecutionProviderRegistry {
  private readonly byPack = new Map<string, PayrollExecutionProvider>();
  private readonly byId = new Map<string, PayrollExecutionProvider>();

  constructor(providers: readonly PayrollExecutionProvider[] = []) {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  register(provider: PayrollExecutionProvider): void {
    const packKey = provider.packCode.trim().toLowerCase();
    const idKey = provider.providerId.trim().toLowerCase();
    if (!packKey || !idKey) {
      throw new Error('PayrollExecutionProvider must declare non-empty packCode and providerId.');
    }
    if (this.byPack.has(packKey)) {
      throw new Error(`Duplicate PayrollExecutionProvider for packCode "${provider.packCode}".`);
    }
    if (this.byId.has(idKey)) {
      throw new Error(`Duplicate PayrollExecutionProvider for providerId "${provider.providerId}".`);
    }
    this.byPack.set(packKey, provider);
    this.byId.set(idKey, provider);
  }

  resolveForPack(packCode: string): PayrollExecutionProvider {
    const provider = this.byPack.get(packCode.trim().toLowerCase());
    if (!provider) {
      throw new Error(`No PayrollExecutionProvider registered for pack "${packCode}".`);
    }
    return provider;
  }

  resolveById(providerId: string): PayrollExecutionProvider {
    const provider = this.byId.get(providerId.trim().toLowerCase());
    if (!provider) {
      throw new Error(`No PayrollExecutionProvider registered with id "${providerId}".`);
    }
    return provider;
  }

  listRegisteredPacks(): string[] {
    return Array.from(this.byPack.keys()).sort();
  }
}
