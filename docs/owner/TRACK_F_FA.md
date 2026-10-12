# مسیر F: کارخانه‌ی نرم‌افزار (راهنمای اجرای شخصی مالک)

وضعیت: ۱۲ اکتبر ۲۰۲۶. منبع‌ها: `docs/ops/TASK_CAPS.md`، `docs/ops/PREVIEW.md`، `docs/factory/FACTORY_AUDIT_2026-10-12.md` بخش ۱٫۱ و ۷، `docs/STRATEGY_GAP_2026-10-12.md` (F2، F7، F10، F12، O14)، `AGENTS.md` بخش ۶ (قانون «بدون تخریب»).

## ۱. هدف
«کارخانه» یعنی ابزارهایی که کارهای کوچک کد را به agentهای ارزان می‌دهند و PR می‌گیرند (`scripts/dev/rx`). سه کار: (۱) سقف خرج و زمان برای هر کار agent تا یک حلقه‌ی خراب پول و وقت نسوزاند؛ (۲) محیط پیش‌نمایش موقت برای دیدن تغییر قبل از ادغام؛ (۳) مرتب‌کردن حدود ۲۳۰ worktree کهنه و اسکریپت‌های قدیمی ریشه بدون حذف چیزی که هنوز لازم است.

## ۲. چرا الان
- `docs/ops/TASK_CAPS.md` صریحاً می‌گوید هنوز هیچ چیز به rx وصل نشده؛ یک agent گیرکرده تا سقف کلید ۴ دلاری خرج می‌کند.
- پیش‌نمایش «هرگز end-to-end ثابت نشده» (F7).
- worktreeهای کهنه فضای دیسک و سردرگمی می‌سازند؛ ولی حذف دسته‌جمعی طبق AGENTS بخش ۶ ممنوع است، پس باید انتخابی و قابل‌اثبات انجام شود.

## ۳. پیش‌نیازها
- مسیر E (کلیدهای جدا با سقف روزانه) ترجیحاً انجام شده؛ سقف نرم‌افزاری مکمل سقف کلید است.
- نصب‌بودن `gh` و ورود به آن، Docker Desktop برای پیش‌نمایش.
- کار با `git fetch && git checkout origin/main` شروع شود (سرور هر ~۳۰ دقیقه به main پوش می‌کند).
- هیچ حذفی را بدون خواندن فهرست و تأیید خودتان اجرا نکنید.

## ۴. قدم‌به‌قدم

### F0. تعمیر codebase-memory (۵ دقیقه)
سرور MCP نمودار کد از ۳ اکتبر کار نمی‌کند (قفل کهنه). طبق audit:
۱) (مک؛ همه‌ی نشست‌های Claude را ببندید) مطمئن شوید پروسه‌ای نیست:
```bash
pgrep -fl codebase-memory || echo "no cbm processes"
```
انتظار: فقط `no cbm processes`.
۲) قفل‌های هماهنگی (نه دیتابیس نمودار):
```bash
rm -r /tmp/cbm-daemon-501
```
۳) تأیید:
```bash
codebase-memory-mcp cli list_projects
```
انتظار: فهرست پروژه‌ها. اگر خطا داد: `codebase-memory-mcp update -y` و دوباره گام ۳.

