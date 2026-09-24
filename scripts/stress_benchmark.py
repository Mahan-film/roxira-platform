#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
بنچمارک تاب‌آوری سرور (Server Resilience Benchmark)

سنجش همزمانی غیرهمگام با AsyncIO + HTTPX برای شبیه‌سازی بار واقعی روی
دو مسیر حیاتی سامانه:

  ۱) GET /health/system
     پایش سلامت کانتینرها (NestJS — VERSION_NEUTRAL روی پورت ۳۰۰۰)
  ۲) GET /api/backend/enterprise-hub/accounting/accounts
     فهرست حساب‌های دفتر کل؛ این مسیر از طریق لایه NestJS به PostgreSQL و
     از آنجا از طریق PgBouncer (pool mode=transaction) خوانده می‌شود.

پس از بار، پایداری اتصال PgBouncer با یک موج همزمان `SELECT 1` و شمارش
اتصال‌های واقعی بک‌اند (`pg_stat_activity`) تأیید می‌گردد.

اجرای پیش‌فرض روی هاست:
    python3 scripts/stress_benchmark.py
اجرا داخل کانتینر (نام سرویس‌های شبکه داکر):
    BENCH_HEALTH_URL=http://roxira_enterprise_backend:3000/health/system \\
    BENCH_ACCOUNTS_URL=http://roxira_enterprise_frontend:3001/api/backend/enterprise-hub/accounting/accounts \\
    PGBOUNCER_HOST=roxira_pgbouncer \\
    python3 /tmp/stress_benchmark.py

خروجی 0 = هر دو مسیر پایدار و PgBouncer سالم؛ در غیر این‌صورت 1.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

try:  # psycopg در محیط اجرای سرویس موجود است؛ در نبود آن فقط بخش DB رد می‌شود.
    import psycopg
except Exception:  # pragma: no cover - محیط بدون درایور پایگاه داده
    psycopg = None  # type: ignore[assignment]


# ─────────────────────────────────────────────────────────────────────────────
# پیکربندی
# ─────────────────────────────────────────────────────────────────────────────
DEFAULT_HEALTH_URL = os.getenv(
    "BENCH_HEALTH_URL", "http://127.0.0.1:3000/health/system"
)
DEFAULT_ACCOUNTS_URL = os.getenv(
    "BENCH_ACCOUNTS_URL",
    "http://127.0.0.1:3001/api/backend/enterprise-hub/accounting/accounts",
)

MAX_DB_CONNECTIONS = int(os.getenv("PGBOUNCER_MAX_DB_CONNECTIONS", "500"))


@dataclass
class Endpoint:
    label: str
    url: str


@dataclass
class Sample:
    label: str
    status: int | None
    elapsed: float
    ok: bool
    error: str | None = None


