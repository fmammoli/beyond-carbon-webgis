"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Layers, MapPlus } from "lucide-react";

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
import type { LandcoverStatsJobStatus, LandcoverStatsResult } from "@/lib/landcover-stats";
import type { PmtilesZoomRange } from "@/lib/pmtiles-source";

type HoveredClassInfo = {
  color: string;
  label: string;
  labelId: string;
};

type HoverPixelPanelInfo = {
  code: number | null;
  red: number;
  green: number;
  blue: number;
  alpha: number;
  requestedZoom: number | null;
  sourceZoom: number | null;
};

type MapTopPanelsProps = {
  isSatelliteVisible: boolean;
  isBoundariesAndPlacesVisible: boolean;
  isLandcoverVisible: boolean;
  landcoverOpacity: number;
  activeLegendLayers: ActiveLegendLayer[];
  isLegendOpen: boolean;
  onSatelliteChange: (visible: boolean) => void;
  onBoundariesAndPlacesChange: (visible: boolean) => void;
  onLandcoverChange: (visible: boolean) => void;
  onLandcoverOpacityChange: (opacity: number) => void;
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
  primaryAction?: ReactNode;
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
  isPlaying: boolean;
  canAdvance: boolean;
  isFrameLoading: boolean;
  isPreloadingYears: boolean;
  onYearChange: (year: number) => void;
  onPlayingChange: (isPlaying: boolean) => void;
};

type HoverClassTooltipProps = {
  hoveredClass: HoveredClassInfo | null;
  hoverTooltipStyle: CSSProperties | null;
  isVisible: boolean;
};

type HoveredVectorInfo = {
  layerName: string;
  groupingColumn: string | null;
  groupingValue: string;
};

