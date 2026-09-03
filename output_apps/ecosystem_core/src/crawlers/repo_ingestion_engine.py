import os
import httpx
import pathlib
import ast
import logging
from typing import Dict, Any, List

logger = logging.getLogger("RepoIngestionEngine")

class RepoIngestionEngine:
    """موتور دانلود، اسکن و بردارسازی ساختار مخازن نرم‌افزاری متن‌باز"""

    @classmethod
    def scan_directory_structure(cls, root_path: str) -> Dict[str, Any]:
        """پیمایش فایل‌ها و پوشه‌ها برای شناسایی ماژول‌ها و ساختار کلی پروژه"""
        base = pathlib.Path(root_path)
        if not base.exists():
            return {"status": "error", "message": f"مسیر {root_path} یافت نشد."}

        files_map = []
        for p in base.rglob("*"):
            if p.is_file() and not any(part.startswith((".", "__pycache__", "node_modules", ".venv")) for part in p.parts):
                ext = p.suffix
                files_map.append({
                    "relative_path": str(p.relative_to(base)),
                    "extension": ext,
                    "size_bytes": p.stat().st_size
                })

        return {
            "status": "success",
            "total_files": len(files_map),
            "files": files_map[:100]  # نمونه ۱۰۰ فایل اول
        }

    @classmethod
    async def analyze_repo_and_vectorize(cls, repo_name: str, target_dir: str) -> Dict[str, Any]:
        """اسکن کدهای پایتون، استخراج کلاس‌ها و ذخیره در حافظه برداری کارخانه"""
        scan_res = cls.scan_directory_structure(target_dir)
        if scan_res.get("status") == "error":
            return scan_res

        q_host = os.getenv("QDRANT_HOST", "roxira_qdrant_prod")
        q_port = os.getenv("QDRANT_PORT", "6333")
        
        indexed_count = 0
        base = pathlib.Path(target_dir)
        
        for file_info in scan_res.get("files", []):
            if file_info["extension"] == ".py":
                full_path = base / file_info["relative_path"]
                try:
                    code_text = full_path.read_text(encoding="utf-8")
                    tree = ast.parse(code_text)
                    classes = [n.name for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]
                    functions = [n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]
                    
                    if classes or functions:
                        # ثبت متادیتا در Qdrant
                        point = {
                            "id": abs(hash(str(full_path))) % (10**9),
                            "payload": {
                                "repo": repo_name,
                                "file": file_info["relative_path"],
                                "classes": classes,
                                "functions": functions,
                                "snippet": code_text[:1500]
                            }
                        }
                        async with httpx.AsyncClient(timeout=4.0) as client:
                            await client.put(
                                f"http://{q_host}:{q_port}/collections/software_factory_code_vectors/points",
                                json={"points": [point]}
                            )
                        indexed_count += 1
                except Exception:
                    continue

        return {
            "status": "success",
            "repo": repo_name,
            "indexed_python_files": indexed_count,
            "message": f"تعداد {indexed_count} فایل از مخزن {repo_name} تحلیل و در دیتابیس برداری Qdrant ایندکس شد."
        }
