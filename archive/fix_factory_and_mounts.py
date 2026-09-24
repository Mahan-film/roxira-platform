import pathlib

print("🔧 ۱. افزودن Volume Mounts به docker-compose.prod.yml برای همگام‌سازی زنده کدها...")

compose_path = pathlib.Path("/opt/roxira_platform/docker-compose.prod.yml")
compose_content = """services:
  enterprise_app:
    build:
      context: .
      dockerfile: Dockerfile.prod
    container_name: roxira_app_prod
    restart: always
    env_file:
      - .env
    volumes:
      - ./src:/app/src
      - ./output_apps:/app/output_apps
      - ./run_unified_server.py:/app/run_unified_server.py
    environment:
      - POSTGRES_HOST=postgres_prod
      - POSTGRES_PORT=5432
      - POSTGRES_USER=enterprise_admin
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
      - POSTGRES_DB=enterprise_db
      - REDIS_HOST=redis_prod
      - REDIS_PORT=6379
      - QDRANT_HOST=qdrant_prod
      - QDRANT_PORT=6333
    depends_on:
      - postgres_prod
      - redis_prod
      - qdrant_prod
    networks:
      - roxira_net

  postgres_prod:
    image: postgres:17-alpine
    container_name: roxira_postgres_prod
    restart: always
    environment:
      POSTGRES_USER: enterprise_admin
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: enterprise_db
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - roxira_net

  redis_prod:
    image: redis:7-alpine
    container_name: roxira_redis_prod
    restart: always
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    networks:
      - roxira_net

  qdrant_prod:
    image: qdrant/qdrant:latest
    container_name: roxira_qdrant_prod
    restart: always
    ports:
      - "6333:6333"
    volumes:
      - qdrant_data:/qdrant/storage
    networks:
      - roxira_net

  nginx_gateway:
    image: nginx:alpine
    container_name: roxira_nginx_prod
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./production_bundle/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
      - certbot_web:/var/www/certbot
    depends_on:
      - enterprise_app
    networks:
      - roxira_net

networks:
  roxira_net:
    driver: bridge

volumes:
  postgres_data:
  redis_data:
  qdrant_data:
  certbot_web:
"""
compose_path.write_text(compose_content, encoding="utf-8")

print("🔧 ۲. اصلاح و ثبت قطعی روت‌های کارخانه نرم‌افزار در run_unified_server.py...")

server_file = pathlib.Path("/opt/roxira_platform/run_unified_server.py")
code = server_file.read_text(encoding="utf-8")

routes_block = """
# ==========================================
# ROXIRA AUTONOMOUS SOFTWARE FACTORY ROUTES
# ==========================================
class FactorySynthesisRequest(BaseModel):
    prompt: str
    target_framework: str = "FastAPI"

class EnterpriseModuleGenRequest(BaseModel):
    module_name: str
    category: str = "ERP"
    features: list[str]

@app.post("/api/v1/factory/synthesize")
async def api_factory_synthesize(payload: FactorySynthesisRequest):
    factory_mod = dynamic_import("roxira_factory_core", "output_apps/ecosystem_core/src/crawlers/roxira_factory_core.py")
    return await factory_mod.RoxiraSoftwareFactory.synthesize_open_source_component(
        payload.prompt, payload.target_framework
    )

@app.post("/api/v1/factory/enterprise-module")
async def api_generate_enterprise_module(payload: EnterpriseModuleGenRequest):
    factory_mod = dynamic_import("roxira_factory_core", "output_apps/ecosystem_core/src/crawlers/roxira_factory_core.py")
    prompt = f"طراحی و پیاده‌سازی ماژول سازمانی {payload.module_name} در رده {payload.category} با امکانات: {', '.join(payload.features)}. همراه با مدل‌های دیتابیس PostgreSQL، اسکیمای Pydantic و تست‌های اعتبارسنجی."
    return await factory_mod.RoxiraSoftwareFactory.synthesize_open_source_component(
        prompt, "FastAPI"
    )
"""

if "api_factory_synthesize" not in code:
    if 'if __name__ == "__main__":' in code:
        code = code.replace('if __name__ == "__main__":', routes_block + '\nif __name__ == "__main__":')
    else:
        code += routes_block
    server_file.write_text(code, encoding="utf-8")
    print("✅ روت‌های کارخانه نرم‌افزار قبل از بلوک main ثبت شدند.")
else:
    print("ℹ️ روت‌ها در فایل سرور موجود هستند.")
