# Per-organization recommendation module enable/disable switchboard

**Date:** 2026-04-30
**Status:** Design approved, awaiting implementation plan
**Branch (planned):** `feat/recommendation-module-toggle`
**Cut from:** `integration`
**Path:** A (no upstream-PR dependencies)

## Goal

Per-organization toggle to enable/disable individual recommendation modules. Single ngui Settings page lists all modules with on/off switches; bumiworker scheduler skips disabled modules at dispatch time so disabled modules consume zero API budget.

## Motivation

Customers want to suppress checks irrelevant to their environment (e.g. an Azure-only tenant disabling AWS rightsizing tiles, or a tenant disabling experimental cold-tier rec until they enable last-access-time tracking). Today they can only set thresholds via per-rec SideModal — no way to silence a module entirely. Cuts API spend + clutter.

## Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Option key semantics | **Whitelist** (`enabled_recommendation_modules`) | Explicit opt-in for every module. New upstream modules surface via `WARNING` log so admin reviews before enabling. |
| Bootstrap for existing orgs | **Migration backfill** | Deterministic. Seeds every existing org with **all currently-discovered modules at deploy time** so no user loses any active rec on upgrade. Future upstream-added modules NOT auto-enabled — admin opts in via Settings. |
| Archive scheduler | **Gated with rec** | Disabling rec also gates its archive sweep. Re-enable picks up fresh data on next tick. |
| Tile UI when disabled | **Grey + "Disabled" badge + tooltip with link to Settings** | Discoverable, confirms toggle worked, links back. |
| v1 scope | **Toggle only** | YAGNI. Reset-thresholds + cloud-grouped bulk presets defer to v1.1. |
| Tooltip on greyed tile | **Yes, clickable link** | Self-service discovery. |
| `optscale-recommendations` skill update | **Yes** | Module authors need to know new modules require explicit per-org enablement. |
| Gate location | **Scheduler dispatch filter** in `bumiworker/tasks.py` | Zero runtime cost for disabled. Single chokepoint. |

## Architecture

Three layers:

1. **Persistence** — reuse existing `OrganizationOption` table (verified at `rest_api/rest_api_server/models/models.py:1007`). NO schema migration. Option key `enabled_recommendation_modules`, JSON value `{"types": ["azure_abandoned_storage_accounts", "obsolete_ips", ...]}`. One-shot data migration backfills all existing orgs at deploy.
2. **Backend gate** — `bumiworker/tasks.py` scheduler reads option once per tick, intersects with `list_modules('recommendations')` discovery, dispatches enabled only. Same gate applies to archive scheduler at `bumiworker/bumiworker/modules/archive/`.
3. **Frontend** — new ngui Settings page `/settings/recommendation-modules` lists every discovered module with toggle. PATCH via existing org-options REST. Overview tiles for disabled modules render grey + "Disabled" badge + tooltip linking back to Settings.

## Components

### Backend

- **`rest_api/rest_api_server/controllers/organization_options.py`** — extend with validator hook for key `enabled_recommendation_modules`:
  - Validate JSON shape `{"types": [str, ...]}`
  - Cross-check `types` ⊆ `list_modules('recommendations')` discovery
  - Reject unknown module names with HTTP 400 (catches typos that would silently enable nothing)
- **`bumiworker/bumiworker/modules/module.py`** — add `list_enabled_modules(organization_id, kind='recommendations')` helper:
  - Read option, intersect with discovery, return enabled set
  - Stale entries (option lists removed module) → log `WARNING` once per scheduler-load, skip; other modules unaffected
- **`bumiworker/bumiworker/tasks.py`** — call helper at scheduler dispatch (rec scheduler + archive scheduler):
  - Log `INFO module=<X> skipped (not enabled by org option)` at default log level (NOT DEBUG — support needs default visibility)
- **Migration script** — one-shot post-deploy:
  - Iterate `Organization` collection
  - For every org without `enabled_recommendation_modules` option row → write row with full discovered module list
  - Existing rows untouched (idempotent)
  - Logs count: backfilled / skipped

### Frontend

