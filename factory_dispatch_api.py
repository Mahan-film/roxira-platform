#!/usr/bin/env python3
"""
Roxira Dedicated Factory Dispatcher API (Port 8005)
دریافت تسک‌ها و ایده‌های جدید از وب و تزریق مستقیم به صف خودکار
"""
import http.server
import json
import os
import subprocess
import time

QUEUE_FILE = "/opt/roxira_platform/task_queue.json"

class DispatchHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/api/v1/factory/dispatch":
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            
            try:
                payload = json.loads(post_data.decode('utf-8'))
                prompt = payload.get("prompt", "").strip()
                if not prompt:
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(b'{"error": "Prompt is required"}')
                    return

                # ایجاد شناسه و درج در صف
                task_id = f"USER-{int(time.time())}"
                new_task = {
                    "id": task_id,
                    "prompt": prompt,
                    "status": "QUEUED",
                    "priority": "IMMEDIATE",
                    "created_at": time.strftime("%Y-%m-%d %H:%M:%S UTC")
                }

                data = {"pending": [], "completed": []}
                if os.path.exists(QUEUE_FILE):
                    with open(QUEUE_FILE, "r", encoding="utf-8") as f:
                        data = json.load(f)

                # تزریق با بالاترین اولویت در ابتدای صف
                data.setdefault("pending", []).insert(0, new_task)

                with open(QUEUE_FILE, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)

                # تریگر ناهمگام ورکر بدون معطل کردن پاسخ وب
                subprocess.Popen(["python3", "/opt/roxira_platform/output_apps/ecosystem_core/src/factory/task_worker.py"])

                response = {
                    "status": "QUEUED_AND_TRIGGERED",
                    "task_id": task_id,
                    "prompt": prompt,
                    "message": "پروژه در صف عامل‌های هوشمند قرار گرفت و بیلد آغاز شد."
                }
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))

            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"detail": "Not Found"}')

    def log_message(self, format, *args):
        pass

if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 8005), DispatchHandler)
    server.serve_forever()
