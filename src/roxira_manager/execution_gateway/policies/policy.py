class ExecutionPolicy:


    ALLOWED = [
        "output_apps",
        "src/roxira_manager"
    ]


    def validate_path(self, path):

        return any(
            path.startswith(x)
            for x in self.ALLOWED
        )
