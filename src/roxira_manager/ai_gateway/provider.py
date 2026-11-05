import pathlib
import sys


def _llm_route():
    root = pathlib.Path(__file__).resolve().parents[3]
    dev = str(root / "scripts" / "dev")
    if dev not in sys.path:
        sys.path.insert(0, dev)
    import llm_route

    return llm_route


class AIProvider:


    def __init__(self):

        self.providers={

            "openrouter":
            {
                "endpoint":
                _llm_route().OPENROUTER_BASE_URL
            },

            "deepseek":
            {
                "endpoint":
                "https://api.deepseek.com"
            }

        }



    def get_endpoint(self,name):

        return self.providers.get(name)
