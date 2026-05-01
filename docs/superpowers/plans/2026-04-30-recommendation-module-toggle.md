# Per-organization recommendation module enable/disable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-organization toggle to enable/disable recommendation modules. ngui Settings tab lists modules with switches; bumiworker scheduler skips disabled modules at dispatch time so disabled modules consume zero API budget.

**Architecture:** Three layers — (1) reuse `OrganizationOption` SQL row keyed `enabled_recommendation_modules` with JSON-string value `{"types": [...]}`; (2) backend validator dispatch in `OrganizationOptionsController.patch()` cross-checks types against `list_modules('recommendations')` discovery; (3) override `InitializeChildrenBase.list_modules` in `bumiworker/tasks.py` to layer per-org whitelist over existing global filter. Lazy default: absent option row = all enabled, no migration script. Frontend: new tab in existing tabbed Settings page with per-toggle PATCH; disabled tiles render greyed with tooltip linking back to Settings.

**Tech Stack:** Python 3 (rest_api Tornado controllers, bumiworker scheduler, SQLAlchemy on MariaDB), TypeScript/React 18 + Material-UI + react-intl (ngui), pytest backend tests, vitest+RTL frontend.

**Spec:** `docs/superpowers/specs/2026-04-30-recommendation-module-toggle-design.md` (commit `12930818`).

**Branch:** `feat/recommendation-module-toggle` cut from `integration` (Path A — no upstream-PR dependencies).

---

## Phase 0 — Verifications already done

These were verified during spec writing and re-verified at plan-write time. No action — informational only.

| Item | Verified location |
|---|---|
| `InitializeChildrenBase.list_modules` | `bumiworker/bumiworker/tasks.py:277` |
| `InitializeArchive(InitializeService)` chain | `bumiworker/bumiworker/tasks.py:473` (inherits override free) |
| `OrganizationOptionsController.patch()` | `rest_api/rest_api_server/controllers/organization_options.py:47` |
| `WrongArgumentsException` import + pattern | `rest_api/rest_api_server/controllers/organization_options.py:31, 51` |
| PATCH `EDIT_PARTNER` guard | `rest_api/rest_api_server/handlers/v2/organization_options.py:194` |
| GET `INFO_ORGANIZATION` guard | `rest_api/rest_api_server/handlers/v2/organization_options.py:65, 123` |
| `value` reaches `patch()` as JSON string | `controllers/organization_options.py:57` (`json.loads(options[0].value)`) |
| `useOptscaleRecommendations({withDeprecated:true})` signature | `ngui/ui/src/hooks/useOptscaleRecommendations.ts:41` (returns dict keyed by `type`) |
| `rest_cl.organization_option_get` | `optscale_client/rest_api_client/client_v2.py:906` |
| `rest_cl.organization_option_update` | `optscale_client/rest_api_client/client_v2.py:910` |
| `Cards.tsx` actual path | `ngui/ui/src/containers/RecommendationsOverviewContainer/Cards/Cards.tsx` (NOT `components/RecommendationCard/Cards.tsx` — spec was wrong) |
| Settings page is tab-based, not route-based | `ngui/ui/src/pages/Settings/Settings.tsx` uses `?tab=...` query param + `SETTINGS_TABS` enum at `utils/constants.ts:1047` |
| Empty-modules handling (no abort) | `bumiworker/bumiworker/tasks.py:318-321` (checklist) + `:464-470` (service) |
| `SETTINGS_TABS` enum location | `ngui/ui/src/utils/constants.ts:1047-1054` |

**Locked design clarifications (resolved during planning):**

- **Settings location** — new tab `recommendationModules` added to `SETTINGS_TABS` enum in `utils/constants.ts`, registered in existing `Settings.tsx` tabbed page. URL becomes `/settings?tab=recommendationModules`. Spec mentioned `/settings/recommendation-modules` — that pattern doesn't exist; use the existing tab pattern instead.
- **Cards.tsx path** — `containers/RecommendationsOverviewContainer/Cards/Cards.tsx` (not `components/RecommendationCard/Cards.tsx`). The latter doesn't exist. `RecommendationCard.tsx` is the generic primitive; `Cards.tsx` consumes `BaseRecommendation` instances from `useOptscaleRecommendations`.
- **Disabled-state plumbing** — pass `disabledModuleTypes: Set<string>` prop from `RecommendationsOverview.tsx` (which already calls the hook) down to `Cards.tsx`. `RecommendationsOverview.tsx` fetches the option via existing redux/api machinery and computes the disabled set.
- **Error codes** — use `Err.OE0217` ("Invalid %s") for unknown module name, `Err.OE0219` ("%s should be a string with valid JSON") for malformed JSON, `Err.OE0214` ("%s should be a string") for malformed shape.

---

## Task 0: Cut feature branch

**Files:**
- None directly. Branch operation only.

- [ ] **Step 1: Verify on `dev` and clean tree**

```bash
cd /home/iitadmin/optscale-fork
git status
git branch --show-current
```

Expected: clean tree, on `dev`. If dirty, stash or commit before proceeding.

- [ ] **Step 2: Sync upstream**

```bash
.claude/scripts/upstream-sync.sh
```

Expected: `integration` updated to upstream HEAD; no merge conflicts.

- [ ] **Step 3: Cut feature branch from `integration`**

```bash
.claude/scripts/start-feature.sh recommendation-module-toggle
```

Expected: now on `feat/recommendation-module-toggle`, branched from current `integration` HEAD.

- [ ] **Step 4: Verify branch**

```bash
git log --oneline -1
git branch --show-current
```

Expected: branch `feat/recommendation-module-toggle`; HEAD matches `integration` HEAD.

---

## Task 1: Backend — add error codes if missing

**Files:**
- Verify: `rest_api/rest_api_server/exceptions.py`

- [ ] **Step 1: Check existing error codes**

```bash
grep -n "OE0217\|OE0219\|OE0214" rest_api/rest_api_server/exceptions.py
```

Expected: all three already present (verified during planning). If any missing, STOP and ask before adding.

No commit at this step — verification only.

---

## Task 2: Backend — add `_validate_enabled_modules` helper + dispatch table

**Files:**
- Modify: `rest_api/Dockerfile`
- Modify: `rest_api/rest_api_server/controllers/organization_options.py`
- Test: `rest_api/rest_api_server/tests/unittests/test_organization_options_api.py`

- [ ] **Step 0: Add bumiworker module discovery files to rest_api Docker image**

`rest_api/Dockerfile` does not COPY bumiworker. The validator uses `list_modules('recommendations')` which globs bumiworker's recommendations directory. Add the minimal COPY lines to make the import path resolvable inside the image.

Open `rest_api/Dockerfile` and add after the existing `COPY optscale_client ...` line and before `COPY rest_api/...` lines:

```dockerfile
COPY bumiworker/__init__.py bumiworker/__init__.py
COPY bumiworker/bumiworker/__init__.py bumiworker/bumiworker/__init__.py
COPY bumiworker/bumiworker/modules/__init__.py bumiworker/bumiworker/modules/__init__.py
COPY bumiworker/bumiworker/modules/module.py bumiworker/bumiworker/modules/module.py
COPY bumiworker/bumiworker/modules/recommendations bumiworker/bumiworker/modules/recommendations
```

This copies only the discovery machinery + recommendation module Python files (no bumiworker dependencies installed — `module.py` uses only stdlib).

Verify the `__init__.py` files exist (create empty ones if missing):
```bash
for f in bumiworker/__init__.py \
          bumiworker/bumiworker/__init__.py \
          bumiworker/bumiworker/modules/__init__.py; do
  test -f "$f" || touch "$f"
done
ls bumiworker/__init__.py bumiworker/bumiworker/__init__.py \
   bumiworker/bumiworker/modules/__init__.py
```

- [ ] **Step 1: Write failing test for happy-path validator (create path)**

Add to `rest_api/rest_api_server/tests/unittests/test_organization_options_api.py` inside `TestCloudAccountApi`:

