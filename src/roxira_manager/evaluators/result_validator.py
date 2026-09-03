from __future__ import annotations


class ResultValidator:

    def validate(self, result: dict):

        if not result:
            return False

        if result.get("status") == "COMPLETED":
            return True

        return False