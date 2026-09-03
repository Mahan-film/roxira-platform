import os, sys, json, re, pathlib, time, ast, urllib.request, urllib.error
from typing import Dict, Any, List, Tuple

# مسیر ذخیره ماژول‌های تولیدی
OUTPUT_DIR = pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# خواندن کلید OpenRouter از فایل محیطی
env_file = pathlib.Path("/opt/roxira_platform/.env")
env_vars = {}
if env_file.exists():
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            env_vars[k.strip()] = v.strip().strip("'\"")

OPENROUTER_KEY = os.getenv("OPENROUTER_API_KEY") or env_vars.get("OPENROUTER_API_KEY", "")

# ماتریس مسیریابی سلسله‌مراتبی کارخانه روکسیرا
MODEL_TIERS = {
    # اولویت اول: مدل‌های کاملاً رایگان با کانتکست و توان بالا
    "tier0_free": [
        {"id": "openrouter/free", "name": "OpenRouter Free Router"},
        {"id": "z-ai/glm-5.2:free", "name": "GLM 5.2 (Free)"},
        {"id": "cohere/north-mini-code:free", "name": "North Mini Code (Free)"},
        {"id": "nvidia/nemotron-3-ultra:free", "name": "Nemotron 3 Ultra (Free)"},
        {"id": "poolside/laguna-s-2.1:free", "name": "Laguna S 2.1 (Free)"},
        {"id": "minimax/minimax-m3:free", "name": "MiniMax M3 (Free)"},
        {"id": "google/gemma-4-31b:free", "name": "Gemma 4 31B (Free)"}
    ],
    # اولویت دوم: پیشتازان اقتصادی و فوق‌سریع (Value Leaders)
    "tier1_value": [
        {"id": "z-ai/glm-5.3-flash", "name": "GLM 5.3 Flash (Agentic 96%)"},
        {"id": "deepseek/deepseek-v4-flash-0731", "name": "DeepSeek V4 Flash 0731"},
        {"id": "google/gemini-3.8-flash", "name": "Gemini 3.8 Flash (Reasoning)"},
        {"id": "upstage/solar-pro-4", "name": "Solar Pro 4"},
        {"id": "inclusionai/ling-3.0-flash", "name": "Ling 3.0 Flash"}
    ],
    # اولویت سوم: استدلال عمیق مهندسی (در صورت ضرورت)
    "tier2_reasoning": [
        {"id": "deepseek/deepseek-r1", "name": "DeepSeek R1 Reasoning"},
        {"id": "anthropic/claude-3.7-sonnet", "name": "Claude 3.7 Sonnet"}
    ]
}

def clean_python(text: str) -> str:
    blocks = re.findall(r"```(?:python)?\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
    if blocks:
        return "\n\n".join(b.strip() for b in blocks if b.strip())
    lines = [l for l in text.splitlines() if not l.strip().startswith("```")]
    return "\n".join(lines).strip()

def execute_openrouter_call(sys_prompt: str, user_prompt: str) -> Tuple[str, str, str]:
    # اجرای ترتیبی از لایه رایگان تا لایه اقتصادی
    for tier_key in ["tier0_free", "tier1_value", "tier2_reasoning"]:
        for model in MODEL_TIERS[tier_key]:
            m_id = model["id"]
            m_name = model["name"]
            try:
                payload = json.dumps({
                    "model": m_id,
                    "messages": [
                        {"role": "system", "content": sys_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": 0.1,
                    "max_tokens": 4096
                }).encode("utf-8")
                
                req = urllib.request.Request(
                    "[https://openrouter.ai/api/v1/chat/completions](https://openrouter.ai/api/v1/chat/completions)",
                    data=payload,
                    headers={
                        "Authorization": f"Bearer {OPENROUTER_KEY}",
                        "HTTP-Referer": "[https://roxira.net](https://roxira.net)",
                        "Content-Type": "application/json",
                        "User-Agent": "RoxiraAutonomousFactory/3.0"
                    }
                )
                with urllib.request.urlopen(req, timeout=60) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    content = data["choices"][0]["message"]["content"]
                    if content and len(content.strip()) > 50:
                        return clean_python(content), m_name, tier_key
            except Exception:
                continue
    return "", "None", "Failed"

def build_module(name: str, category: str, features: List[str], business_context: str = "") -> bool:
    print(f"\n🏭 [کارخانه روکسیرا] در حال طراحی ماژول: {name} ({category})...")
    sys_prompt = (
        f"You are the Lead Software Architect for Roxira OS Enterprise Suite. "
        f"Synthesize complete, production-ready Python 3.12+ code for '{name}' ({category}). "
        f"Features required: {', '.join(features)}. "
        f"Architecture: 1) SQLAlchemy 2.0 Async models. 2) Pydantic v2 schemas. "
        f"3) FastAPI APIRouter under prefix /api/v1/apps/{name.lower()}. "
        f"Business rules: {business_context}. Output ONLY valid Python code."
    )
    user_prompt = f"Write complete self-contained Python source code for {name}."

    code, model_used, tier_used = execute_openrouter_call(sys_prompt, user_prompt)
    if not code:
        print(f"❌ خطا در سنتز ماژول {name}.")
        return False

    # ممیزی سینتکس AST و خودترمیمی
    try:
        ast.parse(code)
        print(f"✅ اعتبارسنجی سینتکس AST موفق بود.")
    except SyntaxError as se:
        print(f"⚠️ خطای سینتکس ({se}). فعال‌سازی ایجنت خودترمیمی با مدل‌های فلش...")
        fix_sys = "You are a syntax repair agent. Fix all syntax errors and return ONLY clean Python code."
        fix_user = f"Error: {se}\n\nCode:\n{code}"
        fixed_code, fix_model, _ = execute_openrouter_call(fix_sys, fix_user)
        if fixed_code:
            code = fixed_code

    # ذخیره‌سازی ایزوله در سیستم فایل
    target_dir = OUTPUT_DIR / name.lower()
    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / "__init__.py").touch()
    target_file = target_dir / f"{name.lower()}_module.py"
    target_file.write_text(code, encoding="utf-8")
    print(f"💾 ماژول ذخیره شد: {target_file}")
    print(f"🎯 لایه اجرا: [{tier_used}] | مدل استفاده‌شده: [{model_used}]")
    return True

if __name__ == "__main__":
    print("🚀 خط تولید خودمختار روکسیرا با اولویت مدل‌های رایگان و پیشتازان اقتصادی فعال شد.")
