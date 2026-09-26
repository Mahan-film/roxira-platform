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
- **Dark mode:** `.dark` class variant (`@custom-variant dark (&:is(.dark *))`), not
  `prefers-color-scheme`.

## Rules

- Use the semantic Tailwind classes (`bg-background`, `text-foreground`, `border-border`,
  etc.) generated from `@theme inline`, never a raw OKLCH value or hex in a component.
- New shadcn components go through `components.json`'s aliases (`@/components/ui`, `@/lib`,
  `@/hooks`) so they inherit these tokens automatically.
- A new semantic token (e.g. a new chart color) is added to both `:root` and `.dark` in
  `globals.css`, with a browser-default check (focus ring, selection, scrollbar) per the
  Impeccable skill's craft-floor checklist (`.claude/skills/impeccable/reference/craft-floor.md`).
