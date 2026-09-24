import os, json, re, pathlib, time, urllib.request

env_p = pathlib.Path('/opt/roxira_platform/.env')
env = {}
if env_p.exists():
    for line in env_p.read_text(encoding='utf-8').splitlines():
        if '=' in line and not line.strip().startswith('#'):
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"\'')

key = os.getenv('OPENROUTER_API_KEY') or env.get('OPENROUTER_API_KEY', '')
dkey = os.getenv('DEEPSEEK_API_KEY') or env.get('DEEPSEEK_API_KEY', '')

out_base = pathlib.Path('/opt/roxira_platform/output_apps/generated_modules')
out_base.mkdir(parents=True, exist_ok=True)

modules = [
    ('warehouseinventory', 'WarehouseInventory', 'ERP', 'StockTracking, BatchNumbering, MultiWarehouse, BarcodeScanner'),
    ('atomiccrm', 'AtomicCRM', 'CRM', 'LeadManagement, PipelineTracking, InteractionLog, TaskAutomation'),
    ('doclingparser', 'DoclingParser', 'DocumentProcessing', 'PDFTableExtraction, InvoiceZUGFeRDValidation, MarkdownConversion'),
    ('scraplingwebagent', 'ScraplingWebAgent', 'WebIntelligence', 'AntiBotBypass, CamoufoxStealth, CompetitorPriceMonitoring')
]

def clean_code(text):
    blocks = re.findall(r'```(?:python)?\s*(.*?)\s*```', text, re.DOTALL | re.IGNORECASE)
    if blocks:
        return '\n\n'.join(b.strip() for b in blocks if b.strip())
    lines = [l for l in text.splitlines() if not l.strip().startswith('```')]
    return '\n'.join(lines).strip()

def query_ai(name, cat, feats):
    sys_p = f"You are Chief Architect for Roxira OS. Write complete deployable Python 3.12+ code for module {name} ({cat}) with features: {feats}. Use SQLAlchemy 2.0 Async, Pydantic v2 schemas, and FastAPI APIRouter endpoints."
    user_p = f"Write complete code for {name}."
    
    if key:
        for model in ['google/gemini-2.0-flash-001', 'deepseek/deepseek-chat', 'meta-llama/llama-3.3-70b-instruct']:
            try:
                payload = json.dumps({'model': model, 'messages': [{'role': 'system', 'content': sys_p}, {'role': 'user', 'content': user_p}], 'temperature': 0.1, 'max_tokens': 4096}).encode('utf-8')
                req = urllib.request.Request('[https://openrouter.ai/api/v1/chat/completions](https://openrouter.ai/api/v1/chat/completions)', data=payload, headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'HTTP-Referer': '[https://roxira.net](https://roxira.net)', 'User-Agent': 'Roxira/1.0'})
                with urllib.request.urlopen(req, timeout=120) as resp:
                    res = json.loads(resp.read().decode('utf-8'))
                    return res['choices'][0]['message']['content'], model
            except Exception:
                continue
    if dkey:
        try:
            payload = json.dumps({'model': 'deepseek-chat', 'messages': [{'role': 'system', 'content': sys_p}, {'role': 'user', 'content': user_p}], 'temperature': 0.1}).encode('utf-8')
            req = urllib.request.Request('[https://api.deepseek.com/chat/completions](https://api.deepseek.com/chat/completions)', data=payload, headers={'Authorization': f'Bearer {dkey}', 'Content-Type': 'application/json', 'User-Agent': 'Roxira/1.0'})
            with urllib.request.urlopen(req, timeout=120) as resp:
                res = json.loads(resp.read().decode('utf-8'))
                return res['choices'][0]['message']['content'], 'deepseek-direct'
        except Exception:
            pass
    return None, None

print("🚀 آغاز تولید تمام ماژول‌های سازمانی روکسیرا...\n")
for folder, name, cat, feats in modules:
    print(f"⚙️ در حال تولید ماژول [{name}]...")
    raw, model_used = query_ai(name, cat, feats)
    if raw:
        code = clean_code(raw)
        mdir = out_base / folder
        mdir.mkdir(parents=True, exist_ok=True)
        fpath = mdir / f"{folder}_module.py"
        fpath.write_text(code, encoding='utf-8')
        print(f"✅ ماژول {name} با موفقیت ذخیره شد -> {fpath} (مدل: {model_used})\n")
    else:
        print(f"❌ خطا در ساخت {name}\n")
    time.sleep(1)

print("🏁 خط تولید با موفقیت پایان یافت.")
