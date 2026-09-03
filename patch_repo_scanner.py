import pathlib

p = pathlib.Path("/opt/roxira_platform/run_unified_server.py")
code = p.read_text(encoding="utf-8")

snippet = """
# --- Repository Scanner Endpoints ---
class RepoScanRequest(BaseModel):
    repo_name: str
    target_path: str = "/opt/roxira_platform/src"

@app.post("/api/v1/factory/scan-repo")
async def api_scan_repository(payload: RepoScanRequest):
    mod = dynamic_import("repo_ingestion_engine", "output_apps/ecosystem_core/src/crawlers/repo_ingestion_engine.py")
    return await mod.RepoIngestionEngine.analyze_repo_and_vectorize(
        payload.repo_name, payload.target_path
    )
"""

if "/api/v1/factory/scan-repo" not in code:
    code = code.replace('if __name__ == "__main__":', snippet + '\nif __name__ == "__main__":')
    p.write_text(code, encoding="utf-8")
    print("✅ اندپوینت اسکن مخازن به سرور افزوده شد.")
