class AgentEvaluator:


    def score(self, agent):

        scores={

            "opencode":90,

            "openhands":85,

            "aider":75

        }


        return scores.get(
            agent,
            50
        )
