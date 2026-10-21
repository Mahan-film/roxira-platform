# Modal vs TEI embedding parity test (design)

Goal: prove that vectors made on Modal (`EMBED_BACKEND=modal`) can sit in the same Qdrant
collection as vectors made by TEI (`roxira_embeddings`). Nothing may be built with Modal until
this passes once, and again after any change of GPU type, fp16 flag or SDK/sentence-transformers pin.

## What is compared

| | TEI (reference) | Modal |
|---|---|---|
| Model | `BAAI/bge-m3` (`--model-id`, docker-compose.prod.yml) | `BAAI/bge-m3` |
| Request | `POST /embed {"inputs": [...], "normalize": true}` (scripts/legal/ingest_pipeline.py `_embed_http`) | `SentenceTransformer.encode(normalize_embeddings=True)` |
| Output | dense, 1024 dims, CLS pooling, L2-normalised | same |
| Precision | fp32 on CPU (arm64 image) | fp32 on GPU (fp16 only after this test passes with `MODAL_EMBED_FP16=1`) |
| Truncation | none (inputs are <= 2000 chars, see `EMBED_CHARS`) | `max_seq_length=8192` |

## Test

1. Sample 50 real article texts (the `text` field of rows in `data/legal/staged/*.jsonl`, spread
   over at least 10 laws, include 3 long ones near 2000 chars and 3 with Persian digits / ZWNJ).
   Save as a JSONL with a `text` field.
2. On srv1 (TEI reachable, Modal tokens in env):
   `EMBEDDING_URL=http://roxira_embeddings:80 python3 scripts/infra/modal_embed.py parity sample50.jsonl --n 50`
3. Pass criteria (exit code 0): `min_cosine >= 0.999` over all 50 pairs, every Modal vector has 1024
   dims and L2 norm within 1e-3 (checked on every batch in `check_vectors`, also during real builds).
4. If it fails: first try fp32 (unset `MODAL_EMBED_FP16`), then confirm identical model revision; do
   not lower the threshold. Keep TEI as the build backend until it passes.
5. Record the result (date, GPU, min/mean cosine, SDK versions) in the PR that first enables Modal.

Unit-level checks (offline, no Modal) live in `scripts/infra/tests/test_cloud_integrations.py`:
dimension/normalisation validation, cost guard, dry-run estimate, backend dispatch (default stays TEI).
The live parity run is the only part that needs tokens and network.
