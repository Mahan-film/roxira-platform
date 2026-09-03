

from datetime import datetime


class LegalVersionTracker:


    def __init__(self):

        self.rules={}



    def register_rule(
        self,
        name,
        version,
        source
    ):

        self.rules[name]={

            "version":version,

            "source":source,

            "updated":
            datetime.utcnow().isoformat()

        }


        return self.rules[name]



    def check_update(self,name,new_version):


        old=self.rules.get(name)


        if not old:

            return "NEW_RULE"



        if old["version"] != new_version:

            return "UPDATED"


        return "NO_CHANGE"



