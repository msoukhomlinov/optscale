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
| Option key semantics | **Whitelist** (`enabled_recommendation_modules`) | Explicit opt-in for every module once an org has touched Settings. |
| Bootstrap for existing orgs | **Lazy default — absent option row = all enabled** | No deploy-order invariant, no migration race. Whitelist semantics apply only after first user save. Existing orgs auto-pass; first save creates row and locks-in current set. |
| Archive scheduler | **Gated with rec (free via class hierarchy)** | `InitializeArchive` inherits the same `list_modules` override → archive symmetry comes for free. |
| Tile UI when disabled | **Grey + "Disabled" badge + tooltip with link to Settings** | Discoverable, confirms toggle worked, links back. |
| v1 scope | **Toggle only** | YAGNI. Reset-thresholds + cloud-grouped bulk presets defer to v1.1. |
| Tooltip on greyed tile | **Yes, clickable link** | Self-service discovery. |
| `optscale-recommendations` skill update | **Yes** | Module authors need to know new modules require explicit per-org enablement (after first user save). |
| Gate location | **Override `InitializeChildrenBase.list_modules` in `bumiworker/tasks.py`** (line 277) | Layers per-org whitelist over existing global `disabled_recommendations` filter. Single chokepoint inherited by `InitializeChecklist`, `InitializeService`, `InitializeArchive`. |
| Filter composition | **`enabled_set = (discovered \ global_disabled) ∩ org_whitelist_or_all`** | Reuses existing `config_cl.disabled_recommendations()` global filter; per-org whitelist layered on top. |
| Update model | **Direct per-toggle PATCH** | Simpler than batched-save-with-diff. One PATCH per switch flip. No diff state, no save button. |

## Architecture

Three layers:

1. **Persistence** — reuse existing `OrganizationOption` SQL table (`rest_api/rest_api_server/models/models.py:1007`, MariaDB via SQLAlchemy). NO schema migration. Option key `enabled_recommendation_modules`, `value` column stores JSON **string** `{"types": ["azure_abandoned_storage_accounts", "obsolete_ips", ...]}` (matches existing storage convention — see `controllers/organization_options.py:57` `json.loads(options[0].value)`). **No data migration required** (lazy default; absent row = all enabled).
2. **Backend gate** — override `InitializeChildrenBase.list_modules` at `bumiworker/bumiworker/tasks.py:277`. Per-org-per-tick: fetch option via existing `self.rest_cl.organization_options_*` REST → `json.loads` → compute `enabled = (discovered \ global_disabled) ∩ org_whitelist_or_all`. Same override applies to `InitializeChecklist`, `InitializeService`, `InitializeArchive` via class inheritance — archive symmetry free. Existing `Process._execute` (line 530) `disabled_recommendations` check stays as defence-in-depth (does NOT need per-org awareness because dispatch-time filter already gated).
3. **Frontend** — new ngui Settings page `/settings/recommendation-modules` lists every discovered module with toggle. Direct per-toggle PATCH via existing org-options REST. When org option row exists AND a module is not in `types`, the overview tile renders grey + "Disabled" badge + tooltip linking back to Settings (pre-first-save: tiles render normally per lazy default). Discovery banner on Settings page when `discovered ⊋ stored.types` ("N new modules available — review and enable").

## Components

### Backend

- **`rest_api/rest_api_server/controllers/organization_options.py`** — extend `OrganizationOptionsController.patch()` (line 47) with per-name validator dispatch:
  - Add module-level constant: `KEY_VALIDATORS = {"enabled_recommendation_modules": _validate_enabled_modules}`
  - In `patch()`, before `super().create/update`, lookup `KEY_VALIDATORS.get(name)` and invoke if present.
  - `_validate_enabled_modules(value_str)`: `json.loads(value_str)` → check shape `{"types": [str, ...]}` → cross-check `types ⊆ list_modules('recommendations')` discovery → raise `WrongArgumentsException` (existing pattern) on mismatch with message including sorted valid list.
  - Reject malformed JSON with HTTP 400 + clear message.
