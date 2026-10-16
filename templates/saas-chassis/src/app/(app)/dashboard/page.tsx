import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AiDemo } from "@/components/ai-demo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getOrgPlan } from "@/lib/billing/subscriptions";
import { notesRepo } from "@/features/example/repository";
import { requireOrg } from "@/lib/tenant";

const NoteInput = z.object({ title: z.string().trim().min(1).max(200) });

async function addNote(formData: FormData) {
  "use server";
  const org = await requireOrg(); // tenant id comes from the session, never from the form
  const parsed = NoteInput.safeParse({ title: formData.get("title") });
  if (!parsed.success) return;
  await notesRepo(org.organizationId).insert({ title: parsed.data.title, body: "" });
  revalidatePath("/dashboard");
}

export default async function DashboardPage() {
  const org = await requireOrg();
  const [plan, notes] = await Promise.all([getOrgPlan(org.organizationId), notesRepo(org.organizationId).list()]);

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="text-sm text-muted-foreground">Current plan: {plan.name}</p>

      <Card>
        <CardHeader>
          <CardTitle>Example feature: notes (tenant-scoped)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={addNote} className="flex gap-2">
            <Input name="title" required maxLength={200} placeholder="New note" />
            <Button type="submit">Add</Button>
          </form>
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {notes.map((n) => (
              <li key={n.id}>{n.title}</li>
            ))}
            {notes.length === 0 && <li className="list-none text-muted-foreground">No notes yet.</li>}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Example feature: AI</CardTitle>
        </CardHeader>
        <CardContent>
          <AiDemo />
        </CardContent>
      </Card>
    </div>
  );
}
