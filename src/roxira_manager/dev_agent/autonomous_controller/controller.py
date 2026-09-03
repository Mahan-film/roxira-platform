
from src.roxira_manager.dev_agent.agent_router.router import AgentRouter
from src.roxira_manager.dev_agent.engineering_supervisor.supervisor import EngineeringSupervisor
from src.roxira_manager.dev_agent.engineering_intelligence.v2.patch_planner import PatchPlanner
from src.roxira_manager.dev_agent.engineering_intelligence.v2.regression_guard import RegressionGuard


class AutonomousEngineeringController:

    def __init__(self):
        self.router = AgentRouter()
        self.supervisor = EngineeringSupervisor()
        self.patch = PatchPlanner()
        self.guard = RegressionGuard()


    def process(self, task, task_type):

        route = self.router.select(task)

        agent = (
            route.get("agent")
            if isinstance(route, dict)
            else route
        )

        approval = self.supervisor.approve(
            agent,
            task_type
        )


        if not approval["approved"]:
            return {
                "status":"WAITING_APPROVAL",
                "approval":approval
            }


        contract = {
            "valid":False,
            "missing":[task]
        }


        patch = self.patch.create_patch(contract)

        validation = self.guard.validate(patch)


        return {
            "agent":agent,
            "patch":patch,
            "validation":validation,
            "status":"ENGINEERING_READY"
        }

