
from typing import Dict,Any


class ROXIRAState:


    def __init__(self,task):

        self.task=task

        self.context={}

        self.history=[]

        self.status="CREATED"



    def update(self,key,value):

        self.context[key]=value



    def record(self,item):

        self.history.append(item)

