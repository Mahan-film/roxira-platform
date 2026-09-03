class AdapterRegistry:


    def __init__(self):

        self.adapters={

            "opencode":
            "OpenCodeAdapter",

            "openhands":
            "OpenHandsAdapter",

            "aider":
            "AiderAdapter"

        }


    def get(self,name):

        return self.adapters.get(name)
