import pytest


@pytest.fixture
def template_check():
    from src.factory_pipeline import template_check as module

    return module


def test_check_project(tmp_path, template_check):
    good = tmp_path / "good"
    (good / "frontend" / "src" / "app").mkdir(parents=True)
    (good / "frontend" / "src" / "app" / "layout.tsx").write_text('<html dir="rtl" lang="fa" />')
    (good / "api").mkdir()
    (good / "api" / "users.dto.ts").write_text("export class UsersDto {}")
    (good / "api" / "users.controller.ts").write_text("@Body() body: UsersDto")
    (good / "schema.sql").write_text("CREATE TABLE users (id integer, tenant_id text);")
    assert template_check.check_project(good) == []

    bad_layout = tmp_path / "bad_layout"
    (bad_layout / "app").mkdir(parents=True)
    (bad_layout / "app" / "layout.tsx").write_text('<html lang="fa" />')
    assert template_check.check_project(bad_layout) == [
        'app/layout.tsx: root layout must set dir="rtl" and lang="fa"'
    ]

    bad_secret = tmp_path / "bad_secret"
    (bad_secret / "frontend").mkdir(parents=True)
    (bad_secret / "frontend" / "app.ts").write_text("sk-" + "a" * 24)
    assert template_check.check_project(bad_secret) == [
        "frontend/app.ts: possible secret in frontend code"
    ]

    bad_controller = tmp_path / "bad_controller"
    bad_controller.mkdir()
    (bad_controller / "users.controller.ts").write_text("@Body() body: unknown")
    assert template_check.check_project(bad_controller) == ["users.controller.ts: controller takes @Body without a DTO file in the same folder"]

    bad_sql = tmp_path / "bad_sql"
    bad_sql.mkdir()
    (bad_sql / "schema.sql").write_text("CREATE TABLE users (id integer);")
    assert template_check.check_project(bad_sql) == [
        "schema.sql: table users has no tenant_id/owner_id"
    ]


def test_main_reports_bad_layout(tmp_path, capsys, template_check):
    project = tmp_path / "bad"
    (project / "app").mkdir(parents=True)
    (project / "app" / "layout.tsx").write_text('<html lang="fa" />')

    assert template_check.main([str(project)]) == 0
    assert capsys.readouterr().out == (
        f'{project}: app/layout.tsx: root layout must set dir="rtl" and lang="fa"\n'
    )


def test_main_strict_exits_one_for_problems(tmp_path, template_check):
    project = tmp_path / "bad"
    (project / "app").mkdir(parents=True)
    (project / "app" / "layout.tsx").write_text('<html lang="fa" />')

    assert template_check.main(["--strict", str(project)]) == 1


def test_main_without_projects_exits_zero(tmp_path, monkeypatch, capsys, template_check):
    monkeypatch.chdir(tmp_path)

    assert template_check.main([]) == 0
    assert capsys.readouterr().out == "no projects\n"
