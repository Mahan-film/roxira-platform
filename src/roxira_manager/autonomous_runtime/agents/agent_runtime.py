

class AgentRuntime:


    def execute(self,agent,task):


        registry={

            "aider":"PATCH_ENGINE",

            "opencode":"CODE_ENGINE",

            "openhands":"AUTONOMOUS_ENGINE"

        }


        return {

            "agent":agent,

            "engine":registry.get(agent),

            "task":task,

            "status":"AGENT_EXECUTED"

        }

