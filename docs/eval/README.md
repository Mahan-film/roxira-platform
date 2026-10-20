# Model bake-off (`scripts/eval/model_bakeoff.py`)

Compares every per-rank group of the key pool (`best-product-free`, `vip-product`, `vip-pro`, `vip-premium`, i.e. the
free / basic / pro / premium tiers) on 40 Persian questions: 30 legal ones from the golden data, 6 small-talk, 4 out of scope.
Run it on the server only: the providers are blocked or flaky from Iranian IPs and the gateway listens on `127.0.0.1:4000` there.

## Commands (on srv1)

Quick smoke run (5 questions, all models, no judge):

    cd /opt/roxira_platform && python3 scripts/eval/model_bakeoff.py --limit 5

Full run (all four tiers, LLM judge, plus the live app end to end):

    cd /opt/roxira_platform && ROXIRA_EVAL_TOKEN=<optional login token> python3 scripts/eval/model_bakeoff.py --mode both --judge

Useful options:

    --dry-run                      list candidates and questions, call no model
    --tiers free,pro               only some tiers
    --candidates vip-pro,best-product-free__r3   only groups whose name contains one of these
    --judge-group vip-pro          judge group (default vip-pro = rank 1; "vip-pro__r1" is accepted as an alias)
    --retry-errors                 re-run pairs that failed or came back empty
    --report-only                  rebuild the report from the JSONL
    --tag 2026-10-21               new tag = new results file; same tag = resume

It reads `KEYPOOL_MASTER_KEY` from the environment or `/opt/roxira_platform/.env` (never printed). Gateway URL:
`--gateway` / `BAKEOFF_GATEWAY` (default `http://127.0.0.1:4000/v1`). App URL (retrieval, citation check, pipeline mode):
`--app-url` / `BAKEOFF_APP_URL` (default `https://ghazihoushmand.ir`).

## Output

- Results: `/var/lib/roxira-eval/bakeoff/results_<tag>.jsonl` (env BAKEOFF_OUT_DIR) (append-only, one record per model x question, plus judge records;
  retrieved contexts in `results_<tag>.ctx.jsonl`). Interrupt and re-run the same command to resume: finished pairs are skipped.
- Report: `docs/eval/MODEL_BAKEOFF_<tag>.md` (rebuilt on every run; ranking table per tier, recommended rank order in
  `config/key_pool.yaml` terms).
- Load: 3 concurrent calls, 3 attempts with backoff per call, 60 s per call. Full run = 20 groups x 40 questions = 800 calls (+ up to 800 judge calls).
  Paid tiers cost real money (cents for the whole run); free tiers consume daily quota, so do the full run once, off-peak.

## How it measures

- Model-only mode: the same retrieved context for every model (retrieved once per question with the app's public `POST /api/v1/apps/judge/query`) and the production
  system prompt (`prompt_library.build_system_prompt`, `chat_fast.context_lines`). It does not replay the app's history, case files, jurisdiction hints or the post-answer
  citation rewrite, so absolute numbers are a little below the product's; the comparison between models is what counts. The app's deterministic small-talk fast path is NOT applied, so models are
  tested on «سلام» etc. themselves.
- Citation validity: the answer is sent to the app's own `POST /api/v1/apps/judge/citations/verify` (CitationHallucinationGuard: article catalogue + Qdrant).
- Gateway fallback: a request for `vip-pro__r2` silently falls to the next rank when that model fails. The served model is compared with the expected one and a mismatch counts as a failure of that candidate.
- Pipeline mode (`--mode pipeline|both`): `POST /api/v1/apps/judge/chat/stream`. The plan is the one of the bearer token in `ROXIRA_EVAL_TOKEN`; without it the run is anonymous FREE and the per-IP/user chat limits apply.
