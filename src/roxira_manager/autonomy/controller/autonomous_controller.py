class AutonomousController:


    def __init__(self,planner,executor,validator):

        self.planner=planner
        self.executor=executor
        self.validator=validator



    def run(self,mission):

        plan=self.planner.create_plan(mission)

        result=self.executor.execute(plan)

        validation=self.validator.check(result)


        return {

            "mission":mission,

            "plan":plan,

            "result":result,

            "validation":validation

        }
