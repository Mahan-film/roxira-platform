def test_normalize_alternatives_handles_llm_key_variants():
    from src.automation.project_brief import normalize_alternatives

    normal = {"name": "Next.js", "maturity": "high", "why": "Proven"}
    result = normalize_alternatives(
        [
            {
                "name_en": "Astro",
                "product_type_en": "framework",
                "license_or_pricing_note_fa": "MIT",
                "why_it_matters_for_this_project_fa": "سریع است",
            },
            {"title": ""},
            "not an alternative",
            normal,
        ]
    )

    assert result == [
        {
            "name_en": "Astro",
            "product_type_en": "framework",
            "license_or_pricing_note_fa": "MIT",
            "why_it_matters_for_this_project_fa": "سریع است",
            "name": "Astro",
            "why": "سریع است",
            "license": "MIT",
        },
        normal,
    ]
