# Rebuild corpus v7 on srv1 and gate it before switching

Runbook for the hub. The first `iran_laws_v7` (7,295 points) was **not switched**: the legal
gate dropped r@1 from 72.9 % to 67.1 % because the same law came in under two names («وارده» /
«وارد شده», Arabic/Persian letters, years) and the duplicates pushed the v6 rows down the ranks.
This rebuild adds:

- **Law-name folding** (`scripts/legal/law_names.py`, used by `build_v7.py`): one canonical key per
  law (ي/ك, ZWNJ/space/no space, «آئین»/«آیین», digits, diacritics, tatweel, «وارده»/«وارد شده
  (به)», parenthesised years, «مصوب ...», «با اصلاحات بعدی»). Staged names fold onto the v6 name,
  and two staged spellings of a new law fold onto one name. A fuzzy (non-equal key) merge needs
  the same years, ordinals («پنجم»/«ششم») and amendment marker, so budgets of different years,
  different development plans and «(اصلاحی 1392)» never merge. Order-independent. Every rewrite
  is listed in `v7_report.json` → `law_name_merges` and in `v7_law_name_merges.md`.
- **Guild amendment relabel** (`split_rc_law_articles.py`): the base-article texts quoted inside
  «قانون اصلاح قانون نظام صنفی کشور» are now «ماده N قانون نظام صنفی کشور (اصلاحی 1392)» (36
  articles); the 59 amendment items keep their own numbers and point to the relabelled article.
  Chat no longer cites «ماده 27 قانون اصلاح قانون نظام صنفی کشور».
- **`--replace-law NAME`** on `build_v7.py`: v6 already holds the old guild rows, and the build
  keeps v6 text on any conflict, so the re-split rows would never land without it. The named
  law's v6 rows are left out and its staged rows win (`replaced_laws` in the report). It refuses
  a law with no staged rows.

Nothing below switches serving. Switching is a separate owner approval (step 6).

## 0. Preconditions

```bash
ssh roxira-prod
cd /opt/roxira_platform && git fetch && git checkout origin/main   # includes this PR
QDRANT=http://127.0.0.1:6333
DST=iran_laws_v7c                       # a NEW name; build_v7 refuses an existing collection
curl -fsS "$QDRANT/collections" | python3 -c 'import json,sys; print(sorted(c["name"] for c in json.load(sys.stdin)["result"]["collections"]))'
OUT=/root/deploy-state/v7c && mkdir -p "$OUT"      # --out must be outside data/
```

Run the Python steps the way the hub ran the first v7 build (host `python3` against the local
Qdrant, or inside the app image when the host lacks a dependency, as in `run_v8h_gate.sh`).

## 1. Re-split the rc.majlis laws (new staged file; existing files are never changed)

```bash
python3 scripts/legal/split_rc_law_articles.py data/legal/staged/iran_relay_2026-10-15.jsonl --dry-run
#  165 قانون امور گمرکی / 96 قانون نظام صنفی کشور / 95 قانون اصلاح قانون نظام صنفی کشور (59 items + 36 relabelled)
python3 scripts/legal/split_rc_law_articles.py data/legal/staged/iran_relay_2026-10-15.jsonl \
  --out data/legal/staged/rc_laws_2026-10-22.jsonl --proposed
```

Checked offline on the repo's copy of that relay file: 356 rows, laws «قانون اصلاح قانون نظام
صنفی کشور» 59, «قانون نظام صنفی کشور (اصلاحی 1392)» 36. `--proposed` sets
`staging_status=proposed` (build_v7 only selects proposed rows; the older `rc_laws_2026-10-15`
rows are `status=VALID` and stay ignored). Customs rows are identical to v6 and are skipped as
`already_in_v6`.

## 2. Dry run (writes only `$OUT`)

```bash
python3 scripts/legal/build_v7.py --out "$OUT" --qdrant "$QDRANT" \
  --replace-law "قانون اصلاح قانون نظام صنفی کشور" \
  --replace-law "قانون نظام صنفی کشور"
```

Check before going on:

