# چک‌لیست مهاجرت به سرور جدید (مالک)

جزئیات و دلیل هر مرحله: `docs/infra/NEW_SERVER_PLAN_2026-10-12.md`. در همه‌جا `OLD=5.75.200.67` و `NEW` آی‌پی سرور جدید است.
قانون: هر مرحله را اجرا کنید، خروجی را چک کنید، بعد بروید مرحله بعد. هیچ رمز یا کلیدی را در چت نفرستید.

```bash
export OLD=5.75.200.67
export NEW=<IP-جدید>     # بعد از مرحله ۳ مقدار بگیرید
```

## قبل از خرید (فقط خواندن)

- [ ] ۱. در کنسول Hetzner موجودی را ببینید (صفحه‌ی عمومی همه‌ی پلن‌ها را «موجود نیست» نشان داد؛ ممکن است فقط خطای نمایش باشد). پیشنهاد: CAX31 (آرم، ۸ هسته، ۱۶ گیگ، ۱۶۰ گیگ دیسک) در Nuremberg؛ اگر نبود CX43 یا CPX42 (x86، بخش ۱.۳ پلن را بخوانید). اگر هزینه مهم است: CAX21/CX33 (۸ گیگ) با ۱۶۰ گیگ یا حداقل ۸۰ گیگ.
  ```bash
  hcloud server-type list | grep -E 'cax|cx|cpx'
  ```
- [ ] ۲. سلامت بکاپ روی سرور قدیم (باید تایمرها فعال و آخرین اجرا OK باشد؛ اگر نبود اول `docs/ops/DISASTER_RECOVERY.md` بخش ۶ را اجرا کنید):
  ```bash
  ssh root@$OLD 'systemctl list-timers "roxira-backup-dr-*" --no-pager; cat /var/lib/roxira-backup/status.env | grep -E "LAST_RESULT|LAST_OK"'
  bash scripts/ops/backup/mac_pull.sh && ls -lt ~/Backups/roxira-dr | head
  ```
- [ ] ۳. دو مشکل شناخته‌شده را قبلاً بسته کنید یا دور بزنید: (الف) باگ نام سرویس‌ها در `restore.sh` و ریستور cron در همین PR اصلاح شده؛ (ب) Twenty از `docker-compose.modern-stack.yml` ساخته شده (روی prod تأیید شد) و ریستور آن را از همان فایل بالا می‌آورد.
- [ ] ۴. IP جدید را در هر جایی که IP سرور را whitelist می‌کند اضافه کنید (پیامک، درگاه پرداخت). این در ریپو تأیید نشده؛ از پشتیبانی هر سرویس بپرسید.
- [ ] ۵. تصمیم x-ui/VPN (پورت‌های 8443/2053/2096): همراه مهاجرت منتقل شود یا روی سرور قدیم بماند؟ (اگر سرور قدیم حذف شود VPN قطع می‌شود.)

## ساخت و سخت‌سازی

- [ ] ۶. ساخت سرور (Ubuntu 24.04، لوکیشن nbg1):
  ```bash
  hcloud ssh-key create --name roxira-admin --public-key-from-file ~/.ssh/id_ed25519.pub
  hcloud server create --name roxira-2 --type cax31 --image ubuntu-24.04 --location nbg1 --ssh-key roxira-admin
  export NEW=$(hcloud server ip roxira-2)
  ```
- [ ] ۷. اجرای اسکریپت پایه (اول dry-run را بخوانید؛ این ترمینال را باز نگه دارید):
  ```bash
  scp scripts/infra/bootstrap_new_server.sh root@$NEW:/root/
  ssh root@$NEW 'bash /root/bootstrap_new_server.sh --dry-run'
  ssh root@$NEW 'bash /root/bootstrap_new_server.sh'
  ```
  (قفل‌کردن sshd روی کلید فقط با `--i-have-key-access` انجام می‌شود؛ بدون آن این گام عمداً رد می‌شود.)