```python
def test_enabled_recommendation_modules_create_valid(self):
    # Lazy default: org1 has no row. First save creates row.
    valid_value = {'value': json.dumps({'types': ['obsolete_ips']})}
    with patch(
        'rest_api.rest_api_server.controllers.organization_options.'
        'list_recommendation_module_names',
        return_value={'obsolete_ips', 'abandoned_instances'}
    ):
        code, resp = self.client.organization_option_create(
            self.org_id1, 'enabled_recommendation_modules', valid_value)
    self.assertEqual(code, 200)
    self.assertEqual(resp, valid_value)

def test_enabled_recommendation_modules_create_unknown_module(self):
    bad_value = {'value': json.dumps({'types': ['nonexistent_module']})}
    with patch(
        'rest_api.rest_api_server.controllers.organization_options.'
        'list_recommendation_module_names',
        return_value={'obsolete_ips', 'abandoned_instances'}
    ):
        code, resp = self.client.organization_option_create(
            self.org_id1, 'enabled_recommendation_modules', bad_value)
    self.assertEqual(code, 400)
    self.assertIn('nonexistent_module', resp['error']['reason'])

def test_enabled_recommendation_modules_update_unknown_module(self):
    # Pre-create a valid row, then attempt update with bad type.
    valid_value = {'value': json.dumps({'types': ['obsolete_ips']})}
    with patch(
        'rest_api.rest_api_server.controllers.organization_options.'
        'list_recommendation_module_names',
        return_value={'obsolete_ips'}
    ):
        self.client.organization_option_create(
            self.org_id1, 'enabled_recommendation_modules', valid_value)
        bad_value = {'value': json.dumps({'types': ['nonexistent_module']})}
        code, resp = self.client.organization_option_update(
            self.org_id1, 'enabled_recommendation_modules', bad_value)
    self.assertEqual(code, 400)
    self.assertIn('nonexistent_module', resp['error']['reason'])

def test_enabled_recommendation_modules_malformed_json(self):
    bad_value = {'value': 'not-a-json-string'}
    code, resp = self.client.organization_option_create(
        self.org_id1, 'enabled_recommendation_modules', bad_value)
    self.assertEqual(code, 400)

def test_enabled_recommendation_modules_wrong_shape(self):
    # value must be {"types": [...]}; a bare list is invalid.
    bad_value = {'value': json.dumps(['obsolete_ips'])}
    code, resp = self.client.organization_option_create(
        self.org_id1, 'enabled_recommendation_modules', bad_value)
    self.assertEqual(code, 400)

def test_enabled_recommendation_modules_empty_types_allowed(self):
    valid_value = {'value': json.dumps({'types': []})}
    with patch(
        'rest_api.rest_api_server.controllers.organization_options.'
        'list_recommendation_module_names',
        return_value={'obsolete_ips'}
    ):
        code, resp = self.client.organization_option_create(
            self.org_id1, 'enabled_recommendation_modules', valid_value)
    self.assertEqual(code, 200)

def test_other_options_unaffected_by_validator(self):
    # Validator must only fire for 'enabled_recommendation_modules'.
    arbitrary_value = {'value': json.dumps({'foo': 'bar'})}
    code, resp = self.client.organization_option_create(
        self.org_id1, 'arbitrary_option_name', arbitrary_value)
    self.assertEqual(code, 200)
```

Note: Permission guards (EDIT_PARTNER for PATCH, INFO_ORGANIZATION for GET) are verified at handler line numbers in Phase 0 and enforced by the existing handler framework — no unit test needed here. `TestApiBase.get_client` does not accept `user_id`, so permission tests in this file require a different base pattern; omitted to avoid unworkable stubs.

- [ ] **Step 2: Run tests — verify 4 fail, 3 pass pre-implementation**

```bash
cd /home/iitadmin/optscale-fork
python3 -m pytest rest_api/rest_api_server/tests/unittests/test_organization_options_api.py -v -k enabled_recommendation_modules
```

Expected pre-implementation:
- **PASS already** (3): `test_enabled_recommendation_modules_create_valid` (expects 200, gets 200), `test_enabled_recommendation_modules_empty_types_allowed` (expects 200, gets 200), `test_other_options_unaffected_by_validator` (no validator = any option accepted)
- **FAIL** (4): `create_unknown_module`, `update_unknown_module`, `malformed_json`, `wrong_shape` — all expect 400 but controller currently accepts any value without validation

Leave all 3 passing tests as regression guards. All 7 must pass after implementation.

- [ ] **Step 3: Implement validator + dispatch in controller**

Edit `rest_api/rest_api_server/controllers/organization_options.py`:

Add this import near the top with other imports (`import json` likely already present):

```python
from bumiworker.bumiworker.modules.module import list_modules
```

Add helper just below imports, above `OrganizationOptionsController` class:

```python
def list_recommendation_module_names():
    """Discover available recommendation module filenames.

    Indirected through this helper so tests can patch a single symbol
    inside this controller module instead of the bumiworker import path.
    """
    return set(list_modules('recommendations'))


def _validate_enabled_modules(value_str):
    """Validate value for `enabled_recommendation_modules` option.

    Raises WrongArgumentsException on:
    - Non-string input (defensive — value reaches here as string)
    - Malformed JSON
    - Wrong shape (must be {"types": [str, ...]})
    - Unknown module names (cross-check vs discovery)
    """
    if not isinstance(value_str, str):
        raise WrongArgumentsException(
            Err.OE0214, ['enabled_recommendation_modules'])
    try:
        parsed = json.loads(value_str)
    except (ValueError, TypeError):
        raise WrongArgumentsException(
            Err.OE0219, ['enabled_recommendation_modules'])
    if not isinstance(parsed, dict) or 'types' not in parsed:
        raise WrongArgumentsException(
            Err.OE0217, ['enabled_recommendation_modules'])
    types = parsed['types']
    if not isinstance(types, list) or not all(
            isinstance(t, str) for t in types):
        raise WrongArgumentsException(
            Err.OE0217, ['enabled_recommendation_modules'])
    discovered = list_recommendation_module_names()
    unknown = [t for t in types if t not in discovered]
    if unknown:
        valid_sorted = sorted(discovered)
        raise WrongArgumentsException(
            Err.OE0217,
            [f'enabled_recommendation_modules: unknown module(s) '
             f'{unknown!r}. Valid: {valid_sorted}'])


KEY_VALIDATORS = {
    'enabled_recommendation_modules': _validate_enabled_modules,
}
```

Modify `OrganizationOptionsController.patch()` to dispatch validator at the very top, after `check_org()`, BEFORE the create/update branch. Replace the existing method body (around line 47) with:

```python
    def patch(self, org_id, option_name, data, is_secret=False):
        self.check_org(org_id)
        validator = KEY_VALIDATORS.get(option_name)
        if validator is not None:
            validator(data)
        options = super().list(organization_id=org_id, name=option_name)
        if len(options) > 1:
            raise WrongArgumentsException(Err.OE0177, [])
        elif len(options) == 0:
            res = super().create(organization_id=org_id, name=option_name,
                                 value=data)
            return res.value
        else:
            option = json.loads(options[0].value)
            locked_by_user_id = option.get("locked_by")
            if locked_by_user_id:
                if not is_secret:
                    if self.token:
                        cur_user_id = self.get_user_id()
                        if cur_user_id != locked_by_user_id:
                            raise ForbiddenException(Err.OE0234, [])
                    else:
                        raise ForbiddenException(Err.OE0234, [])
            res = super().update(options[0].id, value=data)
            return res.value
```

Note: `data` here is the bare JSON string. Verified: `handlers/v2/organization_options.py` line 195 does `data = self._request_body().get('value')` before passing to `controller.patch()`. No dict-unwrap needed in the validator.

- [ ] **Step 4: Run all 7 tests — verify all pass**

```bash
python3 -m pytest rest_api/rest_api_server/tests/unittests/test_organization_options_api.py -v -k "enabled_recommendation_modules or unaffected_by_validator"
```

Expected: all 7 PASS (6 validator tests + 1 regression guard).

- [ ] **Step 5: Run full org-options test file — verify no regression**

