

class WorkspaceRegistry:


    def __init__(self):

        self.workspaces={

            "smartjudge":
            {
                "scope":
                "output_apps/smart_judge",
                "agent":
                "opencode"
            },


            "runtime":
            {
                "scope":
                "src/roxira_manager/autonomous_runtime",
                "agent":
                "openhands"
            },


            "knowledge":
            {
                "scope":
                "memory,qdrant,graphrag",
                "agent":
                "opencode"
            },


            "safety":
            {
                "scope":
                "git,sandbox,rollback",
                "agent":
                "aider"
            },


            "control":
            {
                "scope":
                "mission,orchestration",
                "agent":
                "openhands"
            }

        }



    def list(self):

        return self.workspaces

