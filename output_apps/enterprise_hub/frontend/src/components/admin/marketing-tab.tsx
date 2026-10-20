"use client";

import { useCallback, useState } from "react";
import { adminPost } from "@/lib/api/admin-console-client";
import { Badge, Btn, Card, ErrorBox, fa, Notice, Spinner, useAction, useAdminData, when } from "./admin-ui";

interface Post {
  id: number;
  brand: string;
  platform: string;
  campaign: string;
  status: string;
  caption: string;
  hashtags: string[];
  link: string;
  scheduled_at: number;
  updated: number;
  error: string;
  external_id: string;
  has_image: boolean;
}
interface Overview {
  available: boolean;
  reason?: string;
  drafts: Post[];
  published: Post[];
  counts?: Record<string, number>;
  paused?: boolean;
}

export function MarketingTab({ onAuthLost }: { onAuthLost: () => void }) {
  const q = useAdminData<Overview>("/marketing", undefined, onAuthLost);
  const [note, setNote] = useState<string | null>(null);
  const fn = useCallback(
    async (body: { post_id: number; decision: "approve" | "reject"; reason: string }) => adminPost<{ result: string }>("/marketing/decision", body),
    [],
  );
  const decide = useAction(fn, onAuthLost);

  async function act(p: Post, decision: "approve" | "reject") {
    const verb = decision === "approve" ? "تأیید" : "رد";
    if (!window.confirm(`${verb} پست #${p.id} (${p.platform})؟${decision === "approve" ? " پس از تأیید در نوبت انتشار قرار می‌گیرد." : ""}`)) return;
    const res = await decide.run({ post_id: p.id, decision, reason: `${verb} از کنسول مدیر` });
    if (res) {
      setNote(`پست #${p.id}: ${res.result}`);
      q.reload();
    }
  }

  if (q.loading && !q.data) return <Spinner />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} />;
  const d = q.data;
  if (!d) return null;
  if (!d.available) return <Notice tone="info">موتور بازاریابی در دسترس نیست: {d.reason}</Notice>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(d.counts ?? {}).map(([s, n]) => <Badge key={s} tone={s === "published" ? "ok" : s === "failed" ? "danger" : "muted"}>{s}: {fa(n)}</Badge>)}
        {d.paused && <Badge tone="danger">انتشار متوقف (فایل PAUSE)</Badge>}
        <Btn small variant="ghost" onClick={q.reload} disabled={q.loading}>بازخوانی</Btn>
      </div>
      {note && <Notice tone="ok">{note}</Notice>}
      {decide.error && <Notice tone="danger">{decide.error}</Notice>}

      <Card title={`پیش‌نویس‌های در انتظار (${fa(d.drafts.length)})`}>
        {d.drafts.length === 0 && <p className="text-sm text-[var(--gh-muted)]">پیش‌نویسی در انتظار نیست.</p>}
        <div className="space-y-3">
          {d.drafts.map((p) => (
            <article key={p.id} className="rounded-xl border border-[var(--gh-border)] bg-[var(--gh-bg-2)] p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge tone="cyan">#{p.id}</Badge><Badge>{p.brand}</Badge><Badge>{p.platform}</Badge>
                <Badge tone={p.status === "proposed" ? "warn" : "muted"}>{p.status === "proposed" ? "پیشنهادشده" : "پیش‌نویس"}</Badge>
                <span className="text-[var(--gh-muted)]">زمان انتشار: {when(p.scheduled_at)}</span>
                {p.has_image && <Badge>تصویر دارد</Badge>}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{p.caption}</p>
              {p.hashtags.length > 0 && <p dir="auto" className="mt-1 text-xs text-[var(--gh-cyan)]">{p.hashtags.join(" ")}</p>}
              {p.link && /^https?:\/\//.test(p.link) && <a href={p.link} dir="ltr" target="_blank" rel="noopener noreferrer" className="mt-1 block break-all text-xs text-[var(--gh-cyan)] underline">{p.link}</a>}
              <div className="mt-3 flex gap-2">
                <Btn small disabled={decide.busy} onClick={() => void act(p, "approve")}>تأیید</Btn>
                <Btn small variant="danger" disabled={decide.busy} onClick={() => void act(p, "reject")}>رد</Btn>
              </div>
            </article>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-[var(--gh-muted)]">همان گذارهای mkt.py: پیشنهادشده ← تأیید/رد؛ پیش‌نویس هنگام تأیید ابتدا «پیشنهادشده» می‌شود. بدون تأیید شما چیزی منتشر نمی‌شود.</p>
      </Card>

      <Card title={`منتشرشده‌ها (${fa(d.published.length)} مورد اخیر)`}>
        {d.published.length === 0 && <p className="text-sm text-[var(--gh-muted)]">هنوز پستی منتشر نشده.</p>}
        <ul className="space-y-2">
          {d.published.map((p) => (
            <li key={p.id} className="rounded-xl border border-[var(--gh-border)] p-3 text-sm">
              <div className="mb-1 flex flex-wrap gap-2 text-xs"><Badge tone="ok">#{p.id}</Badge><Badge>{p.platform}</Badge><span className="text-[var(--gh-muted)]">{when(p.updated)}</span></div>
              <p className="line-clamp-3 whitespace-pre-wrap">{p.caption}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
