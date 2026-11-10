import { formatMoneyRial } from "./fa-format.ts";
import {
  ACTION_LABELS,
  MODULE_LABELS,
  SCOPE_TYPE_LABELS,
  SENSITIVE_FIELD_LABELS,
  SYSTEM_ROLE_LABELS,
  type AccessActionKey,
  type AccessModuleKey,
  type CustomRole,
  type FieldVisibilityMap,
  type Member,
  type RoleScope,
  type RoleScopeType,
  type SensitiveField,
} from "../types/access.ts";

export const CORE_MODULES: AccessModuleKey[] = ["members", "security", "audit"];

/**
 * Standard system role field visibility mapping, mirroring `modules/access/catalogue.ts`.
 * Salary is visible by default ONLY to owner and hr.
 */
export const SYSTEM_ROLE_FIELD_VISIBILITY: Record<string, FieldVisibilityMap> = {
  owner: { cost: true, margin: true, salary: true },
  admin: { cost: true, margin: true, salary: false },
  accountant: { cost: true, margin: true, salary: false },
  hr: { cost: false, margin: false, salary: true },
  sales: { cost: false, margin: true, salary: false },
  cheque_reviewer: { cost: false, margin: false, salary: false },
  read_only: { cost: false, margin: false, salary: false },
  legacy_member: { cost: false, margin: false, salary: false },
};

export function getEffectiveFieldVisibility(
  roleKey: string,
  customRole?: CustomRole | null,
): FieldVisibilityMap {
  if (roleKey === "custom" && customRole?.fieldVisibility) {
    return {
      cost: Boolean(customRole.fieldVisibility.cost),
      margin: Boolean(customRole.fieldVisibility.margin),
      salary: Boolean(customRole.fieldVisibility.salary),
    };
  }
  return SYSTEM_ROLE_FIELD_VISIBILITY[roleKey] ?? { cost: false, margin: false, salary: false };
}

export function getEffectiveScope(
  roleKey: string,
  customRole?: CustomRole | null,
  member?: Member | null,
): RoleScope {
  if (member?.branchScoped && member.branchId) {
    return { type: "branch", ids: [member.branchId] };
  }
  if (roleKey === "custom" && customRole?.scopeType) {
    return {
      type: customRole.scopeType,
      ids: customRole.scopeIds ?? [],
    };
  }
  return { type: "org", ids: [] };
}

/** Parses Persian or Latin digit string or number to clean positive integer Rials. */
export function parseRialAmount(value: string | bigint | number): bigint {
  if (typeof value === "bigint") return value < BigInt(0) ? BigInt(0) : value;
  const raw = String(value ?? "").trim();
  if (raw.startsWith("-")) return BigInt(0);
  const clean = raw
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[,\s٬]/g, "")
    .split(".")[0]
    .trim();
  if (!clean || !/^\d+$/.test(clean)) return BigInt(0);
  try {
    return BigInt(clean);
  } catch {
    return BigInt(0);
  }
}

export function formatRialDisplay(amount: bigint | number | string): string {
  const minor = typeof amount === "bigint" ? amount : parseRialAmount(amount);
  return formatMoneyRial(minor.toString());
}

export interface AccessEvaluationQuery {
  roleKey: string;
  customRole?: CustomRole | null;
  member?: Member | null;
  entitledModules?: string[];
  module: AccessModuleKey;
  action: AccessActionKey;
  amountRials?: string | number;
  branchId?: string | null;
  warehouseId?: string | null;
  field?: SensitiveField;
}

export interface CheckItem {
  nameFa: string;
  passed: boolean;
  messageFa: string;
}

export type AccessDeniedReasonCode =
  | "MODULE_NOT_ENTITLED"
  | "FORBIDDEN_ACTION"
  | "FORBIDDEN_FIELD"
  | "FORBIDDEN_SCOPE"
  | "AMOUNT_LIMIT_EXCEEDED";

export interface AccessEvaluationResult {
  allowed: boolean;
  code?: AccessDeniedReasonCode;
  summaryFa: string;
  reasonFa: string;
  remediationFa: string;
  checks: CheckItem[];
}

