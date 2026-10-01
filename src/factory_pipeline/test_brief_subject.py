def test_build_subject_uses_goal_not_other_sections():
    from src.factory_pipeline.brief_subject import build_subject

    subject = build_subject(
        "T", "### هدف پروژه\n\nیک میکروسایت ایستا\n\n### کاربران هدف\n\nعموم"
    )
    assert subject.startswith("T — ")
    assert "میکروسایت ایستا" in subject
    assert "عموم" not in subject


def test_build_subject_honors_max_chars():
    from src.factory_pipeline.brief_subject import build_subject

    assert len(build_subject("T", "### هدف پروژه\n" + "الف" * 20, 10)) == 10


def test_build_subject_includes_preferred_stack_without_cutting_it():
    from src.factory_pipeline.brief_subject import build_subject

    stack = "Next.js (خروجی ایستا) + Tailwind + shadcn/ui"
    subject = build_subject("T", f"### هدف پروژه\n{'الف' * 1000}\n### استک فناوری ترجیحی (اختیاری)\n{stack}")
    assert subject.endswith(f". استک ترجیحی مالک: {stack}")
    assert len(subject) <= 900


def test_build_subject_ignores_unfilled_preferred_stack():
    from src.factory_pipeline.brief_subject import build_subject

    subject = build_subject("T", "### هدف پروژه\nهدف\n### استک فناوری ترجیحی (اختیاری)\n_No response_")
    assert "استک ترجیحی مالک" not in subject


def test_pick_layers_rules():
    from src.factory_pipeline.brief_subject import pick_layers

    all_layers = [
        "ui_ux", "frontend", "backend", "infra_server", "database_sql",
        "ai_models", "observability", "security", "cost",
    ]
    assert pick_layers("یک سایت ایستا") == ["ui_ux", "frontend", "infra_server", "cost"]
    assert pick_layers("بدون کلیدواژه") == all_layers
    assert pick_layers("بدون ورود") == [x for x in all_layers if x != "security"]
