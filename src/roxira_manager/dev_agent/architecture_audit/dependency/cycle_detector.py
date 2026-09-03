

class CycleDetector:


    def find(self,graph):


        cycles=[]


        visited=set()

        stack=set()



        def visit(node):


            if node in stack:

                cycles.append(node)

                return


            if node in visited:

                return



            visited.add(node)

            stack.add(node)



            for dep in graph.get(node,[]):

                visit(dep)



            stack.remove(node)



        for node in graph:

            visit(node)



        return cycles

