from dataclasses import dataclass
from typing import List, Dict, Any, Optional

@dataclass
class LegalNormNode:
    component_id: str
    work_title: str
    norm_type: str
    binding_level: int
    valid_start: str
    valid_end: Optional[str]
    text: str
    binding_edges: List[str]

class SATGraphLegalEngine:
    KNOWLEDGE_GRAPH: List[LegalNormNode] = [
        LegalNormNode(
            component_id="MOJAZAT-1392-ART134-V1",
            work_title="قانون مجازات اسلامی مصوب ۱۳۹۲",
            norm_type="STATUTE",
            binding_level=2,
            valid_start="2013-05-01",
            valid_end="2020-05-12",
            text="در جرائم موجب تعزیر هرگاه جرائم بیش از سه جرم نباشد حداکثر مجازات تعیین می‌گردد...",
            binding_edges=["PRECEDENT-DIVAN-790"]
        ),
        LegalNormNode(
            component_id="MOJAZAT-1399-ART134-V2",
            work_title="قانون کاهش مجازات حبس تعزیری (ماده ۱۳۴ اصلاحی)",
            norm_type="STATUTE",
            binding_level=2,
            valid_start="2020-05-13",
            valid_end=None,
            text="در تعدد جرائم تعزیری درجه ۱ تا ۶ میانگین حداقل و حداکثر تعیین می‌گردد...",
            binding_edges=[]
        ),
        LegalNormNode(
            component_id="PRECEDENT-DIVAN-790",
            work_title="رأی وحدت رویه شماره ۷۹۰ هیأت عمومی دیوان عالی کشور",
            norm_type="PRECEDENT",
            binding_level=2,
            valid_start="2020-07-01",
            valid_end=None,
            text="مقررات اصلاحی ماده ۱۳۴ عطف‌به‌ماسبق شده و در مرحله اجرای احکام لازم‌الاجرا است.",
            binding_edges=["MOJAZAT-1392-ART134-V1", "MOJAZAT-1399-ART134-V2"]
        )
    ]

    @classmethod
    def evaluate_temporal_validity(cls, event_date_str: str) -> List[LegalNormNode]:
        valid_nodes = []
        for node in cls.KNOWLEDGE_GRAPH:
            is_after_start = node.valid_start <= event_date_str
            is_before_end = (node.valid_end is None) or (node.valid_end > event_date_str)
            if is_after_start and is_before_end:
                valid_nodes.append(node)
        return valid_nodes

    @classmethod
    def hybrid_graph_retrieval(cls, query: str, event_date: str = "2024-01-01") -> Dict[str, Any]:
        valid_nodes = cls.evaluate_temporal_validity(event_date)
        return {
            "query": query,
            "temporal_point_evaluated": event_date,
            "active_statutes_and_precedents": [
                {"component_id": n.component_id, "title": n.work_title, "norm_type": n.norm_type, "text": n.text, "related_binding_edges": n.binding_edges}
                for n in valid_nodes if n.binding_level <= 2
            ]
        }

if __name__ == "__main__":
    rep = SATGraphLegalEngine.hybrid_graph_retrieval("تعدد جرم", "2024-01-01")
    print(f"✅ SAT-Graph OK: {len(rep['active_statutes_and_precedents'])} active components retrieved")
