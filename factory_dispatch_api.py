#!/usr/bin/env python3
import http.server, json, os, signal, subprocess, time

signal.signal(signal.SIGCHLD, signal.SIG_IGN)

QUEUE_FILE = "/opt/roxira_platform/task_queue.json"
MODULES_DIR = "/opt/roxira_platform/output_apps/generated_modules"

class DispatchHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        # دریافت اطلاعات سورس‌کد ماژول خاص
        if self.path.startswith("/api/v1/factory/code/"):
            parts = self.path.strip("/").split("/")
            if len(parts) >= 6:
                task_id, filename = parts[4], parts[5]
                file_path = os.path.join(MODULES_DIR, task_id, filename)
                if os.path.exists(file_path):
                    with open(file_path, "r", encoding="utf-8") as f:
                        content = f.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/plain; charset=utf-8')
                    self.end_headers()
                    self.wfile.write(content.encode('utf-8'))
                    return

        # داشبورد وضعیت
        if self.path in ["/api/v1/factory/status", "/api/v1/factory/status/"]:
            data = {"pending": [], "completed": []}
            if os.path.exists(QUEUE_FILE):
                try:
                    with open(QUEUE_FILE, "r", encoding="utf-8") as f: data = json.load(f)
                except Exception: pass
            
            generated = []
            if os.path.exists(MODULES_DIR):
                for folder in sorted(os.listdir(MODULES_DIR), reverse=True)[:15]:
                    m_path = os.path.join(MODULES_DIR, folder, "manifest.json")
                    if os.path.exists(m_path):
                        try:
                            with open(m_path, "r", encoding="utf-8") as mf:
                                generated.append(json.load(mf))
                        except Exception: pass

            res = {
                "server_time": time.strftime("%Y-%m-%d %H:%M:%S UTC"),
                "queue_health": "ONLINE",
                "pending_tasks": len(data.get("pending", [])),
                "completed_tasks": len(data.get("completed", [])),
                "recent_completed": data.get("completed", [])[-5:],
                "recent_generated_artifacts": generated
            }
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps(res, ensure_ascii=False).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"detail": "Not Found"}')

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

                task_id = f"USER-{int(time.time())}"
                new_task = {
                    "id": task_id, "prompt": prompt, "status": "QUEUED",
                    "priority": "IMMEDIATE", "created_at": time.strftime("%Y-%m-%d %H:%M:%S UTC")
                }

                data = {"pending": [], "completed": []}
                if os.path.exists(QUEUE_FILE):
                    with open(QUEUE_FILE, "r", encoding="utf-8") as f: data = json.load(f)

                data.setdefault("pending", []).insert(0, new_task)
                with open(QUEUE_FILE, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)

                # آغاز آنی پردازش تسک در ثانیه صفر
                subprocess.Popen(["python3", "/opt/roxira_platform/output_apps/ecosystem_core/src/factory/task_worker.py"])

                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "status": "QUEUED_AND_TRIGGERED", "task_id": task_id,
                    "prompt": prompt, "message": "پروژه در ثانیه صفر آغاز شد."
                }, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"detail": "Not Found"}')

    def log_message(self, format, *args): pass

if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("0.0.0.0", 8005), DispatchHandler)
    server.serve_forever()