- **`ngui/ui/src/components/Settings/RecommendationModules.tsx`** (new):
  - List source: `useOptscaleRecommendations({ withDeprecated: true })` — same hook tiles use
  - Render `title` translation key + Material-UI `Switch` per module
  - Save button assembles full enabled list, PATCHes option
- **`ngui/ui/src/components/RecommendationCard/Cards.tsx`** (extend):
  - Add disabled-state branch: grey wrapper + `<Badge>Disabled</Badge>` + `<Tooltip>` with link to `/settings/recommendation-modules`
- **Route registration** in router config + nav entry under existing Settings menu
- **i18n** — add keys to `ngui/ui/src/translations/en-US/app.json` (alphabetical position):
  - Page title, save-success toast, validation errors
  - "Disabled" badge text, tooltip text, link label

## Data flow

### Toggle write path

1. User flips switch in Settings page
2. Frontend assembles full enabled list (current option + diff)
3. PATCH `/organizations/{id}/options/enabled_recommendation_modules` with body `{"value": {"types": [...]}}`
4. Controller validator: parse JSON → check shape → cross-check types against `list_modules('recommendations')` discovery → reject unknowns 400
5. `OrganizationOption` row updated; existing audit hook fires
6. Frontend toast on success; on 400, show validation error inline

### Scheduler read path (per tick)

1. `tasks.py` scheduler tick begins per-org loop
2. Per-org: `list_enabled_modules(org_id)` reads option → intersects with discovery → returns enabled set
3. Stale option entries (rec was removed upstream) → `WARNING module=X in option but not discovered, skipped`
4. Discovered-but-not-in-option modules → `INFO module=X skipped (not enabled by org option)`
5. Dispatch loop runs only enabled set. Same flow for archive scheduler.

### Race vs reconcile