```bash
python3 -m pytest rest_api/rest_api_server/tests/unittests/test_organization_options_api.py -v
```

Expected: all original tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add rest_api/Dockerfile \
        rest_api/rest_api_server/controllers/organization_options.py \
        rest_api/rest_api_server/tests/unittests/test_organization_options_api.py
git commit -m "feat(rest_api): add enabled_recommendation_modules validator with discovery cross-check"
```

---

## Task 3: Backend — override `InitializeChildrenBase.list_modules` for per-org gate

**Files:**
- Modify: `bumiworker/bumiworker/tasks.py:277`
- Test: `bumiworker/bumiworker/tests/test_initialize_children_gating.py` (new)

- [ ] **Step 1: Create test directory if missing**

```bash
mkdir -p /home/iitadmin/optscale-fork/bumiworker/bumiworker/tests
test -f /home/iitadmin/optscale-fork/bumiworker/bumiworker/tests/__init__.py || \
  touch /home/iitadmin/optscale-fork/bumiworker/bumiworker/tests/__init__.py
```

- [ ] **Step 2: Write failing test file**

Create `bumiworker/bumiworker/tests/test_initialize_children_gating.py`:

```python
"""Unit tests for per-org recommendation-module whitelist gating.

Covers `InitializeChildrenBase.list_modules` override:
- Lazy default (absent option row → all enabled)
- Whitelist intersection
- Stale entry warning + dedupe
- Skipped-module info logging
- Global-disable wins over per-org whitelist
- Fetch-failure returns empty set + error log

Note: InitializeArchive inherits the override via InitializeChildrenBase, but its
real call path uses 'archive' folder (not 'recommendations'), so the per-org gate
does NOT apply to archive. This is intentional — archive module names differ from
recommendation module names. The gate only applies to RECOMMENDATION_FOLDER.
"""
import json
import logging
from unittest.mock import MagicMock, patch

import pytest

from bumiworker.bumiworker.tasks import (
    InitializeChecklist,
    InitializeService,
    _UNSET,
)


ORG_ID = 'org-uuid-1'


def _make_initialize(cls=InitializeChecklist, *, option_response,
                     discovered=('mod_a', 'mod_b', 'mod_c'),
                     global_disabled=()):
    """Build an Initialize* instance with mocked deps.

    `option_response`:
      - dict with 'value' key → simulates present option row (200 + JSON value)
      - None → simulates absent row (REST API returns 200 + '{}' sentinel)
      - Exception instance → simulates transport failure (HTTPError 5xx etc.)

    Note: the REST API NEVER returns 404 for organization_option_get — absent
    rows return 200 with value='{}'. HTTPError only fires on transport failures.
    """
    inst = cls.__new__(cls)
    inst.body = {'organization_id': ORG_ID}
    inst._enabled_modules_cache = _UNSET
    inst._stale_warned = set()
    inst._fetch_error_logged = False

    mock_rest_cl = MagicMock()
    if isinstance(option_response, Exception):
        mock_rest_cl.organization_option_get.side_effect = option_response
    elif option_response is None:
        # Absent row: API returns 200 with '{}' sentinel.
        mock_rest_cl.organization_option_get.return_value = (
            200, {'value': '{}'})
    else:
        mock_rest_cl.organization_option_get.return_value = (
            200, option_response)
    inst.rest_cl = mock_rest_cl

    mock_config_cl = MagicMock()
    mock_config_cl.disabled_recommendations.return_value = list(global_disabled)
    inst.config_cl = mock_config_cl

    return inst, discovered


def test_absent_option_returns_all_discovered_minus_global_disabled():
    inst, discovered = _make_initialize(
        option_response=None, global_disabled=('mod_c',))
    with patch('bumiworker.bumiworker.tasks.list_modules',
               return_value=list(discovered)):
        result = inst.list_modules('recommendations')
    assert set(result) == {'mod_a', 'mod_b'}


def test_present_option_intersects_with_whitelist():
    inst, discovered = _make_initialize(
        option_response={'value': json.dumps({'types': ['mod_a']})})
    with patch('bumiworker.bumiworker.tasks.list_modules',
               return_value=list(discovered)):
        result = inst.list_modules('recommendations')
    assert set(result) == {'mod_a'}


def test_global_disabled_wins_over_whitelist():
    inst, discovered = _make_initialize(
        option_response={'value': json.dumps(
            {'types': ['mod_a', 'mod_c']})},
        global_disabled=('mod_c',))
    with patch('bumiworker.bumiworker.tasks.list_modules',
               return_value=list(discovered)):
        result = inst.list_modules('recommendations')
    assert set(result) == {'mod_a'}


def test_stale_module_in_option_logged_warning_once(caplog):
    inst, discovered = _make_initialize(
        option_response={'value': json.dumps(
            {'types': ['mod_a', 'stale_mod']})})
    with caplog.at_level(logging.WARNING), \
         patch('bumiworker.bumiworker.tasks.list_modules',
               return_value=list(discovered)):
        inst.list_modules('recommendations')
        inst.list_modules('recommendations')
    warnings = [r for r in caplog.records
                if r.levelno == logging.WARNING and 'stale_mod' in r.message]
    assert len(warnings) == 1


def test_skipped_module_logged_info(caplog):
    inst, discovered = _make_initialize(
        option_response={'value': json.dumps({'types': ['mod_a']})})
    with caplog.at_level(logging.INFO), \
         patch('bumiworker.bumiworker.tasks.list_modules',
               return_value=list(discovered)):
        inst.list_modules('recommendations')
    info_msgs = [r.message for r in caplog.records
                 if r.levelno == logging.INFO and 'skipped' in r.message]
    assert any('mod_b' in m for m in info_msgs)
    assert any('mod_c' in m for m in info_msgs)


def test_fetch_failure_returns_empty_state_advances(caplog):
    # Transport failure (5xx) → empty list returned; state machine still advances
    # (existing empty-modules handling at tasks.py:318-321 / :464-470 takes over).
    import requests
    transport_err = requests.HTTPError(response=MagicMock(status_code=503))
    inst, discovered = _make_initialize(option_response=transport_err)
    with caplog.at_level(logging.ERROR), \
         patch('bumiworker.bumiworker.tasks.list_modules',
               return_value=list(discovered)):
        result = inst.list_modules('recommendations')
    assert result == []
    error_msgs = [r.message for r in caplog.records
                  if r.levelno == logging.ERROR]
    assert any(ORG_ID in m for m in error_msgs)


def test_initialize_service_inherits_override():
    inst, discovered = _make_initialize(
        cls=InitializeService,
        option_response={'value': json.dumps({'types': ['mod_a']})})
    with patch('bumiworker.bumiworker.tasks.list_modules',
               return_value=list(discovered)):
        result = inst.list_modules('recommendations')
    assert set(result) == {'mod_a'}


def test_cache_avoids_double_fetch_per_invocation():
    inst, discovered = _make_initialize(
        option_response={'value': json.dumps({'types': ['mod_a']})})
    with patch('bumiworker.bumiworker.tasks.list_modules',
               return_value=list(discovered)):
        inst.list_modules('recommendations')
        # Call again on same instance — cache should be hit, no second REST call.
        inst.list_modules('recommendations')
    assert inst.rest_cl.organization_option_get.call_count == 1


def test_non_recommendations_module_type_unaffected():
    # Gate must only apply to RECOMMENDATION_FOLDER ('recommendations').
    # Use SERVICE_FOLDER ('service') — a real bumiworker folder, not fictitious.
    from bumiworker.bumiworker.tasks import SERVICE_FOLDER
    inst, _ = _make_initialize(
        option_response={'value': json.dumps({'types': ['mod_a']})})
    with patch('bumiworker.bumiworker.tasks.list_modules',
               return_value=['service_x', 'service_y']):
        result = inst.list_modules(SERVICE_FOLDER)
    # No filtering applied for non-recommendations.
    assert set(result) == {'service_x', 'service_y'}