export function evaluateClientAccess(query: AccessEvaluationQuery): AccessEvaluationResult {
  const checks: CheckItem[] = [];
  const { roleKey, customRole, member, module, action } = query;
  const entitled = new Set(query.entitledModules ?? []);
  const roleName =
    roleKey === "custom" && customRole?.name
      ? `سفارشی (${customRole.name})`
      : SYSTEM_ROLE_LABELS[roleKey] ?? roleKey;

  // 1. Module Entitlement Check
  const isModuleEntitled = CORE_MODULES.includes(module) || entitled.has(module);
  if (!isModuleEntitled) {
    checks.push({
      nameFa: "فعال‌بودن ماژول در سازمان",
      passed: false,
      messageFa: `ماژول «${MODULE_LABELS[module]}» در بسته یا اشتراک فعال این سازمان فعال نشده است.`,
    });
    return {
      allowed: false,
      code: "MODULE_NOT_ENTITLED",
      summaryFa: "ماژول فعال نیست",
      reasonFa: `دسترسی به بخش «${MODULE_LABELS[module]}» امکان‌پذیر نیست، زیرا این ماژول در اشتراک فعال سازمان شما وجود ندارد.`,
      remediationFa: "مدیر سازمان می‌تواند از مسیر «تنظیمات > ماژول‌ها» درخواست فعال‌سازی یا ارتقای بسته را ارسال کند.",
      checks,
    };
  }
  checks.push({
    nameFa: "فعال‌بودن ماژول در سازمان",
    passed: true,
    messageFa: `ماژول «${MODULE_LABELS[module]}» در اشتراک فعال سازمان مجاز و فعال است.`,
  });

  // 2. Action Permission Check
  const targetPermission = `${module}:${action}`;
  let hasActionPermission = false;

  if (roleKey === "owner") {
    hasActionPermission = true;
  } else if (roleKey === "custom") {
    hasActionPermission = Boolean(customRole?.permissions?.includes(targetPermission));
  } else {
    // Standard system roles permissions mapping
    const systemPerms = getSystemRolePermissions(roleKey);
    hasActionPermission = systemPerms.includes(targetPermission);
  }

  if (!hasActionPermission) {
    checks.push({
      nameFa: "مجوز اقدام در نقش",
      passed: false,
      messageFa: `نقش «${roleName}» فاقد مجوز «${ACTION_LABELS[action]}» در ماژول «${MODULE_LABELS[module]}» (${targetPermission}) است.`,
    });
    return {
      allowed: false,
      code: "FORBIDDEN_ACTION",
      summaryFa: "مجوز اقدام وجود ندارد",
      reasonFa: `نقش «${roleName}» فاقد مجوز «${ACTION_LABELS[action]}» برای ماژول «${MODULE_LABELS[module]}» (${targetPermission}) است.`,
      remediationFa:
        roleKey === "custom"
          ? "در بخش «تنظیمات > اعضا و نقش‌ها > نقش‌ها»، این نقش را ویرایش کرده و تیک دسترسی مورد نظر را فعال نمایید."
          : `کاربر را به نقشی با اختیارات بالاتر (مانند ${action === "admin" ? "مدیر یا مالک" : "حسابدار یا مدیر"}) ارتقا دهید.`,
      checks,
    };
  }
  checks.push({
    nameFa: "مجوز اقدام در نقش",
    passed: true,
    messageFa: `نقش «${roleName}» دارای مجوز رسمی (${targetPermission}) است.`,
  });

  // 3. Sensitive Field Visibility Check
  if (query.field) {
    const visibility = getEffectiveFieldVisibility(roleKey, customRole);
    const fieldVisible = Boolean(visibility[query.field]);
    const fieldLabel = SENSITIVE_FIELD_LABELS[query.field];

    if (!fieldVisible) {
      checks.push({
        nameFa: `مشاهده فیلد حساس (${fieldLabel})`,
        passed: false,
        messageFa: `مشاهده اطلاعات فیلد «${fieldLabel}» برای نقش «${roleName}» مجاز نمی‌باشد.`,
      });
      return {
        allowed: false,
        code: "FORBIDDEN_FIELD",
        summaryFa: "فیلد حساس پنهان است",
        reasonFa: `اطلاعات «${fieldLabel}» به دلایل حفاظتی و محرمانگی برای این نقش مخفی شده است.`,
        remediationFa:
          query.field === "salary"
            ? "طبق قوانین محرمانگی، مبالغ حقوق و دستمزد فقط برای مالک و کارشناس منابع انسانی قابل مشاهده است."
            : "در صورت نیاز به مشاهده بهای تمام‌شده یا سود، در نقش سفارشی مربوطه دسترسی این فیلد را فعال کنید.",
        checks,
      };
    }
    checks.push({
      nameFa: `مشاهده فیلد حساس (${fieldLabel})`,
      passed: true,
      messageFa: `مشاهده فیلد «${fieldLabel}» برای این نقش مجاز است.`,
    });
  }

  // 4. Scope Check (Branch & Warehouse)
  const effectiveScope = getEffectiveScope(roleKey, customRole, member);

  if (query.branchId) {
    if (member?.branchScoped && member.branchId && member.branchId !== query.branchId) {
      checks.push({
        nameFa: "محدوده شعبه کاربر",
        passed: false,
        messageFa: `کاربر به شعبه اختصاصی (${member.branchId}) محدود شده و اجازه عملیات در شعبه هدف (${query.branchId}) را ندارد.`,
      });
      return {
        allowed: false,
        code: "FORBIDDEN_SCOPE",
        summaryFa: "خارج از محدوده شعبه کاربر",
        reasonFa: "این عملیات مربوط به شعبه‌ای دیگر است و کاربر به دلیل تنظیم «محدود به شعبه» مجاز به دسترسی به آن نیست.",
        remediationFa: "در صفحه اعضا، تنظیم «محدود به شعبه» کاربر را بررسی کرده یا شعبه انتسابی وی را اصلاح نمایید.",
        checks,
      };
    }

    if (effectiveScope.type === "branch" && !effectiveScope.ids.includes(query.branchId)) {
      checks.push({
        nameFa: "محدوده شعب نقش",
        passed: false,
        messageFa: `شعبه انتخابی در فهرست شعب مجاز نقش «${roleName}» وجود ندارد.`,
      });
      return {
        allowed: false,
        code: "FORBIDDEN_SCOPE",
        summaryFa: "شعبه خارج از حوزه نقش",
        reasonFa: "نقش این کاربر فقط برای شعب مشخصی معتبر است و شعبه درخواستی جزو آنها نیست.",
        remediationFa: "در تنظیمات نقش‌های سفارشی، این شعبه را به فهرست شعب مجاز نقش بیفزایید.",
        checks,
      };
    }
  }

  if (query.warehouseId) {
    if (effectiveScope.type === "warehouse" && !effectiveScope.ids.includes(query.warehouseId)) {
      checks.push({
        nameFa: "محدوده انبارهای نقش",
        passed: false,
        messageFa: `انبار انتخابی در فهرست انبارهای مجاز نقش «${roleName}» قرار ندارد.`,
      });
      return {
        allowed: false,
        code: "FORBIDDEN_SCOPE",
        summaryFa: "انبار خارج از حوزه نقش",
        reasonFa: "عملیات در این انبار مسدود است چون انبار هدف خارج از حوزه اختیارات نقش کاربر است.",
        remediationFa: "در ویرایش نقش سفارشی، انبار مدنظر را به انبارهای مجاز نقش تخصیص دهید.",
        checks,
      };
    }
  }

  checks.push({
    nameFa: "حوزه سازمانی و جغرافیایی",
    passed: true,
    messageFa: `عملیات در محدوده سازمانی مجاز (${SCOPE_TYPE_LABELS[effectiveScope.type]}) قرار دارد.`,
  });

  // 5. Amount Limit Check
  if (query.amountRials !== undefined && query.amountRials !== "") {
    const requestedAmount = parseRialAmount(query.amountRials);
    if (requestedAmount > BigInt(0) && roleKey !== "owner") {
      const limits = customRole?.amountLimits ?? {};
      const rawLimit = limits[targetPermission] ?? limits["*"];
      if (rawLimit !== undefined && rawLimit !== null && rawLimit !== "") {
        const allowedMax = parseRialAmount(rawLimit);
        if (allowedMax > BigInt(0) && requestedAmount > allowedMax) {
          checks.push({
            nameFa: "سقف ریالی تراکنش",
            passed: false,
            messageFa: `مبلغ تراکنش (${formatRialDisplay(requestedAmount)}) از سقف مجاز این نقش (${formatRialDisplay(allowedMax)}) بیشتر است.`,
          });
          return {
            allowed: false,
            code: "AMOUNT_LIMIT_EXCEEDED",
            summaryFa: "مبلغ فراتر از سقف مجاز",
            reasonFa: `مبلغ تراکنش (${formatRialDisplay(requestedAmount)}) بیشتر از سقف مجاز این نقش (${formatRialDisplay(allowedMax)}) است.`,
            remediationFa: "این سند باید توسط فردی با اختیارات مالی بالاتر تأیید/ثبت شود یا سقف ریالی نقش کاربر افزایش یابد.",
            checks,
          };
        }
      }
    }
  }
  checks.push({
    nameFa: "سقف ریالی تراکنش",
    passed: true,
    messageFa: "مبلغ تراکنش در محدوده سقف مجاز مالی این نقش قرار دارد یا نامحدود است.",
  });

  // All checks passed!
  return {
    allowed: true,
    summaryFa: "دسترسی مجاز است",
    reasonFa: `کلیه شرایط احراز هویت، مجوز عملیاتی (${targetPermission})، سقف ریالی و محدوده سازمانی تأیید گردید.`,
    remediationFa: "این عملیات مجاز است و کاربر می‌تواند بدون مانع آن را به انجام برساند.",
    checks,
  };
}