Disable mid-flight = next tick gates it. In-flight execution completes (don't half-emit rows). Gate fires only at scheduler dispatch, never inside `_get`.

### Migration flow (one-shot post-deploy)

**Intent: zero-disruption upgrade.** Every existing module stays enabled for every existing org. Whitelist semantics only kick in for modules added AFTER this deploy.

1. Script iterates `Organization` collection
2. For each org without `enabled_recommendation_modules` option row → write row with **the full set of recommendation modules discovered at deploy time** (= every module currently shipping in this build)
3. Existing rows untouched (idempotent — orgs already on a new build that re-runs migration unchanged)
4. Logs count: backfilled / skipped
5. **Post-migration invariant:** any module added by future upstream merge will NOT be present in any org's option row → scheduler logs `INFO module=X skipped (not enabled by org option)` → admin enables via Settings page

## Error handling

### REST validation

- Malformed JSON → HTTP 400 "value must be JSON object with `types` array of strings"
- Unknown module name → HTTP 400 "unknown module: `<X>`. Valid: `<sorted discovered list>`"
- Empty `types` array → ACCEPTED (means: all modules disabled). UI confirmation modal required before submit.
- Permissions: PATCH requires same role as existing org-options PATCH (likely `EDIT_PARTNER`). Read available to all org members so Settings page renders.

### Scheduler robustness

- Option read fails (Mongo down) → fail-closed for that org tick + log `ERROR`. Better to skip a tick than dispatch wrong set.
- `list_modules` discovery fails → existing scheduler error path applies; do not introduce new failure mode
- Disabled module logging is `INFO` not `DEBUG`. Support needs default-level visibility for "why is tile empty?"
- Stale option entry (rec removed upstream) → `WARNING` once per scheduler-load (not per tick — log noise). Self-healing on next deploy

### Frontend safeguards

- Bulk "Disable all" → confirmation modal "This will silence ALL recommendation modules. Continue?"
- Save button disabled until diff exists
- Optimistic update + rollback on PATCH failure

## Critical invariants (block PR if violated)

- **Default = whitelist enforced.** Migration MUST run pre-first-scheduler-tick post-deploy. Document deploy order in PR body.
- **Module identity = bumiworker filename** (matches existing `type` field invariant).
- **Gate at dispatch only, never inside `_get`** (preserves zero-cost-when-disabled property).
- **Archive scheduler symmetry** — same gate applies.
- **Audit trail on every PATCH** (existing `OrganizationOption` mutator hook).
- **Silent-skip vs silent-failure distinction.** Skipped module logs `INFO` line `module=<X> skipped (not enabled by org option)` so support can answer "why is tile empty?" without grep-spelunking.
- **Module discovery as source of truth.** REST validation rejects unknown module names by cross-checking `list_modules('recommendations')`.
- **No bulk toggle without confirmation** (UI requires modal before "Disable all").
- **Per-cloud-account scoping is OUT OF SCOPE for v1.** This is per-org. Per-CA users use existing `skip_cloud_accounts` per-rec option.

## Testing

### Backend unit tests

`rest_api/rest_api_server/tests/test_organization_options.py` (extend):
- PATCH `enabled_recommendation_modules` with valid types → 200, persisted
- PATCH unknown module name → 400 with valid-list hint
- PATCH malformed JSON → 400
- PATCH empty types list → 200 (all-disabled allowed)
- GET returns option correctly
- Permission: non-`EDIT_PARTNER` PATCH → 403

`bumiworker/bumiworker/modules/tests/test_module_gating.py` (new):
- `list_enabled_modules` returns intersection of option + discovery
- Missing option row → returns empty set (post-migration this never happens; defensive only)
- Stale entry in option (not in discovery) → logged WARNING, skipped, other modules unaffected
- Discovered-but-not-enabled → logged INFO, skipped
- Mongo read failure → raises (fail-closed)

### Migration test

- Org without option row → backfilled with full discovered list
- Org with existing option row → untouched
- Idempotent (run twice = same state)

### Manual smoke (Phase 7)

Test URL: https://192.168.230.145/settings/recommendation-modules

- Toggle `azure_abandoned_storage_accounts` off → trigger scheduler → verify no new rows in `recommendations` collection for that module + INFO log present
- Toggle on → next tick → rows return
- Disable all → confirmation modal appears → confirm → all tiles grey
- Frontend tile grey + badge + tooltip + link works

### QA agents (Phase 8)

Three parallel reviewers:
- `pr-review-toolkit:code-reviewer` (full diff)
- `pr-review-toolkit:silent-failure-hunter` (new gate is exactly the kind of "silent skip" risk this catches)
- `pr-review-toolkit:type-design-analyzer` (option JSON shape + REST validation)

## Files (planned)

### New backend

- `rest_api/rest_api_server/tests/test_organization_options.py` (extend existing)
- `bumiworker/bumiworker/modules/tests/test_module_gating.py` (new)
- Migration script under existing migration framework (path TBD per architect blueprint)

### Modified backend

- `rest_api/rest_api_server/controllers/organization_options.py`
- `bumiworker/bumiworker/modules/module.py`
- `bumiworker/bumiworker/tasks.py`

### New frontend

- `ngui/ui/src/components/Settings/RecommendationModules.tsx`
- Route registration in router config
- Nav entry under Settings menu

### Modified frontend

- `ngui/ui/src/components/RecommendationCard/Cards.tsx` (or equivalent — disabled-state branch)
- `ngui/ui/src/translations/en-US/app.json` (i18n keys)

## Out of scope

- Per-cloud-account scoping (use existing `skip_cloud_accounts` per-rec option)
- Reset-thresholds-to-default button (v1.1 candidate)
- Cloud-grouped bulk presets ("disable all AWS") (v1.1 candidate)
- Threshold customization UI changes (existing per-rec SideModal unchanged)

## Commit prefix

`feat(rest_api,bumiworker,ngui): add per-org recommendation module enable/disable`

## Phase 11 follow-up tasks

- Update `optscale-recommendations` skill body — note new modules require explicit per-org enablement post-deploy
- Update plan §5/§8 — add work item entry (non-recommendation feature, document differently from native-module ports)
- Update CLAUDE.md "Critical invariants" if new ones emerge from review
- Update `MEMORY.md` index
- Mark Option A retrofit as superseded in `candidate_followups.md` (B subsumes it), OR queue Option A as fallback for tile-level threshold-disable that B doesn't cover