- [ ] ۸. در یک ترمینال دوم مطمئن شوید ورود کار می‌کند:
  ```bash
  ssh roxira@$NEW 'sudo ufw status verbose; sudo fail2ban-client status sshd; docker --version; free -m'
  ssh root@$NEW true && ssh roxira@$NEW true && ssh root@$NEW 'bash /root/bootstrap_new_server.sh --i-have-key-access'
  ```
  (فقط اگر هر دو ورود با کلید موفق بود، دستور سوم sshd را کلید‌-فقط می‌کند.)
- [ ] ۹. (اختیاری ولی توصیه‌شده) در کنسول Hetzner یک Cloud Firewall بسازید که همان پورت‌های ufw را باز کند (22، 80، 443 و پورت‌های VPN مثل سرور قدیم).

## رازها و ریپو (بدون چاپ مقدار)

- [ ] ۱۰. کپی فایل‌های `/etc/roxira` (از طریق مک، بدون نمایش):
  ```bash
  ssh root@$OLD 'cat /etc/roxira/backup.env' | ssh root@$NEW 'umask 077; cat > /etc/roxira/backup.env'
  scp ~/Secrets/roxira/restic-dr.pass root@$NEW:/etc/roxira/restic.pass
  rsync -a ~/Backups/roxira-dr/restic/ root@$NEW:/var/lib/roxira/mac-repo/
  ssh root@$NEW "printf 'BACKUP_LOCAL_REPO=/var/lib/roxira/mac-repo\n' >> /etc/roxira/backup.env; chmod 600 /etc/roxira/*; ls -l /etc/roxira"
  ```
- [ ] ۱۱. کلید deploy تازه و clone (فقط کلید عمومی منتقل می‌شود):
  ```bash
  ssh root@$NEW 'ssh-keygen -t ed25519 -N "" -f /root/.ssh/roxira_deploy -C roxira-2-deploy >/dev/null; cat /root/.ssh/roxira_deploy.pub' > /tmp/roxira-2.pub
  gh repo deploy-key add /tmp/roxira-2.pub --repo Mahan-film/roxira-platform --title roxira-2
  ssh root@$NEW 'printf "Host github.com\n  IdentityFile /root/.ssh/roxira_deploy\n  IdentitiesOnly yes\n" >> /root/.ssh/config; git clone git@github.com:Mahan-film/roxira-platform.git /opt/roxira_platform'
  ssh root@$NEW 'bash /opt/roxira_platform/scripts/infra/bootstrap_new_server.sh'
  ```
- [ ] ۱۲. نیازی به متوقف‌کردن دستی cron نیست: اسکریپت ریستور خودش cron را متوقف می‌کند، crontabهای قدیمی را در `/var/lib/roxira/cron-held` نگه می‌دارد و فهرست کارها را چاپ می‌کند. آن فهرست را بخوانید (کمپین بازاریابی و خزنده‌ها نباید روی دو سرور هم‌زمان اجرا شوند).

## ریستور آزمایشی و build (چند روز قبل از قطع)

- [ ] ۱۳. drill (فقط استخراج و بررسی، چیزی اعمال نمی‌شود):
  ```bash
  ssh root@$NEW 'cd /opt/roxira_platform && scripts/ops/backup/restore.sh --dry-run --repo local && scripts/ops/backup/restore.sh --repo local --scratch /var/tmp/restore-1'
  ```
- [ ] ۱۴. `.env` را از scratch بگذارید و ایمیج‌ها را build کنید (۱۵ تا ۳۰ دقیقه):
  ```bash
  ssh root@$NEW 'S=/var/tmp/restore-1; ls $S/opt/roxira_platform | head; cp -a $S/opt/roxira_platform/.env /opt/roxira_platform/.env && chmod 600 /opt/roxira_platform/.env
  cd /opt/roxira_platform && scripts/ops/nginx/gen_snakeoil_cert.sh && scripts/ops/nginx/update_cloudflare_ips.sh && scripts/ops/prep_backend_mounts.sh --apply
  docker compose -f docker-compose.prod.yml config -q && docker compose -f docker-compose.prod.yml build'
  ```
