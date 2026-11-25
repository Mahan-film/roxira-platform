import pathlib
import unittest
import yaml


CI_YML = pathlib.Path(__file__).resolve().parents[1] / ".github" / "workflows" / "ci.yml"


class CiWorkflowPortsTest(unittest.TestCase):
    def test_ci_yaml_valid_and_dynamic_ports_in_steps(self):
        data = yaml.safe_load(CI_YML.read_text(encoding="utf-8"))
        jobs = data["jobs"]
        for job_name in ("backend", "m1-gate"):
            job = jobs[job_name]
            job_env = job.get("env", {})
            for k, v in job_env.items():
                self.assertNotIn(
                    "job.services.",
                    str(v),
                    f"{job_name}.env.{k} must not reference job.services (invalid in job-level env)",
                )
            step_runs = "\n".join(str(s.get("run", "")) for s in job.get("steps", []))
            self.assertIn("GITHUB_ENV", step_runs, f"{job_name} must export dynamic ports via GITHUB_ENV")
            self.assertIn("DATABASE_PORT=", step_runs)

        backend_steps = jobs["backend"]["steps"]
        for step in backend_steps:
            env = step.get("env", {})
            self.assertNotEqual(env.get("PGPORT"), "5432")
            self.assertNotEqual(env.get("ROXIRA_TEST_PG_PORT"), "5432")


if __name__ == "__main__":
    unittest.main()