- **`bumiworker/bumiworker/tasks.py`** — modify `InitializeChildrenBase.list_modules` (line 277):
  - After existing `discovered \ global_disabled` filter, layer per-org whitelist.
  - Fetch option once per tick per org via existing `self.rest_cl` org-options method (Phase-0 verify exact method name in `optscale_client/rest_api_client/`). Cache result for current invocation.
  - Absent option row → return existing-filter result unchanged (lazy default).
  - Present option → `json.loads` → intersect with current filtered set.
  - Modules in option but not in `discovered`: log `WARNING module=X stale (in option, not discovered)` once per scheduler-load (de-dupe via in-memory set on Initialize instance).
  - Modules in `discovered` but not in option (when option exists): log `INFO module=X skipped (not enabled by org option)`.
  - REST/SQL fetch fails → log `ERROR option fetch failed for org=Y`, skip this org's tick (do not dispatch on stale assumption).
- **`bumiworker/bumiworker/modules/module.py`** — no change needed; gate lives in `tasks.py`.
- **No migration script.** Lazy default eliminates need for backfill.

### Frontend

- **`ngui/ui/src/components/Settings/RecommendationModules.tsx`** (new):
  - **Phase-0 verification required:** confirm `useOptscaleRecommendations` hook signature in `ngui/ui/src/hooks/useOptscaleRecommendations.ts`. If `withDeprecated` arg supported, use it. Otherwise source list directly from `allRecommendations.ts` (canonical registry per CLAUDE.md "tile dual-registration" invariant).
  - Render `title` translation key + Material-UI `Switch` per module
  - **Direct per-toggle PATCH:** flipping a switch immediately PATCHes option with the new full list (current state ± toggled module). No save button, no diff state, no batched submit.
  - Optimistic local state update; rollback on PATCH failure with toast.
  - **Discovery banner:** when `discovered ⊋ stored.types` (i.e. upstream added modules not yet acknowledged) render banner at top: "N new modules available — review and enable." Banner dismissible per-session but reappears next visit until enabled or rejected. Visible only when option row exists (post-first-save).
  - **"Disable all" UX guard:** show confirmation modal before allowing the final toggle that empties `types`.
- **`ngui/ui/src/components/RecommendationCard/Cards.tsx`** (extend):
  - Add disabled-state branch: grey wrapper + `<Badge>Disabled</Badge>` + `<Tooltip>` with link to `/settings/recommendation-modules`
  - "Disabled" applies when org option row exists AND module not in `types`. Pre-first-save (no row): all tiles render normally per lazy default.
- **Route registration** in router config + nav entry under existing Settings menu
- **i18n** — add keys to `ngui/ui/src/translations/en-US/app.json` (alphabetical position):
  - Page title, validation errors, optimistic-rollback toast
  - "Disabled" badge text, tooltip text, link label
  - Discovery banner text + plural form
  - "Disable all" confirmation modal text

## Data flow

### Toggle write path

1. User flips switch in Settings page.
2. Frontend computes new `types` list from current state ± toggled module (full list, not diff).
3. PATCH `/organizations/{id}/options/enabled_recommendation_modules` with body `{"value": "<json-string of {\"types\": [...]}>"}` (matches existing storage convention — `value` is JSON string in DB).
4. `OrganizationOptionsController.patch()` looks up `KEY_VALIDATORS["enabled_recommendation_modules"]` → `_validate_enabled_modules` parses JSON, checks shape, cross-checks against `list_modules('recommendations')` discovery → raises `WrongArgumentsException` (HTTP 400) on mismatch.
5. `OrganizationOption` row inserted/updated via existing upsert path; existing audit hook fires.
6. Frontend optimistic update confirmed; on 400, rollback + show error toast.

### Scheduler read path (per tick, per org)

1. `tasks.py` scheduler `Initialize*` instance constructed for org.
2. Inside overridden `list_modules`: existing global filter computes `discovered \ global_disabled` (per `config_cl.disabled_recommendations()`).
3. Fetch option once: `self.rest_cl.organization_option_get(org_id, "enabled_recommendation_modules")`. Cache in instance attr for current invocation.
4. **Absent option row** → return existing-filter result unchanged (lazy default, all enabled). No additional logging.
5. **Present option** → `json.loads(value)` → `whitelist = set(parsed["types"])`.
   - `enabled = (discovered_minus_global_disabled) ∩ whitelist`
   - Modules in `whitelist` but not in `discovered`: log `WARNING module=X stale (in option, not discovered)` once per scheduler-load (de-duped via instance set).
   - Modules in `discovered_minus_global_disabled` but not in `whitelist`: log `INFO module=X skipped (not enabled by org option)`.
