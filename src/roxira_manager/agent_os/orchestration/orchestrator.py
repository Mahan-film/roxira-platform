

from src.roxira_manager.agent_os.supervisor.supervisor import AgentSupervisor
from src.roxira_manager.agent_os.orchestration.context import ExecutionContext



class AgentOrchestrator:


    def __init__(self):

        self.supervisor=AgentSupervisor()



    def run(self,task):


        context=ExecutionContext(task)


        agents=self.supervisor.select_agents(task)



        for agent in agents:


            result=agent.execute(

                task,

                context.results

            )


            context.add_result(

                agent.name,

                result

            )


        return {

            "task":task,

            "execution_history":

            context.history,

            "final_status":

            "ORCHESTRATION_COMPLETED"

        }

