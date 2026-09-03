class ControlLoop:


    def __init__(self,controller):

        self.controller=controller



    def start(self,mission):

        return self.controller.run(
            mission
        )
