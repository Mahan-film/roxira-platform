# Importing from Sepidar, Hamkaran and Rahkaran

Status (2026-10-31): **these products are not supported directly, and no column-synonym mapping was added.**

Searches for the real Excel export headers of Sepidar and Hamkaran (persons list, item list) returned nothing from
a public source, and Rahkaran was not searched further. Per the "do not invent formats" rule, no synonyms or
product-specific guides were written. Everything below is **unverified**.

What works today:

- Export each list from the old product as Excel or CSV, put the files in one ZIP and upload it on `/app/import`.
  The existing generic synonym matching and the AI-assisted mapping then propose a column mapping that the user
  confirms before commit.
- A SQL Server `.bak` / `.mdf`, or a MySQL / PostgreSQL / SQL Server dump, is rejected with a Persian message
  that explains this export route (`parsers/sql-dump.parser.ts`, `services/package-store.service.ts`).
- There is no continuous sync: import is a one-off upload and can be undone as one batch.

To add real support, someone with a licensed copy needs to export the persons / items / chart-of-accounts
lists and attach the files (or screenshots of the headers). Then add the headers to
`mapping/lead-field-synonyms.ts` and the matching registry synonyms, with a test that uses the sample file.