```

- [ ] **Step 3: Run tests — verify all fail**

```bash
cd /home/iitadmin/optscale-fork
python3 -m pytest bumiworker/bumiworker/tests/test_initialize_children_gating.py -v
```

Expected: most tests FAIL (override not yet implemented). `test_non_recommendations_module_type_unaffected` and the absent-option test may PASS by accident depending on current behavior — the others must fail.

- [ ] **Step 4: Implement override in `tasks.py`**

Read current `bumiworker/bumiworker/tasks.py:269-310` first to confirm class shape and existing `list_modules` body.

```bash
sed -n '269,310p' bumiworker/bumiworker/tasks.py
```

Modify `InitializeChildrenBase.list_modules` (replace existing method around line 277). Add `import json` if not already present, and add `import requests`. Do NOT add `import logging` or redefine `LOG` — `tasks.py:21` already defines `LOG = get_logger(__name__)` (kombu). Reusing the existing `LOG` is correct.

```python
import json
import requests

ENABLED_MODULES_OPTION_KEY = 'enabled_recommendation_modules'
```

Add module-level sentinels near the top of `tasks.py` (below imports):

```python
_UNSET = object()
_FETCH_FAILED = object()
```

And in `list_modules`, dedupe the ERROR log:

```python
        try:
            whitelist = self._fetch_enabled_modules_whitelist()
        except Exception as e:
            if not self._fetch_error_logged:
                LOG.error(
                    'option fetch failed for org=%s key=%s: %s',
                    org_id, ENABLED_MODULES_OPTION_KEY, e)
                self._fetch_error_logged = True
            return []
```

Add `_fetch_enabled_modules_whitelist` method + replace `list_modules` on `InitializeChildrenBase`:

```python
class InitializeChildrenBase(CheckTimeoutThreshold):
    # ... existing __init__ unchanged ...

    def _fetch_enabled_modules_whitelist(self):
        """Fetch per-org whitelist option; cache for instance lifetime.

        The REST API ALWAYS returns 200 for this endpoint — it returns the
        sentinel string '{}' when no row exists (never 404). HTTPError only
        fires on genuine transport failures (5xx, auth errors, etc.).

        Returns:
            None if option row absent (lazy default → no whitelist enforcement)
            set[str] of whitelisted module names if present
        Raises:
            requests.HTTPError on transport failure (non-200 status)
        """
        if self._enabled_modules_cache is not _UNSET:
            if self._enabled_modules_cache is _FETCH_FAILED:
                raise RuntimeError('cached fetch failure')
            return self._enabled_modules_cache
        org_id = self.body['organization_id']
        try:
            _, resp = self.rest_cl.organization_option_get(
                org_id, ENABLED_MODULES_OPTION_KEY)
        except requests.HTTPError:
            self._enabled_modules_cache = _FETCH_FAILED
            raise
        raw_value = resp.get('value', '{}')
        if raw_value == '{}':
            # Controller returns '{}' sentinel when no option row exists.
            # Treat as lazy default: all modules enabled.
            self._enabled_modules_cache = None
            return None
        parsed = json.loads(raw_value)
        whitelist = set(parsed.get('types', []))
        self._enabled_modules_cache = whitelist
        return whitelist

    def list_modules(self, module_type):
        modules = list_modules(module_type)
        # Preserve existing global filter verbatim (tasks.py:279-282).
        disabled = set(self.config_cl.disabled_recommendations() or [])
        filtered = [m for m in modules if m not in disabled]
        skipped_global = [m for m in modules if m in disabled]
        LOG.info("[disabled modules] %s::%s", module_type, skipped_global)

        # Per-org gate: only applies to RECOMMENDATION_FOLDER.
        if module_type != RECOMMENDATION_FOLDER:
            return filtered

        org_id = self.body['organization_id']
        try:
            whitelist = self._fetch_enabled_modules_whitelist()
        except Exception as e:
            if not self._fetch_error_logged:
                LOG.error(
                    'option fetch failed for org=%s key=%s: %s',
                    org_id, ENABLED_MODULES_OPTION_KEY, e)
                self._fetch_error_logged = True
            return []

        if whitelist is None:
            # Lazy default: absent row → all enabled.
            return filtered

        filtered_set = set(filtered)
        # Stale: in whitelist but not in discovered modules.
        for stale in whitelist - set(modules):
            if stale not in self._stale_warned:
                LOG.warning(
                    'module=%s stale (in option, not discovered) for org=%s',
                    stale, org_id)
                self._stale_warned.add(stale)
        # Skipped: discovered and not globally disabled but not in whitelist.
        for m in filtered_set - whitelist:
            LOG.info(
                'module=%s skipped (not enabled by org option) for org=%s',
                m, org_id)
        enabled = filtered_set & whitelist
        return [m for m in filtered if m in enabled]
```

`InitializeChildrenBase` has NO existing `__init__` (verified). Add one:

```python
class InitializeChildrenBase(CheckTimeoutThreshold):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._enabled_modules_cache = _UNSET
        self._stale_warned = set()
        self._fetch_error_logged = False
```

- [ ] **Step 5: Run tests — verify all pass**

```bash
python3 -m pytest bumiworker/bumiworker/tests/test_initialize_children_gating.py -v
```

Expected: all 9 tests PASS.

- [ ] **Step 6: Smoke-import bumiworker to ensure no syntax/import errors**

```bash
python3 -c "import ast; ast.parse(open('bumiworker/bumiworker/tasks.py').read())"
python3 -c "from bumiworker.bumiworker.tasks import InitializeChildrenBase, InitializeArchive; print('ok')"
```

Expected: both print no error / `ok`.

- [ ] **Step 7: Commit**

```bash
git add bumiworker/bumiworker/tasks.py \
        bumiworker/bumiworker/tests/__init__.py \
        bumiworker/bumiworker/tests/test_initialize_children_gating.py
git commit -m "feat(bumiworker): per-org recommendation module whitelist gate at scheduler dispatch"
```

---

## Task 4: Frontend — add SETTINGS_TABS entry + i18n keys

**Files:**
- Modify: `ngui/ui/src/utils/constants.ts`
- Modify: `ngui/ui/src/translations/en-US/app.json`

- [ ] **Step 1: Add tab key to `SETTINGS_TABS`**

Read `ngui/ui/src/utils/constants.ts:1047-1054`. Edit the `SETTINGS_TABS` object to add `RECOMMENDATION_MODULES`:

```ts
export const SETTINGS_TABS = Object.freeze({
  ORGANIZATION: "organization",
  SUBSCRIPTION: "subscription",
  INVITATIONS: "invitations",
  SSH: "sshKeys",
  EMAIL_NOTIFICATIONS: "emailNotifications",
  RECOMMENDATION_MODULES: "recommendationModules",
});
```

- [ ] **Step 2: Add i18n keys**

Open `ngui/ui/src/translations/en-US/app.json` and add (alphabetical position) the following keys. Verify via `grep -c '"recommendationModules"' app.json` returns 0 first to avoid duplicates.

```json
  "loading": "Loading…",
  "recommendationModules": "Recommendation Modules",
  "recommendationModuleTabHeading": "Enabled recommendation modules",
  "recommendationModuleTabSubtitle": "Toggle individual modules on or off. Disabled modules are hidden from the overview and skipped at scheduler time.",
  "recommendationModuleDisabledBadge": "Disabled",
  "recommendationModuleDisabledTooltip": "This module is disabled for your organization. Manage in Settings → Recommendation Modules.",
  "recommendationModuleDisabledTooltipLink": "Open settings",
  "recommendationModuleDiscoveryBanner": "{count, plural, one {# new module} other {# new modules}} available — review and enable",
  "recommendationModuleDisableAllConfirmTitle": "Disable all recommendation modules?",
  "recommendationModuleDisableAllConfirmBody": "This will silence ALL recommendation modules. Continue?",
  "recommendationModuleUnknownModule": "Unknown module name",
```

- [ ] **Step 3: Build ngui to verify TypeScript compiles**

```bash
cd /home/iitadmin/optscale-fork/ngui/ui
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors related to `SETTINGS_TABS` or i18n.

- [ ] **Step 4: Commit**

