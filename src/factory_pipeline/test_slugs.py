from __future__ import annotations

from src.factory_pipeline.slugs import slugify_project, unique_slug


def test_basic_slug():
    assert slugify_project("Persian Legal Voice Assistant") == "persian-legal-voice-assistant"


def test_punctuation_collapses_to_hyphen():
    assert slugify_project("SEO-heavy web app!!") == "seo-heavy-web-app"


def test_non_ascii_falls_back_gracefully():
    # A Farsi-only brief title must not crash the planner.
    assert slugify_project("دستیار صوتی حقوقی فارسی") == "project"


def test_empty_string_falls_back():
    assert slugify_project("") == "project"


def test_custom_fallback():
    assert slugify_project("", fallback="brief") == "brief"


def test_truncates_to_max_len():
    long_title = "a" * 100
    slug = slugify_project(long_title, max_len=40)
    assert len(slug) <= 40


def test_unique_slug_no_collision():
    assert unique_slug("voice-app", set()) == "voice-app"
    assert unique_slug("voice-app", {"other-app"}) == "voice-app"


def test_unique_slug_collision_appends_suffix():
    assert unique_slug("voice-app", {"voice-app"}) == "voice-app-2"


def test_unique_slug_multiple_collisions():
    existing = {"voice-app", "voice-app-2", "voice-app-3"}
    assert unique_slug("voice-app", existing) == "voice-app-4"