type SelectedPolygonInfo = {
  layerName: string;
  groupingColumn: string | null;
  groupingValue: string;
  properties: Array<{ key: string; value: string }>;
  areaSquareKilometers: number | null;
  areaHectares: number | null;
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

type HoverVectorTooltipProps = {
  hoveredVector: HoveredVectorInfo | null;
  hoveredClass: HoveredClassInfo | null;
  hoveredClassCode: number | null;
  hoverTooltipStyle: CSSProperties | null;
  isVisible: boolean;
};

type PixelInspectorPanelProps = {
  hoverPixelInfo: HoverPixelPanelInfo | null;
  hoveredClass: HoveredClassInfo | null;
  pmtilesZoomRange: PmtilesZoomRange | null;
  isVisible: boolean;
};

function formatTooltipArea(value: number, compact = false): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: compact && value >= 100 ? 0 : value >= 10 ? 1 : 2,
    maximumFractionDigits: compact && value >= 100 ? 0 : value >= 10 ? 1 : 2,
  }).format(value);
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
  activeLegendLayers,
  isLegendOpen,
  onSatelliteChange,
  onBoundariesAndPlacesChange,
  onLandcoverChange,
  onLandcoverOpacityChange,
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
  primaryAction,
}: MapTopPanelsProps) {
  const hasCommunityPanel = Boolean(primaryAction);

  return (
    <div className="absolute left-3 right-3 top-3 md:left-5 md:right-5 md:top-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="pointer-events-auto flex h-[calc(100dvh-5.5rem)] w-full min-h-0 md:h-[calc(100dvh-6.5rem)] md:w-auto md:min-w-[18rem]">
          <Card className="flex h-full min-h-0 w-[min(92vw,18rem)] flex-col border-white/30 bg-card/85 shadow-lg backdrop-blur-sm">
            {hasCommunityPanel ? (
              <Tabs defaultValue="layers" className="min-h-0 flex-1 gap-0 px-2 pb-2 pt-2">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="layers" aria-label="Open layer controls tab">
                    <Layers />
                    Layers
                  </TabsTrigger>
                  <TabsTrigger value="community" aria-label="Open community map tab">
                    <MapPlus />
                    Community
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="layers" className="min-h-0 flex-1 overflow-hidden pb-0 pt-1">
                  <CardContent className="min-h-0 h-full overflow-hidden px-0 pb-0 pt-0">
                    <MapControls
                      isSatelliteVisible={isSatelliteVisible}
                      isBoundariesAndPlacesVisible={isBoundariesAndPlacesVisible}
                      isLandcoverVisible={isLandcoverVisible}
                      landcoverOpacity={landcoverOpacity}
                      onSatelliteChange={onSatelliteChange}
                      onBoundariesAndPlacesChange={onBoundariesAndPlacesChange}
                      onLandcoverChange={onLandcoverChange}
                      onLandcoverOpacityChange={onLandcoverOpacityChange}
                      embedded
                    />
                  </CardContent>
                </TabsContent>
                <TabsContent value="community" className="min-h-0 flex-1 overflow-hidden pb-0 pt-1">
                  <CardContent className="min-h-0 h-full overflow-hidden px-0 pb-0 pt-0">
                    <div className="min-h-0 h-full rounded-md border border-cyan-200/60 bg-cyan-50/40 p-2">
                      {primaryAction}
                    </div>
                  </CardContent>
                </TabsContent>
              </Tabs>
            ) : (
              <CardContent className="min-h-0 flex-1 overflow-hidden px-2 pb-2 pt-2">
                <MapControls
                  isSatelliteVisible={isSatelliteVisible}
                  isBoundariesAndPlacesVisible={isBoundariesAndPlacesVisible}
                  isLandcoverVisible={isLandcoverVisible}
                  landcoverOpacity={landcoverOpacity}
                  onSatelliteChange={onSatelliteChange}
                  onBoundariesAndPlacesChange={onBoundariesAndPlacesChange}
                  onLandcoverChange={onLandcoverChange}
                  onLandcoverOpacityChange={onLandcoverOpacityChange}
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
}) {
  const isStatsActive = landcoverStatsJob.status === "submitting" || landcoverStatsJob.status === "queued" || landcoverStatsJob.status === "running";
  const isBaselineYearValid = Number.isInteger(landcoverStatsBaselineYear);
  const isYearPairValid = isBaselineYearValid && landcoverStatsBaselineYear !== comparisonYear;
  const canStartStats = Boolean(selectedPolygon) && isYearPairValid && !isStatsActive;
  const [isAreaOpen, setIsAreaOpen] = useState(true);
  const [isPropertiesOpen, setIsPropertiesOpen] = useState(true);
  const [isStatsOpen, setIsStatsOpen] = useState(true);
  const [isStatsResultOpen, setIsStatsResultOpen] = useState(true);
  const [isStatsMetadataOpen, setIsStatsMetadataOpen] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const statsActionLabel = isStatsActive
    ? landcoverStatsJob.status === "submitting"
      ? "Submitting..."
      : landcoverStatsJob.status === "queued"
        ? "Queued..."
        : "Running..."
    : landcoverStatsJob.status === "failed"
      ? "Retry stats"
      : "Run landcover stats";

  const statRows = landcoverStatsJob.result
    ? [
        ["Baseline year", landcoverStatsJob.result.baselineYear === undefined ? "N/A" : String(landcoverStatsJob.result.baselineYear)],
        ["Comparison year", landcoverStatsJob.result.comparisonYear === undefined ? "N/A" : String(landcoverStatsJob.result.comparisonYear)],
        ["Forest loss", `${formatStatsNumber(landcoverStatsJob.result.forestLossHa, 2)} ha`],
        ["Forest loss (%)", landcoverStatsJob.result.forestLossPct === undefined ? "N/A" : `${formatStatsNumber(landcoverStatsJob.result.forestLossPct, 3)}%`],
        ["Forest gain", `${formatStatsNumber(landcoverStatsJob.result.forestGainHa, 2)} ha`],
        ["Forest gain (%)", landcoverStatsJob.result.forestGainPct === undefined ? "N/A" : `${formatStatsNumber(landcoverStatsJob.result.forestGainPct, 3)}%`],
        ["Net change", `${formatStatsNumber(landcoverStatsJob.result.netForestChangeHa, 2)} ha`],
        ["Baseline forest area", `${formatStatsNumber(landcoverStatsJob.result.baselineForestAreaHa, 2)} ha`],
        ["Comparison forest area", `${formatStatsNumber(landcoverStatsJob.result.comparisonForestAreaHa, 2)} ha`],
        ["Analyzed area", `${formatStatsNumber(landcoverStatsJob.result.analyzedAreaHa, 2)} ha`],
        ["AOI area", `${formatStatsNumber(landcoverStatsJob.result.aoiAreaHa, 2)} ha`],
        ["Coverage fraction", formatStatsNumber(landcoverStatsJob.result.coverageFraction, 3)],
        ["Valid pixels", new Intl.NumberFormat("en-US").format(landcoverStatsJob.result.validPixelCount)],
      ]
    : [];

  return (
    <Collapsible open={isPanelOpen} onOpenChange={setIsPanelOpen}>
      <div className="w-[min(92vw,18rem)] rounded-xl border border-cyan-200/70 bg-cyan-50/90 p-3 text-[13px] shadow-lg backdrop-blur-sm">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left">
          <div className="text-base font-semibold text-cyan-950 md:text-[17px]">Selected Polygon</div>
          {isPanelOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </CollapsibleTrigger>

        <CollapsibleContent className="mt-1 max-h-[calc(100dvh-10rem)] overflow-y-auto pr-1 md:max-h-[calc(100dvh-11rem)]">
          {!selectedPolygon ? (
            <p className="text-[13px] text-cyan-900/80">
              Click a polygon on the map to view its area and attributes.
            </p>
          ) : (
            <>
          <div className="mt-1.5 text-xs text-cyan-900/80">Layer: {selectedPolygon.layerName}</div>
          <div className="mt-1 text-xs text-cyan-900/80">
            {selectedPolygon.groupingColumn
              ? `${selectedPolygon.groupingColumn}: ${selectedPolygon.groupingValue}`
              : `Group: ${selectedPolygon.groupingValue}`}
          </div>
          {selectedPolygon.areaSquareKilometers !== null && selectedPolygon.areaHectares !== null ? (
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
                      {formatTooltipArea(selectedPolygon.areaSquareKilometers)} km²
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-start justify-between gap-2">
                    <span className="text-cyan-900/75">Hectares</span>
                    <span className="text-right font-medium">
                      {formatTooltipArea(selectedPolygon.areaHectares, true)} ha
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
                  <div className="max-h-52 space-y-0.5 overflow-y-auto pr-1">
                    {selectedPolygon.properties.map((entry) => (
                      <div key={`${entry.key}:${entry.value}`} className="flex items-start justify-between gap-2 text-xs text-cyan-950">
                        <span className="text-cyan-900/75">{entry.key}</span>
                        <span className="min-w-0 break-all text-right">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-cyan-900/75">No properties found for this polygon.</div>
                )}
              </CollapsibleContent>
            </div>
          </Collapsible>

          <div className="mt-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 w-full border-cyan-300 bg-white/90 text-[11px] text-cyan-900 hover:bg-cyan-100"
              onClick={onDownloadSelectedPolygonGeoJson}
              disabled={!canDownloadSelectedPolygon}
            >
              Download Polygon as GeoJSON
            </Button>
          </div>

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

                {landcoverStatsJob.message || landcoverStatsJob.error || isStatsActive || landcoverStatsJob.status === "succeeded" ? (
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

                    {landcoverStatsJob.result ? (
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

                        {landcoverStatsJob.result.metadata ? (
                          <Collapsible open={isStatsMetadataOpen} onOpenChange={setIsStatsMetadataOpen}>
                            <div className="mt-1 rounded-md border border-cyan-200/70 bg-white/85 px-2 py-1">
                              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left">
                                <div className="text-xs font-semibold uppercase tracking-wide text-cyan-900/70">Metadata</div>
                                {isStatsMetadataOpen ? <ChevronDown className="size-3.5 text-cyan-900/70" /> : <ChevronRight className="size-3.5 text-cyan-900/70" />}
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words pr-1 text-xs leading-snug text-cyan-950">
{JSON.stringify(landcoverStatsJob.result.metadata, null, 2)}
                                </pre>
                              </CollapsibleContent>
                            </div>
                          </Collapsible>
                        ) : null}
                      </div>
                    ) : null}
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
  isPlaying,
  canAdvance,
  isFrameLoading,
  isPreloadingYears,
  onYearChange,
  onPlayingChange,
}: MapBottomSliderProps) {
  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 z-30 -translate-x-1/2 md:bottom-3">
      <div className="pointer-events-auto w-fit">
        <TimeSlider
          year={year}
          minYear={minYear}
          maxYear={maxYear}
          isPlaying={isPlaying}
          canAdvance={canAdvance}
          isFrameLoading={isFrameLoading}
          isPreloadingYears={isPreloadingYears}
          onYearChange={onYearChange}
          onPlayingChange={onPlayingChange}
        />
      </div>
    </div>
  );
}

export function HoverClassTooltip({
  hoveredClass,
  hoverTooltipStyle,
  isVisible,
}: HoverClassTooltipProps) {
  if (!isVisible || !hoverTooltipStyle || !hoveredClass) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute z-40 max-w-48 rounded-md border border-white/35 bg-black/75 px-2.5 py-1.5 text-[11px] text-white shadow-lg backdrop-blur-sm duration-100 ease-out animate-in fade-in-0 zoom-in-95 slide-in-from-left-1 transition-[left,top]"
      style={hoverTooltipStyle}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-3 w-3 shrink-0 rounded-xs ring-1 ring-white/60"
          style={{ backgroundColor: hoveredClass.color }}
        />
        <div className="min-w-0 leading-tight">
          <div className="truncate">{hoveredClass.label}</div>
          <div className="truncate text-white/75">{hoveredClass.labelId}</div>
        </div>
      </div>
    </div>
  );
}

export function HoverVectorTooltip({
  hoveredVector,
  hoveredClass,
  hoveredClassCode,
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
      <div className="mt-0.5 text-[10px] text-cyan-100/80">
        {hoveredVector.groupingColumn
          ? `${hoveredVector.groupingColumn}: ${hoveredVector.groupingValue}`
          : `Group: ${hoveredVector.groupingValue}`}
      </div>
      {hoveredClass || hoveredClassCode !== null ? (
        <div className="mt-1.5 border-t border-cyan-100/25 pt-1.5 text-[10px] text-cyan-100/90">
          {hoveredClass ? (
            <>
              <div className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-xs ring-1 ring-white/60"
                  style={{ backgroundColor: hoveredClass.color }}
                />
                <span className="truncate">Landcover: {hoveredClass.label}</span>
              </div>
              <div className="mt-0.5 truncate text-cyan-100/75">{hoveredClass.labelId}</div>
            </>
          ) : (
            <div className="truncate">Landcover: Unmapped</div>
          )}
          {hoveredClassCode !== null ? (
            <div className="mt-0.5 font-mono text-cyan-100/80">Code: {hoveredClassCode}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function PixelInspectorPanel({
  hoverPixelInfo,
  hoveredClass,
  pmtilesZoomRange,
  isVisible,
}: PixelInspectorPanelProps) {
  if (!isVisible || !hoverPixelInfo) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute bottom-28 right-3 w-[min(92vw,22rem)] rounded-xl border border-white/30 bg-black/70 px-3 py-2 text-xs text-white shadow-lg backdrop-blur-sm md:bottom-36 md:right-5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">Pixel Inspector</span>
        <span className="text-[11px] text-amber-200">Classified mode</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span>Code</span>
        <span className="font-mono tabular-nums">
          {hoverPixelInfo.code === null ? "NoData" : hoverPixelInfo.code}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span>RGBA</span>
        <span className="font-mono tabular-nums">
          {hoverPixelInfo.red}, {hoverPixelInfo.green}, {hoverPixelInfo.blue}, {hoverPixelInfo.alpha}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span>Requested z</span>
        <span className="font-mono tabular-nums">{hoverPixelInfo.requestedZoom ?? "-"}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span>Source z used</span>
        <span className="font-mono tabular-nums">{hoverPixelInfo.sourceZoom ?? "-"}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span>PMTiles z-range</span>
        <span className="font-mono tabular-nums">
          {pmtilesZoomRange
            ? `${pmtilesZoomRange.minZoom}-${pmtilesZoomRange.maxZoom}`
            : "unknown"}
        </span>
      </div>
      {hoverPixelInfo.requestedZoom !== null &&
      hoverPixelInfo.sourceZoom !== null &&
      hoverPixelInfo.requestedZoom !== hoverPixelInfo.sourceZoom ? (
        <div className="mt-1 text-[11px] text-amber-100/90">
          Overzoom active: rendering from source z{hoverPixelInfo.sourceZoom}.
        </div>
      ) : null}
      <div className="mt-1 flex items-center justify-between gap-2">
        <span>Legend</span>
        {hoveredClass ? (
          <span className="flex items-center gap-2 text-right">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-xs ring-1 ring-white/60"
              style={{ backgroundColor: hoveredClass.color }}
            />
            <span className="truncate">{hoveredClass.label}</span>
          </span>
        ) : (
          <span className="text-white/80">Unmapped</span>
        )}
      </div>
      <div className="mt-2 text-[11px] text-amber-100/90">
        Landcover classes are decoded from rendered PMTiles colors.
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