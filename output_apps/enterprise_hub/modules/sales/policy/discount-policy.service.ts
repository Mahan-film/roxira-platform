import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { SystemRole } from '../../access/catalogue';
import { PolicyService } from '../../tenants/policy/policy.service';

export interface LineDiscountInput {
  discountPercent?: number;
  discountAmountMinor?: bigint;
  grossAmountMinor?: bigint;
}

export interface DiscountCheckResult {
  allowed: boolean;
  warning?: string;
  maxDiscount: number;
  limit: number;
}

/**
 * Role-based discount limit policy (#584 item 7):
 * Restricts maximum discount percentage on sales lines or documents based on user role.
 */
@Injectable()
export class DiscountPolicyService {
  constructor(private readonly policyService: PolicyService) {}

  /**
   * Evaluates line discounts and document-level discount percentage against the user's role limit.
   */
  async checkDiscount(
    tenantId: string,
    roleKey: string,
    lines: LineDiscountInput[],
    invoiceDiscountPercent: number = 0,
    manager?: EntityManager,
  ): Promise<DiscountCheckResult> {
    const enforcement = (await this.policyService.get(
      tenantId,
      'sales.discount.enforcement',
      manager,
    )) as string;

    if (enforcement === 'off') {
      return { allowed: true, maxDiscount: 0, limit: 100 };
    }

    // Determine role discount limit
    const roleLimit = await this.resolveRoleLimit(tenantId, roleKey, manager);

    // Calculate maximum discount percentage requested
    let maxRequestedPercent = invoiceDiscountPercent > 0 ? invoiceDiscountPercent : 0;

    for (const line of lines) {
      let percent = line.discountPercent ?? 0;
      if (percent <= 0 && line.discountAmountMinor && line.grossAmountMinor && line.grossAmountMinor > 0n) {
        if (line.discountAmountMinor * 100n > line.grossAmountMinor * BigInt(roleLimit)) {
          const ratio = (line.discountAmountMinor * 100n) / line.grossAmountMinor;
          percent = Number(ratio);
        }
      }
      if (percent > maxRequestedPercent) {
        maxRequestedPercent = percent;
      }
    }

    if (maxRequestedPercent > roleLimit) {
      if (enforcement === 'refuse') {
        throw new BadRequestException(
          `درصد تخفیف اعمال‌شده (${maxRequestedPercent}٪) از سقف مجاز نقش شما (${roleLimit}٪) فراتر است.`,
        );
      }
      return {
        allowed: true,
        warning: `درصد تخفیف اعمال‌شده (${maxRequestedPercent}٪) از سقف مجاز نقش (${roleLimit}٪) فراتر است.`,
        maxDiscount: maxRequestedPercent,
        limit: roleLimit,
      };
    }

    return {
      allowed: true,
      maxDiscount: maxRequestedPercent,
      limit: roleLimit,
    };
  }

  private async resolveRoleLimit(
    tenantId: string,
    roleKey: string,
    manager?: EntityManager,
  ): Promise<number> {
    const normalizedRole = (roleKey || '').toLowerCase();
    if (normalizedRole === SystemRole.OWNER || normalizedRole === SystemRole.ADMIN || normalizedRole === 'admin') {
      return 100;
    }

    if (normalizedRole.includes('manager') || normalizedRole === 'sales_manager') {
      const managerLimit = (await this.policyService.get(
        tenantId,
        'sales.discount.max_percent_manager',
        manager,
      )) as number;
      return managerLimit ?? 25;
    }

    const agentLimit = (await this.policyService.get(
      tenantId,
      'sales.discount.max_percent_agent',
      manager,
    )) as number;
    return agentLimit ?? 10;
  }
}
