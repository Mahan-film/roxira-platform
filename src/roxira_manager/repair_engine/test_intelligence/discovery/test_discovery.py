

from pathlib import Path


class TestDiscovery:


    def discover(self, task):


        mapping = {


            "SmartJudgeEngine": {

                "files":[

                    "output_apps/smart_judge/src/engines/legal_drafter.py"

                ],

                "test":

                "smartjudge_contract"

            },


            "GraphRAG": {

                "files":[

                    "output_apps/smart_judge/src/graphrag"

                ],

                "test":

                "graphrag_contract"

            },


            "Gateway": {

                "files":[

                    "output_apps/smart_judge/src/ai_core"

                ],

                "test":

                "gateway_contract"

            }

        }



        for key,value in mapping.items():

            if key.lower() in task.lower():

                return {

                    "target":value["files"],

                    "test":value["test"],

                    "status":"TEST_DISCOVERED"

                }



        return {

            "target":[],

            "test":"generic",

            "status":"GENERIC_TEST"

        }

