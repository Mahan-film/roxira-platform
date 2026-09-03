

from src.roxira_manager.control_plane.agents.real_agent_controller import RealAgentController



class MissionOrchestrator:


    def __init__(self):

        self.agent=RealAgentController()



    def select_agent(self,domain,risk):


        if domain=="legal" and risk=="high":

            return "opencode"


        if risk=="low":

            return "aider"


        return "opencode"



    def execute(self,mission,domain,risk):


        agent=self.select_agent(
            domain,
            risk
        )


        result=self.agent.execute(

            agent,

            mission

        )


        return {

            "mission":mission,

            "agent":agent,

            "result":result,

            "status":"MISSION_EXECUTED"

        }

