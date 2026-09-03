import os
import time
import json
import urllib.request
import pathlib

def extract_api_key():
    key = os.getenv("OPENROUTER_API_KEY", "")
    env_file = pathlib.Path(".env")
    if not key and env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("OPENROUTER_API_KEY="):
                parts = line.split("=", 1)
                if len(parts) > 1:
                    key = parts.strip().strip('"').strip("'")
    return key

def run_benchmark():
    api_key = extract_api_key()
    if not api_key or api_key.startswith("sk-your"):
        print("❌ کلید معتبر OPENROUTER_API_KEY یافت نشد.")
        return

    models = [
        ("nvidia/nemotron-3-ultra:free", "🆓 Free (1M Context)"),
        ("stealth/ox-alpha:free", "🆓 Free (1M Context)"),
        ("nvidia/nemotron-3.5-lightning:free", "🆓 Free (1M Fast)"),
        ("z-ai/glm-5.2:free", "🆓 Free (256K Logic)"),
        ("cohere/north-mini-code:free", "🆓 Free (256K Code)"),
        ("google/gemma-4-26b-a4b:free", "🆓 Free (262K Google)"),
        ("poolside/laguna-s-2.1:free", "🆓 Free (262K Extraction)"),
        ("deepseek/deepseek-v4-flash", "💲 Budget ($0.065/M)"),
        ("inclusionai/ling-3.0-flash", "💲 Ultra-Budget ($0.021/M)")
    ]

    tests = [
        ("ACCOUNTING_JSON", "سند فروش نسیه ۱۵ میلیون تومانی با ارزش افزوده ۱۰٪ را فقط در قالب شیء JSON با کلیدهای debit, credit, vat, desc بنویس."),
        ("LEGAL_CHECK_ART23", "۳ مزیت اصلی صدور اجرائیه مستقیم ماده ۲۳ قانون چک را در ۳ بند کوتاه فارسی بنویس.")
    ]

    print("========================================================")
    print("⚡ ROXIRA MODEL BENCHMARK MATRIX (LIVE)")
    print("========================================================\n")

    summary = []
    for model_id, badge in models:
        print(f"🔍 تست مدل: {model_id} ({badge})")
        passed = 0
        total_time = 0.0

        for t_id, prompt in tests:
            t0 = time.time()
            payload = json.dumps({
                "model": model_id,
                "messages": [
                    {"role": "system", "content": "You are an expert Iranian enterprise & legal AI advisor."},
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.2
            }).encode("utf-8")

            req = urllib.request.Request(
                "https://openrouter.ai/api/v1/chat/completions",
                data=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://roxira.net"
                }
            )

            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    res_data = json.loads(resp.read().decode())
                    elapsed = time.time() - t0
                    total_time += elapsed
                    txt = res_data["choices"][0]["message"]["content"].replace("\n", " ")[:55]
                    print(f"   ✅ [{t_id}] ⏱️ {elapsed:.2f}s -> {txt}...")
                    passed += 1
            except Exception as e:
                elapsed = time.time() - t0
                total_time += elapsed
                print(f"   ❌ [{t_id}] ⏱️ {elapsed:.2f}s -> {str(e)[:45]}")

        avg_lat = round(total_time / len(tests), 2)
        summary.append((model_id, badge, f"{passed}/{len(tests)}", avg_lat))
        print("-" * 56)

    # ایجاد فایل لیدربورد
    md = "# 🏆 ROXIRA OPENROUTER MODEL LEADERBOARD\n\n"
    md += "| رتبه | مدل | رده هزینه | امتیاز | میانگین زمان |\n"
    md += "| :--- | :--- | :--- | :--- | :--- |\n"
    for idx, (m, b, sc, lat) in enumerate(summary, 1):
        md += f"| {idx} | `{m}` | {b} | **{sc}** | {lat}s |\n"

    pathlib.Path("OPENROUTER_MODEL_LEADERBOARD.md").write_text(md, encoding="utf-8")
    print("\n🎉 نتایج در فایل OPENROUTER_MODEL_LEADERBOARD.md ذخیره شد.")

if __name__ == "__main__":
    run_benchmark()
