


class FeatureFlags:


    flags={

        "agent_autonomy":True,

        "self_healing":True,

        "graph_rag":True,

        "finance_module":True,

        "legal_module":True

    }



    @classmethod
    def enabled(
        cls,
        feature
    ):

        return cls.flags.get(
            feature,
            False
        )

