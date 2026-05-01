# Project Memory Index

Project-scoped persistent notes for the optscale-fork repo. Cross-session knowledge that doesn't belong in CLAUDE.md (too detailed) or refs (too session-specific).

User-level memory at `/home/iitadmin/.claude/projects/-home-iitadmin/memory/MEMORY.md` is for cross-project knowledge. Project-scoped goes here.

## When to add an entry

Save when you discover:
- Non-obvious gotchas (Azure SDK quirks, Hystax behavior assumptions)
- Hard-won fixes (specific bug → root cause → resolution)
- User preferences for THIS repo (build flow, deploy cadence, QA expectations)
- Real-data findings (forecast results, anomalies)

Don't save:
- Code patterns / conventions (those are in CONVENTIONS.md)
- Architecture (in ARCHITECTURE.md)
- Build/deploy commands (in BUILD.md)
- Anything in the upstream repo's docs

## Format

Each entry = one `.md` file in this directory with frontmatter:

```
---
name: short-name
description: one-line trigger for relevance check
type: gotcha | fact | finding | preference
date: 2026-04-29
---

[content]
```

Then add a one-line index entry below. Keep this MEMORY.md ≤ 50 entries / 200 lines.

## Entries

- [nerdctl setuid bypass](nerdctl_setuid.md) — `/home/iitadmin/bin/nerdctl` is setuid root; drop `sudo` prefix for non-interactive sub-agent builds (CNI may need `--net=none` for ad-hoc `nerdctl run`)
- [overlay cold-tier silently broken](overlay_cold_tier_broken.md) — legacy `s3_intelligent_tiering` wrapper produces 0 rows due to track-1 SPN passed to track-2 MonitorManagementClient; errors swallowed; native is first working implementation (verified 2026-04-29; "$1.2k/mo NRL savings" historical figure was stale)
- [ngui recommendation tile registration](ngui_recommendation_registration.md) — new tiles MUST be added to `useOptscaleRecommendations.ts` (drives overview) AND `allRecommendations.ts` (archive/detail); missing the hook = tile silently invisible even with MongoDB data present
- [ngui recommendation title format](ngui_recommendation_title_format.md) — `title` key = plain string only; no HTML/ICU plural (Cards.tsx renders with no `values` prop); HTML+ICU only valid in `descriptionMessageId` keys
- [upstream PR workflow](upstream_pr_workflow.md) — 2-stage PR workflow: Stage 1 internal PR (msoukhomlinov:feat → msoukhomlinov:dev) for Codex review; Stage 2 upstream PR + merge to dev locally. Helpers: upstream-sync/start-feature/propose-feature/land-feature/forget-merged.sh + _lib_deps.sh; deps tracked at .claude/scripts/.feat-deps/&lt;name&gt;
- [azure_helpers layout](azure_helpers_layout.md) — actual 9-file layout of azure_helpers/ differs from plan: confidence logic is in cold_forecast_confidence.py (combined), not a standalone confidence.py; cold_forecast.py also present as sibling; tests/ subdir present
- [upstream PRs open](upstream_prs_open.md) — Upstream: PR #870 (cold-tier), PR #871 (codex-feedback-loop), PR #872 (azure-storage-discovery, C2), PR #873 (azure-orphan-nics), PR #874 (azure-abandoned-storage-accounts) — all OPEN against hystax/optscale:integration. Internal: PR #1 + #2 + #3 + #4 merged to dev (latest 2026-04-30)
- [candidate follow-ups](candidate_followups.md) — C1/C2/C2-followup/C2b/C3 + R1 helpers refactor + 2026-04-30 API-cost optimisations (O1 metrics:getBatch SDK migration, O3 UsedCapacity 24h TTL, O4 Resource Graph pre-filter); canonical version in plan § 8
- [CI deferred](ci_deferred.md) — plan #1 GitHub Actions build-images workflow deferred 2026-04-29; local nerdctl into K3s containerd is fastest for solo iteration; promote only if upstream rejects / team grows / artifact reproducibility required
- [Use optscale-recommendations skill](use_optscale_skill.md) — always invoke `optscale-recommendations:add-optscale-recommendation` skill for new modules; always consult for refactors; encodes 8-round Codex review lessons + 2-stage PR workflow + invariants (dual-reg, sibling null-guard, plain title, sentinel meta, ARM lowercase)
- [Next work — handover](next_work.md) — **START HERE**: `feat/recommendation-module-toggle` implemented + 4-agent QA done. Internal PR #5 OPEN awaiting Codex. Run `land-feature.sh` once clean. Then `azure_unattached_managed_disks`.
- [Handover pattern](handover_pattern.md) — session-end discipline: sync 7 project docs to reality, decide next task with user, mark NEXT in plan §8, overwrite `next_work.md`, flag START HERE in MEMORY.md. Auto-trigger phrases: "what next", "wrap up", "handover", "is doc up to date", or after Stage 2 land
