type LegalResultStateProps = {
  state: "loading" | "empty" | "caution" | "error";
  message: string;
};

const stateStyles = {
  loading: "bg-info text-info-foreground",
  empty: "bg-muted text-muted-foreground",
  caution: "bg-warning text-warning-foreground",
  error: "border-destructive bg-destructive/10 text-destructive",
};

export function LegalResultState({ state, message }: LegalResultStateProps) {
  const labels = {
    loading: "در حال بارگذاری",
    empty: "نتیجه‌ای یافت نشد",
    caution: "توجه",
    error: "خطا",
  };

  return (
    <section className={`rounded-lg border p-4 text-start ${stateStyles[state]}`} dir="rtl" role={state === "error" ? "alert" : "status"}>
      <h3 className="font-semibold">{labels[state]}</h3>
      <p className="mt-1 text-sm">{message}</p>
      {state === "caution" && <p className="mt-3 text-sm font-medium">این پاسخ مشاورهٔ حقوقی قطعی نیست.</p>}
    </section>
  );
}