```bash
cd /home/iitadmin/optscale-fork
git add ngui/ui/src/utils/constants.ts ngui/ui/src/translations/en-US/app.json
git commit -m "feat(ngui): add recommendationModules settings tab key and i18n strings"
```

---

## Task 5: Frontend — add API hook for recommendation-modules option

**Files:**
- Create: `ngui/ui/src/hooks/useRecommendationModulesOption.ts`

- [ ] **Step 1: Inspect existing org-options API hook pattern**

```bash
grep -rn "organization_option\|organizationOption" ngui/ui/src/hooks/ ngui/ui/src/api/ 2>/dev/null | head -20
```

Identify the existing pattern (Apollo/redux/saga). Read at least one example end-to-end (e.g. `useDisabledRecommendations` if it exists; fall back to grep for `organizationOptions` in actions/api).

- [ ] **Step 1.5: Verify absent-row sentinel in controller + saga layer**

```bash
grep -rn "GET_ORGANIZATION_OPTION\|organization_option_get\|organizationOptionGet" \
  ngui/ui/src/api/ ngui/ui/src/sagas/ 2>/dev/null | head -20
```

Confirm: the rest_api controller's `get_by_name` returns `'{}'` (empty JSON object string) when no row exists — the API does NOT return 404 for the GET path. So on "absent row", the saga receives a 200 with `value = '{}'`. The hook's `optionRowExists` check (`rawValue !== "{}"`) correctly distinguishes this sentinel. Match existing `OrganizationOptionsService` behavior exactly to confirm the saga writes the `rawValue` to the store on success.

- [ ] **Step 1.6: Verify saga writes to both `api[label]` and `RESTAPI[label]` store slices**

```bash
grep -n "GET_ORGANIZATION_OPTION\|put.*GET_ORGANIZATION\|apiData\|RESTAPI" \
  ngui/ui/src/sagas/organization*.{ts,js} 2>/dev/null | head -30
```

Confirm that the saga handling `GET_ORGANIZATION_OPTION` writes into the same slice that `useApiData(GET_ORGANIZATION_OPTION, null)` reads from. If the saga uses a different action label or writes to a different slice key, adjust the hook's `useApiData` call and/or `useApiState` call to match the actual saga output. Mismatch = `rawValue` stays `null` forever, no toggle state visible.

- [ ] **Step 2: Create hook following identified pattern**

Create `ngui/ui/src/hooks/useRecommendationModulesOption.ts`. The hook MUST mirror `OrganizationOptionsService` (verified in Step 1 + 1.5).

**Critical implementation notes (verified by round-2 QA against actual codebase):**

- The redux reducer (`reducer.ts`) stores `action.payload.value` directly — a raw JSON **string**, NOT an envelope `{name, value}`. So `useApiData(GET_ORGANIZATION_OPTION)` returns the raw string (e.g. `'{"types":["mod_a"]}'`), not `{value: "..."}`. Do NOT use `apiData?.value` — use `apiData` directly with `parseJSON`.
- `updateOrganizationOption` already calls `JSON.stringify` on its third argument internally. Pass `{ types }` directly — NOT `{ value: JSON.stringify({ types }) }` (double-stringification corrupts the payload). Verified against `actionCreators.ts:378-389`.
- `optionRowExists`: 404 leaves `apiData` at the default value (empty string or null per saga behavior confirmed in Step 1.5). Row exists = `apiData` is a non-empty non-default string.

```ts
import { useCallback, useMemo } from "react";
import { useDispatch } from "react-redux";
import {
  getOrganizationOption,
  updateOrganizationOption,
} from "api/restapi/actionCreators";
import { GET_ORGANIZATION_OPTION } from "api/restapi/actionTypes";
import { useApiData } from "hooks/useApiData";
import { useApiState } from "hooks/useApiState";
import { useOrganizationInfo } from "hooks/useOrganizationInfo";

// parseJSON: use the existing utility (grep for parseJSON in utils/ to confirm path)
import { parseJSON } from "utils/strings";  // adjust import path per Step 1 discovery

const OPTION_KEY = "enabled_recommendation_modules";

type EnabledModulesValue = { types: string[] };

export const useRecommendationModulesOption = () => {
  const dispatch = useDispatch();
  const { organizationId } = useOrganizationInfo();

  const { isLoading } = useApiState(GET_ORGANIZATION_OPTION);
  // rawValue lifecycle: null (pre-fetch, default) → '{}' (absent row sentinel) → JSON-string (present row).
  // Component distinguishes null-pre-fetch via isLoading, not optionRowExists.
  // KNOWN LIMITATION: GET_ORGANIZATION_OPTION is a shared store label. If any other component
  // fetches a different option name, rawValue may reflect that option instead. Acceptable in v1:
  // only this hook uses this action label. Document if a second option consumer is added.
  const { apiData: rawValue } = useApiData(GET_ORGANIZATION_OPTION, null);

  // optionRowExists: controller returns '{}' when no row exists (not 404).
  // Row is present iff rawValue is a non-empty non-sentinel string.
  const optionRowExists = typeof rawValue === "string" && rawValue.length > 0 && rawValue !== "{}";

  // parseJSON never throws — it returns fallback on parse error.
  // IMPORTANT: if optionRowExists=true but parse fails (corrupt DB row), parsed=null.
  // null means "lazy default → all modules enabled" — safe degradation (no silent deny).
  // Log a console.warn so operators can detect corrupt rows without breaking the UI.
  const parsed = useMemo<EnabledModulesValue | null>(() => {
    if (!optionRowExists) return null;
    const result = parseJSON(rawValue, null) as EnabledModulesValue | null;
    if (result === null) {
      // Row exists but value is not valid JSON — degrade to "all enabled" and warn.
      console.warn(
        "[useRecommendationModulesOption] corrupt option row — rawValue is not valid JSON; " +
        "defaulting to all-enabled. Fix the row via DELETE /organizations/.../options/enabled_recommendation_modules"
      );
    }
    return result;
  }, [rawValue, optionRowExists]);

  const fetchOption = useCallback(() => {
    dispatch(getOrganizationOption(organizationId, OPTION_KEY));
  }, [dispatch, organizationId]);

  const updateTypes = useCallback(
    (types: string[]) =>
      // Pass raw object — updateOrganizationOption JSON.stringifies internally.
      dispatch(updateOrganizationOption(organizationId, OPTION_KEY, { types })),
    [dispatch, organizationId]
  );

  return {
    isLoading,
    optionRowExists,
    enabledTypes: parsed?.types ?? null, // null = lazy default (all enabled)
    fetchOption,
    updateTypes,
  };
};
```

If the existing pattern differs from redux (e.g. Apollo), rewrite accordingly. The contract is: `enabledTypes === null` ⇒ lazy default; `enabledTypes` is array of strings otherwise. `optionRowExists` must track HTTP 404 (row absent), not parse failure.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/iitadmin/optscale-fork/ngui/ui
npx tsc --noEmit 2>&1 | grep useRecommendationModulesOption
```

Expected: no output (no errors).

- [ ] **Step 4: Commit**

```bash
cd /home/iitadmin/optscale-fork
git add ngui/ui/src/hooks/useRecommendationModulesOption.ts
git commit -m "feat(ngui): add useRecommendationModulesOption hook"
```

---

## Task 6: Frontend — build RecommendationModules tab component

**Files:**
- Create: `ngui/ui/src/components/Settings/RecommendationModulesSettings/RecommendationModulesSettings.tsx`
- Create: `ngui/ui/src/components/Settings/RecommendationModulesSettings/index.ts`

- [ ] **Step 1: Create the component**

`ConfirmationModal` does not exist in this codebase — `AlertDialog` is single-button only. Use an inline MUI `Dialog` for the "disable all" confirmation.

`BaseRecommendation.constructor` requires `(status: Status, apiResponse: TODO)`. TypeScript will error on `new RecClass()`. Instantiate with dummy args to access the title class field: `new RecClass(STATUS.ACTIVE, {}).title`. Import `STATUS` from `BaseRecommendation`.

`optionRowExists` must track HTTP status (200 vs 404), not JSON parse success — see hook contract from Task 5.

```tsx
import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Switch, Typography } from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import { useOptscaleRecommendations } from "hooks/useOptscaleRecommendations";
import { useRecommendationModulesOption } from "hooks/useRecommendationModulesOption";

