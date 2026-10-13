# VPN اضطراری روکسیرا (Xray + REALITY)

## چیست؟
یک سرویس بدون پنل وب (headless): Xray-core با VLESS + XTLS-Vision + REALITY روی پورت 8443 سرور جدید.
اجرا با کاربر بدون دسترسی (`xray-vpn`) و systemd سخت‌شده. پورت‌های 2053/2096 و هر پنل وب استفاده نمی‌شوند.
اسکریپت‌ها: `scripts/infra/vpn/`.

## دستورات مالک (به ترتیب، روی سرور)
```bash
cd /opt/roxira_platform/scripts/infra/vpn
sudo ./install_xray_reality.sh --host IP_یا_دامنه_سرور                 # فقط نمایش برنامه (dry-run)
sudo ./install_xray_reality.sh --host IP --clients owner,phone --apply  # نصب؛ لینک‌ها فقط روی صفحه چاپ می‌شوند
sudo ./health.sh                                                        # بررسی سلامت
sudo ./vpn_client.sh add NAME | remove NAME | list | link NAME          # مدیریت کاربران
sudo ./rotate.sh --port 8444 --dest dl.google.com:443 --keys --apply    # تغییر وقتی فیلتر شد
```
اگر پورت 8443 اشغال باشد (احتمالا سرویس x-ui بازیابی‌شده)، نصب متوقف می‌شود. برای آزادسازی صریحا
`--disable-xui` را اضافه کنید (`systemctl disable --now x-ui`).
لینک را در لاگ/چت/گیت نگذارید؛ لینک مثل رمز عبور است.

## وارد کردن لینک
- v2rayNG (اندروید): `+` ← Import config from clipboard (یا اسکن QR).
- Streisand (iOS): افزودن پروفایل ← Import from clipboard / QR.
- Hiddify: Add profile ← لینک یا QR. 
هر دستگاه یک کاربر جدا بگیرد تا بتوان جداگانه حذفش کرد.

## اگر مسدود شد
1. `./health.sh` را بزنید (سرویس و پورت سالم باشد).
2. `./rotate.sh --dest <سایت دیگر>:443 --keys --apply` (کلیدها عوض می‌شوند؛ لینک‌های جدید چاپ می‌شود).
3. اگر IP/پورت مسدود است: `--port` دیگر (غیر از پورت‌های رزرو AGENTS.md §7).
انتخاب dest: سایت بزرگ با TLS 1.3 و h2 که در ایران باز است و پشت ریدایرکت عجیب نیست
(پیش‌فرض www.microsoft.com؛ با `openssl s_client -connect X:443 -tls1_3 -alpn h2` تست کنید).

## نکته مهم شبکه
VPN همان IP مبدا سرور را استفاده می‌کند. فایروال «فقط Cloudflare» باید پورت 8443/tcp را باز نگه دارد
(قانون ufw با کامنت `roxira-vpn` ساخته می‌شود). خود سایت تاثیری نمی‌بیند چون کاربران از طریق Cloudflare می‌آیند.
