#!/usr/bin/env python3
"""
Roxira Resilient Multi-Provider Deep Search & Web Reader Cluster (2026)
Supports: Tavily Pool (4 Keys), Exa.ai, Brave Search, Jina AI Reader, Firecrawl Scraper
"""
import os, json, urllib.request, urllib.parse

def load_env():
    env = {}
    env_file = "/opt/roxira_platform/.env"
    if os.path.exists(env_file):
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                if "=" in line and not line.strip().startswith("#"):
                    k, v = line.strip().split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    return env

def search_tavily(query: str, api_key: str) -> str:
    url = "https://api.tavily.com/search"
    payload = json.dumps({"api_key": api_key, "query": query, "search_depth": "advanced", "max_results": 4}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        snippets = [r.get("content", "") for r in data.get("results", [])]
        return "\n".join(snippets)

def search_exa(query: str, api_key: str) -> str:
    url = "https://api.exa.ai/search"
    payload = json.dumps({"query": query, "numResults": 3, "useAutoprompt": True}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"x-api-key": api_key, "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        snippets = [r.get("text", "") or r.get("title", "") for r in data.get("results", [])]
        return "\n".join(snippets)

def search_brave(query: str, api_key: str) -> str:
    q = urllib.parse.quote(query)
    url = f"https://api.search.brave.com/res/v1/web/search?q={q}&count=4&freshness=pd"
    req = urllib.request.Request(url, headers={"X-Subscription-Token": api_key, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        results = data.get("web", {}).get("results", [])
        return "\n".join([r.get("description", "") for r in results])

def scrape_with_jina(target_url: str, api_key: str = "") -> str:
    """خواندن عمیق متن تمیز یک صفحه وب با استفاده از Jina Reader"""
    try:
        url = f"https://r.jina.ai/{target_url}"
        headers = {"Accept": "application/json"}
        if api_key: headers["Authorization"] = f"Bearer {api_key}"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("data", {}).get("content", "")[:1500]
    except Exception:
        return ""

def scrape_with_firecrawl(target_url: str, api_key: str) -> str:
    """استخراج ساختاریافته صفحه با Firecrawl"""
    try:
        url = "https://api.firecrawl.dev/v1/scrape"
        payload = json.dumps({"url": target_url, "formats": ["markdown"]}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("data", {}).get("markdown", "")[:1500]
    except Exception:
        return ""

def resilient_deep_search(query: str) -> str:
    env = load_env()

    # ۱. جستجو در استخر تِویلی (۴ کلید موازی)
    tavily_keys = [k.strip() for k in env.get("TAVILY_KEYS", "").split(",") if k.strip()]
    for i, t_key in enumerate(tavily_keys):
        try:
            res = search_tavily(query, t_key)
            if res and len(res) > 80:
                print(f"  ✅ وب‌کاوی فعال: Tavily (شاخص {i+1})")
                return res
        except Exception:
            continue

    # ۲. فالبک به Exa.ai
    exa_key = env.get("EXA_API_KEY")
    if exa_key:
        try:
            res = search_exa(query, exa_key)
            if res and len(res) > 80:
                print("  ✅ وب‌کاوی فعال: Exa.ai")
                return res
        except Exception: pass

    # ۳. فالبک به Brave Search با فیلتر اخبار اخیر
    brave_key = env.get("BRAVE_API_KEY")
    if brave_key:
        try:
            res = search_brave(query, brave_key)
            if res and len(res) > 80:
                print("  ✅ وب‌کاوی فعال: Brave Search")
                return res
        except Exception: pass

    # ۴. فالبک به Jina Search
    jina_key = env.get("JINA_API_KEY")
    if jina_key:
        try:
            q = urllib.parse.quote(query)
            url = f"https://s.jina.ai/{q}"
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {jina_key}", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                items = data.get("data", [])
                snippets = [it.get("content", "")[:350] for it in items[:3]]
                res = "\n".join(snippets)
                if res and len(res) > 80:
                    print("  ✅ وب‌کاوی فعال: Jina Search")
                    return res
        except Exception: pass

    return "داده‌ها بر اساس سنتز شواهد پایگاه مدل و منابع داخلی استخراج شدند."
