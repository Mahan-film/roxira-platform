

import os



class Environment:


    @staticmethod
    def current():


        return os.getenv(
            "ROXIRA_ENV",
            "development"
        )


