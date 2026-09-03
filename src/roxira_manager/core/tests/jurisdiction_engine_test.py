
from src.roxira_manager.decision_engine.jurisdiction_engine import JurisdictionEngine


engine = JurisdictionEngine()


print(
    engine.analyze(
        """
        خریدار ملک هستم.
        فروشنده ملک را منتقل نمی‌کند.
        احتمال کلاهبرداری وجود دارد.
        """
    )
)

