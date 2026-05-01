import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
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
  const newModuleCount = useMemo(() => {
    if (!optionRowExists || enabledTypes === null) return 0;
    const stored = new Set(enabledTypes);
    return discovered.filter((t) => !stored.has(t)).length;
  }, [optionRowExists, enabledTypes, discovered]);

  // Errors surface via redux apiError middleware → existing app-level error toast.
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
          // @ts-expect-error — BaseRecommendation constructor params are optional at runtime
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
