from .registry import ModelRegistry


class ModelRouter:

    def __init__(self):
        self.registry = ModelRegistry()


    def select_model(self, task):

        task_map = {

            "reasoning": "reasoning",
            "architecture": "reasoning",
            "planning": "reasoning",

            "coding": "coding",
            "debugging": "coding",
            "repository_analysis": "coding",

            "summarization": "fast",
            "classification": "fast",
            "indexing": "fast"
        }


        capability = task_map.get(
            task,
            "reasoning"
        )


        models = self.registry.get_by_capability(
            capability
        )


        # اگر مدل پیدا شد
        if models:
            return models[0]


        # fallback امن
        fallback = self.registry.get_by_capability(
            "premium"
        )


        if fallback:
            return fallback[0]


        return {
            "name": "no_model_available",
            "capability": "none"
        }



if __name__ == "__main__":

    router = ModelRouter()

    tests = [
        "coding",
        "reasoning",
        "summarization",
        "unknown_task"
    ]


    print("ROXIRA MODEL ROUTER")


    for test in tests:

        model = router.select_model(test)

        print(
            test,
            "=>",
            model["name"]
        )