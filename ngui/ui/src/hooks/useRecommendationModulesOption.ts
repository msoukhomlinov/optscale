import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  getOrganizationOption,
  getDiscoveredRecommendationModules,
  updateOrganizationOption,
} from "api/restapi/actionCreators";
import {
  GET_ORGANIZATION_OPTION,
  GET_DISCOVERED_RECOMMENDATION_MODULES,
} from "api/restapi/actionTypes";
import { hashParams } from "api/utils";
import { useApiData } from "hooks/useApiData";
import { useApiState } from "hooks/useApiState";
import { useOrganizationInfo } from "hooks/useOrganizationInfo";
import { parseJSON } from "utils/strings";

const OPTION_KEY = "enabled_recommendation_modules";

type EnabledModulesValue = { types: string[] };

export const useRecommendationModulesOption = () => {
  const dispatch = useDispatch();
  const { organizationId } = useOrganizationInfo();

  const { isLoading, isError: isOptionError } = useApiState(GET_ORGANIZATION_OPTION);
  const { apiData: rawValue } = useApiData(GET_ORGANIZATION_OPTION, "{}");
  // Hash of the most recent fetch the store reflects, vs. the hash for the
  // CURRENT (org, key) tuple we want. They diverge after an org switch
  // until the new org's fetch lands — using this divergence as a gate
  // prevents a late success from a previous org from satisfying
  // `hasFetchedOption` and exposing stale `rawValue`.
  const optionStoreHash = useSelector((state: any) => state.api?.[GET_ORGANIZATION_OPTION]?.hash ?? 0);
  const optionExpectedHash = useMemo(
    () => hashParams({ organizationId, name: OPTION_KEY }),
    [organizationId]
  );
  const optionStoreMatches = optionStoreHash === optionExpectedHash;
  const discoveredStoreHash = useSelector(
    (state: any) => state.api?.[GET_DISCOVERED_RECOMMENDATION_MODULES]?.hash ?? 0
  );
  const discoveredExpectedHash = useMemo(
    () => hashParams({ organizationId }),
    [organizationId]
  );
  const discoveredStoreMatches = discoveredStoreHash === discoveredExpectedHash;

  // Backend's currently-discovered recommendation module names. The validator
  // for `enabled_recommendation_modules` rejects unknown types with OE0217,
  // so the toggle UI must filter the stored whitelist against this set
  // before submitting (avoids stale rename/removal entries blocking saves)
  // and use it to seed the first-toggle payload (avoids silently disabling
  // hidden-but-valid modules during frontend/backend version skew).
  const { isLoading: isLoadingDiscovered, isError: isDiscoveredError } = useApiState(
    GET_DISCOVERED_RECOMMENDATION_MODULES
  );
  const { apiData: discoveredBackendList } = useApiData(
    GET_DISCOVERED_RECOMMENDATION_MODULES,
    []
  );

  // hasFetched flips true after the first GET_ORGANIZATION_OPTION resolves.
  // Before that, rawValue still holds its default "{}" placeholder, which is
  // indistinguishable from "no row exists" — callers must not act on the
  // derived enabledTypes (and certainly not submit toggles) until this is true.
  // Also reset on `organizationId` change so an org switch on the same page
  // does not let toggles fire against the new org while apiData still holds
  // the previous org's option/discovery payload (would cause a stale-stored
  // module set to be written into the wrong organization).
  const wasLoadingRef = useRef(false);
  const wasDiscoveryLoadingRef = useRef(false);
  const [hasFetchedOption, setHasFetchedOption] = useState(false);
  const [hasFetchedDiscovered, setHasFetchedDiscovered] = useState(false);
  const fetchedOrgIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (fetchedOrgIdRef.current !== organizationId) {
      fetchedOrgIdRef.current = organizationId;
      wasLoadingRef.current = false;
      wasDiscoveryLoadingRef.current = false;
      setHasFetchedOption(false);
      setHasFetchedDiscovered(false);
    }
  }, [organizationId]);
  useEffect(() => {
    if (isLoading) {
      wasLoadingRef.current = true;
    } else if (wasLoadingRef.current && !isOptionError && optionStoreMatches) {
      // Only flip on a successful load AND when the store hash matches the
      // current org+key — otherwise a late success from a previous org
      // could satisfy this branch and unblock toggles with stale rawValue
      // (subsequent save would overwrite the real org setting).
      setHasFetchedOption(true);
    }
  }, [isLoading, isOptionError, optionStoreMatches]);
  useEffect(() => {
    if (isLoadingDiscovered) {
      wasDiscoveryLoadingRef.current = true;
    } else if (
      wasDiscoveryLoadingRef.current &&
      !isDiscoveredError &&
      discoveredStoreMatches
    ) {
      setHasFetchedDiscovered(true);
    }
  }, [isLoadingDiscovered, isDiscoveredError, discoveredStoreMatches]);

  // Toggles must wait for BOTH the option row and backend discovery — the
  // discovery list is needed to filter stale stored types and to seed the
  // null-branch correctly.
  const hasFetched = hasFetchedOption && hasFetchedDiscovered;

  const optionRowExists = typeof rawValue === "string" && rawValue.length > 0 && rawValue !== "{}";

  const parsed = useMemo<EnabledModulesValue | null>(() => {
    if (!optionRowExists) return null;
    const result = parseJSON(rawValue, null) as EnabledModulesValue | null;
    if (result === null) {
      console.warn(
        "[useRecommendationModulesOption] corrupt option row — rawValue is not valid JSON; " +
          "defaulting to all-enabled. Fix the row via DELETE /organizations/.../options/enabled_recommendation_modules"
      );
    }
    return result;
  }, [rawValue, optionRowExists]);

  const fetchOption = useCallback(() => {
    dispatch(getOrganizationOption(organizationId, OPTION_KEY));
    dispatch(getDiscoveredRecommendationModules(organizationId));
  }, [dispatch, organizationId]);

  const updateTypes = useCallback(
    (types: string[]) => dispatch(updateOrganizationOption(organizationId, OPTION_KEY, { types })),
    [dispatch, organizationId]
  );

  const discoveredBackend = useMemo(
    () => new Set<string>(Array.isArray(discoveredBackendList) ? discoveredBackendList : []),
    [discoveredBackendList]
  );

  return {
    isLoading,
    hasFetched,
    fetchFailed: (isOptionError && !isLoading) || (isDiscoveredError && !isLoadingDiscovered),
    optionRowExists,
    enabledTypes: parsed?.types ?? null,
    discoveredBackend,
    fetchOption,
    updateTypes,
  };
};
