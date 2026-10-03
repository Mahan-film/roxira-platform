from src.ingestion_safety.url_safety import is_safe_public_url, robots_allows


def _resolver(mapping):
    def resolve(host):
        if host not in mapping:
            raise OSError("nxdomain")
        return mapping[host]

    return resolve


def test_public_host_ok():
    r = _resolver({"example.com": ["93.184.216.34"]})
    assert is_safe_public_url("https://example.com/a", r) == (True, "ok")


def test_bad_schemes():
    for u in ("ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)"):
        assert not is_safe_public_url(u, _resolver({}))[0]


def test_credentials_rejected():
    assert not is_safe_public_url("http://user:pw@example.com/", _resolver({}))[0]


def test_localhost_and_private_literals():
    for u in (
        "http://localhost/",
        "http://127.0.0.1/",
        "http://10.0.0.5/",
        "http://192.168.1.1/",
        "http://169.254.169.254/latest/meta-data",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
    ):
        assert not is_safe_public_url(u, _resolver({}))[0], u


def test_hostname_resolving_to_private():
    r = _resolver({"evil.test": ["93.184.216.34", "10.1.1.1"], "meta.test": ["169.254.169.254"]})
    assert not is_safe_public_url("http://evil.test/", r)[0]
    assert not is_safe_public_url("http://meta.test/", r)[0]


def test_unresolvable():
    assert not is_safe_public_url("http://nope.test/", _resolver({}))[0]


def test_robots():
    txt = "User-agent: *\nDisallow: /private/\n"
    assert robots_allows(txt, "https://example.com/public", "bot")
    assert not robots_allows(txt, "https://example.com/private/x", "bot")
    assert robots_allows("", "https://example.com/x", "bot")
