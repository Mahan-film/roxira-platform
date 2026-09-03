class ControlController:


    def dispatch(self,command):

        return {

            "command":command,

            "status":"DISPATCHED"

        }