### F1. وصل‌کردن سقف کار (task caps) به rx
سقف‌های پیش‌فرض: ۲۵ نوبت، ۴۰۰٬۰۰۰ توکن ورودی، ۱۸۰۰ ثانیه، ۰٫۵۰ دلار، و ۳ خطای یکسان پشت‌سرهم (`src/factory_pipeline/task_caps.py`). کد نوشتن کار شماست نه؛ کار شما دادن دستور درست به agent و تأیید است.
۱) issue بسازید (اگر قبلاً نیست):
```bash
gh issue create --repo Mahan-film/roxira-platform --title "factory: wire CapTracker into scripts/dev/rx behind RX_CAPS" --body "Implement the hook points in docs/ops/TASK_CAPS.md: create CapTracker after worker start, append_task_event per turn, PARK kills the worker like the timeout branch and logs a park event, end event after PR. RX_CAPS=1 must first only LOG (no kill); RX_CAPS=enforce enforces. Also remove codex from the default fallback chain in scripts/dev/rx and scripts/dev/README.md. Only ids, counts, statuses and hashes in the ledger; never keys or prompts. Add a unit test for the PARK path."
```
انتظار: آدرس issue و شماره‌ی N.
۲) agent را اجرا کنید (N شماره‌ی issue):
```bash
rx N dsflash
```
انتظار: PR باز می‌شود. این فایل جزو مسیرهای حساس auto-merge نیست؛ ولی قبل از ادغام diff را بخوانید یا از hub بخواهید با `reviewer` مرور کند.
۳) بعد از ادغام، حالت فقط-ثبت:
```bash
RX_CAPS=1 rx M dsflash
```
(M = یک issue کوچک واقعی دیگر.) سپس:
```bash
python3 scripts/dev/factory_status.py -n 10 --days 7
```
انتظار: رویدادهای step/end برای آن کار در دفتر `~/.local/state/roxira/runs/tasks.jsonl`.
۴) پس از یک هفته که لاگ منطقی بود، `RX_CAPS=enforce` را به‌عنوان پیش‌فرض بخواهید.

### F2. محیط پیش‌نمایش (preview) و اثبات یک دور کامل
قواعد: حداکثر ۲ پیش‌نمایش زنده، هر کدام ۱ CPU و ۱ گیگ، انقضای ۲۴ ساعت، پورت غیرتولیدی، بدون داده و رمز تولید (`docs/ops/PREVIEW.md`). قالب آماده: `templates/preview/docker-compose.preview.yml` (یک nginx).
۱) پورت‌ها را چک کنید (قانون AGENTS بخش ۷)؛ اسکریپت خودش پورت قطعی می‌دهد ولی ببینید آزاد باشد:
```bash
dry="$(scripts/ops/preview.sh --dry-run up demo-1 templates/preview/docker-compose.preview.yml)"; echo "$dry"
```
انتظار: یک دستور docker compose با `PREVIEW_PORT=<عدد>`. عدد را `lsof -nP -iTCP:<عدد> -sTCP:LISTEN` چک کنید؛ خروجی خالی = آزاد.
۲) بالا بیاورید:
```bash
scripts/ops/preview.sh up demo-1 templates/preview/docker-compose.preview.yml
```
۳) تأیید:
```bash
docker ps --filter label=roxira.preview=1 --format "{{.Names}} {{.Ports}}"
```
در مرورگر `http://127.0.0.1:<PORT>` صفحه‌ی nginx را نشان می‌دهد.
۴) خاموش‌کردن فوری و جمع‌آوری منقضی‌ها:
```bash
scripts/ops/preview.sh down demo-1
```
```bash
scripts/ops/preview.sh gc
```
انتظار: `docker ps --filter label=roxira.preview=1` خالی.
۵) این همان «اثبات یک دور» است. اگر خطا داد، متن خطا را به hub بدهید. گام بعد (hub): قالب `templates/roxira-static-rtl` به‌عنوان پیش‌نمایش واقعی PR.

