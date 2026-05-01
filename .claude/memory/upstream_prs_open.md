---
name: upstream_prs_open
description: current open PRs (upstream + internal fork)
type: fact
date: 2026-04-30
---

## Upstream PRs (`hystax/optscale:integration`)

| PR | Title | Branch | Opened |
|---|---|---|---|
| #870 | Add native Azure cold-tier candidates recommendation module | feat/azure-cold-tier-native | 2026-04-29 |
| #871 | Improve review-loop ergonomics: AGENTS.md + SDK ctor lock + cache isolation tests | feat/codex-feedback-loop | 2026-04-29 |
| #872 | feat(cloud_adapter): capture Azure storage account tier metadata | feat/azure-storage-discovery | 2026-04-29 |
| #873 | feat(bumiworker,ngui): add azure_orphan_nics recommendation module | feat/azure-orphan-nics | 2026-04-29 |
| #874 | feat(bumiworker,ngui): add azure_abandoned_storage_accounts recommendation | feat/azure-abandoned-storage-accounts | 2026-04-30 |

## Internal PRs (`msoukhomlinov/optscale:dev`)

Internal Codex review on our fork is the Stage 1 gate before opening the corresponding upstream PR.

| PR | Title | Branch | Stage | Status |
|---|---|---|---|---|
| #1 | Native Azure cold-tier candidates recommendation module | feat/azure-cold-tier-native | merged 2026-04-29 | Codex clean; merged to dev; upstream PR #870 opened |
| #2 | feat(cloud_adapter): capture Azure storage account tier metadata | feat/azure-storage-discovery | merged 2026-04-29 | Codex clean (1 P1 fix in 4176e5e7); merged to dev; upstream PR #872 opened |
| #3 | feat(bumiworker,ngui): add azure_orphan_nics recommendation module | feat/azure-orphan-nics | merged 2026-04-29 | 5 Codex review rounds (P1 sentinel scoping + P1 mass false archival + P2 zero-saving allowlist + P1 service-managed NIC filter + P2 stray test assertion). Merged to dev with 3-file ngui registry conflict resolution (kept both AzureColdTierCandidates + AzureOrphanNics). Upstream PR #873 opened |
| #4 | feat(bumiworker,ngui): add azure_abandoned_storage_accounts recommendation | feat/azure-abandoned-storage-accounts | merged 2026-04-30 | 3 Codex review rounds. Round 1: P1 retail prices NextPageLink pagination + P1 capacity probe error vs no-data + P2 archive options compared against current persisted (not defaults). Round 2: P1 fallback rows saving=None breaks rest_api optimization controller (KeyError + -None TypeError) → reverted to saving=0.0 (uniquely identifies fallback because healthy path drops saving≤0). Round 3: P1 pricing transient HTTP error counted as probe failure via tagged-tuple (price, transient_error) return + P2 missing-credentials branch emits sentinel fallback. Merged to dev with 3-file ngui registry conflict resolution (kept all 3: AzureAbandonedStorageAccounts + AzureColdTierCandidates + AzureOrphanNics). Upstream PR #874 opened |
| #5 | feat: per-org recommendation module enable/disable toggles | feat/recommendation-module-toggle | OPEN 2026-05-01 | Awaiting Codex review. 4-agent QA pass complete; all critical/high findings fixed. Run land-feature.sh once Codex is clean. |

## Recovery protocol

When an upstream PR merges:
1. `upstream-sync.sh` to pull the merge into integration.
2. `forget-merged.sh <branch>` to clean up the local + remote feat branch.
3. For dependent in-flight feat branches (see `.claude/scripts/.feat-deps/<name>`), rebase onto refreshed integration.

When an internal PR is Codex-clean:
1. `land-feature.sh <name>` to merge feat into local dev (closes internal PR), push dev, and open the upstream PR.
