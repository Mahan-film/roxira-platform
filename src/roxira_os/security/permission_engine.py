

class PermissionEngine:


    def __init__(self):

        self.permissions={}



    def grant(
        self,
        role,
        permission
    ):

        if role not in self.permissions:

            self.permissions[role]=[]


        self.permissions[role].append(
            permission
        )



    def check(
        self,
        role,
        permission
    ):

        return permission in self.permissions.get(
            role,
            []
        )

