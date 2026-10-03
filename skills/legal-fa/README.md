# legal-fa skills

Agent Skills (open format: `SKILL.md` with `name` and `description` frontmatter) for Persian-language Iranian legal work. Instructions are in English; user-facing output is in Persian.

| Skill | Purpose |
| --- | --- |
| `citation-check-ir` | Verify every cited article via `/citations/verify`; never invent article numbers. |
| `ruling-draft-review-ir` | Review non-binding AI draft rulings: banner, citations, no punishment numbers in criminal drafts, `INSUFFICIENT_BASIS`. |
| `civil-contract-review-ir` | Checklist review of contracts against Iranian civil code concepts; output is not legal advice. |

These live under `skills/` (not `.claude/`) so any agent runtime can load them. They contain no secrets.
