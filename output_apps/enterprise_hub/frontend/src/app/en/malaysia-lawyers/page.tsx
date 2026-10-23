import type { Metadata } from "next";
import Link from "next/link";
import { BookOpenCheck, FileSearch, ListChecks, Quote, ShieldAlert } from "lucide-react";
import { MyLegalWaitlistForm } from "@/components/en/my-legal-waitlist-form";

/**
 * Landing page + waitlist for the Malaysian legal research pilot (G2,
 * docs/strategy/MASTER_PLAN_2026-10-16.md §5). Served on roxira.net/en/malaysia-lawyers.
 *
 * Copy rules: it is a pilot, nothing is live; no prices; no claim about coverage, accuracy or
 * official status that the pilot cannot back. Source licensing status:
 * docs/research/global/MALAYSIA_AGC_TERMS_2026-10-22.md.
 */

export const metadata: Metadata = {
  title: "Legal research with checked citations — Malaysia pilot | Roxira",
  description:
    "A research assistant for Malaysian advocates & solicitors that answers from the text of federal Acts and shows the section it relies on. Pilot in preparation; join the waitlist.",
  alternates: { canonical: "https://roxira.net/en/malaysia-lawyers" },
  // Not launched yet: keep it out of search results until the pilot opens.
  robots: { index: false, follow: false },
};

const HOW = [
  {
    icon: Quote,
    title: "Every answer points to a section",
    body: "Answers cite the Act and section they rely on, e.g. “Contracts Act 1950 [Act 136], s. 10(1)”, and show the quoted text next to the answer.",
  },
  {
    icon: ShieldAlert,
    title: "Unsupported citations are flagged",
    body: "Before an answer is shown, each citation is checked against the stored text. If a section cannot be found, the answer says so instead of guessing.",
  },
  {
    icon: FileSearch,
    title: "You verify in one click",
    body: "Each citation links to the section text, so checking the source before you rely on it takes seconds, not a separate search.",
  },
];

const PILOT_SCOPE = [
  "About 20 federal Acts used daily in small practices: contracts and civil procedure, employment, companies, data protection, land and strata, family and estates.",
  "English text only. Case law is not part of the first pilot.",
  "Texts are taken from the online versions published by the Attorney General’s Chambers. Those online versions are not the authentic reprint, so every answer shows the “as at” date and should be checked against the official text before you rely on it.",
  "We are confirming the reuse terms for those texts with the publisher before anything is opened to users.",
];

const NOT = [
  "It is not legal advice and not a substitute for your judgement.",
  "It is for advocates & solicitors and their staff, not for members of the public.",
  "It does not include commercial law reports or any publisher’s headnotes.",
];

export default function MalaysiaLawyersPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/en" className="text-sm font-semibold">
            Roxira
          </Link>
          <a
            href="#waitlist"
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            Join the waitlist
          </a>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto flex w-full max-w-5xl flex-col items-start gap-5 px-4 pb-14 pt-16 sm:px-6">
          <span className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
            Pilot in preparation · Malaysia
          </span>
          <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Legal research for Malaysian practitioners, with citations you can check
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
            Ask a question in plain English. Get an answer drawn from the text of Malaysian federal
            Acts, with the exact section quoted beside it. Built for sole practitioners and small
            firms who need to find and confirm the statute quickly.
          </p>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            It is not live yet. We are preparing a small pilot and are looking for a few practitioners
            to try it and tell us what is missing.
          </p>
          <a
            href="#waitlist"
            className="inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85"
          >
            Join the pilot waitlist
          </a>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight">How it is meant to work</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              The citation checking comes from a legal research assistant we already run in
              production in another jurisdiction. The Malaysian pilot applies the same approach to
              Malaysian Acts.
            </p>
            <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
              {HOW.map(({ icon: Icon, title, body }) => (
                <div key={title} className="rounded-xl border border-border bg-card p-5">
                  <Icon className="size-5 text-muted-foreground" aria-hidden />
                  <h3 className="mt-3 text-base font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-10 px-4 py-14 sm:px-6 md:grid-cols-2">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                <ListChecks className="size-5 text-muted-foreground" aria-hidden />
                What the pilot covers
              </h2>
              <ul className="mt-4 flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
                {PILOT_SCOPE.map((item) => (
                  <li key={item} className="border-l-2 border-border pl-3">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                <BookOpenCheck className="size-5 text-muted-foreground" aria-hidden />
                What it is not
              </h2>
              <ul className="mt-4 flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
                {NOT.map((item) => (
                  <li key={item} className="border-l-2 border-border pl-3">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="waitlist" className="scroll-mt-6 border-t border-border">
          <div className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight">Join the pilot waitlist</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              We plan to start with a small group and will contact you by email when the pilot
              opens. No payment details are asked for.
            </p>
            <div className="mt-8 max-w-3xl">
              <MyLegalWaitlistForm />
            </div>
            <div className="mt-8 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              <h3 className="font-semibold text-foreground">Privacy note</h3>
              <p className="mt-1">
                We collect the details in this form only to contact you about the pilot and to
                understand which research tasks matter to you. We do not sell or share them. They
                may be stored on servers outside Malaysia. To see, correct or delete your details,
                email{" "}
                <a href="mailto:enterprise@roxira.net" className="underline underline-offset-2">
                  enterprise@roxira.net
                </a>
                .
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-4 py-6 text-xs text-muted-foreground sm:px-6">
          <span>© {new Date().getFullYear()} Roxira</span>
          <span>Not legal advice. Pilot in preparation; nothing on this page is a live service.</span>
        </div>
      </footer>
    </div>
  );
}
