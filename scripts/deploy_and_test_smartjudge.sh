#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# استقرار و آزمون E2E سامانه قاضی هوشمند (Task 3)
# اجرا از هاست:  bash /opt/roxira_platform/scripts/deploy_and_test_smartjudge.sh
# مراحل: کامپایل → ری‌استارت کانتینر → اعتبارسنجی درون‌کانتینری → تست curl
# ═══════════════════════════════════════════════════════════════════════════
set -u
cd /opt/roxira_platform
PASS=0; FAIL=0
ok() { echo "[PASS] $1"; PASS=$((PASS+1)); }
bad() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }

echo "== 1) Compile =="
if python3 -m py_compile output_apps/generated_modules/smartjudge/smartjudge_module.py; then
  ok "py_compile smartjudge_module"
else
  bad "py_compile smartjudge_module"; echo "ABORT"; exit 1
fi

echo "== 2) Restart containers =="
if docker restart roxira_app_prod >/dev/null 2>&1 && docker exec roxira_nginx_prod nginx -s reload 2>/dev/null; then
  ok "docker restart roxira_app_prod + nginx -s reload"
else
  bad "docker restart / nginx reload"
fi

echo "== 3) In-container validation suite =="
docker exec roxira_app_prod mkdir -p /app/scripts 2>/dev/null
docker cp scripts/validate_smartjudge_overhaul.py roxira_app_prod:/app/scripts/ >/dev/null 2>&1
if docker exec roxira_app_prod python scripts/validate_smartjudge_overhaul.py; then
  ok "validate_smartjudge_overhaul (inside container)"
else
  bad "validate_smartjudge_overhaul (inside container)"
fi

echo "== 4) E2E: /health =="
docker exec roxira_app_prod curl -s --max-time 30 http://127.0.0.1:8000/api/v1/apps/judge/health | head -c 700; echo

echo "== 5) E2E: /analyze-case — legal_advisory باید متن ساده فارسی باشد =="
docker exec roxira_app_prod sh -c 'curl -s --max-time 240 -X POST http://127.0.0.1:8000/api/v1/apps/judge/analyze-case -H "Content-Type: application/json" --data-binary @- ' > /tmp/sj_analyze.json <<'JSON'
{"case_text": "خریدار مبلغ توافق‌شده قرارداد را پرداخت نکرده است. فروشنده مستند به ماده ۱۰ و ماده ۲۳۰ قانون مدنی مطالبه وجه و خسارت می‌کند. مرجع صالح کدام دادگاه است؟", "engine_tier": "tier1"}
JSON
python3 - <<'PY'
import json, sys
try:
    d = json.load(open("/tmp/sj_analyze.json"))
except Exception as exc:
    print("[FAIL] analyze-case response is not JSON:", exc)
    print(open("/tmp/sj_analyze.json").read()[:500]); sys.exit(1)
if "detail" in d and "status" not in d:
    print("[FAIL] LLM unavailable:", json.dumps(d, ensure_ascii=False)[:300]); sys.exit(1)
adv = str(d.get("legal_advisory", "")).strip()
draft = str(d.get("draft_text", "")).strip()
print("model_used          :", d.get("model_used"))
print("success_probability :", d.get("success_probability"))
print("jurisdiction        :", d.get("jurisdiction"))
print("legal_advisory[:200]:", adv[:200])
print("draft_text[:150]    :", draft[:150])
plain = bool(adv) and not adv.startswith("{") and not adv.startswith("[")
if plain and draft:
    print("[PASS] legal_advisory = plain Persian text | draft_text populated")
elif plain:
    print("[WARN] legal_advisory plain but draft_text empty (model did not emit draft)")
    sys.exit(0)
else:
    print("[FAIL] legal_advisory is still JSON-like (double serialization not fixed?)")
    sys.exit(1)
PY
if [ $? -eq 0 ]; then ok "analyze-case plain-text advisory"; else bad "analyze-case plain-text advisory"; fi

echo "== 6) E2E: /transcribe-audio — local faster-whisper fallback =="
docker exec roxira_app_prod python -c "import wave,struct,math; f=wave.open('/tmp/e2e_tone.wav','w'); f.setnchannels(1); f.setsampwidth(2); f.setframerate(16000); f.writeframes(b''.join(struct.pack('<h', int(3000*math.sin(i*440.0*2.0*math.pi/16000.0))) for i in range(16000))); f.close()"
docker exec roxira_app_prod sh -c 'curl -s --max-time 900 -X POST http://127.0.0.1:8000/api/v1/apps/judge/transcribe-audio -F "file=@/tmp/e2e_tone.wav"' > /tmp/sj_transcribe.json
python3 - <<'PY'
import json, sys
raw = open("/tmp/sj_transcribe.json").read()
try:
    d = json.loads(raw)
except Exception as exc:
    print("[FAIL] transcribe response not JSON:", exc, raw[:300]); sys.exit(1)
print("transcribe response:", json.dumps(d, ensure_ascii=False)[:200])
if set(d.keys()) == {"status", "transcript"} and d.get("status") == "OK":
    print("[PASS] exact response shape {status, transcript} — فقط کلمات گفته‌شده")
    sys.exit(0)
print("[FAIL] unexpected response shape"); sys.exit(1)
PY
if [ $? -eq 0 ]; then ok "transcribe-audio minimal shape"; else bad "transcribe-audio minimal shape"; fi

echo "== 7) Temp audio cleanup check =="
LEFT=$(docker exec roxira_app_prod sh -c 'ls /tmp 2>/dev/null | grep -c "^input_audio_" || true')
if [ "${LEFT}" = "0" ]; then ok "no leftover /tmp/input_audio_* files"; else bad "${LEFT} temp audio file(s) left behind"; fi

echo
echo "════════ RESULT: PASS=${PASS} FAIL=${FAIL} ════════"
[ "${FAIL}" = "0" ]
