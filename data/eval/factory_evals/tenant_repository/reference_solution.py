def get_case(store, tenant_id, case_id):
    record = store[case_id]
    if record["tenant_id"] != tenant_id:
        raise PermissionError("cross-tenant read")
    return dict(record)
