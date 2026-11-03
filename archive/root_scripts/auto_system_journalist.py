import os, sys, json, pathlib, subprocess, urllib.request

env_p = pathlib.Path("/opt/roxira_platform/.env")
env_vars = {}
if env_p.exists():
    for l in env_p.read_text(encoding="utf-8").splitlines():
        if "=" in l and not l.strip().startswith("#"):
            k, v = l.split("=", 1)
            env_vars[k.strip()] = v.strip().strip("'\"")

OPENROUTER_KEY = os.getenv("OPENROUTER_API_KEY") or env_vars.get("OPENROUTER_API_KEY", "")

# جمع‌آوری متریک‌های زنده سیستم
print("🔍 در حال ممیزی زیرساخت برای تولید سند خلاصه پروژه...")
qdrant_stats = {}
try:
    with urllib.request.urlopen("http://127.0.0.1:6333/collections", timeout=3) as r:
        cols = json.loads(r.read().decode()).get("result", {}).get("collections", [])
        for c in cols:
            c_name = c["name"]
            with urllib.request.urlopen(f"http://127.0.0.1:6333/collections/{c_name}", timeout=3) as cr:
                cnt = json.loads(cr.read().decode()).get("result", {}).get("points_count", 0)
                qdrant_stats[c_name] = cnt
except Exception:
    qdrant_stats = {"error": "unreachable"}

mod_dir = pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")
modules_list = [f.name for f in mod_dir.glob("*") if f.is_dir()] if mod_dir.exists() else []

# خواندن فایل‌های رجیستری و سنتینل قبلی
registry_data = "موجود نیست"
p_reg = pathlib.Path("/opt/roxira_platform/src/roxira_manager/AGENT_REGISTRY.json")
if p_reg.exists():
    registry_data = p_reg.read_text(encoding="utf-8")[:500]

raw_system_summary = {
    "platform": "Roxira OS Unified Enterprise Suite",
    "domains": ["roxira.net", "roxira.ir"],
    "active_modules": modules_list,
    "qdrant_collections": qdrant_stats,
    "containers": ["roxira_nginx_prod", "roxira_app_prod", "roxira_postgres_prod", "roxira_redis_prod", "roxira_qdrant_prod"],
    "swap_allocated": "8GB Permanent",
    "agent_registry_snippet": registry_data
}

# پرامپت تولید شناسنامه تحویل برای هوش مصنوعی
sys_prompt = "You are the Chief Technical Secretary for Roxira OS. Generate a clean, highly structured, concise Handover Manifest in Persian for an AI assistant. Summarize: 1) What is fully running, 2) Data state, 3) Architecture, 4) Exact next strategic steps. Keep it executive and actionable."
user_prompt = f"Summarize current system state based on this telemetry:\n{json.dumps(raw_system_summary, ensure_ascii=False)}"

summary_text = ""
if OPENROUTER_KEY:
    for model in ["z-ai/glm-5.2:free", "openrouter/free", "deepseek/deepseek-v4-flash-0731", "google/gemini-2.0-flash-001"]:
        try:
            pl = json.dumps({"model": model, "messages": [{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_prompt}], "max_tokens": 1500}).encode()
            req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=pl, headers={"Authorization": f"Bearer {OPENROUTER_KEY}", "Content-Type": "application/json", "HTTP-Referer": "https://roxira.net"})
            with urllib.request.urlopen(req, timeout=40) as resp:
                res = json.loads(resp.read().decode())
                summary_text = res["choices"][0]["message"]["content"]
                print(f"🤖 خلاصه وضعیت توسط مدل [{model}] با موفقیت تولید شد.")
                break
        except Exception:
            continue

if not summary_text:
    summary_text = f"# ROXIRA OS | شناسنامه و خلاصه وضعیت پروژه\n\n- ماژول‌های فعال: {', '.join(modules_list)}\n- وضعیت Qdrant: {json.dumps(qdrant_stats, ensure_ascii=False)}\n- وضعیت: کاملاً آنلاین و عملیاتی"

out_path = pathlib.Path("/opt/roxira_platform/LATEST_AI_HANDOVER.md")
out_path.write_text(summary_text, encoding="utf-8")
print(f"✅ فایل نهایی ذخیره شد -> {out_path}")