const RecommendationModulesSettings = () => {
  const intl = useIntl();
  const recommendationsByType = useOptscaleRecommendations({ withDeprecated: true });
  const {
    isLoading,
    optionRowExists,
    enabledTypes,
    fetchOption,
    updateTypes,
  } = useRecommendationModulesOption();

  const [confirmEmptyOpen, setConfirmEmptyOpen] = useState(false);
  const [pendingTypes, setPendingTypes] = useState<string[] | null>(null);

  useEffect(() => {
    fetchOption();
  }, [fetchOption]);

  const discovered = useMemo(
    () => Object.keys(recommendationsByType).sort(),
    [recommendationsByType]
  );

  // Lazy default: absent row (optionRowExists=false) → all discovered enabled in UI.
  const effectiveEnabled = useMemo(
    () => new Set(enabledTypes ?? discovered),
    [enabledTypes, discovered]
  );

  // Discovery banner: row exists AND discovered has modules not in stored types.
  // enabledTypes is null only when optionRowExists=false (lazy default).
  const newModuleCount = useMemo(() => {
    if (!optionRowExists || enabledTypes === null) return 0;
    const stored = new Set(enabledTypes);
    return discovered.filter((t) => !stored.has(t)).length;
  }, [optionRowExists, enabledTypes, discovered]);

  // Errors surface via redux apiError middleware → existing app-level error toast.
  // No try/catch needed — the middleware promise always resolves.
  const submit = (nextTypes: string[]) => updateTypes(nextTypes);

  const handleToggle = (type: string, nextOn: boolean) => {
    const next = new Set(effectiveEnabled);
    if (nextOn) next.add(type);
    else next.delete(type);
    const nextArr = Array.from(next).sort();
    if (nextArr.length === 0) {
      setPendingTypes(nextArr);
      setConfirmEmptyOpen(true);
      return;
    }
    submit(nextArr);
  };

  if (isLoading && !optionRowExists) {
    return <Typography><FormattedMessage id="loading" /></Typography>;
  }

  return (
    <Stack spacing={2}>
      <Typography variant="h6">
        <FormattedMessage id="recommendationModuleTabHeading" />
      </Typography>
      <Typography variant="body2">
        <FormattedMessage id="recommendationModuleTabSubtitle" />
      </Typography>
      {newModuleCount > 0 && (
        <Alert severity="info">
          <FormattedMessage
            id="recommendationModuleDiscoveryBanner"
            values={{ count: newModuleCount }}
          />
        </Alert>
      )}
      <Box>
        {discovered.map((type) => {
          const RecClass = recommendationsByType[type];
          // BaseRecommendation.title is a class instance field; no-arg constructor matches existing codebase convention.
          const titleKey = new RecClass().title;
          return (
            <Box
              key={type}
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              py={0.5}
            >
              <Typography>
                <FormattedMessage id={titleKey} />
              </Typography>
              <Switch
                checked={effectiveEnabled.has(type)}
                onChange={(_, checked) => handleToggle(type, checked)}
                inputProps={{
                  "aria-label": intl.formatMessage({ id: "recommendationModules" }),
                }}
                data-test-id={`switch_${type}`}
              />
            </Box>
          );
        })}
      </Box>

      {/* Inline confirm dialog — no ConfirmationModal component in this codebase. */}
      <Dialog open={confirmEmptyOpen} onClose={() => setConfirmEmptyOpen(false)}>
        <DialogTitle>
          <FormattedMessage id="recommendationModuleDisableAllConfirmTitle" />
        </DialogTitle>
        <DialogContent>
          <FormattedMessage id="recommendationModuleDisableAllConfirmBody" />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setConfirmEmptyOpen(false);
              setPendingTypes(null);
            }}
          >
            <FormattedMessage id="cancel" />
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              if (pendingTypes !== null) submit(pendingTypes);
              setConfirmEmptyOpen(false);
              setPendingTypes(null);
            }}
          >
            <FormattedMessage id="confirm" />
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};

export default RecommendationModulesSettings;
```

Note: verify `"cancel"` and `"confirm"` i18n keys exist in `app.json`. If not, add them to the i18n task (Task 4 Step 2) or use the existing equivalent keys found by `grep -n '"cancel"\|"confirm"' ngui/ui/src/translations/en-US/app.json`.

- [ ] **Step 2: Create barrel export**

```ts
import RecommendationModulesSettings from "./RecommendationModulesSettings";

export default RecommendationModulesSettings;
```

- [ ] **Step 3: Verify i18n key names**

```bash
grep -n '"cancel"\|"confirm"' ngui/ui/src/translations/en-US/app.json | head -5
```

If keys differ (e.g. `"Cancel"` not `"cancel"`), update the Dialog button `id` props to match.

- [ ] **Step 4: Type-check**

```bash
cd /home/iitadmin/optscale-fork/ngui/ui
npx tsc --noEmit 2>&1 | grep RecommendationModules
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
cd /home/iitadmin/optscale-fork
git add ngui/ui/src/components/Settings/RecommendationModulesSettings/
git commit -m "feat(ngui): add RecommendationModulesSettings component"
```

---

## Task 7: Frontend — register tab in Settings page

**Files:**
- Modify: `ngui/ui/src/pages/Settings/Settings.tsx`

- [ ] **Step 1: Add import + tab entry**

Edit `ngui/ui/src/pages/Settings/Settings.tsx`. Add import alongside existing settings tab imports:

```ts
import RecommendationModulesSettings from "components/Settings/RecommendationModulesSettings";
```

Add tab entry to the `tabs` array (place after `EMAIL_NOTIFICATIONS`, before the closing `]`):

```ts
    {
      title: SETTINGS_TABS.RECOMMENDATION_MODULES,
      dataTestId: `tab_${SETTINGS_TABS.RECOMMENDATION_MODULES}`,
      node: <RecommendationModulesSettings />,
    },
```

- [ ] **Step 2: Type-check**

```bash
cd /home/iitadmin/optscale-fork/ngui/ui
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/iitadmin/optscale-fork
git add ngui/ui/src/pages/Settings/Settings.tsx
git commit -m "feat(ngui): register recommendationModules tab in Settings page"
```

---

## Task 8: Frontend — render disabled tile state

**Files:**
- Modify: `ngui/ui/src/containers/RecommendationsOverviewContainer/Cards/Cards.tsx`
- Modify: `ngui/ui/src/containers/RecommendationsOverviewContainer/RecommendationsOverview.tsx` (pass disabled set)

- [ ] **Step 1: Read existing Cards.tsx fully**

```bash
sed -n '1,160p' ngui/ui/src/containers/RecommendationsOverviewContainer/Cards/Cards.tsx
```

Note the exact `<RecommendationCard ... />` invocation. Disabled-state changes its appearance only; do not alter behavior for enabled tiles.

- [ ] **Step 2: Extend Cards.tsx with `disabledModuleTypes` prop**

Modify the `CardsProps` type and the rendered `RecommendationCard`:

```tsx
import { Box, Chip, Tooltip, Link as MuiLink } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { SETTINGS_TABS } from "utils/constants";
// Note: merge Box/Chip/Tooltip/MuiLink into the existing @mui/material import line in Cards.tsx.

