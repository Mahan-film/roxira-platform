

class ExperienceEngine:


    def __init__(self):

        self.experiences=[]


    def store(self,data):

        self.experiences.append(data)


        return {

            "memory_size":len(self.experiences),

            "status":"EXPERIENCE_STORED"

        }

