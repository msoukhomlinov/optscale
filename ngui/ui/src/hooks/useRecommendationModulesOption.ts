import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import {
  getOrganizationOption,
  getDiscoveredRecommendationModules,
  updateOrganizationOption,
} from "api/restapi/actionCreators";
import {
  GET_ORGANIZATION_OPTION,
  GET_DISCOVERED_RECOMMENDATION_MODULES,
} from "api/restapi/actionTypes";
import { useApiData } from "hooks/useApiData";
import { useApiState } from "hooks/useApiState";
import { useOrganizationInfo } from "hooks/useOrganizationInfo";
import { parseJSON } from "utils/strings";

const OPTION_KEY = "enabled_recommendation_modules";

type EnabledModulesValue = { types: string[] };

export const useRecommendationModulesOption = () => {
  const dispatch = useDispatch();
  const { organizationId } = useOrganizationInfo();

  const { isLoading } = useApiState(GET_ORGANIZATION_OPTION);
  const { apiData: rawValue } = useApiData(GET_ORGANIZATION_OPTION, "{}");

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
    } else if (wasLoadingRef.current) {
      setHasFetchedOption(true);
    }
  }, [isLoading]);
  useEffect(() => {
    if (isLoadingDiscovered) {
      wasDiscoveryLoadingRef.current = true;
    } else if (wasDiscoveryLoadingRef.current && !isDiscoveredError) {
      // Only flip hasFetchedDiscovered when the request actually succeeded.
      // On error, leave it false so toggles stay blocked — the empty default
      // would otherwise be indistinguishable from "backend has no modules"
      // and the passThrough filter would silently drop every hidden module
      // type from a stored whitelist.
      setHasFetchedDiscovered(true);
    }
  }, [isLoadingDiscovered, isDiscoveredError]);

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
    discoveryFailed: isDiscoveredError && !isLoadingDiscovered,
    optionRowExists,
    enabledTypes: parsed?.types ?? null,
    discoveredBackend,
    fetchOption,
    updateTypes,
  };
};
