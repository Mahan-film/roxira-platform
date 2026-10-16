"use client";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export default function AcceptInvitationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    const res = await authClient.organization.acceptInvitation({ invitationId: id });
    if (res.error) return setError(res.error.message ?? "Could not accept the invitation. Sign in first.");
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="space-y-4 text-center">
      <h1 className="text-2xl font-bold">Team invitation</h1>
      <p className="text-sm text-muted-foreground">Sign in with the invited email, then accept.</p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <Button onClick={accept}>Accept invitation</Button>
    </div>
  );
}
