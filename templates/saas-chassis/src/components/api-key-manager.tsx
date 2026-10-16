"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createApiKey, deleteApiKey } from "@/app/(app)/dashboard/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Key {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: string;
}

export function ApiKeyManager({ keys, canManage }: { keys: Key[]; canManage: boolean }) {
  const router = useRouter();
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const res = await createApiKey({ name: new FormData(form).get("name") });
    if (res.ok) {
      setSecret(res.secret ?? null);
      setError(null);
      form.reset();
      router.refresh();
    } else setError(res.error);
  }

  async function onDelete(id: string) {
    const res = await deleteApiKey(id);
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  return (
    <div className="space-y-4">
      {secret && (
        <div className="rounded-md border border-border bg-muted p-3 text-sm">
          Copy your key now. It will not be shown again.
          <code className="mt-1 block break-all">{secret}</code>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <ul className="divide-y divide-border rounded-md border border-border text-sm">
        {keys.map((k) => (
          <li key={k.id} className="flex items-center justify-between p-3">
            <span>
              {k.name} <span className="text-muted-foreground">{k.start}…</span>
            </span>
            {canManage && (
              <Button variant="ghost" size="sm" onClick={() => onDelete(k.id)}>
                Delete
              </Button>
            )}
          </li>
        ))}
        {keys.length === 0 && <li className="p-3 text-muted-foreground">No API keys.</li>}
      </ul>
      {canManage && (
        <form onSubmit={onCreate} className="flex gap-2">
          <Input name="name" required maxLength={60} placeholder="Key name" aria-label="Key name" />
          <Button type="submit">Create key</Button>
        </form>
      )}
      <p className="text-xs text-muted-foreground">
        Use as <code>Authorization: Bearer &lt;key&gt;</code>. Example endpoint: <code>GET /api/v1/me</code>.
      </p>
    </div>
  );
}
