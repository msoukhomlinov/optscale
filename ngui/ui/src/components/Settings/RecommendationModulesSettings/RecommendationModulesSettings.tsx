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
import { useOrganizationInfo } from "hooks/useOrganizationInfo";
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
  const { organizationId } = useOrganizationInfo();
  const isEditAllowed = useIsAllowed({ requiredActions: ["EDIT_PARTNER"] });
  const recommendationsByType = useOptscaleRecommendations();
  const {
    hasFetched,
    fetchFailed,
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

  // Drop optimistic + pending state when the user switches organization on
  // the same page. Without this, a Set<string> built against the previous
  // org's enabledTypes could be flushed by a subsequent toggle into the new
  // org and overwrite its module whitelist.
  useEffect(() => {
    setOptimisticEnabled(null);
    setPendingTypes(null);
    setConfirmEmptyOpen(false);
  }, [organizationId]);

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

  // Backend-discovered modules this UI build does not have a class for —
  // typically a rolling-upgrade case where the deployed backend is newer
  // than this UI bundle. They are rendered as bare rows (type name only)
  // so operators can still toggle them per-module from Settings instead
  // of being limited to passthrough preserve-or-drop behavior.
  const backendOnlyTypes = useMemo(() => {
    const discoveredSet = new Set(discovered);
    return Array.from(discoveredBackend).filter((t) => !discoveredSet.has(t)).sort();
  }, [discovered, discoveredBackend]);

  const allRenderedTypes = useMemo(
    () => [...discovered, ...backendOnlyTypes],
    [discovered, backendOnlyTypes]
  );

  const effectiveEnabled = useMemo(
    () => optimisticEnabled ?? new Set(enabledTypes ?? allRenderedTypes),
    [optimisticEnabled, enabledTypes, allRenderedTypes]
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
    // The "rendered" set spans frontend-known modules + any backend-only
    // modules we render as bare rows. Pass-through = stored types not
    // currently rendered, intersected with `discoveredBackend` to drop
    // stale rename/removal names that the strict OE0217 validator would
    // otherwise reject on every save.
    const renderedSet = new Set(allRenderedTypes);
    const passThrough = enabledTypes === null
      ? Array.from(discoveredBackend).filter((t) => !renderedSet.has(t))
      : enabledTypes.filter((t) => !renderedSet.has(t) && discoveredBackend.has(t));
    // Submitted selection: intersect with `discoveredBackend` so a UI that
    // ships tiles for module types the deployed backend does not yet know
    // about (rolling-upgrade skew where the UI is newer) does not trip
    // OE0217. Backend-only rows already pass this check by definition.
    const visibleSelected = Array.from(next).filter(
      (t) => renderedSet.has(t) && discoveredBackend.has(t)
    );
    if (visibleSelected.length === 0) {
      // Submit [] on confirm so ALL modules (including hidden) are truly disabled,
      // matching the "silence ALL recommendation modules" dialog wording.
      setPendingTypes([]);
      setConfirmEmptyOpen(true);
      return;
    }
    submit([...passThrough, ...visibleSelected].sort());
  };

  if (fetchFailed) {
    // Block the toggle UI entirely if either the option row OR backend module
    // discovery failed to load. The empty/stale default would let `passThrough`
    // silently drop every hidden module type from a stored whitelist on the
    // next toggle (or overwrite the real setting with a whitelist
    // reconstructed from incomplete data). Surface the error and offer a
    // retry instead.
    return (
      <Stack spacing={2}>
        <Alert
          severity="error"
          variant="outlined"
          action={
            <Button color="inherit" size="small" onClick={fetchOption}>
              <FormattedMessage id="retry" />
            </Button>
          }
        >
          <FormattedMessage id="recommendationModuleFetchFailed" />
        </Alert>
      </Stack>
    );
  }

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
            // Note: backend-only rows are rendered separately below; this
            // branch is the frontend-known module list.

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
          {backendOnlyTypes.map((type) => (
            // Backend-discovered module without a UI class in this build —
            // render a bare row so operators can still toggle it. No cloud
            // chips / API-cost description (this UI build doesn't have the
            // metadata for these types yet).
            <TableRow key={type}>
              <TableCell>
                <Stack spacing={0.25}>
                  <Typography variant="body2">{type}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    <FormattedMessage id="recommendationModuleBackendOnlyHint" />
                  </Typography>
                </Stack>
              </TableCell>
              <TableCell>
                <Typography variant="body2" color="text.secondary">—</Typography>
              </TableCell>
              <TableCell>
                <Typography variant="body2" color="text.secondary">—</Typography>
              </TableCell>
              <TableCell align="right">
                <Switch
                  checked={effectiveEnabled.has(type)}
                  onChange={(_, checked) => handleToggle(type, checked)}
                  disabled={!isEditAllowed}
                  inputProps={{ "aria-label": type }}
                  data-test-id={`switch_${type}`}
                />
              </TableCell>
            </TableRow>
          ))}
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
