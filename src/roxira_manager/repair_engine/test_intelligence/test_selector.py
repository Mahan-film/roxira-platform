

from pathlib import Path


class TestSelector:


    RULES = {

        "SmartJudgeEngine": [
            "output_apps/smart_judge"
        ],

        "GraphRAG": [
            "output_apps/smart_judge/src/graphrag"
        ],

        "Gateway": [
            "output_apps/smart_judge/src/ai_core"
        ],

        "default": [
            "src/roxira_manager"
        ]

    }



    def detect_scope(self, task):

        for key, paths in self.RULES.items():

            if key.lower() in task.lower():

                return {

                    "target": paths,

                    "reason": key

                }


        return {

            "target": self.RULES["default"],

            "reason":"default"

        }



    def select_test(self, task):


        scope=self.detect_scope(task)


        return {

            "task":task,

            "scope":scope,

            "test_mode":"TARGETED",

            "status":"TEST_SELECTED"

        }

