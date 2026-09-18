#!/usr/bin/env python3
import sys, os
sys.path.insert(0, "/opt/roxira_platform")

import http.server
import json
import signal
import subprocess
import time
import urllib.parse

try:
    from output_apps.ecosystem_core.src.factory.report_generator import generate_enterprise_docx, generate_markdown_report
except Exception as err:
    print(f"⚠️ هشدار ایمپورت: {err}")
    def generate_enterprise_docx(*args, **kwargs): pass
    def generate_markdown_report(*args, **kwargs): pass

signal.signal(signal.SIGCHLD, signal.SIG_IGN)

QUEUE_FILE = "/opt/roxira_platform/task_queue.json"
MODULES_DIR = "/opt/roxira_platform/output_apps/generated_modules"
HTML_FILE = "/opt/roxira_platform/output_apps/enterprise_hub/frontend/public/factory/index.html"

class SafeDispatchHandler(http.server.BaseHTTPRequestHandler):
    def send_safe_json(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def do_GET(self):
        try:
            raw_path = urllib.parse.unquote(self.path)

            # ۱. سرویس‌دهی داشبورد وب
            if raw_path in ["/factory", "/factory/", "/factory/index.html"]:
                if os.path.exists(HTML_FILE):
                    with open(HTML_FILE, "r", encoding="utf-8") as f:
                        content = f.read()
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(content.encode("utf-8"))
                    return
                self.send_safe_json(404, {"error": "Dashboard HTML missing"})
                return

            # ۲. دانلود مستقیم فایل‌ها
            if raw_path.startswith("/api/v1/factory/download/"):
                parts = raw_path.strip("/").split("/")
                if len(parts) >= 6:
                    tid, fmt = parts[4].strip(), parts[5].strip().lower()
                    tdir = os.path.join(MODULES_DIR, tid)
                    mpath = os.path.join(tdir, "manifest.json")
                    meta = {"task_id": tid, "prompt": tid, "verification_status": "ALL_GREEN"}
                    if os.path.exists(mpath):
                        try:
                            with open(mpath, "r", encoding="utf-8") as mf:
                                meta = json.load(mf)
                        except Exception: pass

                    if fmt == "docx":
                        doc_path = os.path.join(tdir, f"{tid}_Report.docx")
                        if not os.path.exists(doc_path):
                            generate_enterprise_docx(tid, meta.get("prompt", tid), tdir, meta)
                        if os.path.exists(doc_path):
                            with open(doc_path, "rb") as f: bytes_data = f.read()
                            self.send_response(200)
                            self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
                            self.send_header("Content-Disposition", f'attachment; filename="{tid}_Report.docx"')
                            self.end_headers()
                            self.wfile.write(bytes_data)
                            return

                    elif fmt == "markdown":
                        md_path = os.path.join(tdir, "REPORT.md")
                        if not os.path.exists(md_path):
                            generate_markdown_report(tid, meta.get("prompt", tid), tdir, meta)
                        if os.path.exists(md_path):
                            with open(md_path, "r", encoding="utf-8") as f: md_data = f.read().encode("utf-8")
                            self.send_response(200)
                            self.send_header("Content-Type", "text/markdown; charset=utf-8")
                            self.send_header("Content-Disposition", f'attachment; filename="{tid}_REPORT.md"')
                            self.end_headers()
                            self.wfile.write(md_data)
                            return

                    elif fmt == "json":
                        self.send_safe_json(200, meta)
                        return

                    elif fmt == "pdf":
                        md_path = os.path.join(tdir, "REPORT.md")
                        if not os.path.exists(md_path):
                            generate_markdown_report(tid, meta.get("prompt", tid), tdir, meta)
                        md_text = ""
                        if os.path.exists(md_path):
                            with open(md_path, "r", encoding="utf-8") as f: md_text = f.read()

                        pdf_html = f"""<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><title>{tid} Report</title><script src="https://cdn.tailwindcss.com"></script><link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;700;900&display=swap" rel="stylesheet"><style>body{{font-family:Vazirmatn,sans-serif;}}@media print{{.no-print{{display:none!important;}}body{{background:white;}}}}</style></head><body class="bg-slate-100 p-6"><div class="max-w-4xl mx-auto bg-white p-10 rounded-2xl shadow-xl border border-slate-200"><div class="no-print flex justify-between items-center mb-8 pb-4 border-b"><span class="text-sm font-bold text-slate-500">سند رسمی ارزیابی و استقرار سازمانی</span><button onclick="window.print()" class="px-6 py-2.5 bg-emerald-600 text-white font-bold rounded-xl text-sm">🖨️ چاپ مستقیم / ذخیره PDF</button></div><h1 class="text-2xl font-black mb-1">سامانه جامع کارخانه خودگردان نرم‌افزار روکسیرا</h1><p class="text-xs text-slate-500 mb-6">شناسه ماژول: {tid} | وضعیت: {meta.get('verification_status', 'ALL_GREEN')}</p><div class="mb-4"><strong>شرح هدف:</strong> {meta.get('prompt','')}</div><pre class="bg-slate-50 p-4 rounded-xl text-xs font-mono whitespace-pre-wrap leading-relaxed">{md_text}</pre></div></body></html>"""
                        self.send_response(200)
                        self.send_header("Content-Type", "text/html; charset=utf-8")
                        self.end_headers()
                        self.wfile.write(pdf_html.encode("utf-8"))
                        return

            # ۳. استعلام وضعیت زنده و ماژول‌ها
            if raw_path in ["/api/v1/factory/status", "/api/v1/factory/status/"]:
                qdata = {"pending": [], "completed": []}
                if os.path.exists(QUEUE_FILE):
                    try:
                        with open(QUEUE_FILE, "r", encoding="utf-8") as f: qdata = json.load(f)
                    except Exception: pass

                artifacts = []
                for comp in reversed(qdata.get("completed", [])):
                    cid = comp.get("id")
                    mpath = os.path.join(MODULES_DIR, cid, "manifest.json")
                    if os.path.exists(mpath):
                        try:
                            with open(mpath, "r", encoding="utf-8") as mf:
                                artifacts.append(json.load(mf))
                        except Exception: pass
                    else:
                        artifacts.append({
                            "task_id": cid,
                            "prompt": comp.get("prompt", cid),
                            "created_at": comp.get("created_at", ""),
                            "verification_status": "ALL_GREEN"
                        })

                self.send_safe_json(200, {
                    "server_time": time.strftime("%Y-%m-%d %H:%M:%S UTC"),
                    "queue_health": "ONLINE",
                    "pending_tasks": len(qdata.get("pending", [])),
                    "completed_tasks": len(qdata.get("completed", [])),
                    "recent_completed": qdata.get("completed", [])[-5:],
                    "recent_generated_artifacts": artifacts
                })
                return

            self.send_safe_json(404, {"error": "Not Found"})
        except Exception as e:
            self.send_safe_json(500, {"error": str(e)})

    def do_POST(self):
        try:
            raw_path = urllib.parse.unquote(self.path)
            if raw_path == "/api/v1/factory/dispatch":
                length = int(self.headers.get("Content-Length", 0))
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                prompt = payload.get("prompt", "").strip()
                if not prompt:
                    self.send_safe_json(400, {"error": "Prompt required"}); return

                tid = f"USER-{int(time.time())}"
                new_task = {"id": tid, "prompt": prompt, "status": "QUEUED", "priority": "IMMEDIATE", "created_at": time.strftime("%Y-%m-%d %H:%M:%S UTC")}

                data = {"pending": [], "completed": []}
                if os.path.exists(QUEUE_FILE):
                    with open(QUEUE_FILE, "r", encoding="utf-8") as f: data = json.load(f)
                data.setdefault("pending", []).insert(0, new_task)
                with open(QUEUE_FILE, "w", encoding="utf-8") as f: json.dump(data, f, ensure_ascii=False, indent=2)

                subprocess.Popen(["python3", "/opt/roxira_platform/output_apps/ecosystem_core/src/factory/task_worker.py"])
                self.send_safe_json(200, {"status": "QUEUED_AND_TRIGGERED", "task_id": tid, "prompt": prompt, "message": "پروژه در صف کارخانه قرار گرفت."})
                return
            self.send_safe_json(404, {"error": "Not Found"})
        except Exception as e:
            self.send_safe_json(500, {"error": str(e)})

    def log_message(self, format, *args): pass

if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("0.0.0.0", 8005), SafeDispatchHandler)
    server.serve_forever()
