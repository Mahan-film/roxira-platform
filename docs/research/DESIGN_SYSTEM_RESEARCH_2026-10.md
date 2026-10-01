# Smart Judge Design-System Research — 2026-10-01

## Decision in one sentence

Keep the existing Tailwind v4 + shadcn/ui + self-hosted Vazirmatn foundation; add a
Roxira-owned `DESIGN.md` as the agent contract, improve semantic legal-trust tokens,
and borrow interaction patterns rather than another product's visual identity.

## Scope and verification

This is a web-checked snapshot taken on 2026-10-01. Every linked resource below was
opened and confirmed reachable. Stars and commit dates are snapshots, not durability
guarantees. “Recent” means a commit after 2026-04-01; older, stable references are
labelled accordingly. Current frontend facts were read from `DESIGN.md`,
`src/app/globals.css`, and `src/app/layout.tsx`: Tailwind v4 semantic OKLCH tokens,
shadcn/ui, `dir="rtl"` for Persian, and a self-hosted Vazirmatn variable font are already
in place. Live repository metadata (stars, licence, and latest commit) is cited to its
canonical GitHub repository/commit page—the authoritative source; adoption claims below
are otherwise triangulated from three independent sources.

## Triangulated findings

1. **Use both policy and tokens.** Three independent DESIGN.md collections describe a
   human- and agent-readable brief containing colour roles, typography, component rules,
   responsive behaviour, and do/don’t guidance: [VoltAgent](https://github.com/VoltAgent/awesome-design-md),
   [DesignMD Directory](https://github.com/dimabraven/design-md), and
   [Awesome Design Skills](https://github.com/jdsadminllc/awesome-design-skills).
   The inference: tokens make utilities consistent; an owned brief tells an AI when and
   why to use them. Do not treat brand-inspired examples as a licence to imitate brands.

2. **Keep the single CSS-token source of truth.** [Tailwind v4 theme variables](https://tailwindcss.com/docs/theme),
   [shadcn theming](https://ui.shadcn.com/docs/theming), and
   [Style Dictionary](https://github.com/style-dictionary/style-dictionary) independently
   support semantic tokens. The first two directly match this frontend’s `@theme inline`
   architecture, so adding a parallel JSON pipeline now would add churn without value.

3. **Keep Vazirmatn self-hosted.** [Vazirmatn](https://github.com/rastikerdar/vazirmatn),
   [Fontsource’s Vazirmatn record](https://fontsource.org/fonts/vazirmatn/about), and
   [Next.js `next/font/local`](https://nextjs.org/docs/app/api-reference/components/font)
   support the current choice: Persian/Arabic coverage, variable weights, OFL-1.1, and
   local font files. The current local variable font avoids a runtime third-party request.

4. **For legal trust, copy principles, not skins.** The [GOV.UK Design System](https://github.com/alphagov/govuk-design-system),
   [USWDS](https://github.com/uswds/uswds), and [USWDS token guidance](https://designsystem.digital.gov/design-tokens/)
   consistently emphasise clear hierarchy, predictable form/error treatment, accessible
   components, and named tokens. This is a better legal-tech reference than glossy
   marketing gradients. Fintech density may be studied through the [Stripe example in
   DesignMD Directory](https://github.com/dimabraven/design-md), but not copied.

## Resources and verdicts

### Agent-facing design guidance

| Resource (verified URL) | Snapshot: stars; last commit; licence | What it gives Smart Judge | Verdict |
| --- | --- | --- | --- |
| [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) · [commit record](https://api.github.com/repos/VoltAgent/awesome-design-md) | 118,671; 2026-09-21; MIT | Large, current collection of agent-readable DESIGN.md references and a practical format. | **Adapt.** Use as a research library only; write a Persian-legal, Roxira-owned brief. |
| [dimabraven/design-md](https://github.com/dimabraven/design-md) | 5; last-commit date not exposed by the accessible page; MIT | Small CLI/directory with explicit Codex/Claude instructions and Stripe/Linear/Vercel examples. | **Adapt.** Useful format/checklist, but its low maturity means it cannot be a dependency or authority. |
| [jdsadminllc/awesome-design-skills](https://github.com/jdsadminllc/awesome-design-skills) | 0; single initial commit (page checked 2026-09); MIT | 67 portable `SKILL.md` + `DESIGN.md` visual-style packs. | **Skip.** Style packs are generic and the project is not yet a reliable base for a legal product. |
| [VoltAgent/design-md explanatory guide](https://github.com/VoltAgent/design-md/blob/main/README.md) | Same project family; documentation file; MIT | Clear distinction between exact tokens and the design judgement agents need. | **Adapt.** Use its “policy plus values” model in Roxira’s own brief. |

### Tokens, components, and registry tooling

| Resource (verified URL) | Snapshot: stars; last commit; licence | What it gives Smart Judge | Verdict |
| --- | --- | --- | --- |
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui) · [commit record](https://api.github.com/repos/shadcn-ui/ui) | 124,901; 2026-09-30; MIT | Customisable accessible component source, theme tokens, and registry item types including themes, fonts, rules, and files. | **Adopt (already present).** Preserve its semantic-token conventions; do not replace components wholesale. |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) · [commit record](https://github.com/tailwindlabs/tailwindcss/commits/main) | 97,800; 2026-09-08; MIT | Tailwind v4 `@theme` variables generate utility APIs from CSS tokens. | **Adopt (already present).** Keep `globals.css` as the token source of truth. |
| [Style Dictionary](https://github.com/style-dictionary/style-dictionary) · [commit record](https://github.com/style-dictionary/style-dictionary/commits/main) | 4,800; 2026-08-19; Apache-2.0 | Token transformation/build pipeline for CSS, JS, native, and documentation outputs. | **Defer/adapt.** Add only when the same Roxira tokens must serve multiple independently shipped clients. |
| [Tokens Studio for Figma](https://github.com/tokens-studio/figma-plugin) · [commit record](https://github.com/tokens-studio/figma-plugin/commits/main) | 1,600; 2026-08-22; MIT | Figma token authoring, aliases, modes, and JSON/GitHub sync. | **Skip for now.** Valuable only if the team adopts Figma as a maintained token-authoring source. |
| [shadcn registry authoring](https://github.com/shadcn-ui/ui/blob/main/skills/shadcn/registry.md) | Part of shadcn/ui above; 2026-09-30; MIT | A registry can distribute themes, components, tokens, docs, rules, and workflows. | **Defer/adapt.** Make an internal registry only after a second Roxira frontend needs shared primitives. |

### RTL typography and high-trust references

| Resource (verified URL) | Snapshot: stars; last commit; licence | What it gives Smart Judge | Verdict |
| --- | --- | --- | --- |
| [rastikerdar/vazirmatn](https://github.com/rastikerdar/vazirmatn) · [latest release](https://github.com/rastikerdar/vazirmatn/releases?after=v24.0.0) | 3,200; 2022-06-22 release `v33.003`; SIL OFL-1.1 | Persian/Arabic typeface, variable font and web-font installation guidance. | **Adopt (already present).** Retain the bundled variable WOFF2; update only after a visual regression check. |
| [Fontsource Vazirmatn](https://github.com/fontsource/font-files/blob/main/fonts/google/vazirmatn/README.md) · [package record](https://www.npmjs.com/package/%40fontsource/vazirmatn?activeTab=dependents) | Monorepo metrics not used; Fontsource entry updated 2026-03-12; OFL-1.1 | Optional npm packaging, declared Arabic/Latin subsets, and 100–900 weights. | **Skip.** The app already self-hosts the font; adding a package duplicates assets and upgrade surface. |
| [GOV.UK Design System](https://github.com/alphagov/govuk-design-system) · [commit record](https://github.com/alphagov/govuk-design-system/commits/main) | 674; 2026-09-03; MIT | Mature public-service styles, components, patterns, content and trust cues. | **Adapt.** Borrow disclosure, error, form, and progress patterns—not UK branding or Sass code. |
| [USWDS](https://github.com/uswds/uswds) · [commit record](https://github.com/uswds/uswds/commits/main) | 7,200; 2025-05-23; CC0-1.0 except noted assets | Public-sector tokens, accessible components, 8px rhythm, and progressive enhancement guidance. | **Adapt.** Strong check-list/reference; too stale and Sass-centric to install in this Next/Tailwind app. |

## Concrete adoption plan (ordered by value)

1. **Edit `output_apps/enterprise_hub/frontend/DESIGN.md`** — convert the token summary into the agent contract: legal-tech personality, Persian copy tone, component/state rules, layout rhythm, and explicit anti-patterns.
2. **Edit `output_apps/enterprise_hub/frontend/src/app/globals.css`** — add paired semantic `success`, `warning`, `info`, and `confidence` tokens in light/dark plus Tailwind mappings; reserve chroma for evidence, status, and decisive action.
3. **Create `output_apps/enterprise_hub/frontend/src/components/legal/legal-provenance-card.tsx`** — a reusable RTL source/citation card with authority, date, jurisdiction, confidence, and a visible primary record link.
4. **Create `output_apps/enterprise_hub/frontend/src/components/legal/legal-result-state.tsx`** — standardise loading, no-result, caution, and error states so legal uncertainty is never styled as certainty.
5. **Edit `output_apps/enterprise_hub/frontend/src/app/layout.tsx`** — keep the existing local Vazirmatn font; add a documented Latin fallback stack and ensure English routes retain their LTR exception without leaking it into Persian UI.
6. **Edit `output_apps/enterprise_hub/frontend/src/components/chat/chat-result.tsx`** — compose the two legal primitives into answer results before touching marketing surfaces; this makes the trust system visible where risk is highest.

## Risks and controls

- **RTL:** use logical CSS (`ms/me`, `ps/pe`, `text-start`, `start/end`) and test Persian
  numerals, mixed Latin citations, icons, tables, keyboard order, and mobile overflow; avoid
  blanket `flex-row-reverse`, which breaks mixed-direction content.
- **Performance:** retain the one local variable WOFF2 and `display: swap`; do not add font
  packages/CDNs or permanent `backdrop-filter` layers to dense case/result screens. Profile
  any animation and honour reduced motion/transparency.
- **Licence and brand:** MIT/Apache/CC0/OFL permit the recommended code/font use subject to
  their notices; DESIGN.md examples are observational brand references, not licensed product
  skins. Do not copy logos, proprietary copy, screenshots, or trademarked visual identity.
- **Legal assurance:** colour and “confidence” labels must describe a traceable system state,
  never imply legal advice or authority that the underlying source/provenance cannot support.

## Opened source index

- [DesignMD Directory](https://github.com/dimabraven/design-md), [Awesome Design Skills](https://github.com/jdsadminllc/awesome-design-skills), [VoltAgent collection](https://github.com/VoltAgent/awesome-design-md), and [VoltAgent guide](https://github.com/VoltAgent/design-md/blob/main/README.md).
- [shadcn theming](https://ui.shadcn.com/docs/theming), [shadcn registry authoring](https://github.com/shadcn-ui/ui/blob/main/skills/shadcn/registry.md), [Tailwind theme variables](https://tailwindcss.com/docs/theme), [Style Dictionary](https://github.com/style-dictionary/style-dictionary), and [Tokens Studio](https://github.com/tokens-studio/figma-plugin).
- [Vazirmatn](https://github.com/rastikerdar/vazirmatn), [Vazirmatn release list](https://github.com/rastikerdar/vazirmatn/releases?after=v24.0.0), [Fontsource Vazirmatn](https://fontsource.org/fonts/vazirmatn/about), [Fontsource package](https://www.npmjs.com/package/%40fontsource/vazirmatn?activeTab=dependents), and [Next.js fonts](https://nextjs.org/docs/app/api-reference/components/font).
- [GOV.UK Design System](https://github.com/alphagov/govuk-design-system), [USWDS](https://github.com/uswds/uswds), and [USWDS design tokens](https://designsystem.digital.gov/design-tokens/).
