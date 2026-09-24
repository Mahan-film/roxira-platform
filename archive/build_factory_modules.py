import os, sys, json, re, pathlib, time, urllib.request, urllib.error

env_path = pathlib.Path("/opt/roxira_platform/.env")
env_vars = {}
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env_vars[k.strip()] = v.strip().strip("''"\"")

key = os.getenv("OPENROUTER_API_KEY") or env_vars.get("OPENROUTER_API_KEY", "")
deepseek_key = os.getenv("DEEOSEEK_API_KEY") or env_vars.get("DEEOSEEK_API_KEY", "")

out_base = pathlib.Path("/opt/roxira_platform/output_apps/generated_modules")
out_base.mkdir(parents=True, exist_ok=True)

modules = [
    {"name": "WarehouseInventory", "cat": "ERP", "features": ["StockTracking", "BatchNumbering", "MultiWarehouse", "BarcodeScanner"]},
    {"name": "AtomicCRM", "cat": "CRM", "features": ["LeadManagement", "PipelineTracking", "InteractionLog", "TaskAutomation"]},
    {"name": "DoclingParser", "cat": "DocumentProcessing", "features": ["PDFTableExtraction", "InvoiceZUGFeRDValidation", "MarkdownConversion"]},
    {"name": "ScraplingWebAgent", "cat": "WebIntelligence", "features": ["AntiBotBypass", "CamoufoxStealth", "CompetitorPriceMonitoring"]}
]

def extract_code(text):
    blocks = re.findall(r"``c(?:python)?\s*(*?)\s*```", text, re.DOTALL | re.IGNORECASE)
    if blocks:
        return "\n\n".join(b.strip() for b in blocks if b.strip())
    lines = [l for l in text.splitlines() if not l.strip().startswith("```")]
    return "\n".join(lines).strip()

def query_llm(sys_p, user_p):
    if key:
        for m in ["google/gemini-2.0-flash-001", "deepseek/deepseek-chat", "meta-llama/llama-3.3-70b-instruct"]:
            try:
                pl = json.dumps({"model": m, "messages": [{"role": "system", "content": sys_p}, {"role": "user", "content": user_p}], "temperature": 0.1, "max_tokens": 4096}).encode("utf-8")
                req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=pl, headers={"Authorization": f"Bearer {key}", "HTTP-Referer": "https://roxira.net", "Content-Type": "application/json", "User-Agent": "RoxiraFactory/1.0"})
                with urllib.request.urlopen(req, timeout=120) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    return extract_code(data["choices"][0]["message"]["content"]), m
            except Exception as e:
                print(f"  [OpenRouter {m}] Failed: {e}")
    if deepseek_key:
        try:
            pl = json.dumps({"model": "deepseek-chat", "messages": [{"role": "system", "content": sys_p}, {"role": "user", "content": user_p}], "temperature": 0.1}).encode("utf-8")
            req = urllib.request.Request("https://api.deepseek.com/chat/completions", data=pl, headers={"Authorization": f"Bearer {deepseek_key}", "Content-Type": "application/json", "User-Agent": "RoxiraFactory/1.0"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return extract_code(data["choices"][0]["message"]["content"]), "deepseek-direct"
        except Exception as e:
            print(f"  [DeepSeek Direct] Failed: {e}")
    return None, None

print("\n💜 1. آغاز خط توliد خودکار ماڨولاهای سازمانی روکسیرا...\n")
for m in modules:
    print(f"⚙️