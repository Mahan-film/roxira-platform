from pathlib import Path
from datetime import datetime


class WorkspaceManager:


    def __init__(self,root="workspace"):

        self.root=Path(root)



    def create_workspace(self,agent):

        path=self.root / agent

        path.mkdir(
            parents=True,
            exist_ok=True
        )

        return str(path)



    def snapshot(self,agent):

        return {

            "agent":agent,

            "time":
            datetime.utcnow().isoformat(),

            "status":
            "SNAPSHOT_CREATED"

        }
