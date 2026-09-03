

class DependencyManager:


    def check(self,module,available):


        missing=[]


        for dep in module.get(
            "dependencies",
            []
        ):

            if dep not in available:

                missing.append(dep)



        return {

            "valid":
            len(missing)==0,

            "missing":
            missing

        }