- [ ] ۱۵. ریستور کامل (ابتدا dry-run را بخوانید):
  ```bash
  ssh root@$NEW 'cd /opt/roxira_platform && scripts/ops/backup/restore.sh --repo local --full --dry-run'
  ssh root@$NEW 'cd /opt/roxira_platform && scripts/ops/backup/restore.sh --repo local --full --yes --scratch /var/tmp/restore-1'
  ssh root@$NEW 'ufw reload; systemctl stop "roxira-*.timer"; systemctl is-active cron; ufw status numbered'   # cron باید inactive باشد
  ssh root@$NEW true    # از ترمینال دوم: هنوز وارد می‌شوید؟
  ```
- [ ] ۱۶. شمارش نقطه‌های Qdrant در قدیم و جدید باید برابر باشد:
  ```bash
  for H in $OLD $NEW; do echo "== $H"; ssh root@$H 'curl -s localhost:6333/collections | jq -r ".result.collections[].name" | sort | while read c; do printf "%s %s\n" "$c" "$(curl -s localhost:6333/collections/$c | jq .result.points_count)"; done'; done
  ```
- [ ] ۱۷. Twenty از `docker-compose.modern-stack.yml` توسط اسکریپت ریستور بالا می‌آید (مقادیر از `.env` ریپو). روی سرور کاملاً جدید اول `docker network create roxira_mesh`. اعتبارسنجی: `docker compose -f docker-compose.modern-stack.yml config -q`. بعد research-stack و سندباکس‌ها را با compose خودشان بالا بیاورید.

## تست دود روی IP جدید (قبل از تغییر DNS)

- [ ] ۱۸. تست با `--resolve` (فایروال Cloudflare-only هنوز اعمال نشده):
  ```bash
  for D in ghazihoushmand.ir roxira.ir roxira.net; do curl -sS -o /dev/null -w "$D %{http_code} tls=%{ssl_verify_result}\n" --resolve $D:443:$NEW https://$D/health; done
  ssh root@$NEW 'curl -s -o /dev/null -w "groq %{http_code}\n" https://api.groq.com/openai/v1/models; curl -s -o /dev/null -w "openrouter %{http_code}\n" https://openrouter.ai/api/v1/models; free -m; df -h /'
  ```
  (کد 401 یعنی قابل‌دسترس؛ timeout یا 403 یعنی IP بلاک است.) سپس در مرورگر با موقتاً اضافه کردن `NEW ghazihoushmand.ir roxira.ir roxira.net` به `/etc/hosts`: ورود با OTP و گوگل، یک پرسش حقوقی با ارجاع، آپلود پرونده، سفارش آزمایشی پرداخت. بعد خطوط hosts را پاک کنید.
- [ ] ۱۹. ایمیل بکاپ از سرور جدید کار کند: `ssh root@$NEW 'FORCE_BUNDLE=1 /opt/roxira_platform/scripts/ops/backup/server_backup.sh report'`

## پنجره‌ی قطع (۱۵ تا ۳۰ دقیقه)

- [ ] ۲۰. روی قدیم نوشتن را متوقف کنید و بکاپ نهایی بگیرید:
  ```bash
  ssh root@$OLD 'systemctl stop cron; systemctl stop "roxira-*.timer"; cd /opt/roxira_platform && docker compose -f docker-compose.prod.yml stop roxira_enterprise_frontend roxira_enterprise_backend enterprise_app nginx_gateway; docker stop roxira_twenty_crm'
  ssh root@$OLD '/opt/roxira_platform/scripts/ops/backup/server_backup.sh run'
  ```