6. **Fetch fails** (REST/SQL down) → log `ERROR option fetch failed for org=Y` and return empty set (skip this org's tick — do not dispatch on stale assumption).
7. Same flow inherited by `InitializeChecklist`, `InitializeService`, `InitializeArchive` — archive symmetry free.
8. `Process._execute` (line 530) keeps existing global `disabled_recommendations` defence-in-depth check unchanged. Per-org awareness not added there (would be redundant; dispatch-time filter is authoritative).

### Race vs reconcile

Toggle mid-flight = next tick reflects new state. In-flight execution completes (don't half-emit rows). Gate fires only at `list_modules` time, never inside `_get`.

### Bootstrap (lazy default — no migration script)

**Intent: zero-disruption upgrade with no deploy-order dependency.**

- Pre-deploy: orgs have no `enabled_recommendation_modules` option row.
- Post-deploy: orgs continue running ALL discovered modules (lazy default = all enabled).
- First user save in Settings → option row created with currently-toggled-on set. From this point forward, whitelist enforced for that org.
- **No migration script.** No deploy-order invariant. No race vs running scheduler.
- Trade-off (acknowledged): orgs that NEVER touch Settings continue auto-enabling future upstream modules. Discovery banner only appears for orgs with row.

## Error handling

### REST validation

- Malformed JSON → HTTP 400 "value must be JSON object with `types` array of strings"
- Unknown module name → HTTP 400 "unknown module: `<X>`. Valid: `<sorted discovered list>`"
- Empty `types` array → ACCEPTED (means: all modules disabled). UI confirmation modal required before final-toggle submit.
- Permissions:
  - PATCH requires `EDIT_PARTNER` (handler line 194 — verified)
  - GET requires `INFO_ORGANIZATION` (handler line 65 — verified)

### Scheduler robustness

- Option fetch fails (REST/SQL unreachable) → log `ERROR option fetch failed for org=Y`, skip this org's tick. Note: REST is already on critical scheduler path (org listing) — option-fetch outage implies tick is already dead, so this just prevents dispatch on stale assumption.
- `list_modules` discovery fails → existing scheduler error path applies; do not introduce new failure mode.
- Skipped module logging is `INFO` not `DEBUG`. Support needs default-level visibility for "why is tile empty?"
- Stale option entry (rec removed upstream) → `WARNING` once per scheduler-load via instance-level de-dupe set (not per tick — log noise). Self-healing on next deploy.

### Frontend safeguards

- Final toggle that empties `types` → confirmation modal "This will silence ALL recommendation modules. Continue?"
- Optimistic per-toggle update + rollback toast on PATCH failure
- Banner dismissal is per-session only — does not write to backend

## Critical invariants (block PR if violated)

- **Lazy default semantic.** Absent option row = ALL discovered modules enabled (no whitelist enforcement). Whitelist applies only when row exists. No migration, no deploy-order invariant.
- **Filter composition order.** `enabled = (discovered \ global_disabled) ∩ org_whitelist_or_all`. Existing `config_cl.disabled_recommendations()` global filter must NOT be bypassed by per-org whitelist (a module globally disabled stays disabled even if listed in org option).
- **Module identity = bumiworker filename** (matches existing `type` field invariant).
- **Gate at `InitializeChildrenBase.list_modules` only**, never inside `_get` (preserves zero-cost-when-disabled property). `Process._execute` defence-in-depth check stays as-is (global only, no per-org awareness).
- **Archive scheduler symmetry** — comes free via class inheritance; do NOT add a separate gate.
- **Tile dual-registration honored** (CLAUDE.md invariant). Settings page list source must match canonical `allRecommendations.ts` registry; verify hook signature in Phase 0 before committing implementation.
- **JSON storage convention.** `OrganizationOption.value` is stored as JSON **string**, parsed via `json.loads` at read sites. Validator must `json.loads` first.
- **Audit trail on every PATCH** (existing `OrganizationOption` mutator hook).
- **Silent-skip vs silent-failure distinction.** Skipped module logs `INFO` line `module=<X> skipped (not enabled by org option)` so support can answer "why is tile empty?" without grep-spelunking. Stale option entries log `WARNING` once per scheduler-load.
- **Module discovery as source of truth.** REST validation rejects unknown module names by cross-checking `list_modules('recommendations')`.
- **No bulk-empty toggle without confirmation** (UI requires modal before final toggle that empties `types`).
- **Discovery surfaced via UI banner**, not log-grep. New upstream modules trigger banner on Settings page when `discovered ⊋ stored.types`.
- **Per-cloud-account scoping is OUT OF SCOPE for v1.** This is per-org. Per-CA users use existing `skip_cloud_accounts` per-rec option.

## Testing

### Backend unit tests

`rest_api/rest_api_server/tests/test_organization_options.py` (extend):
- PATCH `enabled_recommendation_modules` with valid types → 200, persisted as JSON string
- PATCH unknown module name → 400 with valid-list hint in error message
- PATCH malformed JSON → 400
- PATCH wrong shape (e.g. `["foo"]` instead of `{"types": ["foo"]}`) → 400
- PATCH empty types list → 200 (all-disabled allowed)
- GET returns option correctly (with role `INFO_ORGANIZATION`)
- Permission: PATCH without `EDIT_PARTNER` → 403
- Permission: GET without `INFO_ORGANIZATION` → 403

`bumiworker/bumiworker/tests/test_initialize_children_gating.py` (new):
- Override of `list_modules` returns `(discovered \ global_disabled) ∩ whitelist` when option row exists
- Absent option row → returns `discovered \ global_disabled` unchanged (lazy default — all enabled)
- Stale entry in option (not in discovery) → logged WARNING once per Initialize instance, skipped, other modules unaffected
- Module in `discovered \ global_disabled` but not in whitelist → logged INFO `not enabled by org option`, skipped
- Module in whitelist but globally disabled → still excluded (global filter wins)
- Option fetch fails → logged ERROR, returns empty set, scheduler tick skipped for this org
- `InitializeArchive` inherits override and applies same filter (verify via class hierarchy test)

### Manual smoke (Phase 7)

Test URL: https://192.168.230.145/settings/recommendation-modules

Pre-test state: existing dev org has no option row (lazy default — all enabled). Verify all tiles show normal.

- Open Settings page → all modules listed with Switch ON (initial state derived from "all enabled" lazy default).
- Flip `azure_abandoned_storage_accounts` OFF → PATCH fires → option row created with full list minus that one.
- Wait scheduler tick → verify no new rows in `recommendations` collection for that module + INFO log line present.
- Overview page: tile for that module shows grey + "Disabled" badge + tooltip with link works.
- Click tooltip link → returns to Settings page.
- Flip back ON → next tick → rows return + tile renders normally.
- Toggle every module off one-by-one → final toggle (the one that empties list) → confirmation modal appears.
- Simulate stale entry: manually add `nonexistent_module` to option via DB → next scheduler-load → WARNING logged once.
- Simulate new upstream module: add fake module file → reload Settings page → discovery banner appears with count.

## Files (planned)

### New backend

- `bumiworker/bumiworker/tests/test_initialize_children_gating.py` (new)

### Modified backend

- `rest_api/rest_api_server/controllers/organization_options.py` (validator dispatch table + `_validate_enabled_modules`)
- `bumiworker/bumiworker/tasks.py` (override `InitializeChildrenBase.list_modules`; archive symmetric via inheritance)
- `rest_api/rest_api_server/tests/test_organization_options.py` (extend existing tests)

### No migration script

Lazy default eliminates need.

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

- Update `optscale-recommendations` skill body — note new modules require explicit per-org enablement after first user save (lazy-default semantic)
- Update plan §5/§8 — add work item entry (non-recommendation feature, document differently from native-module ports)
- Update CLAUDE.md "Critical invariants" if new ones emerge from review
- Update `MEMORY.md` index
