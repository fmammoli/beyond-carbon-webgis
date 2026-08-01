"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Download, Layers, MapPlus, Video } from "lucide-react";

import { Legend, type ActiveLegendLayer } from "@/components/gis/legend";
import { MapControls } from "@/components/gis/map-controls";
import { TimeSlider } from "@/components/gis/time-slider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MapControlVectorLayerItem } from "@/hooks/use-map-vector-layers";
import type { LandcoverStatsJobStatus, LandcoverStatsResult } from "@/lib/landcover-stats";
import type { ChmStatsJobStatus, ChmStatsResult } from "@/lib/chm-stats";
import type { AgbStatsJobStatus, AgbStatsResult } from "@/lib/agb-stats";

type MapTopPanelsProps = {
  isSatelliteVisible: boolean;
  isBoundariesAndPlacesVisible: boolean;
  isLandcoverVisible: boolean;
  landcoverOpacity: number;
  isAgbVisible: boolean;
  agbOpacity: number;
  isChmIndonesiaVisible: boolean;
  chmIndonesiaOpacity: number;
  isChmKetapangVisible: boolean;
  chmKetapangOpacity: number;
  vectorLayerItems: MapControlVectorLayerItem[];
  activeLegendLayers: ActiveLegendLayer[];
  isLegendOpen: boolean;
  onSatelliteChange: (visible: boolean) => void;
  onBoundariesAndPlacesChange: (visible: boolean) => void;
  onLandcoverChange: (visible: boolean) => void;
  onLandcoverOpacityChange: (opacity: number) => void;
  onAgbChange: (visible: boolean) => void;
  onAgbOpacityChange: (opacity: number) => void;
  onChmIndonesiaChange: (visible: boolean) => void;
  onChmIndonesiaOpacityChange: (opacity: number) => void;
  onChmKetapangChange: (visible: boolean) => void;
  onChmKetapangOpacityChange: (opacity: number) => void;
  onVectorLayerChange: (fileName: string, visible: boolean) => void;
  onVectorLayerOpacityChange: (fileName: string, opacity: number) => void;
  onLegendOpenChange: (open: boolean) => void;
  selectedPolygonInfo: SelectedPolygonInfo | null;
  canDownloadSelectedPolygon: boolean;
  onDownloadSelectedPolygonGeoJson: () => void;
  landcoverStatsBaselineYear: number;
  comparisonYear: number;
  onLandcoverStatsBaselineYearChange: (year: number) => void;
  onRunLandcoverStats: () => void;
  onCancelLandcoverStats: () => void;
  landcoverStatsJob: LandcoverStatsJobViewState;
  onRunChmStats: () => void;
  onCancelChmStats: () => void;
  chmStatsJob: ChmStatsJobViewState;
  onRunAgbStats: () => void;
  onCancelAgbStats: () => void;
  agbStatsJob: AgbStatsJobViewState;
  primaryAction?: ReactNode;
  exportsAction?: ReactNode;
};

type OverlayHoverBoundaryProps = {
  children: ReactNode;
  onHoverChange?: (isHovering: boolean) => void;
  className?: string;
};

type MapBottomSliderProps = {
  year: number;
  minYear: number;
  maxYear: number;
  isFrameLoading: boolean;
  onYearChange: (year: number) => void;
};

type HoveredVectorInfo = {
  layerName: string;
  groupingColumn: string | null;
  groupingValue: string;
  placeLabel: string | null;
};

type SelectedPolygonInfo = {
  selectionUid: string;
  layerName: string;
  groupingColumn: string | null;
  groupingValue: string;
  geometryType: string | null;
  properties: Array<{ key: string; value: string }>;
  areaSquareKilometers: number | null;
  areaHectares: number | null;
  precomputedLandcoverStats: LandcoverStatsResult | null;
  precomputedChmStats: ChmStatsResult | null;
  precomputedAgbStats: AgbStatsResult | null;
};

type LandcoverStatsJobViewState = {
  status: "idle" | "submitting" | LandcoverStatsJobStatus;
  jobId: string | null;
  progress: number | null;
  etaSeconds: number | null;
  message: string | null;
  error: { code: string; message: string } | null;
  result: LandcoverStatsResult | null;
};

type ChmStatsJobViewState = {
  status: "idle" | "submitting" | ChmStatsJobStatus;
  jobId: string | null;
  progress: number | null;
  etaSeconds: number | null;
  message: string | null;
  error: { code: string; message: string } | null;
  result: ChmStatsResult | null;
};

type AgbStatsJobViewState = {
  status: "idle" | "submitting" | AgbStatsJobStatus;
  jobId: string | null;
  progress: number | null;
  etaSeconds: number | null;
  message: string | null;
  error: { code: string; message: string } | null;
  result: AgbStatsResult | null;
};

type HoverVectorTooltipProps = {
  hoveredVector: HoveredVectorInfo | null;
  hoverTooltipStyle: CSSProperties | null;
  isVisible: boolean;
};

function formatTooltipArea(value: number, compact = false): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: compact && value >= 100 ? 0 : value >= 10 ? 1 : 2,
    maximumFractionDigits: compact && value >= 100 ? 0 : value >= 10 ? 1 : 2,
  }).format(value);
}

function getPrecomputedAreaSummary(
  precomputedLandcoverStats: LandcoverStatsResult | null,
): { areaSquareKilometers: number | null; areaHectares: number | null } {
  if (!precomputedLandcoverStats) {
    return {
      areaSquareKilometers: null,
      areaHectares: null,
    };
  }

  const preferredAreaHectares =
    precomputedLandcoverStats.aoiAreaHa > 0
      ? precomputedLandcoverStats.aoiAreaHa
      : precomputedLandcoverStats.analyzedAreaHa;

  if (!Number.isFinite(preferredAreaHectares) || preferredAreaHectares <= 0) {
    return {
      areaSquareKilometers: null,
      areaHectares: null,
    };
  }

  return {
    areaSquareKilometers: preferredAreaHectares / 100,
    areaHectares: preferredAreaHectares,
  };
}

export function OverlayHoverBoundary({
  children,
  onHoverChange,
  className,
}: OverlayHoverBoundaryProps) {
  return (
    <div
      className={className}
      onPointerEnter={() => onHoverChange?.(true)}
      onPointerLeave={() => onHoverChange?.(false)}
    >
      {children}
    </div>
  );
}

