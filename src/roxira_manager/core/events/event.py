from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass
class RoxiraEvent:

    event_type: str
    source: str
    payload: dict

    timestamp: str = (
        datetime.now(timezone.utc).isoformat()
    )
