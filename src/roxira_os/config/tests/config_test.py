

from src.roxira_os.config.environment import Environment
from src.roxira_os.config.settings import Settings
from src.roxira_os.config.feature_flags import FeatureFlags



print(
{
"environment":
Environment.current()
}
)



print(
{
"database":
Settings.DATABASE_URL,
"redis":
Settings.REDIS_URL,
"qdrant":
Settings.QDRANT_URL,
"model":
Settings.MODEL
}
)



print(
FeatureFlags.enabled(
"self_healing"
)
)



print(
FeatureFlags.enabled(
"finance_module"
)
)

