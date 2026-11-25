import unittest

from output_apps.generated_modules.smartjudge.legal_phonetics import (
    fuzzy_match_statute,
    normalize_spoken_numbers,
    repair_legal_phonetics,
)


class TestLegalPhoneticsParity(unittest.TestCase):
    def test_normalize_spoken_numbers_compound(self) -> None:
        self.assertEqual(
            normalize_spoken_numbers("ماده پانصد و بیست و دو"),
            "ماده 522",
        )
        self.assertEqual(
            normalize_spoken_numbers("ماده هزار و هشتاد و دو"),
            "ماده 1082",
        )

    def test_normalize_spoken_numbers_persian_digits(self) -> None:
        self.assertEqual(normalize_spoken_numbers("ماده ۴۷۴"), "ماده 474")

    def test_repair_and_fuzzy_match_statute(self) -> None:
        candidates = [
            "قانون آیین دادرسی مدنی",
            "قانون مدنی",
            "قانون مبارزه با پولشویی",
        ]
        repaired = repair_legal_phonetics("قانون موردان برشویش")
        self.assertEqual(
            fuzzy_match_statute(repaired, candidates),
            "قانون مبارزه با پولشویی",
        )
        self.assertIsNone(fuzzy_match_statute("کاملاً نامرتبط", candidates))


if __name__ == "__main__":
    unittest.main()
