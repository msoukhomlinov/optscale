import { useEffect, useMemo } from "react";
import { Grid } from "@mui/material";
import { useRecommendationModulesOption } from "hooks/useRecommendationModulesOption";
import Stack from "@mui/material/Stack";
import { Box } from "@mui/system";
import InlineSeverityAlert from "components/InlineSeverityAlert";
import SearchInput from "components/SearchInput";
import { SPACING_2 } from "utils/layouts";
import { TODO } from "utils/types";
import Cards from "./Cards";
import { RecommendationsFilter, ServicesFilter, VIEW_CARDS, VIEW_TABLE, View } from "./Filters";
import BaseRecommendation, { STATUS } from "./recommendations/BaseRecommendation";
import useStyles from "./RecommendationsOverview.styles";
import RecommendationsTable from "./RecommendationsTable";
import Summary from "./Summary";
import { categoryFilter, serviceFilter, searchFilter, appliedDataSourcesFilter } from "./utils";

type RecommendationsOverviewProps = {
  isDataReady: boolean;
  recommendationClasses: { [key: string]: new (status: string, data: TODO) => BaseRecommendation };
  recommendationsData: TODO;
  onRecommendationClick: (id: string) => void;
  riSpExpensesSummary: { computeExpensesCoveredWithCommitments: number; totalCostWithOffer: number; totalSaving: number };
  isRiSpExpensesSummaryLoading: boolean;
  setSearch: (search: string) => void;
  search: string;
  setCategory: (category: string) => void;
  category: string;
  setService: (service: string) => void;
  service: string;
  setView: (view: string) => void;
  view: string;
  downloadLimit?: number;
  isDownloadAvailable: boolean;
  isGetIsDownloadAvailableLoading: boolean;
  selectedDataSourceIds: string[];
  selectedDataSourceTypes: string[];
  lastCompleted: number;
  totalSaving: number;
  nextRun: number;
  lastRun: number;
};

const sortRecommendation = (recommendationA: BaseRecommendation, recommendationB: BaseRecommendation) => {
  const aHasSavings = recommendationA.hasSaving;
  const bHasSavings = recommendationB.hasSaving;

  // Case 1: Both recommendations have their own savings - sort by saving value
  if (aHasSavings && bHasSavings) {
    return recommendationB.saving - recommendationA.saving;
  }
  // Case 2: Only recommendationA has savings, and B doesn't have it - do not change the order (place A before B)
  if (aHasSavings && !bHasSavings) {
    return -1;
  }
  // Case 3: Only recommendationB has savings, and A doesn't have it - place B before A
  if (!aHasSavings && bHasSavings) {
    return 1;
  }
  // Case 4: Both recommendations have no savings - sort them by count
  return recommendationB.count - recommendationA.count;
};