type CardsProps = {
  isLoading: boolean;
  downloadLimit?: number;
  recommendations: BaseRecommendation[];
  onRecommendationClick: (id: string) => void;
  isDownloadAvailable: boolean;
  isGetIsDownloadAvailableLoading: boolean;
  selectedDataSourceIds: string[];
  disabledModuleTypes: ReadonlySet<string>; // NEW
};
```

Replace the final `return orderedRecommendations.map(...)` block. For each `r`, if `disabledModuleTypes.has(r.type)`, render a wrapper that greys the card and adds a "Disabled" chip label + tooltip. Do NOT use `<Badge>` — it requires a child element to badge; use a `<Chip>` label overlaid absolutely instead. Do NOT apply `pointerEvents: "none"` to the Tooltip's direct child — MUI Tooltip won't fire on a `pointer-events: none` element. Use a hoverable wrapper span around the greyed card body.

```tsx
return orderedRecommendations.map((r) => {
  const isDisabled = disabledModuleTypes.has(r.type);
  // Copy existing RecommendationCard props verbatim from the current map block.
  const card = (
    <RecommendationCard
      key={r.type}
      color={r.color}
      // ... preserve existing header/description/cta/menu/children props verbatim ...
    />
  );
  if (!isDisabled) return card;
  return (
    <Box key={r.type} sx={{ position: "relative" }}>
      {/* Hoverable span so Tooltip fires even on greyed content. */}
      <Tooltip
        title={
          <>
            <FormattedMessage id="recommendationModuleDisabledTooltip" />{" "}
            <MuiLink
              component={RouterLink}
              to={`/settings?tab=${SETTINGS_TABS.RECOMMENDATION_MODULES}`}
            >
              <FormattedMessage id="recommendationModuleDisabledTooltipLink" />
            </MuiLink>
          </>
        }
      >
        <span style={{ display: "block" }}>
          <Box sx={{ opacity: 0.5 }}>
            {card}
          </Box>
        </span>
      </Tooltip>
      <Chip
        label={<FormattedMessage id="recommendationModuleDisabledBadge" />}
        size="small"
        sx={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}
      />
    </Box>
  );
});
```

Merge all new MUI symbols into the existing `@mui/material` import line: `import { Box, Chip, Tooltip, Link as MuiLink } from "@mui/material";`. Also add `import { Link as RouterLink } from "react-router-dom";` and `import { SETTINGS_TABS } from "utils/constants";` if not already present.

- [ ] **Step 3: Wire up `disabledModuleTypes` prop in `RecommendationsOverview.tsx`**

Read `ngui/ui/src/containers/RecommendationsOverviewContainer/RecommendationsOverview.tsx`. The file has NO React imports — `useMemo` and `useEffect` must be added explicitly.

**Critical:** `RecommendationsOverview` must fetch the option itself. Without this, users who navigate directly to the Recommendations Overview (without first visiting Settings) will see all tiles as enabled even if the org has disabled modules — `enabledTypes` stays `null` (lazy default) because nothing dispatched `getOrganizationOption`.

```tsx
import { useEffect, useMemo } from "react";
import { useRecommendationModulesOption } from "hooks/useRecommendationModulesOption";

// Insert AFTER the `const recommendations = Object.values(...)` block and BEFORE the `return (` statement.
// Hooks must be at component top-level (unconditional); placement after a const is legal.
const { enabledTypes, optionRowExists, fetchOption } = useRecommendationModulesOption();
useEffect(() => { fetchOption(); }, [fetchOption]);
const disabledModuleTypes = useMemo<ReadonlySet<string>>(() => {
  // Lazy default: pre-first-save → no row → all enabled → empty disabled set.
  if (!optionRowExists || !enabledTypes) return new Set();
  const enabled = new Set(enabledTypes);
  return new Set(
    recommendations
      .map((r: BaseRecommendation) => r.type)
      .filter((t: string) => !enabled.has(t))
  );
}, [optionRowExists, enabledTypes, recommendations]);

// pass through:
<Cards
  // ... existing props ...
  disabledModuleTypes={disabledModuleTypes}
/>
```

Adjust `useMemo`/`useCallback` import as needed. Match existing import style in the file.

- [ ] **Step 4: Type-check + smoke compile**

```bash
cd /home/iitadmin/optscale-fork/ngui/ui
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /home/iitadmin/optscale-fork
git add ngui/ui/src/containers/RecommendationsOverviewContainer/Cards/Cards.tsx \
        ngui/ui/src/containers/RecommendationsOverviewContainer/RecommendationsOverview.tsx
git commit -m "feat(ngui): render disabled-state tile for whitelisted-out recommendation modules"
```

---

## Task 9: Build + deploy to K3s

**Files:**
- None directly. Build + deploy commands.

- [ ] **Step 1: Build rest_api image and verify bumiworker import resolves inside container**

```bash
export KUBECONFIG=/home/iitadmin/.kube/config
cd /home/iitadmin/optscale-fork
sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io \
  build -t rest_api:local -f rest_api/Dockerfile .
```

Expected: build succeeds.

Verify the import path resolves in the actual runtime environment (uv venv, not bare python3):
```bash
sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io \
  run --rm rest_api:local uv --project rest_api run python -c \
  "from bumiworker.bumiworker.modules.module import list_modules; print(list_modules('recommendations'))"
```

Expected: prints a list of recommendation module names. If ImportError: re-check the Dockerfile COPY lines added in Task 2 Step 0.

- [ ] **Step 2: Build bumiworker image**

```bash
sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io \
  build -t bumi_worker:local -f bumiworker/Dockerfile .
```

Expected: build succeeds.

- [ ] **Step 3: Build ngui image**

```bash
sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io \
  build -t ngui:local -f ngui/Dockerfile .
```

Expected: build succeeds.

- [ ] **Step 4: Roll out**

```bash
kubectl -n default rollout restart deploy/restapi
kubectl -n default rollout restart deploy/bumiworker
kubectl -n default rollout restart deploy/ngui
kubectl -n default rollout status deploy/restapi --timeout=180s
kubectl -n default rollout status deploy/bumiworker --timeout=180s
kubectl -n default rollout status deploy/ngui --timeout=180s
```

(Verify exact deployment names match cluster — use `kubectl get deploy -n default` if unsure.)

Expected: all three rollouts reach `successfully rolled out`.

- [ ] **Step 5: No commit** — build artefacts only.

---

## Task 10: Manual smoke test

**Files:**
- None. Manual UI + log verification.

- [ ] **Step 1: Pre-test state check**

Open https://192.168.230.145/settings?tab=recommendationModules. Verify:
- Page loads with no errors in browser console
- All discovered modules listed with toggle ON (lazy default)
- No discovery banner (no row exists yet)

- [ ] **Step 2: Toggle one module OFF**

Flip `azure_abandoned_storage_accounts` OFF. Verify:
- Network panel shows PATCH `/organizations/{id}/options/enabled_recommendation_modules` returning 200
- Switch settles in OFF position (no flicker-back)

- [ ] **Step 3: Verify scheduler skip**

```bash
kubectl -n default logs deploy/bumiworker --tail=200 | grep azure_abandoned_storage_accounts
```

Wait one scheduler tick (check existing tick interval — typically a few minutes). Expected: log line `module=azure_abandoned_storage_accounts skipped (not enabled by org option) for org=<id>`.

- [ ] **Step 4: Verify tile renders disabled**

Navigate to Recommendations Overview. Verify the `azure_abandoned_storage_accounts` tile renders greyed with "Disabled" badge. Hover → tooltip shows. Click tooltip link → returns to Settings tab.

- [ ] **Step 5: Toggle back ON, verify tile restored**

Flip back ON. Wait one tick. Verify tile renders normally. Verify INFO log line stops appearing.

- [ ] **Step 6: "Disable all" confirmation modal**

Toggle every module OFF one by one. The final toggle must trigger the confirmation modal. Cancel → state preserved with one module on. Confirm → all-off persisted.

- [ ] **Step 7: Stale entry warning**

```bash
# Insert a stale module name directly in the option row via DB or REST.
kubectl -n default exec deploy/mongo -- mongo ...   # OR
curl -X PATCH ... # using authenticated rest_api call to add 'nonexistent_module'
```

Wait one scheduler-load. Expected: WARNING log line `module=nonexistent_module stale (in option, not discovered)` appears once. Subsequent ticks within the same scheduler-load do NOT re-log.

- [ ] **Step 8: Restore all-enabled**

```bash
# DELETE the option row to restore lazy-default state for further testing.
curl -X DELETE ...
```

Verify Settings page shows all toggles ON, no banner.

- [ ] **Step 9: Document smoke results**

Capture screenshots / log excerpts for the PR description.

---

## Task 11: 3-agent QA pass

**Files:**
- None directly. Agent dispatches.

- [ ] **Step 1: Invoke `pr-review-toolkit:review-pr` skill**

Use the `Skill` tool to invoke `pr-review-toolkit:review-pr`. The skill orchestrates code-reviewer, silent-failure-hunter, and type-design-analyzer sub-agents internally.

Provide context:
- Branch: `feat/recommendation-module-toggle`
- Spec: `docs/superpowers/specs/2026-04-30-recommendation-module-toggle-design.md`
- Focus areas: `_validate_enabled_modules`, `_fetch_enabled_modules_whitelist`, `useRecommendationModulesOption`, disabled-tile rendering, type design for lazy-default vs whitelist-active distinction.

Address all HIGH + MEDIUM findings before proceeding. LOW: judge case-by-case.

- [ ] **Step 2: Run final test suite**

```bash
cd /home/iitadmin/optscale-fork
python3 -m pytest rest_api/rest_api_server/tests/unittests/test_organization_options_api.py \
                  bumiworker/bumiworker/tests/test_initialize_children_gating.py -v