- [ ] ۲۱. انتقال به جدید و ریستور دلتا:
  ```bash
  bash scripts/ops/backup/mac_pull.sh && rsync -a ~/Backups/roxira-dr/restic/ root@$NEW:/var/lib/roxira/mac-repo/
  ssh root@$NEW 'cd /opt/roxira_platform && scripts/ops/backup/restore.sh --repo local --full --yes'
  ```
  دوباره مرحله ۱۶ را اجرا کنید (تعداد برابر).
- [ ] ۲۲. کارهای cron نگه‌داشته‌شده و تایمرها را بعد از مرور روی جدید فعال کنید:
  ```bash
  ssh root@$NEW 'cd /opt/roxira_platform && scripts/ops/backup/restore.sh --apply-cron --dry-run'   # فهرست را بخوانید
  ssh root@$NEW 'cd /opt/roxira_platform && scripts/ops/backup/restore.sh --apply-cron'
  ssh root@$NEW 'bash /opt/roxira_platform/scripts/infra/bootstrap_new_server.sh --enable-timers'
  ```
- [ ] ۲۳. **Cloudflare:** رکورد A همه‌ی دامنه‌ها (`ghazihoushmand.ir`, `roxira.ir`, `roxira.net` و `www`) را به `NEW` تغییر دهید؛ رکورد AAAA را هم اصلاح یا حذف کنید. (پروکسی روشن است، اثر در چند ثانیه.)
- [ ] ۲۴. بدون `--resolve` تست کنید: `curl -sS https://ghazihoushmand.ir/health` + ورود + یک پرسش. لاگ زنده: `ssh root@$NEW 'docker logs -f --tail 50 roxira_nginx_prod'`.
- [ ] ۲۵. پس از اطمینان از ترافیک، قفل مبدأ:
  ```bash
  ssh root@$NEW '/opt/roxira_platform/scripts/ops/firewall/cloudflare_only.sh --apply && /opt/roxira_platform/scripts/ops/firewall/cloudflare_only.sh --status'
  curl -sk --max-time 8 -o /dev/null -w "direct IP: %{http_code}\n" https://$NEW/    # باید شکست بخورد یا 444 بدهد
  ```
- [ ] ۲۶. مک را به‌روز کنید: `DEPLOY_SSH_HOST`/`ROXIRA_HOST`، `~/.ssh/config`، هدف `mac_pull.sh`؛ یک بکاپ دستی روی جدید و دیدن ایمیل گزارش؛ یک `deploy_local.sh deploy` برای ثبت دوباره‌ی `prev_commit`.

## بازگشت اگر لازم شد (۴۸ ساعت اول)

- [ ] ۲۷. قبل از نوشته شدن داده روی جدید: رکوردهای A را به `OLD` برگردانید و روی قدیم `systemctl unmask cron; systemctl start cron` و کانتینرها/تایمرها را start کنید. بعد از نوشتن داده‌ی کاربران روی جدید: اول `server_backup.sh run` روی جدید، ریستور روی قدیم، بعد برگرداندن DNS. هرگز cron هر دو سرور را هم‌زمان روشن نگذارید.

## بعد از ۴۸ ساعت

- [ ] ۲۸. شرط‌ها: دو ایمیل گزارش بکاپ از جدید، یک drill ریستور موفق، `ssh root@$NEW 'certbot renew --dry-run'` موفق.
- [ ] ۲۹. روی قدیم snapshot بگیرید و ۷ روز نگه دارید: `hcloud server create-image --type snapshot --description roxira-1-final roxira-1` (نام سرور قدیم را در Hetzner چک کنید).
- [ ] ۳۰. IP قدیم را از allowlistها، deploy keyها (`gh repo deploy-key list`)، `known_hosts` و پیکربندی مک حذف کنید. پوشه‌های `/root/deploy-state/env-backups` را روی سرور **جدید** پاک کنید (کپی متن‌ساده‌ی `.env`).
- [ ] ۳۱. حذف سرور قدیم فقط با تأیید خودتان و فقط همان یک سرور: `hcloud server delete roxira-1` (غیرقابل بازگشت).
