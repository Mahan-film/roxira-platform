# RaaS, AaaS and next-generation app-building platforms (2026-10-02)

Owner question: are RaaS and AaaS really "next generation", how do the new app-building platforms work, and what should Roxira change. Method: four web searches (standard depth) on 2026-10-02. Source quality is mostly vendor blogs and market-research pages, so every number below is marked UNVERIFIED unless a primary source is named. A deeper pass with primary sources is the next step if the owner wants to base pricing on this.

## 1. Definitions (what the terms actually mean)

| Term | Meaning | Is it technology? |
| --- | --- | --- |
| SaaS | Customer rents software and operates it (seat or usage price) | Delivery model |
| AaaS (Agent-as-a-Service) | Customer rents an autonomous agent that pursues a goal with tools and memory (goal -> reasoning loop -> tool calls -> outcome), usually through an API or a chat/agent endpoint | Delivery model on top of agent technology |
| RaaS (Results-as-a-Service) | Customer pays only when a defined outcome is delivered (a resolved ticket, a signed application, a merged PR) | Pricing/contract model |
| "Service-as-software" | The same idea stated as a market thesis: software performs the work that a services firm used to sell | Market thesis |

Conclusion: RaaS and AaaS are not new technology. They are commercial packaging made possible by reliable agents. They are "next generation" only to the extent that the agent underneath can deliver a verifiable outcome at a cost lower than the price. Without verification and cost control they are just marketing.

## 2. What the sources say (all UNVERIFIED unless noted)

- RaaS: billing moves from actions or seats to accepted outcomes; vendors report higher gross margins with outcome pricing but name three standing problems: attribution (how much was the AI), budget unpredictability for the buyer, and revenue volatility for the vendor ([Ambassador](https://getambassador.com/blog/the-saaspocalypse-is-here.-results-as-a-service-is-what-comes-next), [Monetizely](https://www.getmonetizely.com/articles/why-are-outcome-based-ai-agent-pricing-models-gaining-traction)).
- AaaS: layered architecture of foundation models, orchestration, memory and governance; interoperability through open protocols such as A2A; marketplaces where agents hire agents. Market-size figures (tens of billions of dollars by 2030) and the claim "every SaaS company will become an AaaS company" come from secondary pages ([Hackernoon](https://hackernoon.com/move-over-saas-dashboards-2026-is-the-year-of-agents-as-a-service), [Seahawk](https://seahawkmedia.com/tech/agent-as-a-service-aaas/)).
- App builders split into two families: production-grade code owners (Lovable: React + Supabase with GitHub export; v0: Next.js + shadcn/ui on Vercel) and fast prototypers running in the browser (Bolt.new in WebContainers, Replit Agent). Devin-style products are cloud agents that open a sandbox, plan, code, test and open a pull request ([comparison](https://pasqualepillitteri.it/en/news/591/ai-app-builders-comparison-2026), [directory](https://mcp.directory/blog/replit-agent-vs-bolt-vs-lovable-vs-v0-vs-mocha-2026)).
- The merged pull request is becoming the unit of agent output; one vendor report cites a 67% rise in merged PRs per engineer with a coding agent (UNVERIFIED) ([overview](https://noqta.tn/blog/agentic-coding-autonomous-ai-development-2026)).

## 3. How the new app-building platforms work (common shape)

1. Natural-language goal in; a planner turns it into a spec and tasks.
2. An isolated runtime (WebContainer, microVM or container sandbox) where the agent can install, run and test.
3. A verification loop (build, tests, browser run) that feeds errors back to the agent.
4. Managed hosting and a one-click deploy, or a clean export to the customer's repository.
5. Pricing on tokens or credits per month, with a few moving to per-outcome.

Roxira already has every layer: brief -> research -> proposal -> approval -> planner with task contracts and spec artifacts -> agents in isolated runners -> CI and cross-model review -> preview and Pages delivery -> Persian report. The gaps are the ones in `NEXTGEN_ROADMAP_2026-10.md`: the first real end-to-end run, preview environments on a host, and automatic merging (root fix in progress, issue #351).

## 4. What this means for Roxira

The two products map cleanly:

| Roxira surface | Today | RaaS/AaaS reading | Concrete design consequence |
| --- | --- | --- | --- |
| Smart Judge | Sells per outcome already (single draft, VIP, voice pack) | It is an AaaS/RaaS product: the outcome is an accepted legal draft | Define the accepted-outcome check (citations verified, template complete, human-review flag), log it per tenant, expose an agent card for B2B lawyers |
| Roxira OS | Multi-tenant enterprise platform | The tenant-scoped agent runtime could host customer agents | Per-run capability grants (merged, `capabilities.py`) become per-tenant agent tokens; every agent action carries tenant, budget and expiry |
| Project Factory | Internal builder | A RaaS service: price per delivered, verified project slice | The ledger, `/report`, budget and bake-off libraries are the evidence base for an outcome invoice; add an acceptance record (E2E pass, preview URL, deployed SHA) |

Design rules that follow:

1. **Outcome = verifiable event.** Define outcomes only where Roxira can verify them without an LLM judge (E2E passed, citation guard passed, PR merged and deployed). This is the same rule as the bake-off scoring.
2. **Cost per outcome is the margin.** Outcome pricing is only safe with hard budgets per run and per tenant (`budget.py`, ledger). Track cost per accepted outcome, not tokens.
3. **Attribution and audit.** Keep the append-only ledger as the single record of what the agent did; an outcome invoice must cite its ledger entries.
4. **Interoperability at the edge, not inside.** Offer an A2A-style agent card and a tenant API for Smart Judge; do not adopt agent marketplaces or crypto payments (irrelevant to our payment rails and an extra risk under Iranian conditions).
5. **Volatility.** Revenue per outcome swings with demand; keep a small subscription floor next to outcome pricing for Roxira OS tenants.

## 5. Verdict and next steps

- RaaS and AaaS: adopt as the commercial frame (Factory = RaaS, Smart Judge = AaaS), not as new infrastructure.
- Do now (small): an `acceptance record` in the ledger (E2E result, preview URL, deployed SHA, cost) so every Factory run ends with an outcome receipt; cost-per-outcome line in `/report`.
- Do later: Smart Judge agent card and tenant API; pricing experiments only after one real end-to-end Factory run proves the cost per outcome.
- Open question for the owner: should Factory be offered to third parties (RaaS) or stay internal? That decides whether multi-tenant isolation and billing for Factory are worth building.
