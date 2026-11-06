#!/usr/bin/env python3
# One real chat per key. Prints name, model, status only; never the key or the body.
import json,os,urllib.request,urllib.error,time
E=os.environ
OR='https://openrouter.ai/api/v1/chat/completions'; M='https://api.mistral.ai/v1/chat/completions'; S='https://api.sambanova.ai/v1/chat/completions'
T=[('OPENROUTER_API_KEY',OR,m) for m in ['cohere/north-mini-code:free','nvidia/nemotron-3-ultra-550b-a55b:free','google/gemma-4-31b-it:free','deepseek/deepseek-v4.1-flash']]
T+=[('OPENROUTER_API_KEY_AGENTS',OR,'deepseek/deepseek-v4.1-flash')]
T+=[(k,M,'mistral-medium-latest') for k in ['MISTRAL_API_KEY','MISTRAL_API_KEY_2','MISTRAL_API_KEY_3','MISTRAL_API_KEY_4']]
T+=[('SAMBANOVA_API_KEY',S,'gpt-oss-120b')]
T+=[('GROQ_API_KEY','https://api.groq.com/openai/v1/chat/completions','openai/gpt-oss-120b')]
T+=[(k,'https://api.groq.com/openai/v1/chat/completions','openai/gpt-oss-120b') for k in ['GROQ_API_KEY_2','GROQ_API_KEY_3']]
T+=[(k,'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions','gemini-flash-latest') for k in ['GEMINI_API_KEY','GEMINI_API_KEY_2','GEMINI_API_KEY_3','GEMINI_API_KEY_4']]
if E.get('CF_ACCOUNT_ID'): T+=[('CF_AI_TOKEN',f"https://api.cloudflare.com/client/v4/accounts/{E['CF_ACCOUNT_ID']}/ai/v1/chat/completions",'@cf/meta/llama-3.3-70b-instruct-fp8-fast')]
for k,u,m in T:
    if not E.get(k): print(k,m,'not set'); continue
    b=json.dumps({'model':m,'messages':[{'role':'user','content':'Reply with: OK'}],'max_tokens':30}).encode()
    r=urllib.request.Request(u,b,{'Authorization':'Bearer '+E[k],'Content-Type':'application/json','User-Agent':'roxira-keypool/1.0'})
    t=time.time()
    try:
        with urllib.request.urlopen(r,timeout=40) as x: s=x.status; json.load(x)
    except urllib.error.HTTPError as e: s=e.code
    except Exception as e: s=type(e).__name__
    print(f'{k:26} {m:42} {s} {time.time()-t:.1f}s',flush=True)
