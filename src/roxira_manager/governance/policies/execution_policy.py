class ExecutionPolicy:


    def __init__(self):

        self.rules={}


    def add_rule(self,name,value):

        self.rules[name]=value


    def check(self,name):

        return self.rules.get(name)
