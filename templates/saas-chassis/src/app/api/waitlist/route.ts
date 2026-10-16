import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { waitlist } from "@/db/schema";

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  locale: z.string().max(10).optional(),
  source: z.string().max(40).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid email" }, { status: 400 });
  // Duplicate emails are silently accepted: do not reveal who is on the list.
  await db.insert(waitlist).values(parsed.data).onConflictDoNothing();
  return NextResponse.json({ ok: true });
}
