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
- **Glass design system (W21b):** CSS variables in `:root`/`.dark` (`--glass-surface`,
  `--glass-raised`, `--glass-overlay`, `--glass-border`, `--glass-solid`, `--glass-shadow-*`,
  `--glass-app-bg`) registered in `@theme inline` as `glass-*` colors/shadows. The three
  elevations are applied through the `globals.css` utilities `.glass-surface`, `.glass-raised`,
  `.glass-overlay` (semi-transparent fill + `backdrop-filter: blur(16px) saturate(140%)` + 1px
  light border + soft shadow), plus `.glass-app-bg` for the layered page gradient. Scope is the
  ghazi app shell only (`/chat`, `/judge`): page background, header, footer, chat composer.
  When `backdrop-filter` is unsupported the utilities fall back to the opaque `--glass-solid`
  under `@supports not (...)`, and to the same solid under `prefers-reduced-transparency`;
  `prefers-reduced-motion` removes their transitions/animations. Any new glass surface uses
  these utilities instead of raw translucency/blur values.

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
