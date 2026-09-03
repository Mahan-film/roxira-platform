

class AgentRegistry:


    def __init__(self):

        self.agents = {

            "aider":{

                "role":"patch",

                "risk":"low",

                "capabilities":[
                    "bug_fix",
                    "refactor",
                    "git_patch"
                ]

            },


            "openhands":{

                "role":"autonomous_engineering",

                "risk":"high",

                "capabilities":[
                    "architecture",
                    "feature",
                    "multi_file"
                ]

            },


            "opencode":{

                "role":"exploration",

                "risk":"medium",

                "capabilities":[
                    "analysis",
                    "coding",
                    "search"
                ]

            },


            "swe_agent":{

                "role":"debugging",

                "risk":"medium",

                "capabilities":[
                    "bug_analysis",
                    "issue_resolution"
                ]

            },


            "cline":{

                "role":"approval",

                "risk":"high",

                "capabilities":[
                    "human_review"
                ]

            },


            "goose":{

                "role":"tool_agent",

                "risk":"medium",

                "capabilities":[
                    "mcp",
                    "tools"
                ]

            }

        }



    def list(self):

        return self.agents