# ─────────────────────────────────────────────────────────────────────────────
# ابزار عددی
# ─────────────────────────────────────────────────────────────────────────────
def _percentile(sorted_values: list[float], ratio: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    index = max(0, min(len(sorted_values) - 1, round(ratio * (len(sorted_values) - 1))))
    return sorted_values[index]


def _ms(seconds: float) -> str:
    return f"{seconds * 1000:.1f} ms"


# ─────────────────────────────────────────────────────────────────────────────
# بنچمارک HTTP
# ─────────────────────────────────────────────────────────────────────────────
async def _fire(
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    endpoint: Endpoint,
    timeout: float,
) -> Sample:
    async with semaphore:
        started = time.perf_counter()
        try:
            response = await client.get(endpoint.url, timeout=timeout)
            elapsed = time.perf_counter() - started
            return Sample(
                label=endpoint.label,
                status=response.status_code,
                elapsed=elapsed,
                ok=200 <= response.status_code < 400,
            )
        except Exception as exc:  # noqa: BLE001 - هر خطای شبکه باید ثبت شود
            elapsed = time.perf_counter() - started
            return Sample(
                label=endpoint.label,
                status=None,
                elapsed=elapsed,
                ok=False,
                error=f"{type(exc).__name__}: {str(exc)[:140]}",
            )


@dataclass
class EndpointReport:
    label: str
    url: str
    total: int
    success: int
    failure: int
    avg_ms: float
    p50_ms: float
    p95_ms: float
    p99_ms: float
    min_ms: float
    max_ms: float
    rps: float
    errors: list[str]


async def run_http_benchmark(
    endpoints: list[Endpoint],
    total_requests: int,
    concurrency: int,
    timeout: float,
) -> tuple[list[EndpointReport], list[Sample]]:
    limits = httpx.Limits(
        max_connections=concurrency,
        max_keepalive_connections=concurrency,
        keepalive_expiry=30.0,
    )
    semaphore = asyncio.Semaphore(concurrency)
    samples: list[Sample] = []

    print(
        f"\n▶ اجرای {total_requests} درخواست همزمان با آستانه همزمانی {concurrency} "
        f"روی {len(endpoints)} مسیر ..."
    )
    started = time.perf_counter()
    async with httpx.AsyncClient(limits=limits, http2=False, follow_redirects=False) as client:
        tasks = [
            asyncio.create_task(_fire(client, semaphore, endpoints[i % len(endpoints)], timeout))
            for i in range(total_requests)
        ]
        for coro in asyncio.as_completed(tasks):
            samples.append(await coro)
    wall = time.perf_counter() - started

    reports: list[EndpointReport] = []
    for endpoint in endpoints:
        subset = [s for s in samples if s.label == endpoint.label]
        elapsed = sorted(s.elapsed for s in subset)
        successes = [s for s in subset if s.ok]
        errors = [s.error for s in subset if s.error][:5]
        reports.append(
            EndpointReport(
                label=endpoint.label,
                url=endpoint.url,
                total=len(subset),
                success=len(successes),
                failure=len(subset) - len(successes),
                avg_ms=(statistics.fmean(elapsed) * 1000) if elapsed else 0.0,
                p50_ms=_percentile(elapsed, 0.50) * 1000,
                p95_ms=_percentile(elapsed, 0.95) * 1000,
                p99_ms=_percentile(elapsed, 0.99) * 1000,
                min_ms=(elapsed[0] * 1000) if elapsed else 0.0,
                max_ms=(elapsed[-1] * 1000) if elapsed else 0.0,
                rps=(len(subset) / wall) if wall else 0.0,
                errors=errors,
            )
        )
    return reports, samples


# ─────────────────────────────────────────────────────────────────────────────
# تأیید پایداری PgBouncer
# ─────────────────────────────────────────────────────────────────────────────
def _pg_dsn() -> str:
    """DSN هدفِ بررسی، همیشه از مسیر PgBouncer ساخته می‌شود.

    توجه: `DATABASE_URL` عمداً استفاده نمی‌شود؛ در محیط production این متغیر
    معمولاً مستقیماً به Postgres (پورت ۵۴۳۲) اشاره می‌کند و اگر مبنا قرار
    گیرد، بررسی پایداری به‌اشتباه روی pool انجام نمی‌شود. برای هدف‌گیری
    صریح pool، از `PGBOUNCER_DATABASE_URL` یا `PGBOUNCER_HOST/PORT` استفاده
    می‌گردد.
    """
    explicit = os.getenv("PGBOUNCER_DATABASE_URL")
    if explicit:
        return explicit
    host = os.getenv("PGBOUNCER_HOST") or os.getenv("POSTGRES_HOST", "127.0.0.1")
    port = os.getenv("PGBOUNCER_PORT", "6432")
    user = os.getenv("POSTGRES_USER", "enterprise_admin")
    password = os.environ["POSTGRES_PASSWORD"]
    dbname = os.getenv("POSTGRES_DB", "enterprise_db")
    return f"postgresql://{user}:{password}@{host}:{port}/{dbname}"


async def _pg_ping(dsn: str, timeout: float) -> float:
    started = time.perf_counter()
    assert psycopg is not None
    connection = await psycopg.AsyncConnection.connect(dsn, connect_timeout=timeout)
    async with connection:
        async with connection.cursor() as cursor:
            await cursor.execute("SELECT 1")
            await cursor.fetchone()
    return time.perf_counter() - started


async def _pg_backend_connections(dsn: str, timeout: float) -> int:
    assert psycopg is not None
    connection = await psycopg.AsyncConnection.connect(dsn, connect_timeout=timeout)
    async with connection:
        async with connection.cursor() as cursor:
            await cursor.execute(
                "SELECT count(*) FROM pg_stat_activity "
                "WHERE datname = current_database() AND pid <> pg_backend_pid()"
            )
            row = await cursor.fetchone()
    return int(row[0]) if row else 0


async def pg_probe(dsn: str, probes: int, concurrency: int, timeout: float) -> tuple[int, int, float]:
    """موج همزمان اتصال/پرس‌وجو از طریق PgBouncer. بازگشت (موفق، ناموفق، میانگین ثانیه)."""
    semaphore = asyncio.Semaphore(concurrency)

    async def one() -> float | None:
        async with semaphore:
            try:
                return await _pg_ping(dsn, timeout)
            except Exception:
                return None

    results = await asyncio.gather(*(one() for _ in range(probes)))
    ok = [r for r in results if r is not None]
    failed = len(results) - len(ok)
    avg = statistics.fmean(ok) if ok else 0.0
    return len(ok), failed, avg


async def verify_pgbouncer(probes: int, concurrency: int, timeout: float) -> dict:
    if psycopg is None:
        print("\n⚠ درایور psycopg نصب نیست؛ بررسی PgBouncer رد شد.")
        return {"available": False, "stable": False, "skipped": True}

    dsn = _pg_dsn()
    safe_dsn = dsn.split("@")[-1]
    print(f"\n▶ بررسی پایداری PgBouncer روی {safe_dsn} ({probes} اتصال همزمان) ...")

    baseline_conns = await _pg_backend_connections(dsn, timeout)
    ok, failed, avg = await pg_probe(dsn, probes, concurrency, timeout)
    after_conns = await _pg_backend_connections(dsn, timeout)
    within_cap = after_conns <= MAX_DB_CONNECTIONS
    stable = failed == 0 and ok == probes and within_cap and after_conns > 0

    print(f"  • اتصال‌های موفق: {ok}/{probes}  |  ناموفق: {failed}")
    print(f"  • میانگین تأخیر پرس‌وجو از طریق pool: {_ms(avg)}")
    print(f"  • اتصال‌های بک‌اند Postgres: قبل={baseline_conns}  بعد={after_conns}  (سقف {MAX_DB_CONNECTIONS})")
    print(f"  • نتیجه پایداری: {'PASS' if stable else 'FAIL'}")

    return {
        "available": True,
        "skipped": False,
        "stable": stable,
        "dsn_target": safe_dsn,
        "probes": probes,
        "probes_ok": ok,
        "probes_failed": failed,
        "avg_latency_ms": avg * 1000,
        "backend_connections_before": baseline_conns,
        "backend_connections_after": after_conns,
        "max_db_connections": MAX_DB_CONNECTIONS,
    }


# ─────────────────────────────────────────────────────────────────────────────
# گزارش
# ─────────────────────────────────────────────────────────────────────────────
def print_reports(reports: list[EndpointReport], wall_note: str) -> None:
    print("\n" + "═" * 78)
    print("گزارش بنچمارک تاب‌آوری — Stress Benchmark Report")
    print("═" * 78)
    header = f"{'مسیر':<44}{'موفق':>7}{'ناموفق':>8}{'میانگین':>11}{'p95':>10}{'RPS':>8}"
    print(header)
    print("-" * 78)
    for r in reports:
        print(
            f"{r.label:<44}{r.success:>7}{r.failure:>8}"
            f"{r.avg_ms:>9.1f}ms{r.p95_ms:>8.1f}ms{r.rps:>8.0f}"
        )
    print("-" * 78)
    print(wall_note)
    for r in reports:
        if r.errors:
            print(f"  ⚠ نمونه خطاهای «{r.label}»: {r.errors[0]}")


def main() -> int:
    parser = argparse.ArgumentParser(description="بنچمارک همزمانی غیرهمگام سرور")
    parser.add_argument("--requests", type=int, default=1000, help="کل درخواست‌ها (پیش‌فرض 1000)")
    parser.add_argument("--concurrency", type=int, default=100, help="حداکثر همزمانی (پیش‌فرض 100)")
    parser.add_argument("--timeout", type=float, default=30.0, help="مهلت هر درخواست (ثانیه)")
    parser.add_argument("--health-url", default=DEFAULT_HEALTH_URL, help="آدرس کامل /health/system")
    parser.add_argument("--accounts-url", default=DEFAULT_ACCOUNTS_URL, help="آدرس کامل accounting/accounts")
    parser.add_argument("--pg-probes", type=int, default=50, help="تعداد اتصال‌های آزمایشی PgBouncer")
    parser.add_argument("--skip-db", action="store_true", help="رد کردن بررسی PgBouncer")
    parser.add_argument("--max-error-rate", type=float, default=0.01, help="آستانه مجاز نرخ خطا")
    parser.add_argument("--output", default="", help="مسیر ذخیره گزارش JSON")
    args = parser.parse_args()

    endpoints = [
        Endpoint("health/system", args.health_url),
        Endpoint("api/backend/enterprise-hub/accounting/accounts", args.accounts_url),
    ]

    print("─" * 78)
    print("بنچمارک تاب‌آوری سرور — AsyncIO + HTTPX")
    print(f"زمان اجرا: {datetime.now(timezone.utc).isoformat()}")
    for endpoint in endpoints:
        print(f"  • {endpoint.label} → {endpoint.url}")
    print("─" * 78)

    reports, samples = asyncio.run(
        run_http_benchmark(endpoints, args.requests, args.concurrency, args.timeout)
    )

    total = sum(r.total for r in reports)
    failed = sum(r.failure for r in reports)
    error_rate = (failed / total) if total else 1.0
    avg_overall = statistics.fmean([s.elapsed for s in samples]) if samples else 0.0
    wall = sum(s.elapsed for s in samples) / max(args.concurrency, 1)
    print_reports(
        reports,
        f"میانگین کلی پاسخ: {_ms(avg_overall)} | نرخ خطا: {error_rate * 100:.2f}% | "
        f"گذردهی تقریبی: {total / wall:.0f} req/s",
    )

    db_result: dict = {"available": False, "stable": False, "skipped": True}
    db_ok = True
    if not args.skip_db:
        db_result = asyncio.run(verify_pgbouncer(args.pg_probes, args.concurrency, args.timeout))
        if not db_result.get("skipped"):
            db_ok = bool(db_result.get("stable"))

    http_ok = error_rate <= args.max_error_rate
    print("\n" + "═" * 78)
    print(f"HTTP endpoints: {'PASS' if http_ok else 'FAIL'}  (نرخ خطا {error_rate * 100:.2f}%)")
    if db_result.get("skipped"):
        print("PgBouncer: SKIPPED")
    else:
        print(f"PgBouncer: {'PASS' if db_ok else 'FAIL'}")
    print("═" * 78)

    if args.output:
        payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "requests": args.requests,
            "concurrency": args.concurrency,
            "error_rate": error_rate,
            "avg_overall_ms": avg_overall * 1000,
            "endpoints": [r.__dict__ for r in reports],
            "pgbouncer": db_result,
            "passed": bool(http_ok and db_ok),
        }
        with open(args.output, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
        print(f"گزارش JSON ذخیره شد: {args.output}")

    return 0 if (http_ok and db_ok) else 1


if __name__ == "__main__":
    sys.exit(main())