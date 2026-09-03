from __future__ import annotations


class LegalVersionTracker:


    def check_update(self, rule):

        return {
            "rule": rule,
            "status": "MONITORING",
            "source_check": True
        }
