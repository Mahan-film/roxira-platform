import networkx as nx
import json
from pathlib import Path


class RoxiraKnowledgeGraph:

    def __init__(self):

        self.graph = nx.DiGraph()


    def add_entity(
        self,
        source,
        target,
        relation
    ):

        self.graph.add_edge(
            source,
            target,
            relation=relation
        )


    def export(self):

        data = nx.node_link_data(
            self.graph
        )

        Path(
            "project_memory/graph"
        ).mkdir(
            exist_ok=True
        )

        with open(
            "project_memory/graph/knowledge_graph.json",
            "w"
        ) as f:

            json.dump(
                data,
                f,
                indent=2
            )


if __name__ == "__main__":

    kg = RoxiraKnowledgeGraph()

    kg.add_entity(
        "project-foundry",
        "Django",
        "uses"
    )

    kg.add_entity(
        "Django",
        "PostgreSQL",
        "database"
    )


    kg.export()

    print(
        "Knowledge graph created"
    )