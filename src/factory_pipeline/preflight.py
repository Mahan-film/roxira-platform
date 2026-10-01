import json
import os
from dataclasses import dataclass

REQUIRED_SECRETS = {
    "factory-research": (
        "OPENROUTER_RESEARCH_KEY",
        "BRAVE_API_KEY",
        "EXA_API_KEY",
        "FIRECRAWL_API_KEY",
        "JINA_API_KEY",
        "TAVILY_KEYS",
    ),
    "agent-task": ("OPENROUTER_AGENT_KEY",),
}
REQUIRED_TRUE_VARS = {
    "factory-research": ("FACTORY_ENABLED",),
    "agent-task": ("AGENT_ENABLED",),
}

@dataclass(frozen=True)
class Finding:
    workflow: str
    kind: str
    name: str


def check(secret_names: set[str], variables: dict[str, str]) -> list[Finding]:
    findings = []
    for workflow, names in REQUIRED_SECRETS.items():
        findings.extend(
            Finding(workflow, "missing_secret", name)
            for name in names
            if name not in secret_names
        )
    for workflow, names in REQUIRED_TRUE_VARS.items():
        findings.extend(
            Finding(workflow, "var_not_true", name)
            for name in names
            if variables.get(name, "").strip().lower() != "true"
        )
    return sorted(findings, key=lambda finding: (finding.workflow, finding.name))


def render_report_fa(findings: list[Finding]) -> str:
    if not findings:
        return "همهٔ کنترل‌های لازم آماده است."
    lines = [f"کنترل‌های ناقص ({len(findings)}):"]
    for finding in findings:
        if finding.kind == "missing_secret":
            lines.append(f"- {finding.workflow}: کلید {finding.name} تنظیم نشده")
        else:
            lines.append(f"- {finding.workflow}: متغیر {finding.name} باید true باشد")
    return "\n".join(lines)


def main() -> int:
    secret_names = {
        name.strip()
        for name in os.environ.get("SECRETS_PRESENT", "").split(",")
        if name.strip()
    }
    try:
        raw_variables = json.loads(os.environ.get("VARS_JSON", "{}"))
    except json.JSONDecodeError:
        raw_variables = {}
    variables = (
        {str(name): str(value) for name, value in raw_variables.items()}
        if isinstance(raw_variables, dict)
        else {}
    )
    findings = [
        finding
        for finding in check(secret_names, variables)
        if finding.workflow == "factory-research"
    ]
    print(render_report_fa(findings))

    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as output:
            output.write(f"ok={'true' if not findings else 'false'}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
