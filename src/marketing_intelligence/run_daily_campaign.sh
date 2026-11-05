#!/bin/bash
docker exec roxira_app_prod python3 -c "
import sys, random
sys.path.insert(0, '/opt/roxira_platform')
from src.marketing_intelligence.social_autopilot import generate_social_campaign

topics = [
    'تحلیل کاربردی ماده ۴۷۴ قانون آیین دادرسی کیفری و نحوه پذیرش اعاده دادرسی با هوش مصنوعی',
    'راهنمای دفاع در دعاوی چک صیادی و مسدودی حساب طبق قانون جدید صدور چک',
    'چگونه شرکت‌ها با پلتفرم یکپارچه روکسیرا صورتحساب الکترونیکی سامانه مودیان صادر می‌کنند؟'
]

chosen_topic = random.choice(topics)
res = generate_social_campaign(chosen_topic, 'linkedin')
if res.get('status') == 'success':
    with open('/tmp/latest_social_post.txt', 'w', encoding='utf-8') as pf:
        pf.write(res['content'])
    print('[MARKETING-AUTOPILOT] پست روزانه با موفقیت تولید و ذخیره گردید.')
else:
    print('[MARKETING-AUTOPILOT] ' + res.get('message', 'failed'))
" >> /var/log/marketing_autopilot.log 2>&1
