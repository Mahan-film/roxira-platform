class FallbackManager:


    def choose_backup(self,failed_agent):


        mapping={

            "opencode":"aider",

            "openhands":"opencode",

            "aider":"opencode"

        }


        return mapping.get(
            failed_agent
        )
