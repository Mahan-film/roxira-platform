
from src.roxira_manager.dev_agent.git_safety.git_guard import GitGuard


g = GitGuard()


print(
g.status()
)


print(
g.checkpoint(
"ROXIRA engineering checkpoint"
)
)

