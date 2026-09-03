

class TaskDecomposer:


    def decompose(self,task,domain):

        if domain=="legal":

            steps=[
                "analyze_case",
                "retrieve_knowledge",
                "check_precedents",
                "generate_reasoning",
                "validate_output"
            ]

        else:

            steps=[
                "scan_repository",
                "analyze_problem",
                "create_solution",
                "run_tests",
                "validate_change"
            ]


        return {
            "task":task,
            "domain":domain,
            "steps":steps,
            "status":"TASK_DECOMPOSED"
        }

