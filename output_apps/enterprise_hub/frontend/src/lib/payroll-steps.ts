import type { PayrollRunStatus } from "@/types/hr";

export type PayrollStepKey = "month" | "review" | "payslips" | "posting";

export interface PayrollStepView {
  key: PayrollStepKey;
  label: string;
  state: "done" | "current" | "todo";
}

export interface PayrollStepsView {
  current: 0 | 1 | 2 | 3;
  steps: PayrollStepView[];
}

const STEP_DEFINITIONS: Array<{ key: PayrollStepKey; label: string }> = [
  { key: "month", label: "ماه" },
  { key: "review", label: "بازبینی" },
  { key: "payslips", label: "فیش‌ها" },
  { key: "posting", label: "ثبت سند" },
];

export function payrollSteps(
  run: { status: PayrollRunStatus } | null,
  hasPayslips: boolean,
): PayrollStepsView {
  let current: 0 | 1 | 2 | 3 = 0;

  if (!run) {
    current = 0;
  } else if (run.status === "POSTED") {
    current = 3;
  } else if (run.status === "DRAFT") {
    current = hasPayslips ? 2 : 1;
  }

  const steps: PayrollStepView[] = STEP_DEFINITIONS.map((def, idx) => {
    let state: "done" | "current" | "todo" = "todo";
    if (idx < current) {
      state = "done";
    } else if (idx === current) {
      state = "current";
    } else {
      state = "todo";
    }
    return {
      key: def.key,
      label: def.label,
      state,
    };
  });

  return {
    current,
    steps,
  };
}
