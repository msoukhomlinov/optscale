import { Fragment } from "react";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import { Box, Chip, Link as MuiLink, Tooltip } from "@mui/material";
import Typography from "@mui/material/Typography";
import { FormattedMessage } from "react-intl";
import { Link as RouterLink } from "react-router-dom";
import QuestionMark from "components/QuestionMark";
import { isEmptyArray } from "utils/arrays";
import Actions from "../Actions";
import RecommendationCard, { ServicesChipsGrid, TableContent, Header } from "../RecommendationCard";
import BaseRecommendation from "../recommendations/BaseRecommendation";
import { usePinnedRecommendations } from "../redux/pinnedRecommendations/hooks";

type CardsProps = {
  isLoading: boolean;
  downloadLimit?: number;
  recommendations: BaseRecommendation[];
  onRecommendationClick: (id: string) => void;
  isDownloadAvailable: boolean;
  isGetIsDownloadAvailableLoading: boolean;
  selectedDataSourceIds: string[];
  disabledModuleTypes: ReadonlySet<string>;
};

const useOrderedRecommendations = (recommendations: BaseRecommendation[]) => {
  const pinnedRecommendations = usePinnedRecommendations();

  const pinnedRecommendationInstances = pinnedRecommendations
    .map((pinnedRecommendationType: string) =>
      recommendations.find((recommendation) => recommendation.type === pinnedRecommendationType)
    )
    .filter((instance: BaseRecommendation) => instance !== undefined);

  const unpinnedRecommendationInstances = recommendations.filter(
    (recommendation) => !pinnedRecommendations.includes(recommendation.type)
  );

  return [...pinnedRecommendationInstances, ...unpinnedRecommendationInstances];
};

const Cards = ({
  isLoading,
  downloadLimit,
  recommendations,
  onRecommendationClick,
  isDownloadAvailable,
  isGetIsDownloadAvailableLoading,
  selectedDataSourceIds,
  disabledModuleTypes,
}: CardsProps) => {
  const orderedRecommendations = useOrderedRecommendations(recommendations);

  if (isLoading) {
    return [
      <RecommendationCard isLoading key={1} />,
      <RecommendationCard isLoading key={2} />,
      <RecommendationCard isLoading key={3} />,
    ];
  }

  if (isEmptyArray(orderedRecommendations)) {
    return (
      <Typography>
        <FormattedMessage id="noRecommendationsFound" />
      </Typography>
    );
  }

  return orderedRecommendations.map((r) => {
    const isDisabled = disabledModuleTypes.has(r.type);
    const card = (
      <RecommendationCard
        color={r.color}
        header={
          <Header
            recommendationType={r.type}
            color={r.color}
            title={<FormattedMessage id={r.title} />}
            subtitle={<ServicesChipsGrid services={r.services} />}
            value={r.value}
            valueLabel={r.label}
          />
        }
        description={
          <>
            <Typography gutterBottom>
              <FormattedMessage
                id={r.descriptionMessageId}
                values={{ strong: (chunks) => <strong>{chunks}</strong>, ...r.descriptionMessageValues }}
              />
            </Typography>
            {r.hasError && (
              <Box display="flex" alignItems="center">
                <Typography color="error">
                  <FormattedMessage id="recommendationError" />
                </Typography>
                <QuestionMark tooltipText={r.error} color="error" Icon={ErrorOutlineOutlinedIcon} />
              </Box>
            )}
          </>
        }
        cta={!isDisabled && r.count > 0 && <FormattedMessage id="seeAllItems" values={{ value: r.count }} />}
        onCtaClick={isDisabled ? undefined : () => onRecommendationClick(r)}
        menu={
          <Actions
            downloadLimit={downloadLimit}
            recommendation={r}
            withMenu
            isDownloadAvailable={isDownloadAvailable}
            isGetIsDownloadAvailableLoading={isGetIsDownloadAvailableLoading}
            selectedDataSourceIds={selectedDataSourceIds}
          />
        }
      >
        {isEmptyArray(r.previewItems) ? null : <TableContent data={r.previewItems.slice(0, 3)} />}
      </RecommendationCard>
    );
    if (!isDisabled) return <Fragment key={r.type}>{card}</Fragment>;
    return (
      <Box key={r.type} sx={{ position: "relative" }}>
        <Tooltip
          title={
            <>
              <FormattedMessage id="recommendationModuleDisabledTooltip" />{" "}
              <MuiLink
                component={RouterLink}
                to={`/settings?tab=recommendationModules`}
              >
                <FormattedMessage id="recommendationModuleDisabledTooltipLink" />
              </MuiLink>
            </>
          }
        >
          <span style={{ display: "block" }}>
            <Box sx={{ opacity: 0.5 }}>
              {card}
            </Box>
          </span>
        </Tooltip>
        <Chip
          label={<FormattedMessage id="recommendationModuleDisabledBadge" />}
          size="small"
          sx={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}
        />
      </Box>
    );
  });
};

export default Cards;
