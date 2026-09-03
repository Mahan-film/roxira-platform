from __future__ import annotations


class LegalStrategyEngine:


    def build(self, understanding):


        strategy = {

            "main_action": None,

            "secondary_actions": [],

            "strategy_notes": []

        }


        claims = understanding.get(
            "possible_claims",
            []
        )


        if "obligation_to_transfer_official_deed" in claims:

            strategy["main_action"] = (
                "دادخواست الزام به تنظیم سند رسمی"
            )


            strategy["secondary_actions"].append(
                "مطالبه خسارت قراردادی در صورت وجود شرط"
            )


        strategy["strategy_notes"].append(
            "بررسی قرارداد، ادله پرداخت و وضعیت ثبتی ملک"
        )


        return strategy
