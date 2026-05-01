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
    inst._fetch_failed_exc = None

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
    inst._rest_cl = mock_rest_cl

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
    # Note: dedup is per-instance only. In production, each task dispatch
    # creates a new instance, so stale warnings fire on every scheduler run
    # as long as the stale entry remains in the org option. This is acceptable
    # — the warning draws attention to config that needs cleanup.
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
        result1 = inst.list_modules('recommendations')
        # Cache hit: no second REST call and result is consistent.
        result2 = inst.list_modules('recommendations')
    assert inst.rest_cl.organization_option_get.call_count == 1
    assert set(result1) == set(result2) == {'mod_a'}


def test_fetch_failed_sentinel_reused_no_second_rest_call(caplog):
    import requests
    transport_err = requests.HTTPError(response=MagicMock(status_code=503))
    inst, discovered = _make_initialize(option_response=transport_err)
    with caplog.at_level(logging.ERROR), \
         patch('bumiworker.bumiworker.tasks.list_modules',
               return_value=list(discovered)):
        result1 = inst.list_modules('recommendations')
        # Second call must hit _FETCH_FAILED sentinel — no new REST request.
        result2 = inst.list_modules('recommendations')
    assert result1 == result2 == []
    assert inst.rest_cl.organization_option_get.call_count == 1


def test_corrupt_json_option_treated_as_fetch_failure(caplog):
    inst, discovered = _make_initialize(
        option_response={'value': 'not-valid-json'})
    with caplog.at_level(logging.ERROR), \
         patch('bumiworker.bumiworker.tasks.list_modules',
               return_value=list(discovered)):
        result = inst.list_modules('recommendations')
    assert result == []
    error_msgs = [r.message for r in caplog.records
                  if r.levelno == logging.ERROR]
    assert any(ORG_ID in m for m in error_msgs)


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