| report field / file | expect |
|---|---|
| `replaced_laws` | each law has `staged_rows` > 0 (95 / 96); `v6_rows_removed` near the old counts (71 / 96 in `rc_laws_2026-10-15`), more if v6 also has the law from another source |
| `by_law["قانون نظام صنفی کشور (اصلاحی 1392)"]` | 36 |
| `law_name_merges` / `v7_law_name_merges.md` | read every `*_fuzzy` row; a wrong one means two different laws were merged: stop and report it |
| `law_aliases` | staged → v6 names (the `v6_*` rows of the merge list) |
| `v7_conflicts.md` | real text differences only; v6 wins them |
| `dropped` | `already_in_v6`, `already_in_v6_alias`, `news`, `ruling` look plausible vs. the first v7 run |

## 3. Build (Workers AI embeddings; CF credentials come from the server env, never printed)

```bash
EMBED_BACKEND=cf python3 scripts/legal/build_v7.py --apply --collection "$DST" --out "$OUT" \
  --qdrant "$QDRANT" \
  --replace-law "قانون اصلاح قانون نظام صنفی کشور" \
  --replace-law "قانون نظام صنفی کشور"
```

`CF_ACCOUNT_ID` / `CF_AI_TOKEN` must be set; on any CF error the build falls back to the v6
TEI/local embedder. The result prints the written point count, which must equal the collection's
`points_count`.

## 4. Legal gate (retrieval only, no LLM, 0 USD)

Same gate as `run_v8h_gate.sh` (dense for both collections):

```bash
SET=data/eval/chat_golden/legal_gate_2026-10-21.json
for C in iran_laws_v6 "$DST"; do
  LIGHTRAG_QDRANT_COLLECTION="$C" SMARTJUDGE_HYBRID_SPARSE=0 \
    python3 scripts/eval/legal_gate.py retrieval --set "$SET" --json >"$OUT/gate.$C.txt" 2>"$OUT/gate.$C.err"
  grep '^LEGAL_GATE_JSON ' "$OUT/gate.$C.txt" | sed 's/^LEGAL_GATE_JSON //' | python3 -c '
import json,sys; r=json.load(sys.stdin); s=r["summary"]["all"]["kept"]
print(r.get("meta",{}).get("collection"), {k: s.get(k) for k in ("recall@1","recall@3","recall@5")})'
done
```

**Switch criterion** (all must hold):

1. `meta.collection` in each report is the collection you meant.
2. Alias-aware recall@1 and recall@5 of `$DST` are **not lower** than `iran_laws_v6`
   (last measured r@1 72.9 %).
3. No case that passes on v6 fails on `$DST` (compare the per-case ranks in the two reports).
4. Spot check: a question on «محل بدون پروانه کسب» retrieves «ماده 27 قانون نظام صنفی کشور
   (اصلاحی 1392)», not «ماده 27 قانون اصلاح قانون نظام صنفی کشور». The 70-case set has no
   guild case, so this is checked by hand.

If 2 or 3 fails: do not switch. Post `gate.*.txt`, `v7_report.json` and
`v7_law_name_merges.md` to the PR or issue; the regressions show which names still split.

## 5. Report back

Post to the owner/issue: point count, r@1/3/5 for both collections, number of `law_name_merges`
(key vs fuzzy), `replaced_laws`, and the spot-check result.

## 6. Switch and rollback (owner approval required; restarting a container needs approval)

Switch: set `LIGHTRAG_QDRANT_COLLECTION=$DST` in the server env and restart the app container.
Rollback: set it back to `iran_laws_v6` and restart. Keep `iran_laws_v6` until the new
collection has served for a week without a regression.

## Tests (offline)

```bash
python3 -m pytest -q scripts/legal/tests/test_law_names.py \
  scripts/legal/tests/test_split_rc_law_articles.py scripts/legal/tests/test_build_v7.py \
  scripts/legal/tests/test_properties_legal.py
```

Fixture for the name folds: `scripts/legal/tests/fixtures/law_names/variants.json` (groups that
must share a key, pairs that must never merge). Add a line there for every new spelling found in
`v7_law_name_merges.md`.
