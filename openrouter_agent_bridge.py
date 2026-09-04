import os, json, urllib.request

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")

def call_openrouter(prompt, model="google/gemini-3.8-flash", system="شما هسته هوش مصنوعی قاضی هوشمند و روکسیرا هستید."):
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://roxira.net"
    }
    data = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.2
    }).encode("utf-8")
    
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            res = json.loads(response.read().decode("utf-8"))
            return res["choices"][0]["message"]["content"]
    except Exception as e:
        return f"Error: {e}"

if __name__ == "__main__":
    print("Bridge ready.")
