class SkillGraph:


    def register(
        self,
        agent,
        skills
    ):

        return {

            "agent":agent,

            "skills":skills,

            "status":"SKILL_REGISTERED"

        }
