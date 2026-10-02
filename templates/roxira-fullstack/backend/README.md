# Roxira Fullstack - backend slice

A tenant-safe NestJS slice for the `roxira-fullstack` golden template. It ships
one resource, `items`, wired Controller -> Service -> DTO -> Repository, plus a
SQL migration. Checks pass offline via `src/factory_pipeline/template_check.py`.

## Layout

```
src/items/items.controller.ts   HTTP routing only; delegates to the service
src/items/items.service.ts      business logic
src/items/items.repository.ts   persistence; every method takes tenantId first
src/items/create-item.dto.ts    class-validator / class-transformer DTO
migrations/0001_items.sql       items table with tenant_id and an index
```

## Tenancy

Every `ItemsRepository` method takes `tenantId` as its required first argument
and filters on `tenant_id`, so a caller cannot read or mutate another tenant's
rows. The controller reads the tenant from `:tenantId` and passes it down; no
method trusts a body-supplied tenant id. The `items` table carries a
`tenant_id` column and an index on it.

## Validation

`CreateItemDto` uses `class-validator` decorators (`IsString`, `Length`,
`IsOptional`) and a `class-transformer` `@Transform`. Install matching versions
from your approved registry; no version is pinned here because none was
verified against a live registry for this offline template.

## Migrations

Apply `migrations/0001_items.sql` through your reviewed migration process
(`psql -f migrations/0001_items.sql`, or your migration tool). Never run it
directly against production outside a reviewed change.

## Tests

`src/factory_pipeline/test_fullstack_backend_template.py` checks the template
with `template_check.check_project` and asserts every repository method is
tenant-scoped.
