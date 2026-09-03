from __future__ import annotations


class ModelRouter:


    MODELS = {

        "free": {
            "model": "openrouter/free"
        },

        "pro": {
            "model": "deepseek/deepseek-chat"
        },

        "max": {
            "model": "deepseek/deepseek-reasoner"
        }

    }


    def select_model(
        self,
        tier: str = "free"
    ):

        if tier not in self.MODELS:
            tier = "free"

        return self.MODELS[tier]["model"]