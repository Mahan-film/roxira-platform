# Open Design workflow (گردش کار Open Design)

Sources: https://github.com/nexu-io/open-design (README), https://open-design.ai/ (fetched 2026-10-04).
Anything not confirmed by those two pages is marked **UNVERIFIED**; test it yourself before relying on it.

## ۱. خلاصه حقایق (Verified facts)

| Topic | Finding | Status |
|---|---|---|
| License | Apache-2.0; bundled components keep their own licenses | Verified (README + site) |
| macOS | Desktop app, macOS 11+, Apple Silicon and Intel; from open-design.ai or GitHub Releases | Verified |
| CLI/daemon | `od` CLI, e.g. `od mcp install <agent>`; daemon auto-detects agent CLIs on `PATH` | Verified (README) |
| OpenCode | `od mcp install opencode --print` (preview), then without `--print` | Verified command; real behaviour UNVERIFIED |
| Provider keys | BYOK via env vars such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`; custom OpenAI-compatible endpoint via proxy routes `/api/proxy/{anthropic,openai,azure,google,ollama}/stream` | Verified at README level; exact var for a custom base URL UNVERIFIED |
| OpenRouter / OmniRoute | Not named in the README. Treat as "OpenAI-compatible base URL" | UNVERIFIED |
| SSRF | Internal IPs blocked by default; allow with `OD_ALLOWED_INTERNAL_HOSTS=host1,10.0.0.5` (needed if OmniRoute runs on localhost/LAN) | Verified |
| Skills | 100+ skills in `skills/`, Agent Skills `SKILL.md` protocol | Verified |
| DESIGN.md | 151 design-system packages built around a brand `DESIGN.md` contract (tokens, typography, palette); each render reads the active package | Verified |
| Export | Standalone HTML, PDF, PNG, PPTX, ZIP, Markdown, MP4. **No React/Tailwind/Figma export listed.** Output is HTML/CSS/assets on disk | Verified |
| RTL / Persian / Vazirmatn | Not mentioned anywhere | UNVERIFIED; handle via prompt + our tokens |
| Reference image input | Not mentioned on either page | UNVERIFIED; depends on the connected agent/model supporting vision |
| Privacy | "Prompts and context go to the agent, provider, or OpenDesign Cloud you chose." Files stay local. **Product analytics ON by default**, can be disabled in Settings | Verified |
| Security | Skills/plugins get only declared capabilities, default `prompt:inject` only; MCP binds to `127.0.0.1` by default | Verified (README claim; not audited) |

Implications for us:
- Output is static HTML/CSS, not Next.js components. It is a **visual reference**, not code to paste. We re-implement in React + shadcn using our `.ap-theme` tokens.
- Never put real case/customer data in prompts or reference images: it goes to whichever provider you chose. Never use a `:free` model for such data (AGENTS.md §4).
- Keys stay in env only; nothing under `output_apps/enterprise_hub/frontend/`.

## ۲. توکن‌های فعلی ما (Our tokens)

From `output_apps/enterprise_hub/frontend/src/app/globals.css`, `.ap-theme` (line ~289), dark default, light via `prefers-color-scheme` or `data-theme="light"`:

- Colours: `--ap-bg #000`, `--ap-surface #161617`, `--ap-surface-2 #1d1d1f`, `--ap-text #f5f5f7`, `--ap-text-muted #a1a1a6`, `--ap-accent #0071e3`, `--ap-line`, `--ap-warn`, `--ap-danger`, `--ap-ok`, `--ap-nav-bg`.
- Type: `--ap-font` (SF Pro stack, then `var(--font-vazirmatn)`/Vazirmatn), hero `clamp(2.5rem,7vw,5rem)` weight 600, body 17px / 1.47.
- Shape/space: `--ap-radius-card 18px`, `--ap-radius-pill 980px`, `--ap-nav-h 44px`, section pad 120px / 56px.
- Classes: `.ap-hero .ap-section .ap-nav .ap-card .ap-muted .ap-input .ap-btn .ap-btn-ghost`, 44px min touch targets, focus-visible outline in accent, print rules.

`src/app/draft-ruling/page.tsx` is a thin server page (Persian title/description, `robots: noindex`, canonical `https://ghazihoushmand.ir/draft-ruling`) rendering `DraftRulingClient` from `@/components/draft-ruling/draft-ruling-client`. Restyle the client component, keep the page metadata.

## ۳. نصب (Install, macOS Apple Silicon)

Run these yourself (owner). Downloading is an owner action.

