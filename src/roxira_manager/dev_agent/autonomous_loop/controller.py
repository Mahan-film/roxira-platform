

from src.roxira_manager.dev_agent.capability_router.router import CapabilityRouter



class AutonomousDevelopmentController:


    def __init__(
        self,
        router,
        agents
    ):

        self.router=router

        self.agents=agents



    def execute(self,task):


        route=self.router.select_agent(task)


        selected=route["selected_agents"][0]


        agent=self.agents[selected]


        execution=agent.execute(task)


        return {


            "task":task,


            "agent":selected,


            "routing":route,


            "execution":execution,


            "status":
            "AUTONOMOUS_EXECUTION_READY"

        }

