# Tenant-scoped repository read

Implement `get_case(store, tenant_id, case_id)` in `starter.py`. `store` is a mapping from case IDs to record dictionaries containing `tenant_id`. Return a copy of the matching record only if it belongs to `tenant_id`. Raise `KeyError(case_id)` for a missing record and `PermissionError("cross-tenant read")` if the case exists for another tenant.
