

class ErrorParser:


    def parse(self,result):

        output = (
            result.get("stderr","")
            +
            result.get("stdout","")
        )


        if "ModuleNotFoundError" in output:

            error="IMPORT_ERROR"


        elif "AttributeError" in output:

            error="METHOD_ERROR"


        elif "SyntaxError" in output:

            error="SYNTAX_ERROR"


        elif "TypeError" in output:

            error="TYPE_ERROR"


        else:

            error="UNKNOWN_ERROR"



        return {

            "error_type":error,

            "raw":output

        }