### F3. آرشیو اسکریپت‌های قدیمی ریشه (انتخابی، با تأیید شما)
واقعیت: در ریشه‌ی ریپو حدود ۲۵ فایل `.py` «خودکار» قدیمی هست که مسیر `/opt/roxira_platform` را ثابت دارند. همه‌شان مرده نیستند. نتیجه‌ی جست‌وجوی ارجاع (به‌دست‌آمده از ریپو):
- **دست نزنید:** `run_unified_server.py` (در `Dockerfile.prod` و `docker-compose.prod.yml` استفاده می‌شود)، `factory_engine.py` (توسط `output_apps/ecosystem_core/src/factory/task_worker.py` ارجاع شده)، `factory_dispatch_api.py` (پورت 8005 «Factory Dispatcher» در AGENTS رزرو است؛ ممکن است روی سرور زنده باشد).
- **کاندید آرشیو (بدون هیچ ارجاعی در کد):** `apply_2026_modern_pipeline.py`، `audit_system_state.py`، `auto_migrate_db.py`، `auto_system_journalist.py`، `autonomous_agent_factory.py`، `autonomous_agent_watcher.py`، `autonomous_master_daemon.py`، `batch_build_all_modules.py`، `bulk_legal_ingestion.py`، `chaos_swarm_orchestrator.py`، `comprehensive_system_audit.py`، `context_guard.py`، `generate_handover.py`، `ingest_full_precedents.py`، `inject_latest_precedents_2026.py`، `master_autonomous_runner.py`، `master_swarm_orchestrator.py`، `migrate_with_db_detection.py`، `openrouter_agent_bridge.py`، `populate_empty_collections.py`، `sync_qdrant_fixed.py`، `sync_qdrant_rest.py`. همچنین `get-pip.py` (۲ مگابایت) و فایل‌های `TECH_RADAR_*` و handover.
۱) روی سرور فقط بخوانید که چیزی از این‌ها واقعاً اجرا نمی‌شود (هیچ تغییری نمی‌دهد):
```bash
ssh root@5.75.200.67 'systemctl list-units --type=service --state=running --no-pager | grep -i -E "roxira|factory|autonomous|swarm"'
```
```bash
ssh root@5.75.200.67 'crontab -l; ls /etc/cron.d'
```
```bash
ssh root@5.75.200.67 'ss -tulnp | grep 8005'
```
۲) هر اسمی از فهرست کاندید که در خروجی بالا آمد را از کاندیدها خط بزنید.
۳) تصمیم نهایی را به hub بدهید: «این فهرست را به `archive/legacy_root/` منتقل کن». انتقال با `git mv` فایل‌به‌فایل در یک PR بازبینی‌شده انجام می‌شود (هیچ حذفی؛ تاریخچه می‌ماند) و `local_ci` را می‌گذراند.
۴) برگشت: `git revert` همان PR.

### F4. worktree های کهنه (انتخابی و ثابت‌شده برای هر شاخه)
۱) اول پشتیبان از کار ناپوش‌شده (فقط کپی می‌گیرد، چیزی را تغییر نمی‌دهد):
```bash
scripts/dev/branch_backup.sh
```
انتظار: پوشه‌ی `~/branch-backups` با bundle برای شاخه‌های ناپوش‌شده.
۲) فهرست PRهای ادغام‌شده (مخزن squash-merge می‌کند، پس `git branch --merged` کافی نیست):
```bash
gh pr list --repo Mahan-film/roxira-platform --state merged --limit 2000 --json headRefName -q '.[].headRefName' | sort -u > ~/merged-heads.txt; wc -l ~/merged-heads.txt
```
۳) گزارش فقط‌خواندنی؛ هر worktree یکی از وضعیت‌ها را می‌گیرد (از ریشه‌ی ریپوی اصلی اجرا کنید: `cd /Users/mac/Developer/roxira-platform`):
```bash
git worktree list --porcelain | awk '/^worktree /{p=substr($0,10)} /^branch /{b=substr($0,8); sub("refs/heads/","",b); print p"\t"b}' | while IFS=$'\t' read -r p b; do d=$(git -C "$p" status --porcelain 2>/dev/null | wc -l | tr -d ' '); u=$(git -C "$p" log "$b" --not --remotes --oneline 2>/dev/null | wc -l | tr -d ' '); m=no; grep -qxF "$b" ~/merged-heads.txt && m=yes; if [ "$d" != 0 ]; then s=DIRTY; elif [ "$u" != 0 ]; then s=UNPUSHED; elif [ "$m" = yes ]; then s=CANDIDATE; else s=KEEP-UNMERGED; fi; printf '%s\t%s\t%s\n' "$s" "$b" "$p"; done | sort > ~/worktree-report.tsv; cut -f1 ~/worktree-report.tsv | sort | uniq -c
```
انتظار: شمارش هر وضعیت. فقط `CANDIDATE` قابل حذف است: یعنی بدون تغییر ذخیره‌نشده، بدون commit ناپوش‌شده و PRاش ادغام شده. `DIRTY`/`UNPUSHED`/`KEEP-UNMERGED` را هرگز لمس نکنید. worktree فعلی hub و `hub-orchestration-deployment-*` را هم نه.
۴) فایل `~/worktree-report.tsv` را باز کنید و فقط ۱۰ ردیف `CANDIDATE` اول را بخوانید. هر کدام را جدا (بدون `--force`):
```bash
git worktree remove "<مسیر ردیف>"
```
اگر Git گفت تغییرات دارد، متوقف شوید (یعنی گزارش اشتباه بوده) و به hub بگویید.
۵) شاخه‌ها را پاک نکنید (کم‌حجم‌اند). اگر خواستید، فقط برای همان شاخه‌ی تأییدشده: `git branch -D <نام>` (تک‌تک).
۶) هر روز ۱۰ تا؛ بعد از هر دسته `git worktree prune` را خود Git انجام می‌دهد. دیتابیس‌های نمودار قدیمی codebase-memory را هم با `codebase-memory-mcp cli delete_project <name>` برای worktreeهای حذف‌شده پاک کنید.
۷) فایل‌های `~/merged-heads.txt` و `~/worktree-report.tsv` موقتی‌اند.

