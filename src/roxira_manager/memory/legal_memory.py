
import json
from datetime import datetime


class LegalMemory:


    def __init__(self):

        self.memory=[]


    def store(self, data):

        entry={

            "timestamp":
            datetime.utcnow().isoformat(),

            "data":data

        }

        self.memory.append(entry)

        return entry



    def search(self, keyword):

        results=[]

        for item in self.memory:

            if keyword in str(item):

                results.append(item)


        return results



