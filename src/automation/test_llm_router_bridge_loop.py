def test_call_llm_releases_loop_bound_http_client(monkeypatch):
    import output_apps.generated_modules.smartjudge.llm_router as llm_router
    import src.automation.llm_router_bridge as bridge

    monkeypatch.delenv("ROXIRA_OFFLINE_TEST", raising=False)
    monkeypatch.setattr(bridge, "_ensure_router_env", lambda: None)
    entered, clients = [], []
    class FakeClient:
        closed = False
        async def aclose(self): self.closed = True
    async def fake_complete(*_, **__):
        entered.append(llm_router._http_client is None)
        client = FakeClient(); clients.append(client); llm_router.set_http_client(client)
        return llm_router.LLMResult(content="ok", model="m", tier="free", attempts=1)
    monkeypatch.setattr(llm_router, "complete", fake_complete)
    results = [bridge.call_llm("free", "p", "s", feature="t") for _ in range(2)]
    assert [result["status"] for result in results] == ["SUCCESS", "SUCCESS"] and entered == [True, True] and all(client.closed for client in clients) and llm_router._http_client is None
