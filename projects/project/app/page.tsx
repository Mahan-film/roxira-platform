import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start justify-center gap-6 px-4 py-16">
      <h1 className="text-3xl font-bold tracking-tight">صفحهٔ نمونه</h1>
      <p className="text-muted-foreground">
        اسکلت پروژه آماده است. این یک صفحهٔ موقت است و هنوز محتوایی ندارد.
      </p>
      <Button>شروع</Button>
    </main>
  );
}
