import { Check } from "lucide-react";
import type { PayrollStepsView } from "@/lib/payroll-steps";

export function PayrollStepper({ view }: { view: PayrollStepsView }) {
  return (
    <nav aria-label="مراحل حقوق و دستمزد">
      <ol className="flex flex-wrap gap-2">
        {view.steps.map((step, index) => {
          const isCurrent = step.state === "current";
          const isDone = step.state === "done";
          const isTodo = step.state === "todo";

          return (
            <li
              key={step.key}
              {...(isCurrent ? { "aria-current": "step" } : {})}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm transition-colors ${
                isCurrent
                  ? "font-semibold border-primary bg-primary/5 text-foreground"
                  : isDone
                  ? "border-border bg-muted/50 text-foreground"
                  : "border-border text-muted-foreground bg-background"
              }`}
            >
              <span
                className={`flex items-center justify-center size-5 rounded-full text-xs font-medium ${
                  isCurrent
                    ? "bg-primary text-primary-foreground"
                    : isDone
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {isDone ? <Check className="size-3" /> : index + 1}
              </span>
              <span>{step.label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
