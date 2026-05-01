---
name: next_work
description: START HERE — feat/recommendation-module-toggle awaiting Codex review on internal PR #5; then land-feature.sh
type: project
date: 2026-05-01
---

## Goal

`feat/recommendation-module-toggle` is fully implemented, 4-agent QA-clean, and pushed. Internal fork PR #5 (`msoukhomlinov:feat/recommendation-module-toggle → msoukhomlinov:dev`) is OPEN awaiting Codex review.

**Immediate next action**: check PR #5 Codex feedback, fix if needed, then run `land-feature.sh`.

## Reading list

- `CLAUDE.md` — branch rules, invariants, current PR status
- `.claude/memory/upstream_prs_open.md` — PR #5 status + all open upstream PRs
- `docs/superpowers/plans/2026-04-30-recommendation-module-toggle.md` — feature plan (reference)

## Step 1 — check PR #5 Codex status

```bash
gh pr view 5 --repo msoukhomlinov/optscale --comments
```

If Codex found issues: fix on `feat/recommendation-module-toggle`, commit (user attribution only), push.

## Step 2 — land to dev + open upstream PR

Once Codex is satisfied with PR #5:

```bash
cd /home/iitadmin/optscale-fork

# Write upstream PR body first
cat > /tmp/up-pr-rec-module-toggle.md << 'BODY'
## What

Per-org recommendation module enable/disable toggles. Operators can whitelist which bumiworker recommendation modules run for each organisation via a new Settings page tab.

### Backend
- `enabled_recommendation_modules` org-option key (`{"types": [...]}` JSON string). `'{}'` = absent row = all enabled (lazy default).
- Validator: unknown/duplicate/malformed-JSON all caught with OE0217. Discovery cross-check prevents accepting phantom modules in a broken container.
- `InitializeChildrenBase.list_modules` override: instance-lifetime cache, `_UNSET`/`_FETCH_FAILED` sentinels, whitelist ∩ globally-enabled filter. Fail-closed on fetch/parse error (logs traceback via LOG.exception, returns `[]`).
- `rest_api/Dockerfile`: minimal bumiworker COPY for module discovery inside restapi container.

### Frontend
- `useRecommendationModulesOption` hook — fetches/updates org option, returns `{isLoading, optionRowExists, enabledTypes, fetchOption, updateTypes}`.
- `RecommendationModulesSettings` component — per-module Switch list, discovery banner, "disable all" confirmation dialog.
- Settings page gains "Recommendation Modules" tab.
- `RecommendationsOverview`/`Cards`: disabled tiles rendered greyed (opacity 0.5) with "Disabled" Chip badge.

### Also fixed (pre-existing bug)
- `rest_api/server.py`: `etcd.EtcdKeyNotFound` crash on startup when `/restapi/opentelemetry` key absent.

## Why

Operators running OptScale in environments with Azure-specific modules (e.g., `azure_orphan_nics`, `azure_abandoned_storage_accounts`) need to suppress noisy or inapplicable modules per org without touching global config.

## Tests

- 11 bumiworker gating unit tests (`test_initialize_children_gating.py`)
- 7 REST validator unit tests (`test_organization_options_api.py`)
- Manual K3s smoke test: Settings tab visible, toggles persist, bumiworker skips disabled modules next cycle
BODY

./.claude/scripts/land-feature.sh recommendation-module-toggle \
  --title "feat: per-org recommendation module enable/disable toggles" \
  --body-file /tmp/up-pr-rec-module-toggle.md
```

## Step 3 — redeploy after dev merge

After `land-feature.sh` merges dev:

```bash
export KUBECONFIG=/home/iitadmin/.kube/config
# Rebuild bumiworker + restapi (both changed)
sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io \
  build -t bumiworker:local -f bumiworker/Dockerfile .
kubectl -n default rollout restart deploy/bumiworker
sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io \
  build -t restapi:local -f rest_api/Dockerfile .
kubectl -n default rollout restart deploy/restapi
# ngui only if not already deployed from feat branch
```

## Step 4 — next feature

Plan §8 lists candidates. `azure_unattached_managed_disks` was deferred until this feature lands.

## Branch metadata

- Branch: `feat/recommendation-module-toggle`
- Last commit: `7103d8c0` fix: harden fetch-failure paths and guard json.loads
- Internal PR: msoukhomlinov/optscale#5 (OPEN)
- Upstream PR: not yet opened (land-feature.sh does this)

## Key implementation gotchas

- `enabled_recommendation_modules` stores JSON string (not dict); `'{}'` = absent row
- `json.loads` in `_fetch_enabled_modules_whitelist` is guarded; corrupt → `_FETCH_FAILED`
- `LOG.exception` (not `LOG.error`) preserves traceback
- `make_app(otel_config=None)` honours the param; only fetches etcd if param is None
- ngui hook: `rawValue === '{}'` → `optionRowExists=false` → `enabledTypes=null`

## Don'ts

- Don't merge feat branch to dev manually — `land-feature.sh` also opens upstream PR atomically
- Don't open upstream PR manually — idempotency is in `land-feature.sh`
- User attribution only — no Claude/AI/Anthropic in commits/PRs

## Open issue: /v2/invites 500

Login failure was investigated but not resolved. Traced: `GET /restapi/v2/invites → invites.py:get_user_info → GET /auth/v2/users/{id} → 500`. Auth side: `get_downward_hierarchy → auth_hierarchy_get → GET /restapi/v2/auth_hierarchy?type=root → 400 "scope_id is not provided"`. May be pre-existing upstream bug triggered by restapi pod restart. Investigate `auth/auth_server/controllers/base.py:get_downward_hierarchy` and restapi's `auth_hierarchy` handler if login is still broken.

## Retirement

Overwrite this file after `land-feature.sh` completes and upstream PR is open.
