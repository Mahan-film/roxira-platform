

from src.roxira_os.monitoring.health_monitor import HealthMonitor
from src.roxira_os.monitoring.metrics import MetricsCollector
from src.roxira_os.monitoring.error_tracker import ErrorTracker
from src.roxira_os.monitoring.recovery_engine import RecoveryEngine



health=HealthMonitor()


health.register(
"finance"
)

health.register(
"legal"
)


print(
health.check()
)



metrics=MetricsCollector()


metrics.record(
"finance",
"CREATE_INVOICE"
)


print(
metrics.get_all()
)



errors=ErrorTracker()


errors.capture(
"legal",
"MODEL_TIMEOUT"
)


print(
errors.report()
)



recovery=RecoveryEngine()


print(
recovery.recover(
"legal"
)
)