const RecommendationsOverview = ({
  isDataReady,
  recommendationClasses,
  recommendationsData,
  onRecommendationClick,
  riSpExpensesSummary,
  isRiSpExpensesSummaryLoading,
  setSearch,
  search,
  setCategory,
  category,
  setService,
  service,
  setView,
  view,
  downloadLimit,
  isDownloadAvailable,
  isGetIsDownloadAvailableLoading,
  selectedDataSourceIds,
  selectedDataSourceTypes,
  lastCompleted,
  totalSaving,
  nextRun,
  lastRun,
}: RecommendationsOverviewProps) => {
  const { classes } = useStyles();
  const checkDone = lastCompleted !== 0;

  const recommendations = useMemo(
    () =>
      Object.values(recommendationClasses)
        .map((RecommendationClass) => new RecommendationClass(STATUS.ACTIVE, recommendationsData))
        .filter(categoryFilter(category))
        .filter(serviceFilter(service))
        .filter(searchFilter(search))
        .filter(appliedDataSourcesFilter(selectedDataSourceTypes))
        .sort(sortRecommendation),
    [recommendationClasses, recommendationsData, category, service, search, selectedDataSourceTypes]
  );

  const {
    enabledTypes,
    optionRowExists,
    hasFetchedOption,
    optionFailed,
    fetchOption,
  } = useRecommendationModulesOption();
  useEffect(() => { fetchOption(); }, [fetchOption]);
  const disabledModuleTypes = useMemo<ReadonlySet<string>>(() => {
    // Read-only computation: gate on the option fetch only (the discovery
    // endpoint is only needed by the settings writer). Until the option
    // fetch resolves, return empty so the overview does not flash modules
    // as disabled based on stale store data — Cards/Table receive the
    // matching isLoading flag below so a user cannot click into a module
    // before we know whether it is enabled.
    // On option-fetch failure (transient 5xx, network drop), degrade
    // gracefully: treat all modules as enabled rather than locking the
    // entire recommendations page in a perpetual loader; surface a
    // dismissible warning banner so the user knows they may be acting on
    // stale disable-state.
    if (!hasFetchedOption) return new Set<string>();
    if (!optionRowExists || !enabledTypes) return new Set<string>();
    const enabled = new Set(enabledTypes);
    return new Set(
      recommendations
        .map((r: BaseRecommendation) => r.type)
        .filter((t: string) => !enabled.has(t))
    );
  }, [hasFetchedOption, optionRowExists, enabledTypes, recommendations]);

  // The overview can still render recommendations when the option fetch
  // has not finished yet, but only after it has either succeeded OR
  // explicitly failed — otherwise we would briefly let users click into
  // a module that is actually disabled.
  const moduleStateResolved = hasFetchedOption || optionFailed;

  return (
    <Stack spacing={SPACING_2}>
      {optionFailed && (
        <div>
          <InlineSeverityAlert
            severity="warning"
            messageId="recommendationModuleStateUnavailable"
          />
        </div>
      )}
      <div>
        <Summary
          totalSaving={totalSaving}
          nextRun={nextRun}
          lastCompleted={lastCompleted}
          lastRun={lastRun}
          riSpExpensesSummary={riSpExpensesSummary}
          isLoadingProps={{
            isRecommendationsLoading: !isDataReady,
            isRiSpExpensesSummaryLoading,
          }}
        />
      </div>
      <div>
        <Box className={classes.actionBar}>
          <Box className={classes.actionBarPart}>
            <div>
              <RecommendationsFilter onChange={setCategory} value={category} />
            </div>
            <div>
              <ServicesFilter onChange={setService} value={service} />
            </div>
          </Box>
          <Box className={classes.actionBarPart}>
            <View onChange={setView} value={view} />
            <SearchInput onSearch={setSearch} initialSearchText={search} />
          </Box>
        </Box>
      </div>
      <div>
        {checkDone ? (
          <>
            {view === VIEW_CARDS && (
              <Box className={classes.cardsGrid}>
                <Cards
                  recommendations={recommendations}
                  isLoading={!isDataReady || !moduleStateResolved}
                  downloadLimit={downloadLimit}
                  onRecommendationClick={onRecommendationClick}
                  isDownloadAvailable={isDownloadAvailable}
                  isGetIsDownloadAvailableLoading={isGetIsDownloadAvailableLoading}
                  selectedDataSourceIds={selectedDataSourceIds}
                  disabledModuleTypes={disabledModuleTypes}
                />
              </Box>
            )}
            {view === VIEW_TABLE && (
              <RecommendationsTable
                recommendations={recommendations}
                isLoading={!isDataReady || !moduleStateResolved}
                downloadLimit={downloadLimit}
                onRecommendationClick={onRecommendationClick}
                isDownloadAvailable={isDownloadAvailable}
                isGetIsDownloadAvailableLoading={isGetIsDownloadAvailableLoading}
                selectedDataSourceIds={selectedDataSourceIds}
                disabledModuleTypes={disabledModuleTypes}
              />
            )}
          </>
        ) : (
          <Grid item xs={12}>
            <InlineSeverityAlert messageId="recommendationProceeding" />
          </Grid>
        )}
      </div>
    </Stack>
  );
};

export default RecommendationsOverview;
