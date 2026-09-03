import yaml
from pathlib import Path


class ModelRegistry:

    def __init__(self, config_path="config/models.yaml"):
        self.config_path = Path(config_path)
        self.models = []
        self.load()


    def load(self):
        with open(self.config_path, "r") as f:
            data = yaml.safe_load(f)

        self.models = data.get("models", [])


    def list_models(self):
        return self.models


    def get_by_capability(self, capability):

        result = []

        for model in self.models:
            if capability in model.get("capabilities", []):
                result.append(model)

        return sorted(
            result,
            key=lambda x: x.get("priority", 999)
        )


if __name__ == "__main__":

    registry = ModelRegistry()

    print("ROXIRA MODEL REGISTRY")

    for model in registry.list_models():
        print(
            model["name"],
            "=>",
            model["type"]
        )