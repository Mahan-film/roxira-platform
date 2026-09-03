

import os



class Settings:


    DATABASE_URL=os.getenv(
        "DATABASE_URL",
        "postgresql://localhost:5434/roxira"
    )


    REDIS_URL=os.getenv(
        "REDIS_URL",
        "redis://localhost:6380"
    )


    QDRANT_URL=os.getenv(
        "QDRANT_URL",
        "http://localhost:6333"
    )


    MODEL=os.getenv(
        "DEFAULT_MODEL",
        "deepseek/deepseek-chat"
    )


