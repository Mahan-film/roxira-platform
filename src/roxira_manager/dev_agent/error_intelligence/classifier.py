

class ErrorClassifier:


    def classify(self,error):


        mapping={


            "IMPORT_ERROR":
            {
            "agent":"opencode",
            "priority":"medium"
            },


            "METHOD_ERROR":
            {
            "agent":"aider",
            "priority":"high"
            },


            "SYNTAX_ERROR":
            {
            "agent":"aider",
            "priority":"high"
            },


            "TYPE_ERROR":
            {
            "agent":"aider",
            "priority":"medium"
            },


        }



        return mapping.get(

            error,

            {
            "agent":"openhands",
            "priority":"high"
            }

        )

