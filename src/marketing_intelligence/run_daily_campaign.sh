#!/bin/bash
docker exec roxira_app_prod python3 -c "
import os, sys, json, httpx

env_file = '/opt/roxira_platform/.env' if os.path.exists('/opt/roxira_platform/.env') else '/app/.env'
if os.path.exists(env_file):
    with open(env_file, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip() and not line.startswith('#') and '=' in line:
                k, v = line.strip().split('=', 1)
                os.environ[k.strip()] = v.strip().strip('\"').strip("'")

api_key = os.getenv('OPENROUTER_API_KEY', '')
if not api_key: sys.exit(0)

topics = [
    'تحلیل کاربردی ماده ۴۷۴ قانون آیین دادرسی کیفری و نحوه پذیرش اعاده دادرسی با هوش مصنوعی',
    'راهنمای دفاع در دعاوی چک صیادی و مسدودی حساب طبق قانون جدید صدور چک',
    'چگونه شرکت‌ها با پلتفرم یکپارچه روکسیرا صورتحساب الکترونیکی سامانه مودیان صادر می‌کنند؟'
]

import random
chosen_topic = random.choice(topics)

payload = {
    'model': '~google/gemini-flash-latest',
    'messages': [
        {'role': 'system', 'content': 'شما استراتژیست ارشد برندینگ B2B و تولید محتوای هوش مصنوعی قضایی هستید.'},
        {'role': 'user', 'content': f'یک پست حرفه‌ای برای لینکدین درباره: {chosen_topic} بنویسید با هوک قوی، ارقام انگلیسی 0-9 و هشتگ‌های تخصصی.'}
    ],
    'temperature': 0.7,
    'max_tokens': 900
}

headers = {'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}
with httpx.Client(timeout=30.0) as client:
    r = client.post('https://openrouter.ai/api/v1/chat/completions', headers=headers, json=payload)
    if r.status_code == 200:
        post_text = r.json()['choices'][0]['message']['content']
        with open('/tmp/latest_social_post.txt', 'w', encoding='utf-8') as pf:
            pf.write(post_text)
        print('[MARKETING-AUTOPILOT] پست روزانه با موفقیت تولید و ذخیره گردید.')
" >> /var/log/marketing_autopilot.log 2>&1