## ۵. چطور بفهمم درست انجام شد
- [ ] `codebase-memory-mcp cli list_projects` فهرست می‌دهد.
- [ ] `rx` با `RX_CAPS=1` رویداد `step` در `factory_status.py` می‌نویسد و `codex` از زنجیره‌ی پیش‌فرض رفته.
- [ ] `preview.sh up/down/gc` یک دور کامل بدون خطا و بدون کانتینر باقی‌مانده.
- [ ] هیچ فایل «دست نزنید» (بالا) جابه‌جا نشده و `local_ci.sh` سبز است.
- [ ] گزارش worktree شمارش دارد و فقط ردیف‌های `CANDIDATE` پاک شده‌اند؛ `git worktree list | wc -l` کم شده و `git status` ریپوی اصلی تمیز است.

## ۶. خطرها و راه برگشت
- آرشیو اشتباهی یک فایل زنده → `git revert`؛ برای همین قبلش سرور را (فقط‌خواندنی) چک می‌کنیم.
- `git worktree remove` بدون `--force` اگر چیزی ذخیره‌نشده بود خودش رد می‌کند (ضامن ایمنی). هرگز `rm -rf` روی `.claude/worktrees/` یا `~/Developer/rx-wt/`.
- سقف rx زیاد سخت‌گیرانه باشد کار خوب را «park» می‌کند: اول فقط ثبت (RX_CAPS=1).
- پیش‌نمایش باید `127.0.0.1` باشد؛ هرگز پورت‌های رزرو AGENTS را اشغال نکنید.
- bundleها در `~/branch-backups` پشتیبان برگشتند.

## ۷. زمان و هزینه
F0 ۵ دقیقه؛ F1 ۱۵ دقیقه شما + اجرای agent (حدود ۰٫۵ دلار)؛ F2 ۲۰ دقیقه؛ F3 ۳۰ دقیقه شما + یک PR؛ F4 ۴۰ دقیقه برای گزارش، سپس ۱۰ دقیقه در روز. هزینه‌ی ابزار: صفر؛ مصرف توکن کم.

## ۸. کجا Claude کمک می‌کند
- خروجی شمارش `uniq -c` گزارش worktree (نه خود فایل با مسیرها اگر نمی‌خواهید) و ۱۰ ردیف نمونه.
- خروجی سه دستور فقط‌خواندنی سرور در F3.
- خطای `preview.sh` یا `rx`.
- Claude می‌تواند: اجرای issue بخش F1 را به agent بدهد، PR انتقال `archive/legacy_root/` را بسازد، و diff را با reviewer مرور کند.

## منابع
- داخلی: `docs/ops/TASK_CAPS.md`، `docs/ops/PREVIEW.md`، `docs/ops/HOUSEKEEPING.md`، `scripts/dev/README.md`، `scripts/dev/branch_backup.sh`، `scripts/dev/factory_status.py`، `docs/factory/FACTORY_AUDIT_2026-10-12.md`.
- (این مسیر به محصول خارجی وابسته نیست؛ دستورات `git worktree` و `gh pr list` مستندات رسمی Git و GitHub CLI هستند.)
