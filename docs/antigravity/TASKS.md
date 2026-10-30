# Antigravity task pack (visual and small frontend work only)

Claude reviews, tests and merges everything from this pack. You only do the task you are given.

## Fixed rules

1. Do one task only, the one named in the request. Do not fix anything else you notice: list it in your report.
2. Start from a fresh worktree. `<id>` is the task id in lower case:
   ```bash
   export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
   git -C ~/Developer/roxira-platform fetch origin main
   git -C ~/Developer/roxira-platform worktree add ~/Developer/rx-wt/agy-<id> -b agy/<id> origin/main
   cd ~/Developer/rx-wt/agy-<id>/output_apps/enterprise_hub/frontend
   npm ci
   ```
   If git says "must be run in a work tree", stop and report it. Do not change git config.
3. Allowed: only the files named by the task, under `output_apps/enterprise_hub/frontend/src/`.
4. Forbidden: backend, Python, migrations, `package.json`, lockfiles, `globals.css` token values, docker, nginx,
   `.github`, `scripts/`, `config/`, `data/`, any `.env` file. Never read or print a key or secret.
5. Never run `pytest`, and never run anything against a server. Do not push, open a PR or merge.
6. Do not change logic, props, API calls, routes or user-visible Persian text unless the task says so.
7. UI rules: read `DESIGN.md` first. RTL (`dir="rtl"`), Persian text, no raw hex in components, semantic tokens or
   existing `.ghazi-theme` / `.ap-theme` variables only, no new fonts. Keep the e-namad seal in public page footers.
   Respect `prefers-reduced-motion`. Chat and judge roots keep their `dark` class.
8. Before committing, both must pass from the frontend directory:
   ```bash
   npx tsc --noEmit
   npx eslint <the files you changed>
   ```
9. Commit once on the branch: `ui(<area>): <what changed>`. Do not leave uncommitted files.
10. If a task is unclear or needs a forbidden file, stop and say so. Do not guess.

Finish with this report: task id, branch, files changed, `tsc` and `eslint` results, what you did not do, anything
else you noticed.

## Tasks

### A1. Loading skeletons for the business app
Today there is no `loading.tsx` anywhere under `src/app`. Add one `loading.tsx` to each of: `src/app/app/`, and
`accounting`, `assistant`, `crm`, `hr`, `import`, `inventory`, `invoicing` under it. Match each page's real layout
(header, stat row, table rows or cards) so nothing jumps when data arrives. Reuse one small shared component in
`src/components/app/` if an existing skeleton does not fit. Add `aria-busy="true"` and an sr-only Persian label
«در حال بارگذاری». Allowed files: those `loading.tsx` files and that one component.

### A2. Tokens on reset-password and verify-email
In `src/app/reset-password/page.tsx` and `src/app/verify-email/page.tsx`, replace raw colours such as `#fbbf24`,
`#38bdf8` and the page background with the matching existing `.ghazi-theme` variables (see `globals.css` from the
`.ghazi-theme` block). Add the `ghazi-theme` class to the page root if needed. Visual result must stay the same.
Only `className` and style values may change.

### A3. Tokens on the login modal (done, rejected: it put `ghazi-theme` on the enterprise login; do not retry)
Same as A2 for `src/components/auth/login-modal.tsx` and `src/components/auth/email-auth-panel.tsx`. These are auth
files: only `className` and style values may change. Do not touch a handler, state, prop or API call.

### A4. Error pages for public legal sections
`error.tsx` exists only in `src/app/` and `src/app/app/`. Add `error.tsx` to `src/app/laws/`, `src/app/regulations/`,
`src/app/precedents/`, `src/app/guides/` and `src/app/chat/`, following the pattern in `src/app/app/error.tsx`: a calm
Persian message, a retry button using `reset()`, and a link back to the section. Do not show `error.message` to the
user. New Persian text is allowed here, and must say what the user can do next.

### A5R. Rework of A5 (replaces A5)
Do not use your `agy/a5` branch or worktree. Use id `a5r` from `origin/main`. `inventory` and `accounting` already have
a correct empty state: leave them unchanged. Change only `src/app/app/invoicing/page.tsx`: when the list is empty, keep
`EmptyImportState` at full width and, directly below it, centre one outline button «صورتحساب جدید» that opens the
existing editor exactly as the page's current new-invoice button does. Do not wrap `EmptyImportState` in a parent with
`items-center`, because that shrinks it. Add no text line.

### A6. Keep the accounts table honest while loading
In `src/app/app/accounting/page.tsx`, while `loading` is true and `accounts` is empty, the accounts table body shows
nothing. Show skeleton rows there, matching how `TrialBalanceTable` shows its loading rows. Change only that file.

### A7. Logical RTL properties in the table component
In `src/components/ui/table.tsx`, replace `text-left` with `text-start` and `pr-0` with `pe-0`, in `TableHead` and
`TableCell` if present. Change only that file and only those classes.

### A8. Lint errors in PR #871
Start from `origin/feat/sanitize-roxira-net`, not `origin/main`. Use id `a8`. Fix every `eslint` error in
`src/app/api/v1/`, `src/app/api/backend/invoices/route.ts`, `src/app/en/page.tsx` and
`src/components/en/ModuleSandboxModal.tsx`: replace `any` with real types or `unknown`, rename the `module` variable,
and move the synchronous `setState` out of the effect. Behaviour and text must not change. Do not touch secrets or
`JWT` logic.

### A8R. Fix A8's request on every keystroke
Start from `agy/a8`, not `origin/main`. Use id `a8r`. In `src/components/en/ModuleSandboxModal.tsx` A8 added `aiQuery` to
the effect's dependency array, so typing in the AI box sends one request per key. Remove it from that array and keep
the AI verification on its existing submit handler. Keep `aiQuery` in `params` by reading it through a `useRef`, so
`eslint` stays at 0 errors and 0 warnings. Change only that file.

### A5. Empty states in the business app (done, rejected: use A5R)
`crm`, `hr` and `hr/payroll` already show an empty state. `inventory`, `invoicing` and `accounting` should too. Copy
the crm pattern: when a list is empty, show one short Persian line and one action button or link that already exists
on that page (for example the import link). Add no new API calls. Allowed files: the three `page.tsx` files, plus
`src/app/app/accounting/bank/page.tsx` if it has a list. New Persian text is allowed here.