1. Download the Apple Silicon build from https://open-design.ai/ or GitHub Releases (exact asset name UNVERIFIED), drag to Applications, first launch via right-click > Open if Gatekeeper complains.
2. Settings: **turn off product analytics**.
3. Check the CLI exists: `which od && od --version` (UNVERIFIED that the desktop app installs `od` on PATH; if missing, follow the README's CLI section).
4. Make sure OpenCode is on PATH: `which opencode`. The daemon auto-detects it.
5. Preview the integration before applying: `od mcp install opencode --print`. Read the output (it edits OpenCode's MCP config), then `od mcp install opencode`.

## ۴. بارگذاری کلیدها (Env loading)

Keys live in `~/Secrets/roxira/roxira.env` (see `docs/ops/API_KEYS.md`). Never paste them into the Open Design UI if an env route is available, and never into chat.

```bash
set -a; source ~/Secrets/roxira/roxira.env; set +a
# only if the gateway is on localhost/LAN (SSRF guard blocks it otherwise):
export OD_ALLOWED_INTERNAL_HOSTS=localhost,127.0.0.1
# launch from this shell so the app inherits the env (macOS GUI apps do not read shell rc files):
open -a "Open Design"      # app name UNVERIFIED
```

Provider choice, in order: OpenRouter paid models via env key (see `config/models.yaml`, role `executor`/`strong`); or OmniRoute as an OpenAI-compatible base URL (set the base URL and key in Open Design's provider settings, UNVERIFIED field names). Use a `strong`/`cheap` role model, not `free`, if the reference image or prompt contains anything real.

## ۵. پروژه اول (First project)

1. New project, choose a design-system package closest to our look (Apple-like, dark, blue accent), or create a custom `DESIGN.md` (see §6).
2. Attach the reference image (if the UI has no image attach, UNVERIFIED, put it in the project folder and refer to it by path in the prompt).
3. Paste the prompt template (§7). Iterate on one page at a time: `draft-ruling` first.
4. Export standalone HTML (or ZIP) to `~/Design/roxira/<page>/` (outside the repo).

Third-party skills: read `SKILL.md` before enabling; keep default `prompt:inject` only; do not grant shell/network/file-write capabilities; do not install MCP servers beyond the local one. Keep MCP on `127.0.0.1`.

## ۶. DESIGN.md پیشنهادی (custom design system)

Create `DESIGN.md` in the project with values copied from §2 (do not invent new colours): the palette hex values, font stack, radii, spacing, plus rules: RTL, Latin digits, 44px targets, focus ring, dark default with light variant.

## ۷. الگوی پرامپت (Prompt template)

```
Restyle the Smart Judge (قاضی هوشمند) pages from the attached reference image.
Start with the "draft ruling" page.

Constraints:
- Use ONLY the tokens in DESIGN.md (copy of our .ap-theme: --ap-bg, --ap-surface,
  --ap-surface-2, --ap-text, --ap-text-muted, --ap-accent #0071e3, --ap-line,
  --ap-warn/danger/ok, radii 18px card / 980px pill). No new colours. Take only
  layout, hierarchy, spacing rhythm and component shapes from the image.
- Direction: <html dir="rtl" lang="fa">. Use logical CSS properties (margin-inline,
  padding-inline, inset-inline, text-align: start), mirror icons that imply direction.
- Font: Vazirmatn (local @font-face from a relative file, no CDN), fallback system-ui.
- Digits: Latin digits (0-9) everywhere, including dates and counts.
- Content: placeholder Persian text only. No real case data, names or statutes.
- Output: semantic HTML + one CSS file, class names mapped to our .ap-* classes,
  44px minimum touch targets, visible focus ring, dark default plus light variant,
  no external scripts, no inline secrets.
- Tell me which tokens or components you needed that DESIGN.md lacks, instead of inventing them.
```

## ۸. تحویل به کد ما (Handoff into our tokens)

1. Open the exported HTML in a browser; screenshot desktop (1440) and mobile (390), light and dark.
2. Diff the CSS custom properties against `.ap-theme`: list any colour/size not in our tokens. Decide per item: map to an existing token (default) or propose a new `--ap-*` token in a PR touching only `globals.css`.
3. Implement in `src/components/draft-ruling/draft-ruling-client.tsx` (and sibling components) using shadcn primitives + `.ap-*` classes and Tailwind logical utilities (`ms-*`, `ps-*`, `text-start`). Do not paste exported HTML or its CSS wholesale.
4. New tokens: add under `.ap-theme` AND the two light blocks (`@media (prefers-color-scheme: light)` and `[data-theme="light"]`), keep print rules intact.
5. Verify: `npm run lint && npx tsc --noEmit && npm run build` in the frontend, then visual check against the screenshots at both widths, RTL, Latin digits, Vazirmatn loaded via the existing `--font-vazirmatn`.
6. Ship through a normal reviewed PR (review-diff, different model family). Do not commit the exported HTML or the reference image if it contains third-party artwork.

## ۹. باز بودن‌ها (Open questions to test, all UNVERIFIED)

Reference-image attach in the UI; OpenCode MCP behaviour; OmniRoute field names; whether `od` is installed by the desktop app; real RTL quality of generated output; actual outbound traffic beyond analytics (check with Little Snitch/`lsof -i` during a first run).
