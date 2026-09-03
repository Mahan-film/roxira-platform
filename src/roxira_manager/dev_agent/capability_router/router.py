

class CapabilityRouter:


    def __init__(self, registry):

        self.registry = registry



    def analyze_task(self, task):


        t = task.lower()


        result = {

            "domain":"general",

            "risk":"medium",

            "capability":[],

            "approval":False

        }


        if any(
            x in t
            for x in [
                "legal",
                "judge",
                "law",
                "court"
            ]
        ):

            result["domain"]="legal"


        if any(
            x in t
            for x in [
                "architecture",
                "system",
                "module",
                "migration"
            ]
        ):

            result["risk"]="high"


        if any(
            x in t
            for x in [
                "bug",
                "fix",
                "patch",
                "error"
            ]
        ):

            result["risk"]="low"



        if result["risk"]=="high":

            result["approval"]=True



        return result



    def select_agent(self, task):


        analysis=self.analyze_task(task)


        candidates=[]


        for name,data in self.registry.list().items():


            if analysis["risk"]=="low":

                if "bug_fix" in data["capabilities"]:

                    candidates.append(name)



            elif analysis["risk"]=="high":

                if (
                    "architecture"
                    in data["capabilities"]
                ):

                    candidates.append(name)



        if not candidates:

            candidates=["opencode"]


        return {

            "analysis":analysis,

            "selected_agents":
            candidates,

            "status":
            "CAPABILITY_ROUTED"

        }

