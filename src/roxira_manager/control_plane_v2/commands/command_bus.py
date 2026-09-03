class CommandBus:


    def send(self,command):

        return {

            "command":command,

            "status":"QUEUED"

        }
