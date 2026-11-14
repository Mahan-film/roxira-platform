# Tax transmission core (T94)

Code: `output_apps/enterprise_hub/modules/tax_compliance/` (`transmission/`, `services/tax-transmission.service.ts`,
`repositories/tax-transmission.repository.ts`, `repositories/fiscal-memory-profile.repository.ts`,
`utils/tax-reference-chain.ts`). Migration `1789900003600-CreateFiscalMemoryProfiles`.

Status: the service, queue job (`moadian.tx`) and tables exist and are tested, but no HTTP endpoint or UI calls
`TaxTransmissionService.enqueue` yet. The older `MoadianService.submitInvoice` path still works unchanged (it only
sets `ins` now).

## Send modes

A `FiscalMemoryProfile` (table `fiscal_memory_profiles`, one row per memory id and environment, FORCE RLS) selects
the mode for a memory id. A tenant can have several profiles.

| mode | who signs | who sends | adapter today |
| --- | --- | --- | --- |
| `direct` | taxpayer key (sealed in `moadian_credentials`) | us, Moadian v2 client | `DirectAdapter` |
| `tsp_taxpayer_key` | taxpayer key | a TSP | none (test-only `FakeTspAdapter`) |
| `tsp_tsp_key` | the TSP's key | a TSP | none (test-only `FakeTspAdapter`) |

`environment` is `sandbox` or `production`. `DirectAdapter` refuses a profile whose environment does not match the
configured `MOADIAN_BASE_URL`. `tspProvider` is required for the two TSP modes and must be empty for `direct`.
`moadian_credentials` was not extended: it is one row per tenant and holds key material and the serial counter, so it
cannot describe several memory ids. Profiles hold no secret.

`TaxTransmissionAdapterFactory.forMode(mode)` picks the adapter; a mode with no adapter fails closed.

## Outbox and inquiry rules

1. `enqueue` creates the `moadian_submissions` row in one transaction: reserves the serial, builds taxid and
   packet, generates the uid, inserts status `QUEUED` (the queued marker for the invoice is this row). uid, taxid,
   serial and packet are never updated later. Queue publish happens after commit.
2. Idempotency key is (tenant, invoice, ins) (unique index). A repeat returns the existing row.
3. Before the network call the worker takes an atomic compare-and-set claim (`claimForSend` on `(status IN ('QUEUED','UNKNOWN'), attempt_count)`). Only the winner calls `submitBatch`. A row that is not a clean first attempt (status `UNKNOWN`, `SENT`, or `QUEUED` with attempts) is first reconciled with inquiry-by-uid:
   SUCCESS -> confirm (preserving `referenceNumber` and `sentAt`); FAILED -> FAILED; PENDING or already `SENT` -> `SENT`, poll later; NOT_FOUND on `QUEUED`/`UNKNOWN` (never `SENT`) -> resend the SAME uid and taxid; other answers -> stay `UNKNOWN`.
4. Timeout, network error, 5xx, 429, and operational 401/403/404 -> `UNKNOWN` (or keep `SENT` if already `SENT`), never `FAILED`, never a new uid/taxid. Only a definite packet-rejection 4xx answer on send (e.g. 400/422) is `FAILED`. A failing inquiry never downgrades `SENT` or marks `FAILED`.

## Reference chain

The main submission row keeps `active_reference_tax_id` (starts as its own taxid). An amendment (ins=2), return
(ins=4) or cancellation (ins=3) uses it as `irtaxid` (stored as `reference_tax_id`). When an amendment or return is
confirmed, the root's `active_reference_tax_id` moves to that taxid, in the same transaction as the confirmation.
`enqueue` locks the root row and blocks (HTTP 409) when the root is unconfirmed, any chain member is
`QUEUED`/`SENT`/`UNKNOWN`, or a cancellation is already confirmed. A return where one return invoice gives back 100%
of every original line (matched by `originalLine`) is sent as a cancellation (ins=3).

## What a real TSP adapter needs

- Implement `TaxTransmissionAdapter` (`submitBatch`, `inquireByUid`) and provide it under the `TSP_ADAPTERS` token.
- Map the TSP's transport errors to `MoadianApiError(retryable)`: timeout/5xx must be retryable, a definite
  rejection not.
- A TSP must accept our uid (requestTraceId) and taxid unchanged, and offer a lookup by uid, otherwise rule 3
  cannot hold.
- For `tsp_tsp_key` the packet is signed by the TSP, so the adapter must not require our key.
- Credentials per TSP provider, stored sealed like `moadian_credentials`, plus its sandbox base URL.
- Follow-ups not done here: a sweeper that re-publishes `QUEUED`/`UNKNOWN` rows whose job was lost between commit and
  publish, and an HTTP/UI entry that calls `enqueue`.