/** Standard system role permission mappings mirroring backend catalogue. */
function getSystemRolePermissions(roleKey: string): string[] {
  switch (roleKey) {
    case "admin":
      return [
        "accounting:read", "accounting:create", "accounting:approve", "accounting:post", "accounting:export", "accounting:admin",
        "banking:read", "banking:create", "banking:approve", "banking:post", "banking:export", "banking:admin",
        "cheques:read", "cheques:create", "cheques:approve", "cheques:post", "cheques:export", "cheques:admin",
        "invoicing:read", "invoicing:create", "invoicing:approve", "invoicing:post", "invoicing:export", "invoicing:admin",
        "tax:read", "tax:create", "tax:approve", "tax:post", "tax:export", "tax:admin",
        "crm:read", "crm:create", "crm:approve", "crm:post", "crm:export", "crm:admin",
        "hr:read", "hr:create", "hr:approve", "hr:post", "hr:export", "hr:admin",
        "inventory:read", "inventory:create", "inventory:approve", "inventory:post", "inventory:export", "inventory:admin",
        "damages:read", "damages:create", "damages:approve", "damages:post", "damages:export", "damages:admin",
        "data_import:read", "data_import:create", "data_import:approve", "data_import:post", "data_import:export", "data_import:admin",
        "assistant:read", "assistant:create", "assistant:approve", "assistant:post", "assistant:export", "assistant:admin",
        "members:read", "members:create", "members:approve", "members:post", "members:export", "members:admin",
        "security:read", "security:create", "security:approve", "security:post", "security:export", "security:admin",
        "audit:read", "audit:export",
      ];
    case "accountant":
      return [
        "accounting:read", "accounting:create", "accounting:approve", "accounting:post", "accounting:export",
        "banking:read", "banking:create", "banking:approve", "banking:post", "banking:export",
        "cheques:read", "cheques:create", "cheques:approve", "cheques:post", "cheques:export",
        "invoicing:read", "invoicing:create", "invoicing:approve", "invoicing:post", "invoicing:export",
        "tax:read", "tax:create", "tax:approve", "tax:post", "tax:export",
        "inventory:read", "inventory:export",
        "data_import:read", "data_import:create",
        "assistant:read", "assistant:create",
      ];
    case "sales":
      return [
        "invoicing:read", "invoicing:create", "invoicing:export",
        "crm:read", "crm:create", "crm:export",
        "inventory:read",
        "assistant:read", "assistant:create",
      ];
    case "cheque_reviewer":
      return [
        "cheques:read", "cheques:approve", "cheques:export",
        "banking:read",
        "assistant:read",
      ];
    case "hr":
      return [
        "hr:read", "hr:create", "hr:approve", "hr:post", "hr:export", "hr:admin",
        "assistant:read", "assistant:create",
      ];
    case "read_only":
      return [
        "accounting:read", "banking:read", "cheques:read", "invoicing:read", "tax:read",
        "crm:read", "hr:read", "inventory:read", "damages:read", "data_import:read",
        "assistant:read", "members:read", "security:read", "audit:read",
      ];
    default:
      return ["assistant:read"];
  }
}
