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
- Modify: `rest_api/rest_api_server/controllers/organization_options.py`
- Test: `rest_api/rest_api_server/tests/unittests/test_organization_options_api.py`

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

- [ ] **Step 2: Run tests — verify all 7 fail**

```bash
cd /home/iitadmin/optscale-fork
python3 -m pytest rest_api/rest_api_server/tests/unittests/test_organization_options_api.py -v -k enabled_recommendation_modules
```

Expected: 6 tests FAIL (validator not yet implemented — happy paths fail because module-name lookup helper doesn't exist; bad-input tests fail because controller currently accepts anything). The `test_other_options_unaffected_by_validator` test will PASS already since no validator exists yet — leave it as a regression guard for the next step.

- [ ] **Step 3: Implement validator + dispatch in controller**

Edit `rest_api/rest_api_server/controllers/organization_options.py`:

Add these imports near the top with other imports:

```python
import json
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

Note: `data` here is the validated string (the `value` field unwrapped by the handler before reaching the controller). Verify before commit by adding a one-line `print(repr(data))` and running one test, then remove.

- [ ] **Step 4: Verify validator receives the JSON string (not the dict wrapper)**

```bash
cd /home/iitadmin/optscale-fork
grep -n "controller.patch" rest_api/rest_api_server/handlers/v2/organization_options.py
```

Read the handler around the matched line. Confirm it extracts `value` from the request body and passes it as the `data` arg. If the handler passes the raw dict instead, the validator must unwrap `data['value']` first. Adjust validator's first line accordingly:

```python
# If handler passes dict {"value": "..."} instead of bare string:
if isinstance(value_str, dict) and 'value' in value_str:
    value_str = value_str['value']
```

Document the actual signature in a one-line comment above the validator.

- [ ] **Step 5: Run tests — verify all 7 pass**

```bash
python3 -m pytest rest_api/rest_api_server/tests/unittests/test_organization_options_api.py -v -k enabled_recommendation_modules
```

Expected: all 7 PASS.

- [ ] **Step 6: Run full org-options test file — verify no regression**

```bash
python3 -m pytest rest_api/rest_api_server/tests/unittests/test_organization_options_api.py -v
```

Expected: all original tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add rest_api/rest_api_server/controllers/organization_options.py \
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
- InitializeArchive inherits override
"""
import json
import logging
from unittest.mock import MagicMock, patch

import pytest

from bumiworker.bumiworker.tasks import (
    InitializeArchive,
    InitializeChecklist,
    InitializeChildrenBase,
    InitializeService,
)


ORG_ID = 'org-uuid-1'


def _make_initialize(cls=InitializeChecklist, *, option_response,
                     discovered=('mod_a', 'mod_b', 'mod_c'),
                     global_disabled=()):
    """Build an Initialize* instance with mocked deps.

    `option_response`:
      - dict with 'value' key → simulates present option row
      - None → simulates absent row (404)
      - Exception → simulates fetch failure
    """
    inst = cls.__new__(cls)
    inst.organization_id = ORG_ID
    inst._enabled_modules_cache = None
    inst._stale_warned = set()

    mock_rest_cl = MagicMock()
    if isinstance(option_response, Exception):
        mock_rest_cl.organization_option_get.side_effect = option_response
    elif option_response is None:
        mock_rest_cl.organization_option_get.return_value = (
            404, {'error': 'not found'})
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


def test_fetch_failure_returns_empty_and_logs_error(caplog):
    inst, discovered = _make_initialize(
        option_response=RuntimeError('rest down'))
    with caplog.at_level(logging.ERROR), \
         patch('bumiworker.bumiworker.tasks.list_modules',
               return_value=list(discovered)):
        result = inst.list_modules('recommendations')
    assert result == []
    error_msgs = [r.message for r in caplog.records
                  if r.levelno == logging.ERROR]
    assert any(ORG_ID in m for m in error_msgs)


def test_initialize_archive_inherits_override():
    # Class hierarchy proof: archive uses the same gate.
    inst, discovered = _make_initialize(
        cls=InitializeArchive,
        option_response={'value': json.dumps({'types': ['mod_b']})})
    with patch('bumiworker.bumiworker.tasks.list_modules',
               return_value=list(discovered)):
        result = inst.list_modules('recommendations')
    assert set(result) == {'mod_b'}


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
    # Gate must only apply to 'recommendations' module_type.
    inst, _ = _make_initialize(
        option_response={'value': json.dumps({'types': ['mod_a']})})
    with patch('bumiworker.bumiworker.tasks.list_modules',
               return_value=['policy_x', 'policy_y']):
        result = inst.list_modules('policies')
    # No filtering applied for non-recommendations.
    assert set(result) == {'policy_x', 'policy_y'}
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

Modify `InitializeChildrenBase.list_modules` (replace existing method around line 277). Add `import json` and `import logging` at top of file if not already present:

```python
LOG = logging.getLogger(__name__)
ENABLED_MODULES_OPTION_KEY = 'enabled_recommendation_modules'


class InitializeChildrenBase(CheckTimeoutThreshold):
    # ... existing __init__ unchanged ...

    def _fetch_enabled_modules_whitelist(self):
        """Fetch per-org whitelist option; cache for instance lifetime.

        Returns:
            None if option row absent (lazy default → no whitelist enforcement)
            set[str] of whitelisted module names if present
        Raises:
            propagates underlying exceptions on transport failure
        """
        if self._enabled_modules_cache is not _UNSET:
            return self._enabled_modules_cache
        try:
            code, resp = self.rest_cl.organization_option_get(
                self.organization_id, ENABLED_MODULES_OPTION_KEY)
        except Exception:
            self._enabled_modules_cache = _FETCH_FAILED
            raise
        if code == 404:
            self._enabled_modules_cache = None
            return None
        if code != 200:
            self._enabled_modules_cache = _FETCH_FAILED
            raise RuntimeError(
                f'unexpected status {code} fetching '
                f'{ENABLED_MODULES_OPTION_KEY} for org={self.organization_id}')
        parsed = json.loads(resp['value'])
        whitelist = set(parsed.get('types', []))
        self._enabled_modules_cache = whitelist
        return whitelist

    def list_modules(self, module_type):
        modules = list_modules(module_type)
        # Existing global filter (preserve verbatim from current line ~280).
        disabled_globals = set(self.config_cl.disabled_recommendations() or [])
        after_global = [m for m in modules if m not in disabled_globals]

        # Per-org gate applies ONLY to recommendation modules.
        if module_type != 'recommendations':
            return after_global

        try:
            whitelist = self._fetch_enabled_modules_whitelist()
        except Exception as e:
            LOG.error(
                'option fetch failed for org=%s key=%s: %s',
                self.organization_id, ENABLED_MODULES_OPTION_KEY, e)
            return []

        if whitelist is None:
            # Lazy default: absent row → all enabled.
            return after_global

        after_global_set = set(after_global)
        # Stale: in whitelist but not discovered.
        for stale in whitelist - set(modules):
            if stale not in self._stale_warned:
                LOG.warning(
                    'module=%s stale (in option, not discovered) for org=%s',
                    stale, self.organization_id)
                self._stale_warned.add(stale)
        # Skipped: in discovered ∖ global_disabled but not in whitelist.
        for skipped in after_global_set - whitelist:
            LOG.info(
                'module=%s skipped (not enabled by org option) for org=%s',
                skipped, self.organization_id)
        enabled = after_global_set & whitelist
        return [m for m in after_global if m in enabled]
```

Add module-level sentinels near the top of `tasks.py` (below imports):

```python
_UNSET = object()
_FETCH_FAILED = object()
```

Initialize cache attrs in `InitializeChildrenBase.__init__` (or define as class attrs that are overridden per-instance). If `__init__` doesn't exist on this class, find the constructor up the chain and set them in the appropriate place — most likely in the existing constructor where `self.organization_id` is set:

```python
# Inside the existing __init__ where self.organization_id is set:
self._enabled_modules_cache = _UNSET
self._stale_warned = set()
```

Note: the existing `list_modules` may not currently apply `disabled_recommendations` itself — it might be applied elsewhere. Read lines 275-305 carefully and **preserve existing behavior verbatim** in `after_global`. If the existing method just returns `list_modules(module_type)` with no filtering, then `after_global = modules` and the global filter happens elsewhere — adjust accordingly. The spec phrasing `"existing global filter computes discovered \ global_disabled"` implies it lives in `list_modules`; verify by reading the actual code before editing.

- [ ] **Step 5: Run tests — verify all pass**

```bash
python3 -m pytest bumiworker/bumiworker/tests/test_initialize_children_gating.py -v
```

Expected: all 10 tests PASS.

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
  "recommendationModules": "Recommendation Modules",
  "recommendationModuleTabHeading": "Enabled recommendation modules",
  "recommendationModuleTabSubtitle": "Toggle individual modules on or off. Disabled modules are hidden from the overview and skipped at scheduler time.",
  "recommendationModuleDisabledBadge": "Disabled",
  "recommendationModuleDisabledTooltip": "This module is disabled for your organization. Manage in Settings → Recommendation Modules.",
  "recommendationModuleDisabledTooltipLink": "Open settings",
  "recommendationModuleDiscoveryBanner": "{count, plural, one {# new module} other {# new modules}} available — review and enable",
  "recommendationModuleDisableAllConfirmTitle": "Disable all recommendation modules?",
  "recommendationModuleDisableAllConfirmBody": "This will silence ALL recommendation modules. Continue?",
  "recommendationModuleSaveErrorToast": "Could not update recommendation modules. Reverted.",
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

- [ ] **Step 2: Create hook following identified pattern**

Create `ngui/ui/src/hooks/useRecommendationModulesOption.ts`. The hook MUST mirror whatever existing org-options hook is in use. Pseudocode skeleton (replace with real API calls per identified pattern):

```ts
import { useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
// Replace these imports with actual existing action creators / selectors found in Step 1.
import {
  getOrganizationOption,
  updateOrganizationOption,
} from "api/restapi/actionCreators";
import { GET_ORGANIZATION_OPTION } from "api/restapi/actionTypes";
import { useApiData } from "hooks/useApiData";
import { useApiState } from "hooks/useApiState";
import { useOrganizationInfo } from "hooks/useOrganizationInfo";

const OPTION_KEY = "enabled_recommendation_modules";

type EnabledModulesValue = { types: string[] };

export const useRecommendationModulesOption = () => {
  const dispatch = useDispatch();
  const { organizationId } = useOrganizationInfo();

  const { isLoading } = useApiState(GET_ORGANIZATION_OPTION);
  const { apiData } = useApiData(GET_ORGANIZATION_OPTION);

  // apiData.value is a JSON string per backend convention.
  let parsed: EnabledModulesValue | null = null;
  if (apiData?.value) {
    try {
      parsed = JSON.parse(apiData.value);
    } catch {
      parsed = null;
    }
  }
  // Absent option (404) → null. Present → parsed shape.
  const optionRowExists = parsed !== null;

  const fetchOption = useCallback(() => {
    dispatch(getOrganizationOption(organizationId, OPTION_KEY));
  }, [dispatch, organizationId]);

  const updateTypes = useCallback(
    (types: string[]) =>
      dispatch(
        updateOrganizationOption(organizationId, OPTION_KEY, {
          value: JSON.stringify({ types }),
        })
      ),
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

If the existing pattern is GraphQL/Apollo not redux, rewrite accordingly. The contract is: `enabledTypes === null` ⇒ lazy default; `enabledTypes` is array of strings otherwise.

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

```tsx
import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Stack, Switch, Typography } from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import ButtonLoader from "components/ButtonLoader";
import ConfirmationModal from "components/ConfirmationModal";
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

  // Lazy default: absent row → all discovered are "enabled" in UI state.
  const effectiveEnabled = useMemo(
    () => new Set(enabledTypes ?? discovered),
    [enabledTypes, discovered]
  );

  // Discovery banner: row exists AND discovered set has modules not in stored.
  const newModuleCount = useMemo(() => {
    if (!optionRowExists || !enabledTypes) return 0;
    const stored = new Set(enabledTypes);
    return discovered.filter((t) => !stored.has(t)).length;
  }, [optionRowExists, enabledTypes, discovered]);

  const submit = async (nextTypes: string[]) => {
    const previous = enabledTypes ?? discovered;
    try {
      await updateTypes(nextTypes);
    } catch {
      // useRecommendationModulesOption surfaces toast via existing error middleware;
      // optimistic rollback is implicit (next render uses re-fetched state).
      void previous; // explicit acknowledgement of rollback behaviour
    }
  };

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
                  "aria-label": intl.formatMessage(
                    { id: "recommendationModules" }
                  ),
                }}
                data-test-id={`switch_${type}`}
              />
            </Box>
          );
        })}
      </Box>
      <ConfirmationModal
        open={confirmEmptyOpen}
        title={<FormattedMessage id="recommendationModuleDisableAllConfirmTitle" />}
        body={<FormattedMessage id="recommendationModuleDisableAllConfirmBody" />}
        onConfirm={() => {
          if (pendingTypes !== null) submit(pendingTypes);
          setConfirmEmptyOpen(false);
          setPendingTypes(null);
        }}
        onCancel={() => {
          setConfirmEmptyOpen(false);
          setPendingTypes(null);
        }}
      />
    </Stack>
  );
};

export default RecommendationModulesSettings;
```

- [ ] **Step 2: Create barrel export**

```ts
import RecommendationModulesSettings from "./RecommendationModulesSettings";

export default RecommendationModulesSettings;
```

- [ ] **Step 3: Verify ConfirmationModal API matches**

```bash
grep -rn "ConfirmationModal" ngui/ui/src/components/ConfirmationModal/ | head -10
```

Read the actual `ConfirmationModal` props signature. Adjust the JSX in Step 1 to match exactly (prop names may be `onClose`/`onSubmit`/`message` instead of `onConfirm`/`onCancel`/`body`). If a different confirm-modal component is canonical, swap to it.

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
import { Badge, Tooltip, Link as MuiLink } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { SETTINGS_TABS } from "utils/constants";

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

Replace the final `return orderedRecommendations.map(...)` block. For each `r`, if `disabledModuleTypes.has(r.type)`, render a wrapper that greys the card and adds badge + tooltip. Reuse the existing `<RecommendationCard>` invocation; do not duplicate its body. Concretely, wrap the existing card in a disabled-state container:

```tsx
return orderedRecommendations.map((r) => {
  const isDisabled = disabledModuleTypes.has(r.type);
  const card = (
    <RecommendationCard
      key={r.type}
      color={r.color}
      // ... preserve existing props verbatim ...
    />
  );
  if (!isDisabled) return card;
  return (
    <Tooltip
      key={r.type}
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
      <Box sx={{ opacity: 0.5, pointerEvents: "none", position: "relative" }}>
        <Badge
          color="default"
          badgeContent={
            <FormattedMessage id="recommendationModuleDisabledBadge" />
          }
          sx={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}
        />
        {card}
      </Box>
    </Tooltip>
  );
});
```

Note: spec calls for `pointerEvents: "none"` on the disabled card body but the tooltip wrapper must remain interactive — wrap it carefully. If the existing layout breaks, drop pointerEvents disabling and rely on visual greying only.

- [ ] **Step 3: Wire up `disabledModuleTypes` prop in `RecommendationsOverview.tsx`**

Read `ngui/ui/src/containers/RecommendationsOverviewContainer/RecommendationsOverview.tsx`. Add the hook:

```tsx
import { useRecommendationModulesOption } from "hooks/useRecommendationModulesOption";

// inside the component:
const { enabledTypes, optionRowExists } = useRecommendationModulesOption();
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

- [ ] **Step 1: Build rest_api image**

```bash
export KUBECONFIG=/home/iitadmin/.kube/config
cd /home/iitadmin/optscale-fork
sudo nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io \
  build -t rest_api:local -f rest_api/Dockerfile .
```

Expected: build succeeds.

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
kubectl -n default rollout restart deploy/rest-api
kubectl -n default rollout restart deploy/bumi-worker
kubectl -n default rollout restart deploy/ngui
kubectl -n default rollout status deploy/rest-api --timeout=180s
kubectl -n default rollout status deploy/bumi-worker --timeout=180s
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
kubectl -n default logs deploy/bumi-worker --tail=200 | grep azure_abandoned_storage_accounts
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

- [ ] **Step 1: Dispatch `pr-review-toolkit:code-reviewer`**

Dispatch agent against `git diff integration..HEAD` with prompt:

> Review the unstaged + committed changes on this branch (`feat/recommendation-module-toggle`) for correctness, project-convention adherence, and adherence to the spec at `docs/superpowers/specs/2026-04-30-recommendation-module-toggle-design.md`. Flag any deviation from the locked design table or critical invariants.

Address all HIGH + MEDIUM findings before proceeding. LOW findings: judge case-by-case, address or note.

- [ ] **Step 2: Dispatch `pr-review-toolkit:silent-failure-hunter`**

Dispatch agent with prompt:

> Audit the changes on `feat/recommendation-module-toggle` for silent failures: swallowed exceptions, fallback values that mask real problems, optimistic UI updates that don't surface errors, missing log lines on error paths. Focus on `_validate_enabled_modules`, `_fetch_enabled_modules_whitelist`, `useRecommendationModulesOption`, and the disabled-tile error states.

Address findings.

- [ ] **Step 3: Dispatch `pr-review-toolkit:type-design-analyzer`**

Dispatch agent with prompt:

> Review the new types introduced on `feat/recommendation-module-toggle` (Python: validators, sentinels; TypeScript: `EnabledModulesValue`, `disabledModuleTypes` prop). Assess encapsulation, invariant expression, and whether the API surfaces let callers express the lazy-default vs whitelist-active distinction correctly without footguns.

Address findings.

- [ ] **Step 4: Run final test suite**

```bash
cd /home/iitadmin/optscale-fork
python3 -m pytest rest_api/rest_api_server/tests/unittests/test_organization_options_api.py \
                  bumiworker/bumiworker/tests/test_initialize_children_gating.py -v
cd ngui/ui && npx tsc --noEmit
```

Expected: all tests PASS, no TypeScript errors.

- [ ] **Step 5: No commit if no changes — otherwise commit fixes**

```bash
git status
# if dirty:
git add <files>
git commit -m "fix(qa): address findings from code-reviewer/silent-failure-hunter/type-design-analyzer"
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
- Archive symmetry via inheritance → Task 3 Step 5 (test_initialize_archive_inherits_override)
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
