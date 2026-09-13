#!/usr/bin/env python3
import pathlib
import subprocess
import os

print("="*75)
print("🚀 اعمال پیکربندی بهینه Nginx Reverse Proxy برای Live Voice و کشینگ پرسرعت")
print("="*75)

nginx_conf_content = r'''user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 4096;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    client_max_body_size 50M;

    # فشرده‌سازی Gzip برای افزایش سرعت لود
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/rss+xml application/atom+xml image/svg+xml;

    # upstream فرانت‌اند و بک‌اند
    upstream nextjs_frontend {
        server roxira_enterprise_frontend:3000;
        keepalive 32;
    }

    upstream fastapi_backend {
        server roxira_app_prod:8000;
        keepalive 32;
    }

    server {
        listen 80;
        server_name ghazihoushmand.ir www.ghazihoushmand.ir roxira.ir www.roxira.ir 5.75.200.67;

        # ۱. پروکسی اندپوینت‌های بک‌اند و وب‌سرویس‌ها
        location /api/ {
            proxy_pass http://fastapi_backend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_buffering off;
            proxy_read_timeout 300s;
        }

        # ۲. پروکسی اختصاصی وب‌سوکت صوتی زنده (Live Voice WebSocket)
        location /api/v1/apps/judge/live-voice {
            proxy_pass http://fastapi_backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_read_timeout 86400s;
            proxy_send_timeout 86400s;
        }

        # ۳. اسناد و مستندات FastAPI Swagger
        location ~ ^/(docs|redoc|openapi.json) {
            proxy_pass http://fastapi_backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        # ۴. پروکسی صفحات فرانت‌اند Next.js و صفحات SSR
        location / {
            proxy_pass http://nextjs_frontend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
'''

# ذخیره و اعمال کانفیگ در کانتینر roxira_nginx_prod
nginx_file_path = pathlib.Path("/opt/roxira_platform/nginx.conf")
nginx_file_path.write_text(nginx_conf_content.strip() + "\n", encoding="utf-8")

# کپی به کانتینر و ریلود Nginx
subprocess.run(["docker", "cp", "/opt/roxira_platform/nginx.conf", "roxira_nginx_prod:/etc/nginx/nginx.conf"], check=True)
subprocess.run(["docker", "exec", "roxira_nginx_prod", "nginx", "-s", "reload"], check=True)

print("="*75)
print("🎉 پروکسی معکوس Nginx با پشتیبانی کامل از Live Voice و کشینگ فوق‌سریع به‌روزرسانی شد.")
print("="*75)