export function MapTopPanels({
  isSatelliteVisible,
  isBoundariesAndPlacesVisible,
  isLandcoverVisible,
  landcoverOpacity,
  isAgbVisible,
  agbOpacity,
  isChmIndonesiaVisible,
  chmIndonesiaOpacity,
  isChmKetapangVisible,
  chmKetapangOpacity,
  vectorLayerItems,
  activeLegendLayers,
  isLegendOpen,
  onSatelliteChange,
  onBoundariesAndPlacesChange,
  onLandcoverChange,
  onLandcoverOpacityChange,
  onAgbChange,
  onAgbOpacityChange,
  onChmIndonesiaChange,
  onChmIndonesiaOpacityChange,
  onChmKetapangChange,
  onChmKetapangOpacityChange,
  onVectorLayerChange,
  onVectorLayerOpacityChange,
  onLegendOpenChange,
  selectedPolygonInfo,
  canDownloadSelectedPolygon,
  onDownloadSelectedPolygonGeoJson,
  landcoverStatsBaselineYear,
  comparisonYear,
  onLandcoverStatsBaselineYearChange,
  onRunLandcoverStats,
  onCancelLandcoverStats,
  landcoverStatsJob,
  onRunChmStats,
  onCancelChmStats,
  chmStatsJob,
  onRunAgbStats,
  onCancelAgbStats,
  agbStatsJob,
  primaryAction,
  exportsAction,
}: MapTopPanelsProps) {
  const hasCommunityPanel = Boolean(primaryAction);
  const hasExportsPanel = Boolean(exportsAction);
  const hasTabbedPanels = hasCommunityPanel || hasExportsPanel;
  const tabColumnCount = hasCommunityPanel && hasExportsPanel ? 3 : 2;

  return (
    <div className="absolute left-3 right-3 top-3 md:left-5 md:right-5 md:top-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="pointer-events-auto flex h-[calc(100dvh-5.5rem)] w-full min-h-0 md:h-[calc(100dvh-6.5rem)] md:w-auto md:min-w-[18rem]">
          <Card className="flex h-full min-h-0 w-[min(92vw,18rem)] flex-col border-white/30 bg-card/85 shadow-lg backdrop-blur-sm">
            {hasTabbedPanels ? (
              <Tabs defaultValue="layers" className="min-h-0 flex-1 gap-0 px-2 pb-2 pt-2">
                <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${tabColumnCount}, minmax(0, 1fr))` }}>
                  <TabsTrigger value="layers" aria-label="Open layer controls tab">
                    <Layers />
                    Layers
                  </TabsTrigger>
                  {hasCommunityPanel ? (
                    <TabsTrigger value="community" aria-label="Open community map tab">
                      <MapPlus />
                      Community
                    </TabsTrigger>
                  ) : null}
                  {hasExportsPanel ? (
                    <TabsTrigger value="exports" aria-label="Open exports tab">
                      <Video />
                      Exports
                    </TabsTrigger>
                  ) : null}
                </TabsList>
                <TabsContent value="layers" className="min-h-0 flex-1 overflow-hidden pb-0 pt-1">
                  <CardContent className="min-h-0 h-full overflow-hidden px-0 pb-0 pt-0">
                    <MapControls
                      isSatelliteVisible={isSatelliteVisible}
                      isBoundariesAndPlacesVisible={isBoundariesAndPlacesVisible}
                      isLandcoverVisible={isLandcoverVisible}
                      landcoverOpacity={landcoverOpacity}
                      isAgbVisible={isAgbVisible}
                      agbOpacity={agbOpacity}
                      isChmIndonesiaVisible={isChmIndonesiaVisible}
                      chmIndonesiaOpacity={chmIndonesiaOpacity}
                      isChmKetapangVisible={isChmKetapangVisible}
                      chmKetapangOpacity={chmKetapangOpacity}
                      vectorLayerItems={vectorLayerItems}
                      onSatelliteChange={onSatelliteChange}
                      onBoundariesAndPlacesChange={onBoundariesAndPlacesChange}
                      onLandcoverChange={onLandcoverChange}
                      onLandcoverOpacityChange={onLandcoverOpacityChange}
                      onAgbChange={onAgbChange}
                      onAgbOpacityChange={onAgbOpacityChange}
                      onChmIndonesiaChange={onChmIndonesiaChange}
                      onChmIndonesiaOpacityChange={onChmIndonesiaOpacityChange}
                      onChmKetapangChange={onChmKetapangChange}
                      onChmKetapangOpacityChange={onChmKetapangOpacityChange}
                      onVectorLayerChange={onVectorLayerChange}
                      onVectorLayerOpacityChange={onVectorLayerOpacityChange}
                      embedded
                    />
                  </CardContent>
                </TabsContent>
                {hasCommunityPanel ? (
                  <TabsContent value="community" className="min-h-0 flex-1 overflow-hidden pb-0 pt-1">
                    <CardContent className="min-h-0 h-full overflow-hidden px-0 pb-0 pt-0">
                      <div className="flex min-h-0 h-full rounded-md border border-cyan-200/60 bg-cyan-50/40 p-2">
                        {primaryAction}
                      </div>
                    </CardContent>
                  </TabsContent>
                ) : null}
                {hasExportsPanel ? (
                  <TabsContent value="exports" className="min-h-0 flex-1 overflow-hidden pb-0 pt-1">
                    <CardContent className="min-h-0 h-full overflow-hidden px-0 pb-0 pt-0">
                      <div className="flex min-h-0 h-full rounded-md border border-cyan-200/60 bg-cyan-50/40 p-2">
                        {exportsAction}
                      </div>
                    </CardContent>
                  </TabsContent>
                ) : null}
              </Tabs>
            ) : (
              <CardContent className="min-h-0 flex-1 overflow-hidden px-2 pb-2 pt-2">
                <MapControls
                  isSatelliteVisible={isSatelliteVisible}
                  isBoundariesAndPlacesVisible={isBoundariesAndPlacesVisible}
                  isLandcoverVisible={isLandcoverVisible}
                  landcoverOpacity={landcoverOpacity}
                  isAgbVisible={isAgbVisible}
                  agbOpacity={agbOpacity}
                  isChmIndonesiaVisible={isChmIndonesiaVisible}
                  chmIndonesiaOpacity={chmIndonesiaOpacity}
                  isChmKetapangVisible={isChmKetapangVisible}
                  chmKetapangOpacity={chmKetapangOpacity}
                  vectorLayerItems={vectorLayerItems}
                  onSatelliteChange={onSatelliteChange}
                  onBoundariesAndPlacesChange={onBoundariesAndPlacesChange}
                  onLandcoverChange={onLandcoverChange}
                  onLandcoverOpacityChange={onLandcoverOpacityChange}
                  onAgbChange={onAgbChange}
                  onAgbOpacityChange={onAgbOpacityChange}
                  onChmIndonesiaChange={onChmIndonesiaChange}
                  onChmIndonesiaOpacityChange={onChmIndonesiaOpacityChange}
                  onChmKetapangChange={onChmKetapangChange}
                  onChmKetapangOpacityChange={onChmKetapangOpacityChange}
                  onVectorLayerChange={onVectorLayerChange}
                  onVectorLayerOpacityChange={onVectorLayerOpacityChange}
                  embedded
                />
              </CardContent>
            )}
          </Card>
        </div>

        <div className="pointer-events-auto self-start md:ml-auto">
          <div className="flex flex-col gap-2">
            <Legend
              open={isLegendOpen}
              onOpenChange={onLegendOpenChange}
              activeLayers={activeLegendLayers}
            />
            <SelectedPolygonInfoPanel
              selectedPolygon={selectedPolygonInfo}
              canDownloadSelectedPolygon={canDownloadSelectedPolygon}
              onDownloadSelectedPolygonGeoJson={onDownloadSelectedPolygonGeoJson}
              landcoverStatsBaselineYear={landcoverStatsBaselineYear}
              comparisonYear={comparisonYear}
              onLandcoverStatsBaselineYearChange={onLandcoverStatsBaselineYearChange}
              onRunLandcoverStats={onRunLandcoverStats}
              onCancelLandcoverStats={onCancelLandcoverStats}
              landcoverStatsJob={landcoverStatsJob}
              onRunChmStats={onRunChmStats}
              onCancelChmStats={onCancelChmStats}
              chmStatsJob={chmStatsJob}
              onRunAgbStats={onRunAgbStats}
              onCancelAgbStats={onCancelAgbStats}
              agbStatsJob={agbStatsJob}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectedPolygonInfoPanel({
  selectedPolygon,
  canDownloadSelectedPolygon,
  onDownloadSelectedPolygonGeoJson,
  landcoverStatsBaselineYear,
  comparisonYear,
  onLandcoverStatsBaselineYearChange,
  onRunLandcoverStats,
  onCancelLandcoverStats,
  landcoverStatsJob,
  onRunChmStats,
  onCancelChmStats,
  chmStatsJob,
  onRunAgbStats,
  onCancelAgbStats,
  agbStatsJob,
}: {
  selectedPolygon: SelectedPolygonInfo | null;
  canDownloadSelectedPolygon: boolean;
  onDownloadSelectedPolygonGeoJson: () => void;
  landcoverStatsBaselineYear: number;
  comparisonYear: number;
  onLandcoverStatsBaselineYearChange: (year: number) => void;
  onRunLandcoverStats: () => void;
  onCancelLandcoverStats: () => void;
  landcoverStatsJob: LandcoverStatsJobViewState;
  onRunChmStats: () => void;
  onCancelChmStats: () => void;
  chmStatsJob: ChmStatsJobViewState;
  onRunAgbStats: () => void;
  onCancelAgbStats: () => void;
  agbStatsJob: AgbStatsJobViewState;
}) {
  const hasPrecomputedStats = Boolean(selectedPolygon?.precomputedLandcoverStats);
  const displayedStatsResult = selectedPolygon
    ? selectedPolygon.precomputedLandcoverStats ?? landcoverStatsJob.result
    : null;
  const precomputedAreaSummary = getPrecomputedAreaSummary(selectedPolygon?.precomputedLandcoverStats ?? null);
  const areaSquareKilometers = precomputedAreaSummary.areaSquareKilometers ?? selectedPolygon?.areaSquareKilometers ?? null;
  const areaHectares = precomputedAreaSummary.areaHectares ?? selectedPolygon?.areaHectares ?? null;
  const isStatsActive = landcoverStatsJob.status === "submitting" || landcoverStatsJob.status === "queued" || landcoverStatsJob.status === "running";
  const isBaselineYearValid = Number.isInteger(landcoverStatsBaselineYear);
  const isYearPairValid = isBaselineYearValid && landcoverStatsBaselineYear !== comparisonYear;
  const isPolygonSelection = Boolean(selectedPolygon?.geometryType?.includes("Polygon"));
  const canStartStats = Boolean(selectedPolygon) && isPolygonSelection && !hasPrecomputedStats && isYearPairValid && !isStatsActive;
  const hasPrecomputedChmStats = Boolean(selectedPolygon?.precomputedChmStats);
  const displayedChmStatsResult = selectedPolygon
    ? selectedPolygon.precomputedChmStats ?? chmStatsJob.result
    : null;
  const isChmStatsActive = chmStatsJob.status === "submitting" || chmStatsJob.status === "queued" || chmStatsJob.status === "running";
  const canStartChmStats = Boolean(selectedPolygon) && isPolygonSelection && !hasPrecomputedChmStats && !isChmStatsActive;
  const hasPrecomputedAgbStats = Boolean(selectedPolygon?.precomputedAgbStats);
  const displayedAgbStatsResult = selectedPolygon
    ? selectedPolygon.precomputedAgbStats ?? agbStatsJob.result
    : null;
  const isAgbStatsActive =
    agbStatsJob.status === "submitting"
    || agbStatsJob.status === "queued"
    || agbStatsJob.status === "running"
    || agbStatsJob.status === "deferred";
  const canStartAgbStats = Boolean(selectedPolygon) && isPolygonSelection && !hasPrecomputedAgbStats && !isAgbStatsActive;
  const [isAreaOpen, setIsAreaOpen] = useState(true);
  const [isPropertiesOpen, setIsPropertiesOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(true);
  const [isStatsResultOpen, setIsStatsResultOpen] = useState(true);
  const [isStatsMetadataOpen, setIsStatsMetadataOpen] = useState(false);
  const [isChmStatsOpen, setIsChmStatsOpen] = useState(true);
  const [isChmStatsResultOpen, setIsChmStatsResultOpen] = useState(true);
  const [isChmStatsMetadataOpen, setIsChmStatsMetadataOpen] = useState(false);
  const [isAgbStatsOpen, setIsAgbStatsOpen] = useState(true);
  const [isAgbStatsResultOpen, setIsAgbStatsResultOpen] = useState(true);
  const [isAgbStatsMetadataOpen, setIsAgbStatsMetadataOpen] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const selectedTitle = selectedPolygon?.layerName ?? "Selected Feature";
  const statsActionLabel = isStatsActive
    ? landcoverStatsJob.status === "submitting"
      ? "Submitting..."
      : landcoverStatsJob.status === "queued"
        ? "Queued..."
        : "Running..."
    : landcoverStatsJob.status === "failed"
      ? "Retry stats"
      : "Run landcover stats";
  const chmStatsActionLabel = isChmStatsActive
    ? chmStatsJob.status === "submitting"
      ? "Submitting..."
      : chmStatsJob.status === "queued"
        ? "Queued..."
        : "Running..."
    : chmStatsJob.status === "failed"
      ? "Retry stats"
      : "Run CHM stats";
  const agbStatsActionLabel = isAgbStatsActive
    ? agbStatsJob.status === "submitting"
      ? "Submitting..."
      : agbStatsJob.status === "queued"
        ? "Queued..."
        : agbStatsJob.status === "deferred"
          ? "Deferred..."
          : "Running..."
    : agbStatsJob.status === "failed"
      ? "Retry stats"
      : agbStatsJob.status === "cancelled"
        ? "Run again"
        : "Run AGB stats";

  const statRows = displayedStatsResult
    ? [
        ["Baseline year", displayedStatsResult.baselineYear === undefined ? "N/A" : String(displayedStatsResult.baselineYear)],
        ["Comparison year", displayedStatsResult.comparisonYear === undefined ? "N/A" : String(displayedStatsResult.comparisonYear)],
        ["Forest loss", `${formatStatsNumber(displayedStatsResult.forestLossHa, 2)} ha`],
        ["Forest loss (%)", displayedStatsResult.forestLossPct === undefined ? "N/A" : `${formatStatsNumber(displayedStatsResult.forestLossPct, 3)}%`],
        ["Forest gain", `${formatStatsNumber(displayedStatsResult.forestGainHa, 2)} ha`],
        ["Forest gain (%)", displayedStatsResult.forestGainPct === undefined ? "N/A" : `${formatStatsNumber(displayedStatsResult.forestGainPct, 3)}%`],
        ["Net change", `${formatStatsNumber(displayedStatsResult.netForestChangeHa, 2)} ha`],
        ["Baseline forest area", `${formatStatsNumber(displayedStatsResult.baselineForestAreaHa, 2)} ha`],
        ["Comparison forest area", `${formatStatsNumber(displayedStatsResult.comparisonForestAreaHa, 2)} ha`],
        ["Analyzed area", `${formatStatsNumber(displayedStatsResult.analyzedAreaHa, 2)} ha`],
        ["AOI area", `${formatStatsNumber(displayedStatsResult.aoiAreaHa, 2)} ha`],
        ["Coverage fraction", formatStatsNumber(displayedStatsResult.coverageFraction, 3)],
        ["Valid pixels", new Intl.NumberFormat("en-US").format(displayedStatsResult.validPixelCount)],
      ]
    : [];

  const chmSummaryRows = displayedChmStatsResult
    ? [
        ["Min canopy height", `${formatStatsNumber(displayedChmStatsResult.minCanopyHeightM, 2)} m`],
        ["Max canopy height", `${formatStatsNumber(displayedChmStatsResult.maxCanopyHeightM, 2)} m`],
        ["Mean canopy height", `${formatStatsNumber(displayedChmStatsResult.meanCanopyHeightM, 2)} m`],
        ["Median canopy height", `${formatStatsNumber(displayedChmStatsResult.medianCanopyHeightM, 2)} m`],
        ["Std. deviation", `${formatStatsNumber(displayedChmStatsResult.stdDevCanopyHeightM, 3)} m`],
      ]
    : [];

  const chmDistributionRows = displayedChmStatsResult
    ? [
        ["Variance", formatStatsNumber(displayedChmStatsResult.varianceCanopyHeightM2, 3)],
        ["P10", `${formatStatsNumber(displayedChmStatsResult.p10CanopyHeightM, 2)} m`],
        ["P25", `${formatStatsNumber(displayedChmStatsResult.p25CanopyHeightM, 2)} m`],
        ["P75", `${formatStatsNumber(displayedChmStatsResult.p75CanopyHeightM, 2)} m`],
        ["P90", `${formatStatsNumber(displayedChmStatsResult.p90CanopyHeightM, 2)} m`],
        ["P95", `${formatStatsNumber(displayedChmStatsResult.p95CanopyHeightM, 2)} m`],
        ["IQR", `${formatStatsNumber(displayedChmStatsResult.interquartileRangeM, 2)} m`],
        ["Coefficient of variation", formatStatsNumber(displayedChmStatsResult.coefficientOfVariation, 4)],
      ]
    : [];

  const chmCoverageRows = displayedChmStatsResult
    ? [
        ["Analyzed area", `${formatStatsNumber(displayedChmStatsResult.analyzedAreaHa, 2)} ha`],
        ["AOI area", `${formatStatsNumber(displayedChmStatsResult.aoiAreaHa, 2)} ha`],
        ["Coverage fraction", formatStatsNumber(displayedChmStatsResult.coverageFraction, 4)],
        ["Valid pixels", new Intl.NumberFormat("en-US").format(displayedChmStatsResult.validPixelCount)],
        ["Canopy volume proxy", `${formatStatsNumber(displayedChmStatsResult.totalCanopyVolumeProxyM3, 2)} m³`],
      ]
    : [];

  const agbSummaryRows = displayedAgbStatsResult
    ? [
        ["Total AGB/ha", `${formatStatsNumber(displayedAgbStatsResult.totalAgbMgHa, 2)} Mg/ha`],
        ["Baseline year", String(displayedAgbStatsResult.baselineYear)],
        ["Comparison year", String(displayedAgbStatsResult.comparisonYear)],
        ["Min AGB", `${formatStatsNumber(displayedAgbStatsResult.minAgbMgHa, 2)} Mg/ha`],
        ["Max AGB", `${formatStatsNumber(displayedAgbStatsResult.maxAgbMgHa, 2)} Mg/ha`],
        ["Mean AGB", `${formatStatsNumber(displayedAgbStatsResult.meanAgbMgHa, 2)} Mg/ha`],
        ["Median AGB", `${formatStatsNumber(displayedAgbStatsResult.medianAgbMgHa, 2)} Mg/ha`],
        ["Std. deviation", `${formatStatsNumber(displayedAgbStatsResult.stdDevAgbMgHa, 3)} Mg/ha`],
        ["Variance", formatStatsNumber(displayedAgbStatsResult.varianceAgbMgHa2, 3)],
      ]
    : [];

  const agbDistributionRows = displayedAgbStatsResult
    ? [
        ["P10", `${formatStatsNumber(displayedAgbStatsResult.p10AgbMgHa, 2)} Mg/ha`],
        ["P25", `${formatStatsNumber(displayedAgbStatsResult.p25AgbMgHa, 2)} Mg/ha`],
        ["P75", `${formatStatsNumber(displayedAgbStatsResult.p75AgbMgHa, 2)} Mg/ha`],
        ["P90", `${formatStatsNumber(displayedAgbStatsResult.p90AgbMgHa, 2)} Mg/ha`],
        ["P95", `${formatStatsNumber(displayedAgbStatsResult.p95AgbMgHa, 2)} Mg/ha`],
        ["IQR", `${formatStatsNumber(displayedAgbStatsResult.interquartileRangeMgHa, 2)} Mg/ha`],
        ["Coefficient of variation", formatStatsNumber(displayedAgbStatsResult.coefficientOfVariation, 4)],
      ]
    : [];

  const agbChangeRows = displayedAgbStatsResult
    ? [
        ["Total AGB", `${formatStatsNumber(displayedAgbStatsResult.totalAgbMg, 2)} Mg`],
        ["Baseline total AGB", `${formatStatsNumber(displayedAgbStatsResult.baselineTotalAgbMg, 2)} Mg`],
        ["Comparison total AGB", `${formatStatsNumber(displayedAgbStatsResult.comparisonTotalAgbMg, 2)} Mg`],
        ["AGB increase", `${formatStatsNumber(displayedAgbStatsResult.agbIncreaseMg, 2)} Mg`],
        ["AGB decrease", `${formatStatsNumber(displayedAgbStatsResult.agbDecreaseMg, 2)} Mg`],
        ["Net change", `${formatStatsNumber(displayedAgbStatsResult.netChangeAgbMg, 2)} Mg`],
        ["Net change density", `${formatStatsNumber(displayedAgbStatsResult.netChangeAgbMgHa, 2)} Mg/ha`],
        ["Net change percent", `${formatStatsNumber(displayedAgbStatsResult.netChangePercent, 2)}%`],
      ]
    : [];

  const agbCoverageRows = displayedAgbStatsResult
    ? [
        ["Analyzed area", `${formatStatsNumber(displayedAgbStatsResult.analyzedAreaHa, 2)} ha`],
        ["AOI area", `${formatStatsNumber(displayedAgbStatsResult.aoiAreaHa, 2)} ha`],
        ["Coverage fraction", formatStatsNumber(displayedAgbStatsResult.coverageFraction, 4)],
        ["Valid pixels", new Intl.NumberFormat("en-US").format(displayedAgbStatsResult.validPixelCount)],
        ["Increase area", `${formatStatsNumber(displayedAgbStatsResult.agbIncreaseAreaHa, 2)} ha`],
        ["Decrease area", `${formatStatsNumber(displayedAgbStatsResult.agbDecreaseAreaHa, 2)} ha`],
      ]
    : [];

  return (
    <Collapsible open={isPanelOpen} onOpenChange={setIsPanelOpen}>
      <div className="w-[min(92vw,18rem)] rounded-xl border border-cyan-200/70 bg-cyan-50/90 p-3 text-[13px] shadow-lg backdrop-blur-sm">
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <div className="min-w-0 truncate text-base font-semibold text-cyan-950 md:text-[17px]" title={selectedTitle}>
              {selectedTitle}
            </div>
            {selectedPolygon ? (
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-7 w-7 border-cyan-300 bg-white/90 text-cyan-900 hover:bg-cyan-100"
                onClick={onDownloadSelectedPolygonGeoJson}
                disabled={!canDownloadSelectedPolygon}
                aria-label="Download polygon as GeoJSON"
                title="Download selected feature as GeoJSON"
              >
                <Download className="size-3.5" />
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <CollapsibleTrigger
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-cyan-900 hover:bg-cyan-100"
              aria-label={isPanelOpen ? "Collapse selected polygon panel" : "Expand selected polygon panel"}
            >
              {isPanelOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent className="mt-1 max-h-[calc(100dvh-10rem)] overflow-y-auto pr-1 md:max-h-[calc(100dvh-11rem)]">
          {!selectedPolygon ? (
            <p className="text-[13px] text-cyan-900/80">
              Click a feature on the map to view its details and attributes.
            </p>
          ) : (
            <>
          <div className="mt-1.5 text-xs text-cyan-900/80">
            {selectedPolygon.groupingColumn
              ? `${selectedPolygon.groupingColumn}: ${selectedPolygon.groupingValue}`
              : `Group: ${selectedPolygon.groupingValue}`}
          </div>
          {areaSquareKilometers !== null && areaHectares !== null ? (
            <Collapsible open={isAreaOpen} onOpenChange={setIsAreaOpen}>
              <div className="mt-2 rounded-md border border-cyan-200/70 bg-white/70">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs font-semibold text-cyan-900">
                  <span>Area Summary</span>
                  {isAreaOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                </CollapsibleTrigger>
                <CollapsibleContent className="px-2 pb-1.5 text-xs text-cyan-950">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-cyan-900/75">Area</span>
                    <span className="text-right font-medium">
                      {formatTooltipArea(areaSquareKilometers)} km²
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-start justify-between gap-2">
                    <span className="text-cyan-900/75">Hectares</span>
                    <span className="text-right font-medium">
                      {formatTooltipArea(areaHectares, true)} ha
                    </span>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          ) : null}

          <Collapsible open={isPropertiesOpen} onOpenChange={setIsPropertiesOpen}>
            <div className="mt-2 rounded-md border border-cyan-200/70 bg-white/70">
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs font-semibold text-cyan-900">
                <span>Properties</span>
                {isPropertiesOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </CollapsibleTrigger>
              <CollapsibleContent className="px-2 pb-1.5">
                {selectedPolygon.properties.length > 0 ? (
                  <div className="space-y-0.5">
                    {selectedPolygon.properties.map((entry) => (
                      <div key={`${entry.key}:${entry.value}`} className="flex items-start justify-between gap-2 text-xs text-cyan-950">
                        <span className="text-cyan-900/75">{entry.key}</span>
                        <span className="min-w-0 break-all text-right">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-cyan-900/75">No properties found for this feature.</div>
                )}
              </CollapsibleContent>
            </div>
          </Collapsible>

          <Collapsible open={isStatsOpen} onOpenChange={setIsStatsOpen}>
            <div className="mt-2 rounded-md border border-cyan-200/70 bg-white/75 text-xs text-cyan-950">
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left">
                <span className="font-semibold text-cyan-900/80">Landcover stats</span>
                <div className="flex items-center gap-2">
                  <span className="text-cyan-900/65">Comparison: {comparisonYear}</span>
                  {isStatsOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="px-2 pb-1.5">
                {!hasPrecomputedStats ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-cyan-900/75" htmlFor="landcover-stats-baseline-year">Baseline year</label>
                      <input
                        id="landcover-stats-baseline-year"
                        type="number"
                        min={1900}
                        max={comparisonYear - 1}
                        value={Number.isFinite(landcoverStatsBaselineYear) ? landcoverStatsBaselineYear : 1990}
                        onChange={(event) => onLandcoverStatsBaselineYearChange(Number.parseInt(event.target.value, 10))}
                        className="h-7 w-20 rounded-md border border-cyan-200 bg-white px-2 text-right font-mono text-xs text-cyan-950 outline-none ring-offset-cyan-50 focus:ring-2 focus:ring-cyan-300"
                      />
                    </div>

                    {!isYearPairValid ? (
                      <div className="mt-1 text-xs text-amber-700">Baseline year must differ from the comparison year.</div>
                    ) : null}

                    {!isPolygonSelection ? (
                      <div className="mt-1 text-xs text-amber-700">Landcover stats only runs on polygon selections.</div>
                    ) : null}

                    <div className="mt-2 flex items-center gap-2">
                      {isStatsActive ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 flex-1 border-cyan-300 bg-white/90 text-xs text-cyan-900 hover:bg-cyan-100"
                          onClick={onCancelLandcoverStats}
                        >
                          Cancel
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 flex-1 border-cyan-300 bg-white/90 text-xs text-cyan-900 hover:bg-cyan-100"
                          onClick={onRunLandcoverStats}
                          disabled={!canStartStats}
                        >
                          {statsActionLabel}
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="mt-1 rounded-md border border-cyan-200/70 bg-cyan-50 px-2 py-1 text-xs text-cyan-900/80">
                    {"Stats are loaded from this polygon's GeoJSON properties."}
                  </div>
                )}

                {(!hasPrecomputedStats && (landcoverStatsJob.message || landcoverStatsJob.error || isStatsActive || landcoverStatsJob.status === "succeeded")) ? (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-cyan-900/75">Status</span>
                      <span className="text-right font-medium">
                        {landcoverStatsJob.error ? "Failed" : landcoverStatsJob.status === "idle" ? "Ready" : landcoverStatsJob.status}
                      </span>
                    </div>

                    {landcoverStatsJob.message ? (
                      <div className="break-words text-cyan-900/75">{landcoverStatsJob.message}</div>
                    ) : null}

                    {landcoverStatsJob.error ? (
                      <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-rose-800">
                        {landcoverStatsJob.error.code}: {landcoverStatsJob.error.message}
                      </div>
                    ) : null}

                    {isStatsActive ? (
                      <div className="space-y-1">
                        {landcoverStatsJob.progress !== null ? (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-cyan-900/75">Progress</span>
                            <span className="tabular-nums">{Math.max(0, Math.min(100, Math.round(landcoverStatsJob.progress))) }%</span>
                          </div>
                        ) : null}
                        <div className="h-1.5 overflow-hidden rounded bg-cyan-100">
                          <div
                            className="h-full bg-cyan-600 transition-[width] duration-300"
                            style={{ width: `${Math.max(4, landcoverStatsJob.progress ?? 10)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2 text-cyan-900/75">
                          <span>ETA</span>
                          <span>{landcoverStatsJob.etaSeconds === null || landcoverStatsJob.etaSeconds === undefined ? "estimating..." : `${Math.max(0, Math.round(landcoverStatsJob.etaSeconds))}s`}</span>
                        </div>
                      </div>
                    ) : null}

                    {displayedStatsResult ? (
                      <div className="rounded-md border border-cyan-200/70 bg-cyan-50/80 px-2 py-1.5">
                        <Collapsible open={isStatsResultOpen} onOpenChange={setIsStatsResultOpen}>
                          <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-cyan-900">
                            <span>Result details</span>
                            {isStatsResultOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                          </CollapsibleTrigger>
                          <CollapsibleContent className="mt-1 space-y-1">
                            {statRows.map(([label, value]) => (
                                <div key={label} className="flex items-start justify-between gap-2 text-xs">
                                <span className="text-cyan-900/75">{label}</span>
                                <span className="min-w-0 text-right font-medium">{value}</span>
                              </div>
                            ))}
                          </CollapsibleContent>
                        </Collapsible>

                        {displayedStatsResult.metadata ? (
                          <Collapsible open={isStatsMetadataOpen} onOpenChange={setIsStatsMetadataOpen}>
                            <div className="mt-1 rounded-md border border-cyan-200/70 bg-white/85 px-2 py-1">
                              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left">
                                <div className="text-xs font-semibold uppercase tracking-wide text-cyan-900/70">Metadata</div>
                                {isStatsMetadataOpen ? <ChevronDown className="size-3.5 text-cyan-900/70" /> : <ChevronRight className="size-3.5 text-cyan-900/70" />}
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words pr-1 text-xs leading-snug text-cyan-950">
{JSON.stringify(displayedStatsResult.metadata, null, 2)}
                                </pre>
                              </CollapsibleContent>
                            </div>
                          </Collapsible>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {hasPrecomputedStats && displayedStatsResult ? (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-cyan-900/75">Status</span>
                      <span className="text-right font-medium">Precomputed</span>
                    </div>

                    <div className="rounded-md border border-cyan-200/70 bg-cyan-50/80 px-2 py-1.5">
                      <Collapsible open={isStatsResultOpen} onOpenChange={setIsStatsResultOpen}>
                        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-cyan-900">
                          <span>Result details</span>
                          {isStatsResultOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-1 space-y-1">
                          {statRows.map(([label, value]) => (
                            <div key={label} className="flex items-start justify-between gap-2 text-xs">
                              <span className="text-cyan-900/75">{label}</span>
                              <span className="min-w-0 text-right font-medium">{value}</span>
                            </div>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>

                      {displayedStatsResult.metadata ? (
                        <Collapsible open={isStatsMetadataOpen} onOpenChange={setIsStatsMetadataOpen}>
                          <div className="mt-1 rounded-md border border-cyan-200/70 bg-white/85 px-2 py-1">
                            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left">
                              <div className="text-xs font-semibold uppercase tracking-wide text-cyan-900/70">Metadata</div>
                              {isStatsMetadataOpen ? <ChevronDown className="size-3.5 text-cyan-900/70" /> : <ChevronRight className="size-3.5 text-cyan-900/70" />}
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words pr-1 text-xs leading-snug text-cyan-950">
{JSON.stringify(displayedStatsResult.metadata, null, 2)}
                              </pre>
                            </CollapsibleContent>
                          </div>
                        </Collapsible>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </CollapsibleContent>
            </div>
          </Collapsible>

          <Collapsible open={isChmStatsOpen} onOpenChange={setIsChmStatsOpen}>
            <div className="mt-2 rounded-md border border-cyan-200/70 bg-white/75 text-xs text-cyan-950">
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left">
                <span className="font-semibold text-cyan-900/80">CHM stats</span>
                {isChmStatsOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </CollapsibleTrigger>
              <CollapsibleContent className="px-2 pb-1.5">
                {!hasPrecomputedChmStats ? (
                  <>
                    {!isPolygonSelection ? (
                      <div className="mt-1 text-xs text-amber-700">CHM stats only runs on polygon selections.</div>
                    ) : null}

                    <div className="mt-2 flex items-center gap-2">
                      {isChmStatsActive ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 flex-1 border-cyan-300 bg-white/90 text-xs text-cyan-900 hover:bg-cyan-100"
                          onClick={onCancelChmStats}
                        >
                          Cancel
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 flex-1 border-cyan-300 bg-white/90 text-xs text-cyan-900 hover:bg-cyan-100"
                          onClick={onRunChmStats}
                          disabled={!canStartChmStats}
                        >
                          {chmStatsActionLabel}
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="mt-1 rounded-md border border-cyan-200/70 bg-cyan-50 px-2 py-1 text-xs text-cyan-900/80">
                    {"CHM stats are loaded from this polygon's GeoJSON properties."}
                  </div>
                )}

                {(!hasPrecomputedChmStats && (chmStatsJob.message || chmStatsJob.error || isChmStatsActive || chmStatsJob.status === "succeeded")) ? (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-cyan-900/75">Status</span>
                      <span className="text-right font-medium">
                        {chmStatsJob.error ? "Failed" : chmStatsJob.status === "idle" ? "Ready" : chmStatsJob.status}
                      </span>
                    </div>

                    {chmStatsJob.message ? (
                      <div className="break-words text-cyan-900/75">{chmStatsJob.message}</div>
                    ) : null}

                    {chmStatsJob.error ? (
                      <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-rose-800">
                        {chmStatsJob.error.code}: {chmStatsJob.error.message}
                      </div>
                    ) : null}

                    {isChmStatsActive ? (
                      <div className="space-y-1">
                        {chmStatsJob.progress !== null ? (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-cyan-900/75">Progress</span>
                            <span className="tabular-nums">{Math.max(0, Math.min(100, Math.round(chmStatsJob.progress)))}%</span>
                          </div>
                        ) : null}
                        <div className="h-1.5 overflow-hidden rounded bg-cyan-100">
                          <div
                            className="h-full bg-cyan-600 transition-[width] duration-300"
                            style={{ width: `${Math.max(4, chmStatsJob.progress ?? 10)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2 text-cyan-900/75">
                          <span>ETA</span>
                          <span>{chmStatsJob.etaSeconds === null || chmStatsJob.etaSeconds === undefined ? "estimating..." : `${Math.max(0, Math.round(chmStatsJob.etaSeconds))}s`}</span>
                        </div>
                      </div>
                    ) : null}

                    {displayedChmStatsResult ? (
                      <div className="rounded-md border border-cyan-200/70 bg-cyan-50/80 px-2 py-1.5">
                        <Collapsible open={isChmStatsResultOpen} onOpenChange={setIsChmStatsResultOpen}>
                          <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-cyan-900">
                            <span>Result details</span>
                            {isChmStatsResultOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                          </CollapsibleTrigger>
                          <CollapsibleContent className="mt-1 space-y-1">
                            {chmSummaryRows.map(([label, value]) => (
                              <div key={label} className="flex items-start justify-between gap-2 text-xs">
                                <span className="text-cyan-900/75">{label}</span>
                                <span className="min-w-0 text-right font-medium">{value}</span>
                              </div>
                            ))}

                            <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-cyan-900/70">Distribution</div>
                            {chmDistributionRows.map(([label, value]) => (
                              <div key={label} className="flex items-start justify-between gap-2 text-xs">
                                <span className="text-cyan-900/75">{label}</span>
                                <span className="min-w-0 text-right font-medium">{value}</span>
                              </div>
                            ))}

                            <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-cyan-900/70">Coverage</div>
                            {chmCoverageRows.map(([label, value]) => (
                              <div key={label} className="flex items-start justify-between gap-2 text-xs">
                                <span className="text-cyan-900/75">{label}</span>
                                <span className="min-w-0 text-right font-medium">{value}</span>
                              </div>
                            ))}

                            {displayedChmStatsResult.canopyCoverByThreshold.length > 0 ? (
                              <div className="mt-2 rounded-md border border-cyan-200/70 bg-white/85 px-2 py-1">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-cyan-900/70">Canopy Cover Thresholds</div>
                                <div className="mt-1 space-y-1">
                                  {displayedChmStatsResult.canopyCoverByThreshold.map((metric) => (
                                    <div key={metric.thresholdM} className="rounded border border-cyan-100 bg-cyan-50/70 px-2 py-1">
                                      <div className="flex items-start justify-between gap-2 text-xs">
                                        <span className="text-cyan-900/75">Threshold</span>
                                        <span className="font-medium">{formatStatsNumber(metric.thresholdM, 2)} m</span>
                                      </div>
                                      <div className="mt-0.5 flex items-start justify-between gap-2 text-xs">
                                        <span className="text-cyan-900/75">Cover ratio</span>
                                        <span className="font-medium">{formatStatsNumber(metric.coverRatio, 4)}</span>
                                      </div>
                                      <div className="mt-0.5 flex items-start justify-between gap-2 text-xs">
                                        <span className="text-cyan-900/75">Cover percent</span>
                                        <span className="font-medium">{formatStatsNumber(metric.coverPercent, 2)}%</span>
                                      </div>
                                      <div className="mt-0.5 flex items-start justify-between gap-2 text-xs">
                                        <span className="text-cyan-900/75">Cover area</span>
                                        <span className="font-medium">{formatStatsNumber(metric.coverAreaHa, 2)} ha</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </CollapsibleContent>
                        </Collapsible>

                        {displayedChmStatsResult.metadata ? (
                          <Collapsible open={isChmStatsMetadataOpen} onOpenChange={setIsChmStatsMetadataOpen}>
                            <div className="mt-1 rounded-md border border-cyan-200/70 bg-white/85 px-2 py-1">
                              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left">
                                <div className="text-xs font-semibold uppercase tracking-wide text-cyan-900/70">Metadata</div>
                                {isChmStatsMetadataOpen ? <ChevronDown className="size-3.5 text-cyan-900/70" /> : <ChevronRight className="size-3.5 text-cyan-900/70" />}
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words pr-1 text-xs leading-snug text-cyan-950">
{JSON.stringify(displayedChmStatsResult.metadata, null, 2)}
                                </pre>
                              </CollapsibleContent>
                            </div>
                          </Collapsible>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {hasPrecomputedChmStats && displayedChmStatsResult ? (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-cyan-900/75">Status</span>
                      <span className="text-right font-medium">Precomputed</span>
                    </div>

                    <div className="rounded-md border border-cyan-200/70 bg-cyan-50/80 px-2 py-1.5">
                      <div className="space-y-1">
                        {chmSummaryRows.map(([label, value]) => (
                          <div key={label} className="flex items-start justify-between gap-2 text-xs">
                            <span className="text-cyan-900/75">{label}</span>
                            <span className="min-w-0 text-right font-medium">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </CollapsibleContent>
            </div>
          </Collapsible>

          <Collapsible open={isAgbStatsOpen} onOpenChange={setIsAgbStatsOpen}>
            <div className="mt-2 rounded-md border border-cyan-200/70 bg-white/75 text-xs text-cyan-950">
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left">
                <span className="font-semibold text-cyan-900/80">AGB stats</span>
                {isAgbStatsOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </CollapsibleTrigger>
              <CollapsibleContent className="px-2 pb-1.5">
                {!hasPrecomputedAgbStats ? (
                  <>
                    {!isPolygonSelection ? (
                      <div className="mt-1 text-xs text-amber-700">AGB stats only runs on polygon selections.</div>
                    ) : null}

                    <div className="mt-2 flex items-center gap-2">
                      {isAgbStatsActive ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 flex-1 border-cyan-300 bg-white/90 text-xs text-cyan-900 hover:bg-cyan-100"
                          onClick={onCancelAgbStats}
                        >
                          Cancel
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 flex-1 border-cyan-300 bg-white/90 text-xs text-cyan-900 hover:bg-cyan-100"
                          onClick={onRunAgbStats}
                          disabled={!canStartAgbStats}
                        >
                          {agbStatsActionLabel}
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="mt-1 rounded-md border border-cyan-200/70 bg-cyan-50 px-2 py-1 text-xs text-cyan-900/80">
                    {"AGB stats are loaded from this polygon's GeoJSON properties."}
                  </div>
                )}

                {(!hasPrecomputedAgbStats && (agbStatsJob.message || agbStatsJob.error || isAgbStatsActive || agbStatsJob.status === "succeeded" || agbStatsJob.status === "partial_success" || agbStatsJob.status === "cancelled")) ? (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-cyan-900/75">Status</span>
                      <span className="text-right font-medium">
                        {agbStatsJob.error
                          ? "Failed"
                          : agbStatsJob.status === "idle"
                            ? "Ready"
                            : agbStatsJob.status === "partial_success"
                              ? "Partial success"
                              : agbStatsJob.status}
                      </span>
                    </div>

                    {agbStatsJob.message ? (
                      <div className="break-words text-cyan-900/75">{agbStatsJob.message}</div>
                    ) : null}

                    {agbStatsJob.status === "cancelled" ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                        AGB stats job was cancelled.
                      </div>
                    ) : null}

                    {agbStatsJob.status === "partial_success" ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                        AGB stats completed with partial results.
                      </div>
                    ) : null}

                    {agbStatsJob.error ? (
                      <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-rose-800">
                        {agbStatsJob.error.code}: {agbStatsJob.error.message}
                      </div>
                    ) : null}

                    {isAgbStatsActive ? (
                      <div className="space-y-1">
                        {agbStatsJob.progress !== null ? (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-cyan-900/75">Progress</span>
                            <span className="tabular-nums">{Math.max(0, Math.min(100, Math.round(agbStatsJob.progress)))}%</span>
                          </div>
                        ) : null}
                        <div className="h-1.5 overflow-hidden rounded bg-cyan-100">
                          <div
                            className="h-full bg-cyan-600 transition-[width] duration-300"
                            style={{ width: `${Math.max(4, agbStatsJob.progress ?? 10)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2 text-cyan-900/75">
                          <span>ETA</span>
                          <span>{agbStatsJob.etaSeconds === null || agbStatsJob.etaSeconds === undefined ? "estimating..." : `${Math.max(0, Math.round(agbStatsJob.etaSeconds))}s`}</span>
                        </div>
                      </div>
                    ) : null}

                    {displayedAgbStatsResult ? (
                      <div className="rounded-md border border-cyan-200/70 bg-cyan-50/80 px-2 py-1.5">
                        <Collapsible open={isAgbStatsResultOpen} onOpenChange={setIsAgbStatsResultOpen}>
                          <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-cyan-900">
                            <span>Result details</span>
                            {isAgbStatsResultOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                          </CollapsibleTrigger>
                          <CollapsibleContent className="mt-1 space-y-1">
                            {agbSummaryRows.map(([label, value]) => (
                              <div key={label} className="flex items-start justify-between gap-2 text-xs">
                                <span className="text-cyan-900/75">{label}</span>
                                <span className="min-w-0 text-right font-medium">{value}</span>
                              </div>
                            ))}

                            <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-cyan-900/70">Distribution</div>
                            {agbDistributionRows.map(([label, value]) => (
                              <div key={label} className="flex items-start justify-between gap-2 text-xs">
                                <span className="text-cyan-900/75">{label}</span>
                                <span className="min-w-0 text-right font-medium">{value}</span>
                              </div>
                            ))}

                            <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-cyan-900/70">Change 2000-2025</div>
                            {agbChangeRows.map(([label, value]) => (
                              <div key={label} className="flex items-start justify-between gap-2 text-xs">
                                <span className="text-cyan-900/75">{label}</span>
                                <span className="min-w-0 text-right font-medium">{value}</span>
                              </div>
                            ))}

                            <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-cyan-900/70">Coverage</div>
                            {agbCoverageRows.map(([label, value]) => (
                              <div key={label} className="flex items-start justify-between gap-2 text-xs">
                                <span className="text-cyan-900/75">{label}</span>
                                <span className="min-w-0 text-right font-medium">{value}</span>
                              </div>
                            ))}

                            {displayedAgbStatsResult.agbCoverByThreshold.length > 0 ? (
                              <div className="mt-2 rounded-md border border-cyan-200/70 bg-white/85 px-2 py-1">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-cyan-900/70">AGB Threshold Coverage</div>
                                <div className="mt-1 space-y-1">
                                  {displayedAgbStatsResult.agbCoverByThreshold.map((metric) => (
                                    <div key={metric.thresholdMgHa} className="rounded border border-cyan-100 bg-cyan-50/70 px-2 py-1">
                                      <div className="flex items-start justify-between gap-2 text-xs">
                                        <span className="text-cyan-900/75">Threshold</span>
                                        <span className="font-medium">{formatStatsNumber(metric.thresholdMgHa, 2)} Mg/ha</span>
                                      </div>
                                      <div className="mt-0.5 flex items-start justify-between gap-2 text-xs">
                                        <span className="text-cyan-900/75">Cover ratio</span>
                                        <span className="font-medium">{formatStatsNumber(metric.coverRatio, 4)}</span>
                                      </div>
                                      <div className="mt-0.5 flex items-start justify-between gap-2 text-xs">
                                        <span className="text-cyan-900/75">Cover percent</span>
                                        <span className="font-medium">{formatStatsNumber(metric.coverPercent, 2)}%</span>
                                      </div>
                                      <div className="mt-0.5 flex items-start justify-between gap-2 text-xs">
                                        <span className="text-cyan-900/75">Cover area</span>
                                        <span className="font-medium">{formatStatsNumber(metric.coverAreaHa, 2)} ha</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </CollapsibleContent>
                        </Collapsible>

                        {displayedAgbStatsResult.metadata ? (
                          <Collapsible open={isAgbStatsMetadataOpen} onOpenChange={setIsAgbStatsMetadataOpen}>
                            <div className="mt-1 rounded-md border border-cyan-200/70 bg-white/85 px-2 py-1">
                              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left">
                                <div className="text-xs font-semibold uppercase tracking-wide text-cyan-900/70">Metadata</div>
                                {isAgbStatsMetadataOpen ? <ChevronDown className="size-3.5 text-cyan-900/70" /> : <ChevronRight className="size-3.5 text-cyan-900/70" />}
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words pr-1 text-xs leading-snug text-cyan-950">
{JSON.stringify(displayedAgbStatsResult.metadata, null, 2)}
                                </pre>
                              </CollapsibleContent>
                            </div>
                          </Collapsible>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {hasPrecomputedAgbStats && displayedAgbStatsResult ? (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-cyan-900/75">Status</span>
                      <span className="text-right font-medium">Precomputed</span>
                    </div>

                    <div className="rounded-md border border-cyan-200/70 bg-cyan-50/80 px-2 py-1.5">
                      <div className="space-y-1">
                        {agbSummaryRows.map(([label, value]) => (
                          <div key={label} className="flex items-start justify-between gap-2 text-xs">
                            <span className="text-cyan-900/75">{label}</span>
                            <span className="min-w-0 text-right font-medium">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </CollapsibleContent>
            </div>
          </Collapsible>
            </>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function formatStatsNumber(value: number, digits: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function MapBottomSlider({
  year,
  minYear,
  maxYear,
  isFrameLoading,
  onYearChange,
}: MapBottomSliderProps) {
  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 z-30 -translate-x-1/2 md:bottom-3">
      <div className="pointer-events-auto w-fit">
        <TimeSlider
          year={year}
          minYear={minYear}
          maxYear={maxYear}
          isFrameLoading={isFrameLoading}
          onYearChange={onYearChange}
        />
      </div>
    </div>
  );
}

export function HoverVectorTooltip({
  hoveredVector,
  hoverTooltipStyle,
  isVisible,
}: HoverVectorTooltipProps) {
  if (!isVisible || !hoverTooltipStyle || !hoveredVector) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute z-40 max-w-72 rounded-md border border-cyan-100/60 bg-cyan-950/88 px-2.5 py-2 text-[11px] text-white shadow-lg backdrop-blur-sm duration-100 ease-out animate-in fade-in-0 zoom-in-95 slide-in-from-left-1 transition-[left,top]"
      style={hoverTooltipStyle}
    >
      <div className="truncate text-xs font-semibold text-cyan-100">{hoveredVector.layerName}</div>
      {hoveredVector.placeLabel ? (
        <div className="mt-0.5 truncate text-[11px] font-medium text-white">{hoveredVector.placeLabel}</div>
      ) : null}
      <div className="mt-0.5 text-[10px] text-cyan-100/80">
        {hoveredVector.groupingColumn
          ? `${hoveredVector.groupingColumn}: ${hoveredVector.groupingValue}`
          : `Group: ${hoveredVector.groupingValue}`}
      </div>
    </div>
  );
}

export function FloatingStatusMessage({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute bottom-28 left-1/2 max-w-[90vw] -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-xs text-white shadow-lg md:bottom-36">
      {message}
    </div>
  );
}