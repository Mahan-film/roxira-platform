

from .agent_policy import AgentPolicy



class EngineeringSupervisor:


    def __init__(self):

        self.policy=AgentPolicy()



    def approve(self,agent,task_type):


        info=self.policy.get(agent)


        if not info:

            return {

            "approved":False,

            "reason":"UNKNOWN_AGENT"

            }



        if info["approval"]:

            return {

            "approved":False,

            "reason":"HUMAN_APPROVAL_REQUIRED",

            "agent":agent,

            "task":task_type

            }



        return {

        "approved":True,

        "agent":agent,

        "task":task_type

        }

