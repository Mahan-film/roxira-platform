

class IdentityManager:


    def __init__(self):

        self.users={}



    def create_user(
        self,
        user_id,
        role
    ):

        self.users[user_id]={
            "role":role
        }


        return {
            "user":user_id,
            "role":role
        }



    def get_role(
        self,
        user_id
    ):

        return self.users.get(
            user_id
        )

