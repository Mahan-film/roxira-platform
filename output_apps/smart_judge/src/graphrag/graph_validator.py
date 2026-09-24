from __future__ import annotations

import json
import psycopg
from datetime import datetime
from src.roxira_config import postgres_dsn


DB_URL = postgres_dsn(host="127.0.0.1", port=5434)


class GraphValidator:

    def __init__(self):
        self.report = {
            "timestamp": str(datetime.now()),
            "database": False,
            "nodes": 0,
            "edges": 0,
            "broken_links": 0,
            "orphan_nodes": 0,
            "status": "UNKNOWN"
        }


    def validate_database(self):

        with psycopg.connect(DB_URL) as conn:

            with conn.cursor() as cur:

                self.report["database"] = True


                cur.execute(
                    "SELECT COUNT(*) FROM graph_nodes;"
                )

                self.report["nodes"] = cur.fetchone()[0]


                cur.execute(
                    "SELECT COUNT(*) FROM graph_edges;"
                )

                self.report["edges"] = cur.fetchone()[0]


                cur.execute(
                    """
                    SELECT COUNT(*)
                    FROM graph_edges e
                    LEFT JOIN graph_nodes n
                    ON e.target_node_id = n.node_id
                    WHERE n.node_id IS NULL;
                    """
                )

                self.report["broken_links"] = cur.fetchone()[0]


                cur.execute(
                    """
                    SELECT COUNT(*)
                    FROM graph_nodes n
                    LEFT JOIN graph_edges e1
                    ON n.node_id = e1.source_node_id
                    LEFT JOIN graph_edges e2
                    ON n.node_id = e2.target_node_id
                    WHERE e1.source_node_id IS NULL
                    AND e2.target_node_id IS NULL;
                    """
                )

                self.report["orphan_nodes"] = cur.fetchone()[0]


        if (
            self.report["database"]
            and self.report["broken_links"] == 0
        ):
            self.report["status"] = "HEALTHY"
        else:
            self.report["status"] = "WARNING"


        return self.report



def main():

    print("=" * 50)
    print("ROXIRA GRAPH HEALTH REPORT")
    print("=" * 50)


    validator = GraphValidator()

    result = validator.validate_database()


    print(json.dumps(
        result,
        indent=4,
        ensure_ascii=False
    ))


if __name__ == "__main__":
    main()