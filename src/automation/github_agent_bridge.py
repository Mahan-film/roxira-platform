import os, subprocess, pathlib, json

BASE_DIR = pathlib.Path("/opt/roxira_platform")

class GitHubAgentBridge:
    @staticmethod
    def get_git_status() -> dict:
        try:
            status = subprocess.check_output("git status --short", shell=True, cwd=BASE_DIR).decode()
            branch = subprocess.check_output("git rev-parse --abbrev-ref HEAD", shell=True, cwd=BASE_DIR).decode().strip()
            latest_commit = subprocess.check_output("git log -1 --oneline", shell=True, cwd=BASE_DIR).decode().strip()
            return {
                "status": "INITIALIZED",
                "branch": branch,
                "latest_commit": latest_commit,
                "uncommitted_changes": len([l for l in status.splitlines() if l.strip()])
            }
        except Exception as e:
            return {"status": "ERROR", "error": str(e)}

    @staticmethod
    def create_agent_checkpoint(task_name: str) -> bool:
        try:
            subprocess.run("git add .", shell=True, cwd=BASE_DIR, check=True)
            msg = f"feat(agent): automated checkpoint for task [{task_name}]"
            subprocess.run(f'git commit -m "{msg}"', shell=True, cwd=BASE_DIR, check=True)
            return True
        except Exception:
            return False

if __name__ == "__main__":
    st = GitHubAgentBridge.get_git_status()
    print("📌 وضعیت نهایی و اعتبارسنجی مخزن گیت:")
    print(json.dumps(st, ensure_ascii=False, indent=2))
