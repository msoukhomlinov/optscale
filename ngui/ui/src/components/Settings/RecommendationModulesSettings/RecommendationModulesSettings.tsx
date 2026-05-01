import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { FormattedMessage, useIntl } from "react-intl";
import { useIsAllowed } from "hooks/useAllowedActions";
import { useApiState } from "hooks/useApiState";
import { useOptscaleRecommendations } from "hooks/useOptscaleRecommendations";
import { useRecommendationModulesOption } from "hooks/useRecommendationModulesOption";
import { UPDATE_ORGANIZATION_OPTION } from "api/restapi/actionTypes";
import { ALIBABA_CNR, AWS_CNR, AZURE_CNR, GCP_CNR, NEBIUS } from "utils/constants";

const CLOUD_LABEL: Record<string, string> = {
  [AWS_CNR]: "AWS",
  [AZURE_CNR]: "Azure",
  [GCP_CNR]: "GCP",
  [ALIBABA_CNR]: "Alibaba",
  [NEBIUS]: "Nebius",
};

const RecommendationModulesSettings = () => {
  const intl = useIntl();
  const isEditAllowed = useIsAllowed({ requiredActions: ["EDIT_PARTNER"] });
  const recommendationsByType = useOptscaleRecommendations();
  const {
    hasFetched,
    enabledTypes,
    discoveredBackend,
    fetchOption,
    updateTypes,
  } = useRecommendationModulesOption();

  const [confirmEmptyOpen, setConfirmEmptyOpen] = useState(false);
  const [pendingTypes, setPendingTypes] = useState<string[] | null>(null);
  const [optimisticEnabled, setOptimisticEnabled] = useState<Set<string> | null>(null);

  useEffect(() => {
    fetchOption();
  }, [fetchOption]);

  // When the server confirms a write (enabledTypes changes), discard optimistic state.
  useEffect(() => {
    setOptimisticEnabled(null);
  }, [enabledTypes]);

  // Optimistic rollback on save failure. The redux api middleware swallows
  // request errors and resolves the dispatch promise after dispatching
  // `apiError`, so `dispatch(updateOrganizationOption(...)).catch(...)` never
  // fires — instead we observe a load→error transition via useApiState and
  // clear optimistic state then.
  const { isLoading: isUpdating, isError: isUpdateError } = useApiState(UPDATE_ORGANIZATION_OPTION);
  const wasUpdatingRef = useRef(false);
  useEffect(() => {
    if (isUpdating) {
      wasUpdatingRef.current = true;
      return;
    }
    if (wasUpdatingRef.current) {
      wasUpdatingRef.current = false;
      if (isUpdateError) {
        setOptimisticEnabled(null);
      }
    }
  }, [isUpdating, isUpdateError]);

  const discovered = useMemo(
    () => Object.keys(recommendationsByType).sort(),
    [recommendationsByType]
  );

  const effectiveEnabled = useMemo(
    () => optimisticEnabled ?? new Set(enabledTypes ?? discovered),
    [optimisticEnabled, enabledTypes, discovered]
  );

  const submit = (nextTypes: string[]) => {
    updateTypes(nextTypes);
    // Rollback on failure happens via the isUpdateError effect above — the
    // redux api middleware doesn't reject the dispatch promise, so attaching
    // a .catch here would silently never fire.
  };

  const handleToggle = (type: string, nextOn: boolean) => {
    const next = new Set(effectiveEnabled);
    if (nextOn) next.add(type);
    else next.delete(type);
    setOptimisticEnabled(next);
    const discoveredSet = new Set(discovered);
    // Pass-through = stored types this UI doesn't render but the backend
    // currently knows about. Filtering against `discoveredBackend` (fetched
    // from the new GET /recommendation_modules endpoint) drops:
    //   - stale names from renamed/removed modules so a strict validator
    //     (OE0217) doesn't bounce every save and lock the toggle out;
    // and preserves:
    //   - hidden-but-valid modules (eg Nebius types when no Nebius
    //     connection exists) across rolling upgrades / version skew where the
    //     backend knows recommendation types this UI does not render.
    // When no option row exists (enabledTypes null) seed from the same
    // backend-known set minus what this UI renders, so the first save
    // materialises the implicit "all enabled" default without silently
    // disabling hidden modules.
    const passThrough = enabledTypes === null
      ? Array.from(discoveredBackend).filter((t) => !discoveredSet.has(t))
      : enabledTypes.filter((t) => !discoveredSet.has(t) && discoveredBackend.has(t));
    const visibleSelected = Array.from(next).filter((t) => discoveredSet.has(t));
    if (visibleSelected.length === 0) {
      // Submit [] on confirm so ALL modules (including hidden) are truly disabled,
      // matching the "silence ALL recommendation modules" dialog wording.
      setPendingTypes([]);
      setConfirmEmptyOpen(true);
      return;
    }
    submit([...passThrough, ...visibleSelected].sort());
  };

  if (!hasFetched) {
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
      <Alert severity="warning" variant="outlined" sx={{ py: 0.5 }}>
        <FormattedMessage id="recommendationModuleApiCallsNote" />
      </Alert>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell><FormattedMessage id="name" /></TableCell>
            <TableCell><FormattedMessage id="recommendationModuleColCloud" /></TableCell>
            <TableCell><FormattedMessage id="recommendationModuleColApiCalls" /></TableCell>
            <TableCell align="right"><FormattedMessage id="recommendationModuleColEnabled" /></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {discovered.map((type) => {
            const RecClass = recommendationsByType[type];
            // @ts-expect-error — BaseRecommendation constructor params are optional at runtime
            const instance = new RecClass();
            const titleKey: string = instance.title;
            const clouds: string[] = (instance.appliedDataSources ?? [])
              .map((src: string) => CLOUD_LABEL[src])
              .filter(Boolean);
            const apiCallInfo: { description: string; volume: string; cost: string; pricingUrl: string } | null =
              instance.apiCallInfo ?? null;

            return (
              <TableRow key={type}>
                <TableCell>
                  <FormattedMessage id={titleKey} />
                </TableCell>
                <TableCell>
                  <Box display="flex" gap={0.5} flexWrap="wrap">
                    {clouds.length > 0
                      ? clouds.map((c) => <Chip key={c} label={c} size="small" variant="outlined" />)
                      : <Typography variant="body2" color="text.secondary">—</Typography>
                    }
                  </Box>
                </TableCell>
                <TableCell>
                  {apiCallInfo ? (
                    <Stack spacing={0.25}>
                      <Typography variant="body2">
                        {apiCallInfo.description} &middot; {apiCallInfo.volume}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {apiCallInfo.cost}
                      </Typography>
                      <Typography variant="body2">
                        <a href={apiCallInfo.pricingUrl} target="_blank" rel="noopener noreferrer">
                          <FormattedMessage id="recommendationModuleApiCallsPricingLink" />
                        </a>
                      </Typography>
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      <FormattedMessage id="recommendationModuleApiCallsCachedOnly" />
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="right">
                  <Switch
                    checked={effectiveEnabled.has(type)}
                    onChange={(_, checked) => handleToggle(type, checked)}
                    disabled={!isEditAllowed}
                    inputProps={{
                      "aria-label": intl.formatMessage({ id: titleKey }),
                    }}
                    data-test-id={`switch_${type}`}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog open={confirmEmptyOpen} onClose={() => setConfirmEmptyOpen(false)}>
        <DialogTitle>
          <FormattedMessage id="recommendationModuleDisableAllConfirmTitle" />
        </DialogTitle>
        <DialogContent>
          <FormattedMessage id="recommendationModuleDisableAllConfirmBody" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setConfirmEmptyOpen(false); setPendingTypes(null); setOptimisticEnabled(null); }}>
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
