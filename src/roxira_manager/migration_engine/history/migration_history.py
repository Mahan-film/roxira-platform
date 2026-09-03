from datetime import datetime, timezone


class MigrationHistory:


    def __init__(self):

        self.history=[]


    def add(self,name):

        self.history.append({

            "migration":name,

            "time":datetime.now(
                timezone.utc
            ).isoformat()

        })


        return True
