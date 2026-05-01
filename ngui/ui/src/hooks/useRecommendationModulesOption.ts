import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import {
  getOrganizationOption,
  updateOrganizationOption,
} from "api/restapi/actionCreators";
import { GET_ORGANIZATION_OPTION } from "api/restapi/actionTypes";
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

  // hasFetched flips true after the first GET_ORGANIZATION_OPTION resolves.
  // Before that, rawValue still holds its default "{}" placeholder, which is
  // indistinguishable from "no row exists" — callers must not act on the
  // derived enabledTypes (and certainly not submit toggles) until this is true.
  const wasLoadingRef = useRef(false);
  const [hasFetched, setHasFetched] = useState(false);
  useEffect(() => {
    if (isLoading) {
      wasLoadingRef.current = true;
    } else if (wasLoadingRef.current) {
      setHasFetched(true);
    }
  }, [isLoading]);

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
  }, [dispatch, organizationId]);

  const updateTypes = useCallback(
    (types: string[]) => dispatch(updateOrganizationOption(organizationId, OPTION_KEY, { types })),
    [dispatch, organizationId]
  );

  return {
    isLoading,
    hasFetched,
    optionRowExists,
    enabledTypes: parsed?.types ?? null,
    fetchOption,
    updateTypes,
  };
};
