from src.automation.web_intelligence import WebIntelligence

class Fake:
    def __init__(self, configured=True, results=None):
        self.configured = configured
        self.results = results or []
        self.calls = 0

    def search(self, query, **kwargs):
        self.calls += 1
        return {"status": "SUCCESS", "results": self.results}
def make(searxng, ddgs, exa):
    return WebIntelligence(Fake(), exa, Fake(), Fake(), Fake(), Fake(), searxng, ddgs)

def test_free_first_order_and_paid_policy(monkeypatch):
    monkeypatch.delenv("RESEARCH_SEARCH_ORDER", raising=False)
    monkeypatch.delenv("RESEARCH_ALLOW_PAID", raising=False)
    searxng, ddgs, exa = Fake(results=[{"url": "https://a"}, {"url": "https://b"}]), Fake(), Fake()
    intelligence = make(searxng, ddgs, exa)
    result = intelligence.search("query", 2)
    assert searxng.calls and not ddgs.calls
    assert result["providers"]["ddgs"] == {"status": "NOT_NEEDED"}
    assert result["providers"]["tavily"] == {"status": "NOT_NEEDED"}
    searxng.configured, ddgs.results, ddgs.calls = False, [{"url": "https://c"}], 0
    result = intelligence.search("query", 2)
    assert result["providers"]["searxng"] == {"status": "SKIPPED_UNCONFIGURED"}
    assert ddgs.calls
    monkeypatch.setenv("RESEARCH_SEARCH_ORDER", "exa,tavily")
    blocked = intelligence.search("query")
    assert blocked["providers"]["exa"] == {"status": "SKIPPED_PAID"}
    assert not exa.calls
    monkeypatch.setenv("RESEARCH_ALLOW_PAID", "1")
    allowed = intelligence.search("query")
    assert exa.calls
    assert "exa" in allowed["providers"]
