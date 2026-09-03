

import json
from pathlib import Path


class LongTermMemory:


    def __init__(self):

        self.path=Path(
            "project_memory/roxira_master_memory.json"
        )

        self.path.parent.mkdir(
            exist_ok=True
        )


    def save(self,data):

        memory=[]


        if self.path.exists():

            memory=json.loads(
                self.path.read_text()
            )


        memory.append(data)


        self.path.write_text(
            json.dumps(
                memory,
                indent=2,
                ensure_ascii=False
            )
        )


        return {

            "stored":True,

            "items":len(memory),

            "status":"MEMORY_UPDATED"

        }



    def load(self):

        if not self.path.exists():

            return []


        return json.loads(
            self.path.read_text()
        )

