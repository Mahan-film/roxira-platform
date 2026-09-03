

class LegalGraphBuilder:


    def build(self,document):

        return {


            "node":document["title"],

            "relations":[

                "belongs_to_category",

                "has_version",

                "has_source"

            ],


            "status":"GRAPH_READY"

        }


