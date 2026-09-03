from ..router.agent_router import AgentRouter
from ..planner.task_planner import TaskPlanner


class CommandController:


    def __init__(self):

        self.router=AgentRouter()

        self.planner=TaskPlanner()



    def dispatch(self,mission,task,risk="low"):


        plan=self.planner.create_plan(mission)


        agent=self.router.select(task,risk)


        return {

            "mission":mission,

            "agent":agent,

            "plan":plan,

            "status":"DISPATCHED"

        }
