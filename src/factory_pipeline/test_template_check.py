from src.factory_pipeline.template_check import check_project


def test_check_project(tmp_path):
    good = tmp_path / "good"
    (good / "frontend" / "src" / "app").mkdir(parents=True)
    (good / "frontend" / "src" / "app" / "layout.tsx").write_text('<html dir="rtl" lang="fa" />')
    (good / "api").mkdir()
    (good / "api" / "users.dto.ts").write_text("export class UsersDto {}")
    (good / "api" / "users.controller.ts").write_text("@Body() body: UsersDto")
    (good / "schema.sql").write_text("CREATE TABLE users (id integer, tenant_id text);")
    assert check_project(good) == []

    bad_layout = tmp_path / "bad_layout"
    (bad_layout / "app").mkdir(parents=True)
    (bad_layout / "app" / "layout.tsx").write_text('<html lang="fa" />')
    assert check_project(bad_layout) == [
        'app/layout.tsx: root layout must set dir="rtl" and lang="fa"'
    ]

    bad_secret = tmp_path / "bad_secret"
    (bad_secret / "frontend").mkdir(parents=True)
    (bad_secret / "frontend" / "app.ts").write_text("sk-" + "a" * 24)
    assert check_project(bad_secret) == [
        "frontend/app.ts: possible secret in frontend code"
    ]

    bad_controller = tmp_path / "bad_controller"
    bad_controller.mkdir()
    (bad_controller / "users.controller.ts").write_text("@Body() body: unknown")
    assert check_project(bad_controller) == ["users.controller.ts: controller takes @Body without a DTO file in the same folder"]

    bad_sql = tmp_path / "bad_sql"
    bad_sql.mkdir()
    (bad_sql / "schema.sql").write_text("CREATE TABLE users (id integer);")
    assert check_project(bad_sql) == [
        "schema.sql: table users has no tenant_id/owner_id"
    ]
