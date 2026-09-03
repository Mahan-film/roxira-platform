

import os


class AIProvider:


    def __init__(self):

        self.providers={

            "openrouter":
            {
                "endpoint":
                "https://openrouter.ai/api/v1"
            },

            "deepseek":
            {
                "endpoint":
                "https://api.deepseek.com"
            }

        }



    def get_endpoint(self,name):

        return self.providers.get(name)



