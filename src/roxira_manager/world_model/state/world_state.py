class WorldState:


    def snapshot(self):

        return {

            "agents":[],
            
            "missions":[],

            "resources":[],

            "status":"STATE_CAPTURED"

        }