cd ngui/ui && npx tsc --noEmit
```

Expected: all tests PASS, no TypeScript errors.

- [ ] **Step 3: No commit if no changes — otherwise commit fixes**

```bash
git status
# if dirty:
git add <files>
git commit -m "fix(qa): address findings from review-pr skill"
```

---

## Task 12: Stage 1 — internal Codex PR (fork)

**Files:**
- None directly. PR creation.

- [ ] **Step 1: Run propose-feature script**

```bash
cd /home/iitadmin/optscale-fork
.claude/scripts/propose-feature.sh recommendation-module-toggle
```

Expected: PR opened on `msoukhomlinov/optscale` from `feat/recommendation-module-toggle` → `dev`. Codex review triggers automatically.

- [ ] **Step 2: Address Codex review rounds**

For each Codex round:
- Read findings on the PR
- Apply fixes locally on `feat/recommendation-module-toggle`
- Push to update PR
- Wait for next Codex review pass

Continue until Codex returns no actionable findings.

- [ ] **Step 3: Merge PR to `dev`**

Once Codex passes, merge via GitHub UI (squash or merge per project convention — check past PRs in `.claude/memory/upstream_prs_open.md` for pattern).

- [ ] **Step 4: Sync local `dev`**

```bash
git checkout dev
git pull
```

---

## Task 13: Stage 2 — upstream contribution PR

**Files:**
- None directly. PR creation.

- [ ] **Step 1: Run land-feature script**

```bash
.claude/scripts/land-feature.sh recommendation-module-toggle
```

Expected: PR opened on `hystax/optscale` from `msoukhomlinov:feat/recommendation-module-toggle` → `hystax/optscale:integration`.

- [ ] **Step 2: Update upstream PR tracker**

Edit `.claude/memory/upstream_prs_open.md` and `CLAUDE.md` "Current upstream PRs" section: append the new PR number with one-line description.

```bash
git add .claude/memory/upstream_prs_open.md CLAUDE.md
git commit -m "docs: track upstream PR for recommendation-module-toggle"
git push origin dev
```

(Note: this commit lands on `dev`, not `feat/recommendation-module-toggle`.)

---

## Task 14: Phase-11 follow-ups

**Files:**
- Modify: `.claude/skills/optscale-recommendations/SKILL.md` (or wherever the skill lives)
- Modify: `/home/iitadmin/optscale-azure-fork-plan.md`
- Modify: `CLAUDE.md` (if invariants emerged)
- Modify: `.claude/memory/MEMORY.md`
- Modify: `.claude/memory/next_work.md` (retire — replace with execution-complete handover)

- [ ] **Step 1: Update `optscale-recommendations` skill**

Locate the skill body:

```bash
find /home/iitadmin -path '*optscale-recommendations*' -name '*.md' 2>/dev/null | head
```

Add a section noting that as of this feature, new recommendation modules added to a fork that has been touched by per-org Settings (i.e. `enabled_recommendation_modules` row exists) require explicit per-org enablement after first user save. Lazy-default semantic protects untouched orgs only.

- [ ] **Step 2: Update plan §5/§8**

Edit `/home/iitadmin/optscale-azure-fork-plan.md`. Add work-item entry under §5 (or wherever non-recommendation features are tracked) describing this feature, its PR numbers, and current status.

- [ ] **Step 3: Update CLAUDE.md if new invariants emerged**

If QA surfaced any new invariant worth durable capture (e.g. validator dispatch placement gotcha), add to "Critical invariants" section. Otherwise skip.

- [ ] **Step 4: Update `.claude/memory/MEMORY.md`**

Add or update entry for this feature. Refresh "Current upstream PRs" reference.

- [ ] **Step 5: Retire `next_work.md`**

Overwrite `.claude/memory/next_work.md` with a fresh handover for the next session — content depends on what user picks next. If nothing queued, replace with: "Last task: recommendation-module-toggle landed in PR #<n>. Awaiting next task selection."

- [ ] **Step 6: Commit follow-ups**

```bash
cd /home/iitadmin/optscale-fork
git checkout dev
git add .claude/memory/MEMORY.md .claude/memory/next_work.md \
        CLAUDE.md /home/iitadmin/optscale-azure-fork-plan.md
git commit -m "docs: phase-11 follow-ups for recommendation-module-toggle"
git push origin dev
```

---

## Self-Review Checklist (already run)

**Spec coverage** — every locked decision in spec § "Locked decisions" table maps to a task:
- Whitelist key + lazy default + JSON-string convention → Task 2 validator
- Gate at `InitializeChildrenBase.list_modules` + filter composition → Task 3
- Archive scheduler — gate does NOT apply to archive folder (intentional: archive uses `'archive'` module type, not `'recommendations'`); confirmed by `test_non_recommendations_module_type_unaffected` and `test_initialize_service_inherits_override`
- Direct per-toggle PATCH (no save button) → Task 6 Step 1 `handleToggle`
- Tile UI grey + badge + tooltip + Settings link → Task 8
- Discovery banner → Task 6 Step 1 (`newModuleCount` block)
- "Disable all" confirmation modal → Task 6 Step 1 (`ConfirmationModal` block)
- v1 toggle-only scope → no threshold-reset task included (per spec)
- Permissions PATCH=EDIT_PARTNER, GET=INFO_ORGANIZATION → reuses existing handler guards (no task needed)
- Skill update → Task 14 Step 1
- No migration script → no task included (intentional)

**Critical invariants from spec**:
- Lazy default semantic → Task 3 test `test_absent_option_returns_all_discovered_minus_global_disabled`
- Filter composition order → Task 3 test `test_global_disabled_wins_over_whitelist`
- Module identity = bumiworker filename → reuses existing `type` field convention (no new task)
- Gate at `list_modules` only, never `_get` → Task 3 implementation; verified by code review (Task 11)
- Tile dual-registration honored → reuses existing `useOptscaleRecommendations` hook
- JSON storage convention (`json.loads`) → Task 2 validator + Task 5 hook
- Audit trail → existing `OrganizationOption` mutator hook (no task needed)
- Silent-skip vs silent-failure → Task 3 INFO/WARNING/ERROR log paths, tests cover all three
- Module discovery as source of truth → Task 2 validator cross-checks `list_recommendation_module_names()`
- No bulk-empty without confirmation → Task 6 Step 1 confirmation modal
- Discovery via UI banner not log-grep → Task 6 Step 1 banner

**Placeholder scan** — no TBDs, no "implement appropriate error handling", every step has executable content. The two phase-0 verifications inside Task 2 Step 4 (handler signature) and Task 3 Step 4 (existing `list_modules` body) require reading current code before editing — these are explicit verification steps with concrete commands, not placeholders.

**Type consistency** — `enabledTypes`, `disabledModuleTypes`, `effectiveEnabled`, `optionRowExists` used consistently across Tasks 5, 6, 8. Backend: `_validate_enabled_modules`, `KEY_VALIDATORS`, `_fetch_enabled_modules_whitelist`, `_enabled_modules_cache`, `_stale_warned` used consistently across Tasks 2, 3.
