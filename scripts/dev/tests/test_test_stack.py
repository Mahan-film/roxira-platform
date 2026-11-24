"""Tests for scripts/dev/test_stack.sh and docker-compose.test.yml (#1319)."""

import os
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TEST_STACK_SCRIPT = ROOT / "scripts" / "dev" / "test_stack.sh"
COMPOSE_FILE = ROOT / "docker-compose.test.yml"

# Reserved ports from AGENTS.md section 7
RESERVED_PORTS = {
    80, 443, 8000, 3000, 3001, 3002, 5432, 6432, 6379, 6333,
    8888, 8005, 4000, 4001, 2053, 2096, 8443, 11111, 62789
}


class TestTestStack(unittest.TestCase):
    def test_compose_file_exists(self):
        self.assertTrue(COMPOSE_FILE.exists(), f"Missing {COMPOSE_FILE}")

    def test_ports_avoid_agents_md_section_7(self):
        content = COMPOSE_FILE.read_text()
        # Find port mappings like "127.0.0.1:${...:-54380}:5432" or host port mappings
        host_ports = re.findall(r'127\.0\.0\.1:(\d+):', content)
        default_ports = re.findall(r':-(\d+)}:', content)
        all_ports = [int(p) for p in host_ports + default_ports]

        self.assertTrue(len(all_ports) > 0, "No host ports found in compose file")
        for port in all_ports:
            self.assertNotIn(
                port,
                RESERVED_PORTS,
                f"Port {port} in docker-compose.test.yml collides with AGENTS.md section 7 reserved ports!",
            )

    def test_memory_limits_capped(self):
        content = COMPOSE_FILE.read_text()
        mem_limits = re.findall(r'mem_limit:\s*([0-9]+[mgkMGK])', content)
        self.assertTrue(len(mem_limits) >= 3, "All services must declare mem_limit")
        for limit in mem_limits:
            unit = limit[-1].lower()
            val = int(limit[:-1])
            if unit == 'm':
                self.assertLessEqual(val, 256, f"Memory limit {limit} exceeds test cap (256m)")

    def test_env_output(self):
        res = subprocess.run(
            ["bash", str(TEST_STACK_SCRIPT), "env", "l1"],
            capture_output=True,
            text=True,
            cwd=str(ROOT),
        )
        self.assertEqual(res.returncode, 0)
        out = res.stdout
        self.assertIn("ROXIRA_TEST_PG_HOST=127.0.0.1", out)
        self.assertIn("ROXIRA_TEST_PG_APP_USER=roxira_app", out)
        self.assertIn("ROXIRA_TEST_PG_DB=roxira_test_l1", out)
        self.assertIn("ROXIRA_TEST_VALKEY_PORT=", out)
        self.assertIn("ROXIRA_TEST_QDRANT_URL=", out)

    def test_status_output(self):
        res = subprocess.run(
            ["bash", str(TEST_STACK_SCRIPT), "status"],
            capture_output=True,
            text=True,
            cwd=str(ROOT),
        )
        self.assertEqual(res.returncode, 0)
        self.assertIn("Roxira Test Stack Status", res.stdout)
        self.assertIn("Postgres:", res.stdout)
        self.assertIn("Valkey:", res.stdout)
        self.assertIn("Qdrant:", res.stdout)

    def test_create_db_rejects_invalid_lane_name(self):
        for bad in ['l1"; DROP DATABASE postgres; --', 'a b', '../evil', 'a' * 51]:
            res = subprocess.run(
                ["bash", str(TEST_STACK_SCRIPT), "create-db", bad],
                capture_output=True,
                text=True,
                cwd=str(ROOT),
            )
            self.assertEqual(res.returncode, 2, f"Expected exit 2 for {bad!r}, got {res.returncode}")
            self.assertIn("invalid lane_id_or_db_name", res.stderr)


if __name__ == "__main__":
    unittest.main()
