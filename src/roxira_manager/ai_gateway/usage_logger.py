

from datetime import datetime



class UsageLogger:


    def log(
        self,
        user,
        model,
        tokens
    ):


        return {

            "user":user,

            "model":model,

            "tokens":tokens,

            "time":
            datetime.utcnow().isoformat()

        }



