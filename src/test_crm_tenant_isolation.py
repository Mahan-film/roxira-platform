"""Tenant isolation and auth guard for the hub CRM module (issue #369).

Structural regression tests over `output_apps/enterprise_hub/modules/crm`:
- both entities carry `tenant_id`,
- every repository method takes `tenantId` first and filters by it,
- the controller is guarded and reads the tenant only from the verified JWT,
- DTOs never accept a tenant field (forbidNonWhitelisted is global),
- the new migration adds/backfills/NOT NULLs `tenant_id` and indexes it.
"""


def _crm_root():
    from pathlib import Path

    return (
        Path(__file__).resolve().parents[1]
        / "output_apps/enterprise_hub/modules/crm"
    )


def test_crm_entities_carry_tenant_id():
    root = _crm_root()
    lead = (root / "entities/crm-lead.entity.ts").read_text()
    contact = (root / "entities/contact-message.entity.ts").read_text()

    for source in (lead, contact):
        assert "tenantId: string" in source
        assert "name: 'tenant_id'" in source
        assert "type: 'uuid'" in source


def _call_args(body, start):
    """Text of the balanced (...) group whose '(' is at ``start``."""
    depth = 0
    for i in range(start, len(body)):
        if body[i] == "(":
            depth += 1
        elif body[i] == ")":
            depth -= 1
            if depth == 0:
                return body[start : i + 1]
    return body[start:]


def test_crm_repository_scopes_every_method_by_tenant():
    import re

    repo = (_crm_root() / "repositories/crm.repository.ts").read_text()

    methods = {
        "createLead",
        "saveLead",
        "findLeadById",
        "findLeadByEmail",
        "findLeadsAndCount",
        "findAllLeads",
        "countAllLeads",
        "getStageAggregates",
        "createContactMessage",
        "findContactMessagesAndCount",
        "countContactsByLeadId",
        "getContactCountsByLeadIds",
    }
    heads = list(re.finditer(r"\n  async (\w+)\(\s*([^)]*?)\)\s*:", repo))
    assert {m.group(1) for m in heads} == methods, (
        "new repository methods must be added to this test"
    )

    for index, head in enumerate(heads):
        name = head.group(1)
        assert head.group(2).lstrip().startswith(
            "tenantId: string"
        ), f"{name} must take tenantId as its first parameter"

        end = heads[index + 1].start() if index + 1 < len(heads) else len(repo)
        body = repo[head.end() : end]

        # Direct repository calls: tenantId must be inside the call arguments.
        calls = list(
            re.finditer(
                r"\.(find|findOne|findAndCount|update|delete|softDelete|remove"
                r"|count|query|create)\(",
                body,
            )
        )
        # Query builders: tenantId must appear in a where/andWhere argument.
        builders = list(re.finditer(r"\.(where|andWhere)\(", body))
        assert calls or builders, f"{name} has no data access"
        if ".save(" in body:
            # save(entity) is only safe when the entity was built with the tenant.
            assert any(".create(" == c.group(0) for c in calls), name
        for call in calls:
            args = _call_args(body, call.end() - 1)
            assert "tenantId" in args, f"{name}: .{call.group(1)}() lacks tenantId"
        if "createQueryBuilder" in body:
            assert any(
                "tenantId" in _call_args(body, b.end() - 1) for b in builders
            ), f"{name}: query builder is not filtered by tenantId"


def test_crm_service_threads_tenant_to_repository():
    service = (_crm_root() / "services/crm.service.ts").read_text()

    assert "this.crmRepository.findLeadById(tenantId" in service
    assert "this.crmRepository.findLeadByEmail(tenantId" in service
    assert "this.crmRepository.createLead(tenantId" in service
    assert "this.crmRepository.saveLead(tenantId" in service
    assert "this.crmRepository.getStageAggregates(tenantId)" in service
    assert "this.crmRepository.findAllLeads(tenantId)" in service
    assert "countContactsByLeadId(\n      tenantId," in service
    for method in (
        "createLead",
        "listLeads",
        "getLead",
        "updateLead",
        "updateLeadStage",
        "addLeadNote",
        "listContactRecords",
        "addContactRecord",
        "getStats",
        "getPipeline",
    ):
        assert f"async {method}(" in service


def test_crm_controller_is_guarded_and_reads_tenant_from_jwt():
    controller = (_crm_root() / "controllers/crm.controller.ts").read_text()

    assert "UseGuards(JwtAuthGuard)" in controller
    assert "AuthenticatedRequest" in controller
    assert "JwtAuthGuard," in controller
    assert "from '../../auth/guards/jwt-auth.guard'" in controller
    assert "request.user?.sub" in controller
    assert controller.count("@Req() request: AuthenticatedRequest") >= 10
    assert (
        controller.count("this.tenantIdOf(request)") >= 10
    ), "every route must pass the JWT tenant to the service"

    lowered = controller.lower()
    assert "dto.tenant" not in lowered
    assert "query.tenant" not in lowered
    assert "body.tenant" not in lowered


def test_crm_dtos_reject_a_tenant_field():
    from pathlib import Path

    dto_dir = _crm_root() / "dto"
    sources = "\n".join(
        p.read_text() for p in sorted(Path(dto_dir).glob("*.ts"))
    )
    assert "tenantId" not in sources
    assert "tenant_id" not in sources

    main = (
        Path(__file__).resolve().parents[1]
        / "output_apps/enterprise_hub/main.ts"
    ).read_text()
    assert "forbidNonWhitelisted: true" in main


def test_crm_tenant_migration_adds_backfills_and_indexes():
    from pathlib import Path

    migrations = (
        Path(__file__).resolve().parents[1]
        / "output_apps/enterprise_hub/migrations"
    )
    matches = sorted(migrations.glob("*CrmTenantIsolation*.ts"))
    assert len(matches) == 1, "exactly one CRM tenant-isolation migration"
    source = matches[0].read_text()

    assert 'ADD COLUMN IF NOT EXISTS "tenant_id" uuid' in source
    assert 'ALTER COLUMN "tenant_id" SET NOT NULL' in source
    assert "00000000-0000-0000-0000-000000000001" in source
    assert "IDX_crm_leads_tenant_stage" in source
    assert '("tenant_id", "pipeline_stage")' in source
    assert "IDX_contact_messages_tenant_lead" in source
    assert '("tenant_id", "lead_id")' in source

    assert source.count('ADD COLUMN IF NOT EXISTS "tenant_id" uuid') == 2
    assert source.count('DROP COLUMN IF EXISTS "tenant_id"') == 2
    assert source.count("SET NOT NULL") == 2
