from pathlib import Path


class WorkspaceManager:


    def create_scope(self, name):

        path = Path("workspaces") / name

        path.mkdir(
            parents=True,
            exist_ok=True
        )

        return str(path)
