# Task #556: Moadian asks before resending
Found while checking outside research against the code on 2026-11-07.

**Fine already:** `uid` and `taxid` are stored before the BullMQ job is added, so a retry never makes a new tax id.

**Problem.** `MoadianService.processSend` retries `client.sendInvoice` straight after a transport error. If the first request reached the tax system and only the response was lost, the same packet is sent again without checking.

**Wanted.** On any attempt after the first, call `inquiryByUid` first. If the invoice is known, store its reference number, set SENT and schedule the poll. Send again only when it is not known. Inquiry failure counts as a transport error and retries.

Spec: lost response then retry makes one send; unknown uid then retry sends again; inquiry failure does not send.


Files: output_apps/enterprise_hub/modules/tax_compliance/services/moadian.service.ts, processors/moadian.processor.ts, and the existing Moadian spec. Pass `job.attemptsMade` from the processor to processSend. Keep the isFinalAttempt behaviour. Touch nothing else except the docs/strategy/REQUIREMENTS_STATUS.md row for Moadian, if there is one. Do NOT commit or push. Do not weaken tests; do not claim a test passes unless you ran it.
