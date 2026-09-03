from __future__ import annotations

import json
from typing import TypedDict, List, Dict, Any
from langgraph.graph import StateGraph, END
from src.intelligence.providers.openrouter_client import OpenRouterClient
from src.intelligence.memory_engine.indexer import SemanticMemoryIndexer

class AgentState(TypedDict):
    query: str
    selected_model: str
    retrieved_context: List[str]
    final_output: str

class RoxiraOrchestratorGraph:
    def __init__(self):
        self.client = OpenRouterClient()
        self.indexer = SemanticMemoryIndexer()
        self.workflow = self._build_graph()

    def _build_graph(self):
        graph = StateGraph(AgentState)
        graph.add_node("retrieve_memory", self._node_retrieve)
        graph.add_node("synthesize_response", self._node_synthesize)

        graph.set_entry_point("retrieve_memory")
        graph.add_edge("retrieve_memory", "synthesize_response")
        graph.add_edge("synthesize_response", END)
        return graph.compile()

    def _node_retrieve(self, state: AgentState) -> Dict[str, Any]:
        hits = self.indexer.search(state["query"], limit=2)
        contexts = [f"• {h['text']}" for h in hits]
        # استفاده از مطمئن‌ترین مدل با کمترین هزینه بر اساس آزمون زنده
        return {"retrieved_context": contexts, "selected_model": "deepseek/deepseek-v4-flash"}

    def _node_synthesize(self, state: AgentState) -> Dict[str, Any]:
        context_str = "\n".join(state["retrieved_context"])
        prompt = f"پرسش کاربر:\n{state['query']}\n\nمستندات بازیابی‌شده از حافظه برداری:\n{context_str}\n\nپاسخ مستند و دقیق به زبان فارسی:"
        res = self.client.generate(model=state["selected_model"], prompt=prompt)
        output_text = res.get("content", "پاسخ دریافت نشد.") if res.get("status") == "SUCCESS" else f"خطا: {res.get('error')}"
        return {"final_output": str(output_text)}

    def run(self, query: str) -> AgentState:
        return self.workflow.invoke({
            "query": query, "selected_model": "",
            "retrieved_context": [], "final_output": ""
        })

if __name__ == "__main__":
    orchestrator = RoxiraOrchestratorGraph()
    print("\n=== Executing LangGraph Memory-Augmented Pipeline ===")
    res = orchestrator.run("مزیت ماده ۲۳ قانون صدور چک در وصول مطالبات چیست؟")
    print(f"Model: {res['selected_model']}")
    print(f"Contexts Count: {len(res['retrieved_context'])}")
    print(f"Final AI Response:\n{res['final_output']}")
