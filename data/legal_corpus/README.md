# Legal Corpus Drop-in

## laws/*.txt
  # CATEGORY: <GRAPH_CATEGORY>  (optional, default LAW)
  # TITLE: <law title>          (optional, default filename)
  body: law text, chunked per ماده by parse_and_chunk_law

## precedents/*.txt
  # CATEGORY: <GRAPH_CATEGORY>  (optional, default PRECEDENT)
  body: one ruling per block, separated by a line of ===

Only new/changed files are ingested (sha256 state: .ingest_state.json).
Daily 03:30 cron: scripts/run_periodic_crawler.py
