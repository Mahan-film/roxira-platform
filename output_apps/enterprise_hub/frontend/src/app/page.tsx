import { DamagesCalculator } from "@/components/damages/damages-calculator";

export default function Home() {
  return (
    <main className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-6xl mx-auto mb-8 text-center space-y-2">
        <h1 className="text-3xl font-extrabold tracking-tight">سامانه سازمانی روکسیرا (Roxira OS)</h1>
        <p className="text-muted-foreground text-sm">
          بستر تولید خودگردان نرم‌افزار — ماژول محاسبات قضایی و مالیات
        </p>
      </div>
      <DamagesCalculator />
    </main>
  );
}
