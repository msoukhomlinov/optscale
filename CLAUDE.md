# OptScale Fork — Intellect IT

Fork of [hystax/optscale](https://github.com/hystax/optscale). Long-lived intellect-IT branches for prod deployment + feature work that may PR back upstream.

## Identity

- **Repo**: `msoukhomlinov/optscale` (GitHub fork of `hystax/optscale`)
- **Local clone**: `/home/iitadmin/optscale-fork`
- **Primary deployment**: K3s single-node at `/home/iitadmin/.kube/config`, host `192.168.230.145`
- **Plan**: `/home/iitadmin/optscale-azure-fork-plan.md` — multi-phase roadmap (phases A-D, 14-week sequence, decisions locked-in 2026-04-28). Read plan for current phase + work breakdown; don't duplicate here.

## Branches

Four branches: `integration` (upstream mirror — never commit), `dev` (local rollup — never PR upstream), `prod` (deployed — PR only), `feat/<name>` (single enhancement — PR'd both internally and upstream).

**Invariants**:
- Feature branches cut from `integration` (upstream mirror), not `dev`.
- Each feat branch goes through a **2-stage PR workflow**: internal Codex review on our fork first (`msoukhomlinov:feat/x` → `msoukhomlinov:dev`), then upstream contribution PR (`msoukhomlinov:feat/x` → `hystax/optscale:integration`). Internal review is the gate; upstream review proceeds asynchronously and never blocks our own development cadence.
- When a feat branch builds on another in-flight feat branch (whose upstream PR has not merged), declare the chain via `--depends-on` so both PR bodies surface the dependency.

Full workflow, per-feature loop, recovery path, and gotchas → [`.claude/refs/CONVENTIONS.md`](.claude/refs/CONVENTIONS.md) "Branch flow" section. Helper scripts in `.claude/scripts/`: `upstream-sync.sh`, `start-feature.sh`, `propose-feature.sh` (Stage 1), `land-feature.sh` (Stage 2), `forget-merged.sh`, plus `_lib_deps.sh` for dependency-section rendering.

## Critical invariants (don't reintroduce known bugs)

- **Sibling-resource lookup**: any `find_one` for sibling must require non-null `employee_id` AND `pool_id` AND deterministic `sort=[("created_at", 1), ("_id", 1)]`. Null leak crashes frontend Filters component org-wide. See `.claude/refs/AZURE_OVERLAY.md` + plan § 5.
- **Azure SDK matrix**: bumiworker is fully track-2. Use `azure.identity.ClientSecretCredential` for all native modules — `msrestazure.ServicePrincipalCredentials` lacks `get_token` and breaks modern `azure-mgmt-*` SDKs. The track-1/track-2 split in earlier plan versions is obsolete (see plan § 9 decision #10). Note: upstream `cloud_adapter` still constructs track-1 SPNs (pre-existing upstream bug, not ours to fix).
- **Recommendation tile name match**: ngui registry keyed on bumiworker module **filename** — mismatch silently drops the tile. New module = new ngui tile class with `type` field exactly matching filename.
- **Recommendation tile dual-registration**: new ngui tile must be added to BOTH `allRecommendations.ts` (archive/detail views) AND `useOptscaleRecommendations.ts` (overview page). Missing the hook = tile invisible even when MongoDB has data. `useAllRecommendations` wraps `useOptscaleRecommendations` — adding to the hook propagates everywhere.
- **Recommendation tile title = plain string**: `title` translation key value must be plain text only — `Cards.tsx` renders it via `<FormattedMessage id={r.title} />` with no `values` prop, so HTML tags and ICU plural render as raw text. HTML/ICU/variables are only valid in `descriptionMessageId` keys (which get a `strong` helper + `descriptionMessageValues`).

## Current upstream PRs (as of 2026-05-01)

- **#870** `feat/azure-cold-tier-native` → hystax/optscale:integration — OPEN. Native cold-tier module. Internal fork PR #1 merged to dev.
- **#871** `feat/codex-feedback-loop` → hystax/optscale:integration — OPEN. AGENTS.md + SDK ctor lock + cache isolation tests (Codex review ergonomics).
- **#872** `feat/azure-storage-discovery` → hystax/optscale:integration — OPEN. C2: capture Azure storage account tier metadata on `BucketResource` (access_tier, kind, sku, tracking, lifecycle_policy_present). Internal fork PR #2 merged to dev.
- **#873** `feat/azure-orphan-nics` → hystax/optscale:integration — OPEN. New hygiene-class recommendation: detect Azure NICs with no VM attachment. Complements upstream's multi-cloud `obsolete_ips.py` (public-IP scanning). Internal fork PR #3 merged to dev after 5 Codex review rounds.
- **#874** `feat/azure-abandoned-storage-accounts` → hystax/optscale:integration — OPEN. Native Azure recommendation: idle storage accounts (transactions < threshold over window). Replaces overlay `wrappers/s3_abandoned_buckets.py` (which piggybacked Azure rows under the AWS S3 tile). Internal fork PR #4 merged to dev after 3 Codex review rounds.

### In-flight (awaiting Codex review)
- **Internal PR #5** `feat/recommendation-module-toggle` → msoukhomlinov:dev — OPEN 2026-05-01. Per-org recommendation module enable/disable toggles (Settings tab + bumiworker whitelist gate). Run `land-feature.sh recommendation-module-toggle` once Codex is clean.

When any merges: run `upstream-sync.sh` then `forget-merged.sh <branch>`. See `.claude/memory/upstream_prs_open.md`.

## Skills

- **`optscale-recommendations:add-optscale-recommendation`** — invoke for new recommendation modules; consult for refactors. Encodes 8-round Codex lessons + 2-stage PR + invariants. See `.claude/memory/use_optscale_skill.md` for when-to-use rules.

## Refs (load when relevant — keep CLAUDE.md lean)

- [Architecture map](.claude/refs/ARCHITECTURE.md) — service inventory, key paths, frontend/backend split
- [Build + deploy commands](.claude/refs/BUILD.md) — nerdctl, K3s containerd, helm values
- [Conventions](.claude/refs/CONVENTIONS.md) — code style, commit msgs, PR flow, branch naming
- [Azure overlay legacy](.claude/refs/AZURE_OVERLAY.md) — `/opt/optscale-azure-aliases/` overlay system being deprecated; what's there + how it's being ported native
- [Memory index](.claude/memory/MEMORY.md) — project-scoped persistent notes, cross-session knowledge

## Session-end handover

After every substantial work unit (PR shipped, multi-step task complete, or user signals "what next" / "wrap up"):
1. Sync 7 project docs to reality (CLAUDE.md, plan, AZURE_OVERLAY.md, ARCHITECTURE.md, upstream_prs_open.md, MEMORY.md, candidate_followups.md).
2. Decide next task with user.
3. Mark **NEXT** in plan §8.
4. Overwrite `.claude/memory/next_work.md` with full handover (goal, reading list, workflow steps, pre-empts, branch metadata, open questions, don'ts, retirement instruction).
5. Update MEMORY.md index entry to flag START HERE.

Full pattern: `.claude/memory/handover_pattern.md`. Auto-trigger phrases listed there. Resume in next session via `cat .claude/memory/next_work.md`.

## Auto-maintenance

When making non-trivial changes, update relevant ref file BEFORE finishing turn:

- New service / Dockerfile / build step → `.claude/refs/BUILD.md`
- Branch convention change / new merge gate → `.claude/refs/CONVENTIONS.md`
- New native module ported from overlay → `.claude/refs/AZURE_OVERLAY.md` (mark migrated)
- Architecture-level change (new tier, new external dep) → `.claude/refs/ARCHITECTURE.md`
- Plan/decision change → `/home/iitadmin/optscale-azure-fork-plan.md` (canonical roadmap; locked decisions in § 9)

**Memory rule**: when discovering non-obvious facts (gotchas, schema knowledge, undocumented behavior), save to `.claude/memory/<name>.md` + index entry in `.claude/memory/MEMORY.md`. Project-scoped memory only — cross-project goes to user-level `/home/iitadmin/.claude/projects/-home-iitadmin/memory/`.

**Trigger hint**: user can press `#` mid-session to dump current learnings into CLAUDE.md. The `claude-md-management:revise-claude-md` skill formalizes this — invoke at end of substantial work sessions to refresh CLAUDE.md from session insights.

## Quick commands

Always export KUBECONFIG first (or add to `~/.bashrc`):
```
export KUBECONFIG=/home/iitadmin/.kube/config
```

```
# Build a service into K3s containerd (no registry)
sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io \
  build -t <component>:local -f <component>/Dockerfile .

# Restart deployment after rebuild
kubectl -n default rollout restart deploy/<component>
kubectl -n default rollout status deploy/<component> --timeout=180s
```

Full build + push + deploy details in [.claude/refs/BUILD.md](.claude/refs/BUILD.md).

**Tests / CI**: not yet wired (Phase A blocker per plan § 1). Smoke = manual `python3 -c "import ast; ast.parse(open(p).read())"` for Python, `kubectl rollout status` for deploy verify.

## Don'ts

- Never commit secrets (Azure SPN creds, MongoDB passwords, etc).
- Don't push directly to `prod` — PR or admin merge only.
- Don't bypass tests / hooks (no `--no-verify`).
- Don't write upstream-incompatible code without putting it on `feat/*` branch first (preserves option to PR back).
