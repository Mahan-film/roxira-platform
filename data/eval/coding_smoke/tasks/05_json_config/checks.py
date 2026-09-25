from solution import load_config


def test_full_override():
    cfg = load_config('{"debug": true, "retries": 5, "timeout": 10}')
    assert cfg == {"debug": True, "retries": 5, "timeout": 10}


def test_partial_override():
    cfg = load_config('{"retries": 7}')
    assert cfg == {"debug": False, "retries": 7, "timeout": 30}


def test_invalid_json_returns_default():
    cfg = load_config("{not valid json")
    assert cfg == {"debug": False, "retries": 3, "timeout": 30}


def test_non_object_json_returns_default():
    cfg = load_config("[1, 2, 3]")
    assert cfg == {"debug": False, "retries": 3, "timeout": 30}


def test_unknown_keys_ignored():
    cfg = load_config('{"retries": 1, "made_up_key": "x"}')
    assert cfg == {"debug": False, "retries": 1, "timeout": 30}
    assert "made_up_key" not in cfg


def test_invalid_retries_falls_back_per_key():
    cfg = load_config('{"retries": -1, "timeout": 15}')
    assert cfg["retries"] == 3
    assert cfg["timeout"] == 15


def test_invalid_retries_type_falls_back():
    cfg = load_config('{"retries": "five"}')
    assert cfg["retries"] == 3


def test_invalid_timeout_falls_back():
    cfg = load_config('{"timeout": 0}')
    assert cfg["timeout"] == 30


def test_invalid_debug_type_falls_back():
    cfg = load_config('{"debug": "yes"}')
    assert cfg["debug"] is False


def test_empty_object():
    assert load_config("{}") == {"debug": False, "retries": 3, "timeout": 30}


def test_default_config_not_mutated():
    load_config('{"retries": 99}')
    from solution import DEFAULT_CONFIG

    assert DEFAULT_CONFIG == {"debug": False, "retries": 3, "timeout": 30}
