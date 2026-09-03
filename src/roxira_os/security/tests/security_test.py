

from src.roxira_os.security.identity_manager import IdentityManager
from src.roxira_os.security.permission_engine import PermissionEngine
from src.roxira_os.security.audit_logger import AuditLogger



identity=IdentityManager()


print(
identity.create_user(
"admin",
"owner"
)
)



permission=PermissionEngine()


permission.grant(
"owner",
"finance.write"
)


print(
permission.check(
"owner",
"finance.write"
)
)


print(
permission.check(
"owner",
"finance.delete"
)
)



audit=AuditLogger()


audit.record(
"admin",
"CREATE_MODULE",
"finance"
)


print(
audit.history()
)

