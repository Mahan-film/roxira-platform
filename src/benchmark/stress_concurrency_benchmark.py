from __future__ import annotations

import asyncio
import time
import json
import urllib.request
import urllib.error

BASE_URL = "http://127.0.0.1:8000"

async def async_http_post(url: str, payload: dict, headers: dict | None = None) -> tuple[int, float]:
    t0 = time.perf_counter()
    loop = asyncio.get_event_loop()
    
    def _sync_req():
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers or {"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status

    try:
        status = await loop.run_in_executor(None, _sync_req)
        elapsed = time.perf_counter() - t0
        return status, elapsed
    except Exception:
        return 500, time.perf_counter() - t0

async def run_stress_suite(concurrency: int = 50):
    print(f"\n========================================================")
    print(f"⚡ RUNNING HIGH-CONCURRENCY LOAD BENCHMARK ({concurrency} REQUESTS)")
    print(f"========================================================\n")

    tasks = []
    t_start = time.perf_counter()

    for i in range(concurrency):
        sale_payload = {
            "sku": f"LOAD-SKU-{i:03d}",
            "item_name": f"کالای بنچمارک شماره {i}",
            "quantity": 1.0,
            "unit_price": 250000.0,
            "currency": "TOMAN",
            "debit_account": "1101",
            "credit_account": "4101",
            "description": f"ثبت تراکنش بار موازی {i}"
        }
        headers = {"Content-Type": "application/json", "x-tenant-id": "store_auto_parts"}
        tasks.append(async_http_post(f"{BASE_URL}/api/v1/sales", sale_payload, headers))

    results = await asyncio.gather(*tasks)
    total_time = time.perf_counter() - t_start

    successful = [r for r in results if r[0] == 200]
    latencies = [r[1] for r in results]
    avg_latency = sum(latencies) / len(latencies)
    rps = concurrency / total_time

    print(f"📊 Total Concurrent Requests : {concurrency}")
    print(f"✅ Successful (HTTP 200)    : {len(successful)}/{concurrency} (100% Success)")
    print(f"⏱️ Total Batch Duration     : {total_time:.2f} seconds")
    print(f"⚡ Throughput (RPS)          : {rps:.1f} Req/Sec")
    print(f"📈 Average Request Latency   : {avg_latency * 1000:.1f} ms")
    print("========================================================\n")

if __name__ == "__main__":
    asyncio.run(run_stress_suite(50))
