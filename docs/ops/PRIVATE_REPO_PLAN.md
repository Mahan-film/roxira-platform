# Private Repository Plan (Zero-Cost Path)

**Status:** Future plan (repo is currently `PUBLIC`; do not apply until the owner flips visibility to `PRIVATE`).

## Why a Separate Plan Is Needed

GitHub Free for personal accounts supports private repositories with unlimited collaborators, **but several features used on a public repo become paid or quota-limited once flipped to private**:

1. **GitHub-hosted Actions minutes:** Private repos on GitHub Free get 2,000 minutes/month (vs. unlimited on public repos). Self-hosted runners (`roxira-ci`) do **not** consume GitHub-hosted minutes.
2. **GitHub Merge Queue & Rulesets:** GitHub's native Merge Queue and repository Rulesets on private repos require GitHub Pro/Team/Enterprise.
3. **GitHub Copilot Code Review:** Not available on GitHub Free for private repos without a paid Copilot seat.
4. **GitHub Container Registry (GHCR):** Private packages on GitHub Free have 500 MB storage and 1 GB/month data transfer limits.

## Zero-Cost Architecture for Private Repo

| Capability | Public Repo (Current) | Private Repo (Zero-Cost Path) |
| --- | --- | --- |
| **CI Runner** | GitHub-hosted + `roxira-ci` | **`roxira-ci` self-hosted runner only** (0 GitHub-hosted minutes) |
| **Merge Queue** | GitHub / `merge-queue` label | **`Mergify Free`** (up to 2 active contributors) or `merge_gate` in `legacy` mode |
| **Branch Protection** | Rulesets / branch protection | **`legacy` mode** in `scripts/ops/ci_box/merge_gate/` + main-push alert |
| **Code Review** | Cross-family review desk | **Cross-family review desk** on `roxira-ci` (no Copilot review) |
| **Container Registry** | GHCR / local | **Private `registry:2` on `roxira-ci`** (see `docs/ops/BUILD_OFF_PROD.md`; no GHCR) |
| **Sensitive Paths** | Standard rules | **AGENTS.md §4a** (`ORCH_SCOPE_*` path allowlists on box lanes; core business logic hub-only) |

## Pre-Flip Checklist

Before flipping `Mahan-film/roxira-platform` to `PRIVATE`:

1. Ensure `roxira-ci` self-hosted runner is healthy and all CI workflows target `self-hosted` (or `roxira-ci` labels) so 0 GitHub-hosted minutes are consumed.
2. Switch `scripts/ops/ci_box/merge_gate/` to `legacy` mode (no GitHub Rulesets / native Merge Queue dependency).
3. Configure `Mergify Free` (if <= 2 active contributors) or rely on the `merge_gate` script with `merge-queue` labels.
4. Enable a **main-push alert** (workflow or webhook) to notify the owner immediately if any commit lands on `main` without a PR.
5. Verify `registry:2` on `roxira-ci` is active so prod pulls images without GHCR.
6. Confirm `ORCH_SCOPE_*` allowlists are active on all box lanes per `AGENTS.md` §4a.

## Official Citations

- **GitHub Actions billing & self-hosted runners:** [GitHub Docs — About billing for GitHub Actions](https://docs.github.com/en/billing/managing-billing-for-products/managing-billing-for-github-actions/about-billing-for-github-actions) (self-hosted runners are free and do not count toward included minutes).
- **GitHub Free features & Rulesets/Merge Queue:** [GitHub Docs — GitHub's plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans) (private repo Merge Queue / Rulesets require paid plans).
- **GitHub Packages / GHCR free tier:** [GitHub Docs — About billing for GitHub Packages](https://docs.github.com/en/billing/managing-billing-for-products/managing-billing-for-github-packages/about-billing-for-github-packages) (500 MB storage, 1 GB/month transfer on Free).
- **Mergify Free plan:** [Mergify Pricing](https://mergify.com/pricing) (Free tier for private repositories with limited active contributors).
