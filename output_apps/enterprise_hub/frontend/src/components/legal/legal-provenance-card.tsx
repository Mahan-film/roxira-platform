type LegalProvenanceCardProps = {
  authority: string;
  date: string;
  jurisdiction: string;
  confidence: "high" | "medium" | "low";
  sourceUrl: string;
};

const confidenceStyles = {
  high: "bg-success text-success-foreground",
  medium: "bg-confidence text-confidence-foreground",
  low: "bg-warning text-warning-foreground",
};

const confidenceLabels = { high: "بالا", medium: "متوسط", low: "پایین" };

export function LegalProvenanceCard({
  authority,
  date,
  jurisdiction,
  confidence,
  sourceUrl,
}: LegalProvenanceCardProps) {
  return (
    <section className="rounded-lg border bg-card p-4 text-start text-card-foreground" dir="rtl">
      <h3 className="mb-3 font-semibold">مشخصات منبع</h3>
      <dl className="grid gap-2 text-sm">
        <div><dt className="inline text-muted-foreground">مرجع: </dt><dd className="inline">{authority}</dd></div>
        <div><dt className="inline text-muted-foreground">تاریخ: </dt><dd className="inline">{date}</dd></div>
        <div><dt className="inline text-muted-foreground">حوزه قضایی: </dt><dd className="inline">{jurisdiction}</dd></div>
      </dl>
      <span className={`mt-3 inline-block rounded-full px-2 py-1 text-xs ${confidenceStyles[confidence]}`}>
        اطمینان: {confidenceLabels[confidence]}
      </span>
      <a className="mt-3 block text-sm text-primary underline underline-offset-4" href={sourceUrl} rel="noopener noreferrer" target="_blank">
        مشاهده منبع رسمی
      </a>
    </section>
  );
}
