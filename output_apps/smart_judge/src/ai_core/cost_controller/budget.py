from __future__ import annotations


class CostController:

    LIMITS = {
        "free": {
            "max_tokens": 1000
        },

        "pro": {
            "max_tokens": 4000
        },

        "max": {
            "max_tokens": 12000
        }
    }


    def get_limit(self, tier: str):

        return self.LIMITS.get(
            tier,
            self.LIMITS["free"]
        )["max_tokens"]