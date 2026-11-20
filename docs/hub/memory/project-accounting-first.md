---
name: project-accounting-first
description: "Owner priority 2026-11-04 — complete, automatic accounting system for roxira.ir comes before everything else; pinned issue #230"
metadata:
  node_type: memory
  type: project
  originSessionId: d089f50d-4d5d-43d3-9d64-464656318ead
  modified: 2026-11-04T10:12:42.596Z
---

Owner decision 2026-11-04: **priority 1 for all work is the accounting system** — automatic, complete, every accounting infrastructure piece, for roxira.ir (Iran). Other strategies wait or only finish their open PR. Owner said "remember this and don't forget our strategies".

Scope checklist and lane split live in pinned GitHub issue #230 (Mahan-film/roxira-platform):
- Laptop (`mahansudo`, 5 agents): core ledger, subledgers (sales/purchase/contracting tracks in #227), fixed assets, reports; field app (T4) paused.
- Mac: `modules/posting_rules` (one posting engine, no hardcoded account codes), treasury (receipts/payments with invoice allocation, cash/bank transfers, POS settlements), cheques/Sayad, tax and payroll postings, review desk + merging.
- Gate: M1 gate fully green + production tour 16/16.

**Why:** Owner wants a usable Iranian accounting product first; global (.net), public API, assistant extras come after.

**How to apply:** When choosing or starting work, check #230 first; do not start non-accounting work while accounting items are open. Related: [[project-domains-iran-vs-global]], [[project-trusted-codev]].
