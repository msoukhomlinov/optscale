import { useEffect, useMemo, useState } from "react";
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
import { useOptscaleRecommendations, NEBIUS_RECOMMENDATION_TYPES } from "hooks/useOptscaleRecommendations";
import { useRecommendationModulesOption } from "hooks/useRecommendationModulesOption";
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

  const effectiveEnabled = useMemo(
    () => new Set(enabledTypes ?? discovered),
    [enabledTypes, discovered]
  );

  const newModuleCount = useMemo(() => {
    if (!optionRowExists || enabledTypes === null) return 0;
    const stored = new Set(enabledTypes);
    return discovered.filter((t) => !stored.has(t)).length;
  }, [optionRowExists, enabledTypes, discovered]);

  const submit = (nextTypes: string[]) => updateTypes(nextTypes);

  const handleToggle = (type: string, nextOn: boolean) => {
    const next = new Set(effectiveEnabled);
    if (nextOn) next.add(type);
    else next.delete(type);
    const discoveredSet = new Set(discovered);
    // Types in the stored option that aren't rendered here (e.g. Nebius modules when
    // the Nebius connection is removed) may still be valid on the backend — pass them
    // through unchanged so a visible-module toggle doesn't silently disable them.
    const passThrough = (enabledTypes ?? NEBIUS_RECOMMENDATION_TYPES).filter((t) => !discoveredSet.has(t));
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
      <Alert severity="warning" variant="outlined" sx={{ py: 0.5 }}>
        <FormattedMessage id="recommendationModuleApiCallsNote" />
      </Alert>
      {newModuleCount > 0 && (
        <Alert severity="info">
          <FormattedMessage
            id="recommendationModuleDiscoveryBanner"
            values={{ count: newModuleCount }}
          />
        </Alert>
      )}
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
          <Button onClick={() => { setConfirmEmptyOpen(false); setPendingTypes(null); }}>
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
