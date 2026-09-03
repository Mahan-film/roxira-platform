

from src.roxira_os.core.state import ROXIRAState



class ROXIRARuntime:


    def create_state(self,task):

        return ROXIRAState(task)



    def execute(self,state,agents):


        state.status="RUNNING"


        for agent in agents:

            result=agent.execute(

                state.task,

                state.context

            )

            state.record(result)



        state.status="COMPLETED"


        return state

