# Design tokens

Source of truth: `src/app/globals.css` (Tailwind v4 `@theme inline`, no `tailwind.config.*`)
and `components.json` (shadcn). Do not invent new values here — this is a read-only summary;
edit the CSS/shadcn config, then update this file.

- **shadcn style:** `base-nova`, base color `neutral`, icon library `lucide`, no RTL, no prefix.
- **Radius scale:** `--radius: 0.625rem` (10px) is the base; `sm/md/lg/xl/2xl/3xl/4xl` are
  `radius * (0.6 … 2.6)`.
- **Color system:** OKLCH tokens, one set for light `:root`, one for `.dark`. Semantic pairs
  only (no raw hex in components): `background`/`foreground`, `card`, `popover`, `primary`,
  `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `sidebar*`,
  `chart-1..5`. Light mode is near-achromatic (chroma 0 across primary/secondary/muted/accent);
  `destructive` and the sidebar-primary accent in dark mode carry the only real chroma.
- **Fonts:** `--font-sans` (also used as `--font-heading`), `--font-mono` (Geist Mono).
  `--font-sans` resolves to the Persian typeface **Vazirmatn**, loaded via `next/font/google`
  in `src/app/layout.tsx` (`display: swap`, CSS variable `--font-vazirmatn`) and wired to
  `--font-sans` in `globals.css` `:root`, with a system-sans fallback stack. Every page under
  `<html>` inherits it; do not hardcode a different `font-family` in a component.
- **Dark mode:** `.dark` class variant (`@custom-variant dark (&:is(.dark *))`), not
  `prefers-color-scheme`. The Smart Judge (ghazi) surfaces (`/chat`, `/judge`,
  `/judge/payment/callback`) are a committed dark experience: their root element carries the
  `dark` class explicitly (not a global site default) so their `bg-background`/`text-foreground`
  etc. resolve to the dark token set. Keep that class when touching those root wrappers.
- **Browser surfaces:** `::selection` and the scrollbar track/thumb color (`scrollbar-color`)
  are themed from the palette in `globals.css` `@layer base`, per the Impeccable craft-floor
  checklist.
- **Horizontal scroll rows** (mobile chip/action bars with `overflow-x-auto`): pair
  `overflow-x-auto` with the `.scroll-fade-x` utility (`globals.css` `@layer utilities`) so a
  clipped row reads as scrollable instead of abruptly cut off at the viewport edge.
- **Glass design system (W21b / T115):** CSS variables in `:root`/`.dark` (`--glass-surface`,
  `--glass-raised`, `--glass-overlay`, `--glass-border`, `--glass-solid`, `--glass-shadow-*`,
  `--glass-app-bg`) registered in `@theme inline` as `glass-*` colors/shadows. In T115, `--glass-*`
  is mapped directly onto semantic tokens (`--border`, `--card`, `--popover`). The three
  elevations are applied through the `globals.css` utilities `.glass-surface`, `.glass-raised`,
  `.glass-overlay` (semi-transparent fill + `backdrop-filter: blur(16px) saturate(140%)` + 1px
  light border + soft shadow), plus `.glass-app-bg` for the layered page gradient.
- **AI Surface Tint (`--ai-surface` / T115):** A subtle cool indigo tint (`oklch(0.975 0.015 250)`
  in light mode, `oklch(0.22 0.03 250)` in dark mode) registered in `@theme inline` as `--color-ai-surface`
  (`bg-ai-surface`, `border-ai-surface`). Used exclusively to visually distinguish AI-generated drafts
  and suggestions from human-committed financial records (Research R1 §6).
- **Tabular Numerals (`tabular-nums` / T115):** Added `.tabular-nums` utility in `@layer utilities`
  (`font-variant-numeric: tabular-nums`) alongside existing `.num`. Every financial figure, voucher
  amount, debit/credit column, and date must use `tabular-nums` to ensure uniform glyph alignment.

## Semantic Token Mapping (T115)

To prevent visual drift and fragmentation, all three historical token families (`--ap-*`, `--gh-*`, `--glass-*`)
are mapped onto the single semantic token set. The old token names remain functional as backwards-compatible aliases:

### 1. Apple-style (`--ap-*`) Mapping
| Legacy Alias | Semantic Token Target | Usage / Description |
|---|---|---|
| `--ap-bg` | `var(--background)` | Main surface background |
| `--ap-surface` | `var(--card)` | Elevated surface card |
| `--ap-surface-2` | `var(--muted)` | Secondary / interactive surface |
| `--ap-text` | `var(--foreground)` | Primary body typography |
| `--ap-text-muted` | `var(--muted-foreground)` | Secondary / muted text |
| `--ap-accent` | `var(--primary)` | Primary brand action color |
| `--ap-accent-text`| `var(--primary-foreground)` | Text on primary brand action |
| `--ap-line` | `var(--border)` | Hairline dividers and borders |
| `--ap-warn` | `var(--warning)` | Warning alerts / cautions |
| `--ap-danger` | `var(--destructive)` | Destructive actions / negative balances |
| `--ap-ok` | `var(--success)` | Success states / reconciliations |
| `--ap-link` | `var(--info)` | Informational links and highlights |
| `--ap-field-border`| `var(--border)` | Input and form control borders |
| `--ap-menu-bg` | `var(--popover)` | Popovers and dropdown menus |

### 2. Ghazi (`--gh-*`) Mapping
| Legacy Alias | Semantic Token Target | Usage / Description |
|---|---|---|
| `--gh-bg` | `var(--background)` | Deep dark canvas background |
| `--gh-bg-2` | `var(--card)` | Ghazi container card background |
| `--gh-text` | `var(--foreground)` | Light text on dark canvas |
| `--gh-muted` | `var(--muted-foreground)` | Slate muted text |
| `--gh-gold` | `var(--primary)` | Ghazi gold brand primary |
| `--gh-on-gold` | `var(--primary-foreground)` | Dark text on gold button |
| `--gh-cyan` | `var(--info)` | Cyan informational focus / link |
| `--gh-danger` | `var(--destructive)` | Danger / error / negative balance |
| `--gh-ok` | `var(--success)` | Emerald success state |
| `--gh-border` | `var(--border)` | Translucent border on dark surface |
| `--gh-ring` | `var(--ring)` | Cyan focus ring |
| `--gh-modal` | `var(--card)` | Dark glass modal container |
| `--gh-surface` | `var(--glass-surface)` | Glass translucent surface |
| `--gh-surface-2` | `var(--glass-raised)` | Raised glass translucent surface |

### 3. Glass (`--glass-*`) Mapping
| Glass Variable | Semantic Token Target | Description |
|---|---|---|
| `--glass-border` | `var(--border)` | Single source of truth for component borders |
| `--glass-solid` | `var(--card)` | Solid fallback when backdrop-filter is unavailable |
| `--glass-surface`| `color-mix(in oklch, var(--card) 65%, transparent)` | Translucent card surface |
| `--glass-raised` | `color-mix(in oklch, var(--card) 75%, transparent)` | Raised translucent card surface |
| `--glass-overlay`| `color-mix(in oklch, var(--popover) 88%, transparent)`| Dropdown/popover overlay surface |

## UI Debt Lint & Ratchet (T115)

To eliminate ~2,500 raw palette classes and physical-direction classes from the codebase:
1. **ESLint Rule (`ui-debt/no-raw-palette-or-physical-direction`):**
   - Configured in `eslint.config.mjs` as a non-blocking `warn` for all files under `src/` outside `components/ui`.
   - Flags raw palette classes (`(bg|text|border)-(red|...|orange)-NNN`) and directs developers to semantic tokens.
   - Flags physical direction classes (`ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`, `text-left`, `text-right`, `border-l`, `border-r`, `rounded-l`, `rounded-r`) and directs developers to logical utilities (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`, `text-end`, `border-s`, `border-e`, `rounded-s`, `rounded-e`).
