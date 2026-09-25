import json

DEFAULT_CONFIG = {"debug": False, "retries": 3, "timeout": 30}


def load_config(raw):
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return dict(DEFAULT_CONFIG)

    if not isinstance(parsed, dict):
        return dict(DEFAULT_CONFIG)

    cfg = dict(DEFAULT_CONFIG)

    if "debug" in parsed and isinstance(parsed["debug"], bool):
        cfg["debug"] = parsed["debug"]

    if "retries" in parsed:
        value = parsed["retries"]
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            cfg["retries"] = value

    if "timeout" in parsed:
        value = parsed["timeout"]
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
            cfg["timeout"] = value

    return cfg
