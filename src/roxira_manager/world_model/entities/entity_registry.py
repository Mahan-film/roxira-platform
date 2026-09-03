class EntityRegistry:


    def __init__(self):

        self.entities={}



    def register(
        self,
        name,
        entity_type
    ):

        self.entities[name]={

            "type":entity_type

        }


        return {

            "status":"REGISTERED"

        }