2. **Measurement Utility (`scripts/dev/ui_debt_count.sh <dir>`):**
   - Counts exact occurrences in `<dir>` (outside `components/ui`). Outputs single integer count, or JSON breakdown with `--json`.
3. **CI Ratchet (`scripts/dev/ui_debt_ratchet.sh`):**
   - Keeps one baseline file per top folder under `output_apps/enterprise_hub/frontend/.ui-debt/`.
   - Because each folder has its own isolated baseline file, parallel worker lanes never suffer merge conflicts.
   - Any PR that increases raw palette or physical direction debt in any folder fails CI.
   - When debt is cleaned in a batch PR, the folder baseline is updated to ratcheted down value (`--update <folder>`).

## Rules

- Use the semantic Tailwind classes (`bg-background`, `text-foreground`, `border-border`,
  etc.) generated from `@theme inline`, never a raw OKLCH value or hex in a component.
- New shadcn components go through `components.json`'s aliases (`@/components/ui`, `@/lib`,
  `@/hooks`) so they inherit these tokens automatically.
- A new semantic token (e.g. a new chart color) is added to both `:root` and `.dark` in
  `globals.css`, with a browser-default check (focus ring, selection, scrollbar) per the
  Impeccable skill's craft-floor checklist (`.claude/skills/impeccable/reference/craft-floor.md`).
- Icons are `lucide-react` components (already a dependency), one consistent stroke/weight —
  never an emoji or Unicode glyph standing in for an icon.
# Design contract

## Personality

The product is trustworthy, calm, and precise: legal-tech rather than marketing-tech. Use restrained surfaces, clear hierarchy, and deliberate emphasis. Do not use glossy gradients.

## Persian copy tone

Write formal Persian in short, direct sentences. Explain scope and next steps clearly. Never promise legal outcomes, guarantees, or certainty where the law is uncertain.

## Component and state rules

Loading, no-result, caution, and error states must always be visually distinct. Use explicit labels, iconography, and appropriate contrast; do not rely on colour alone. Legal uncertainty must never be styled as certainty.

## Layout rhythm

Use an 8px spacing grid and generous whitespace. Preserve readable line lengths and maintain a consistent vertical rhythm across screens.

## RTL rules

Use logical utilities (`ms`, `me`, `ps`, `pe`, and `text-start`) for direction-aware layout. Never apply blanket `flex-row-reverse`. Test Persian numerals and mixed Persian/Latin legal citations together.

## Anti-patterns

Do not copy another brand's identity. Avoid permanent `backdrop-filter` effects on dense screens. Do not add font CDNs: retain the single local Vazirmatn variable font.
