

from .file_editor import FileEditor

from .learning_store import LearningStore


class PatchExecutor:


    def __init__(self):

        self.editor=FileEditor()

        self.memory=LearningStore()



    def execute(

        self,

        file,

        old,

        new

    ):


        result=self.editor.replace(

            file,

            old,

            new

        )


        self.memory.remember(

            result

        )


        return {


            "patch":

            result,


            "memory":

            "UPDATED"

        }

