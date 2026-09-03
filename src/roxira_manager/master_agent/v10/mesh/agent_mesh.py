

class AgentMesh:


    def __init__(self):

        self.nodes=[]


    def register(self,agent,capability):

        self.nodes.append({

            "agent":agent,

            "capability":capability

        })


        return {

            "nodes":len(self.nodes),

            "status":"NODE_REGISTERED"

        }


    def topology(self):

        return {

            "agents":self.nodes,

            "status":"MESH_READY"

        }

