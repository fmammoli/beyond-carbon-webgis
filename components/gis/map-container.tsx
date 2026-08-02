"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Feature as GeoJsonFeature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import type OLMap from "ol/Map";
import type { Extent } from "ol/extent";
import GeoJSON from "ol/format/GeoJSON";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import "ol/ol.css";

import {
  AGB_FILE_SUFFIX,
  AGB_MAX_YEAR,
  AGB_MIN_YEAR,
  DEFAULT_AGB_OPACITY,
  DEFAULT_CHM_OPACITY,
  DEFAULT_R2_AGB_PMTILES_BASE_URL,
  DEFAULT_R2_CHM_KETAPANG_PMTILES_URL,
  DEFAULT_R2_CHM_PMTILES_URL,
  DEFAULT_LANDCOVER_OPACITY,
  DEFAULT_R2_PMTILES_BASE_URL,
  DEFAULT_YEAR,
  MAX_YEAR,
  MIN_YEAR,
  THREAT_MAP_SQUARE_SIDE_KM,
} from "@/lib/gis-constants";
import {
  MAX_COMMUNITY_BOUNDARY_BUFFER_METERS,
} from "@/lib/community-boundary";
import { MapCanvas, type MapCanvasReadyPayload } from "@/components/gis/map-canvas";
import {
  CommunityMapPanel,
} from "@/components/gis/community-map-panel";
import { ExportsPanel } from "@/components/gis/exports-panel";
import {
  FloatingStatusMessage,
  HoverVectorTooltip,
  MapBottomSlider,
  OverlayHoverBoundary,
  MapTopPanels,
} from "@/components/gis/map-overlay-panels";
import {
  ThreatMapOverlay,
} from "@/components/gis/threat-map-overlay";
import { PolygonConfirmDialog } from "@/components/gis/polygon-confirm-dialog";
import { PointLabelDialog } from "@/components/gis/point-label-dialog";
import { PmtilesLayer } from "@/components/gis/pmtiles-layer";
import { VectorDropzone, type VectorDropzoneHandle } from "@/components/gis/vector-dropzone";
import { useLandcoverStatsJob } from "@/hooks/use-landcover-stats-job";
import { useChmStatsJob } from "@/hooks/use-chm-stats-job";
import { useAgbStatsJob } from "@/hooks/use-agb-stats-job";
import {
  useCommunityPolygonDrawing,
} from "@/hooks/use-community-polygon-drawing";
import {
  useMapPointerInteractions,
} from "@/hooks/use-map-pointer-interactions";
import {
  useMapVectorLayers,
} from "@/hooks/use-map-vector-layers";
import {
  useThreatMapExportFlow,
} from "@/hooks/use-threat-map-export-flow";
import { type LandcoverStatsResult, formatLandcoverStatsError } from "@/lib/landcover-stats";
import { type ChmStatsResult, formatChmStatsError } from "@/lib/chm-stats";
import { type AgbStatsResult, formatAgbStatsError } from "@/lib/agb-stats";
import { shouldUseAgbStatsResultForSelection, shouldUseStatsResultForSelection } from "@/lib/agb-stats-selection";
import {
  type PmtilesArchiveOptions,
} from "@/lib/pmtiles-source";
import { getGroupableColumns } from "@/lib/vector-grouping";
import {
  captureMapWithLegendPng,
  downloadBlob,
  getCaptureMapScreenFocusRect,
} from "@/lib/map-capture-export";

type MapContextState = {
  map: OLMap | null;
};

const MAX_COMMUNITY_BOUNDARY_BUFFER_KM = MAX_COMMUNITY_BOUNDARY_BUFFER_METERS / 1000;
const WORKSHOP_VECTOR_Z_INDEX = 2000;
const CONCESSION_VECTOR_Z_INDEX = 2000;
const WORKSHOP_DEFAULT_FILL_OPACITY = 0;
const CONCESSION_DEFAULT_FILL_OPACITY = 0.12;
const LAST_BOUNDARY_EXTENT_STORAGE_KEY = "bc:last-boundary-extent:v1";

const BUILT_IN_VECTOR_LAYER_COLORS = [
  "#0f766e",
  "#0ea5e9",
  "#7c3aed",
  "#dc2626",
  "#f59e0b",
  "#16a34a",
  "#db2777",
  "#2563eb",
  "#9333ea",
  "#ea580c",
  "#059669",
  "#be123c",
];

type WorkshopRegionsApiResponse = {
  regions: string[];
};

type ConcessionsApiResponse = {
  concessions: string[];
};

type JkppHcsCarbonApiResponse = {
  files: string[];
};

function formatAreaSquareKilometers(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: value >= 10 ? 1 : 2,
    maximumFractionDigits: value >= 10 ? 1 : 2,
  }).format(value);
}

function formatKilometers(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: value >= 10 ? 1 : 2,
    maximumFractionDigits: value >= 10 ? 1 : 2,
  }).format(value);
}

function formatLayerName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.geojson$/i, "");
  const words = withoutExtension.split(/[-_\s]+/g).filter(Boolean);

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    if (!normalized) {
      return null;
    }

    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readPrecomputedNumber(record: Record<string, unknown>, key: string, fallbackKey?: string): number | null {
  const directValue = toFiniteNumber(record[key]);
  if (directValue !== null) {
    return directValue;
  }

  if (fallbackKey) {
    return toFiniteNumber(record[fallbackKey]);
  }

  return null;
}

function readPrecomputedOptionalNumber(record: Record<string, unknown>, key: string, fallbackKey?: string): number | undefined {
  const value = readPrecomputedNumber(record, key, fallbackKey);
  return value === null ? undefined : value;
}

function readPrecomputedMetadata(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const excludedKeys = new Set([
    "baselineYear",
    "comparisonYear",
    "forestLossHa",
    "forestLossPct",
    "forestGainHa",
    "forestGainPct",
    "netForestChangeHa",
    "baselineForestAreaHa",
    "comparisonForestAreaHa",
    "analyzedAreaHa",
    "aoiAreaHa",
    "coverageFraction",
    "validPixelCount",
    "geometry",
  ]);

  const metadataEntries = Object.entries(record).filter(([key]) => !excludedKeys.has(key));
  if (metadataEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(metadataEntries);
}

function resolvePrecomputedLandcoverStats(properties: Record<string, unknown>): LandcoverStatsResult | null {
  const requiredNumbers = {
    forestLossHa: readPrecomputedNumber(properties, "forestLossHa", "forest_loss_ha"),
    forestGainHa: readPrecomputedNumber(properties, "forestGainHa", "forest_gain_ha"),
    netForestChangeHa: readPrecomputedNumber(properties, "netForestChangeHa", "net_forest_change_ha"),
    baselineForestAreaHa: readPrecomputedNumber(properties, "baselineForestAreaHa", "baseline_forest_area_ha"),
    comparisonForestAreaHa: readPrecomputedNumber(properties, "comparisonForestAreaHa", "comparison_forest_area_ha"),
    analyzedAreaHa: readPrecomputedNumber(properties, "analyzedAreaHa", "analyzed_area_ha"),
    aoiAreaHa: readPrecomputedNumber(properties, "aoiAreaHa", "aoi_area_ha"),
    coverageFraction: readPrecomputedNumber(properties, "coverageFraction", "coverage_fraction"),
    validPixelCount: readPrecomputedNumber(properties, "validPixelCount", "valid_pixel_count"),
  };

  if (Object.values(requiredNumbers).some((value) => value === null)) {
    return null;
  }

  return {
    baselineYear: readPrecomputedOptionalNumber(properties, "baselineYear", "baseline_year"),
    comparisonYear: readPrecomputedOptionalNumber(properties, "comparisonYear", "comparison_year"),
    forestLossHa: requiredNumbers.forestLossHa as number,
    forestLossPct: readPrecomputedOptionalNumber(properties, "forestLossPct", "forest_loss_pct"),
    forestGainHa: requiredNumbers.forestGainHa as number,
    forestGainPct: readPrecomputedOptionalNumber(properties, "forestGainPct", "forest_gain_pct"),
    netForestChangeHa: requiredNumbers.netForestChangeHa as number,
    baselineForestAreaHa: requiredNumbers.baselineForestAreaHa as number,
    comparisonForestAreaHa: requiredNumbers.comparisonForestAreaHa as number,
    analyzedAreaHa: requiredNumbers.analyzedAreaHa as number,
    aoiAreaHa: requiredNumbers.aoiAreaHa as number,
    coverageFraction: requiredNumbers.coverageFraction as number,
    validPixelCount: requiredNumbers.validPixelCount as number,
    metadata: readPrecomputedMetadata(properties),
  };
}

function resolvePrecomputedLandcoverStatsFromEntries(
  properties: Array<{ key: string; value: string }>,
): LandcoverStatsResult | null {
  const record: Record<string, unknown> = {};

  for (const entry of properties) {
    const normalizedKey = entry.key.trim();
    if (!normalizedKey) {
      continue;
    }

    record[normalizedKey] = entry.value;
  }

  return resolvePrecomputedLandcoverStats(record);
}

function resolvePrecomputedChmStats(properties: Record<string, unknown>): ChmStatsResult | null {
  const minCanopyHeightM = toFiniteNumber(properties.minCanopyHeightM ?? properties.min_canopy_height_m);
  const maxCanopyHeightM = toFiniteNumber(properties.maxCanopyHeightM ?? properties.max_canopy_height_m);
  const meanCanopyHeightM = toFiniteNumber(properties.meanCanopyHeightM ?? properties.mean_canopy_height_m);
  const medianCanopyHeightM = toFiniteNumber(properties.medianCanopyHeightM ?? properties.median_canopy_height_m);
  const stdDevCanopyHeightM = toFiniteNumber(properties.stdDevCanopyHeightM ?? properties.std_dev_canopy_height_m);
  const varianceCanopyHeightM2 = toFiniteNumber(properties.varianceCanopyHeightM2 ?? properties.variance_canopy_height_m2);
  const p10CanopyHeightM = toFiniteNumber(properties.p10CanopyHeightM ?? properties.p10_canopy_height_m);
  const p25CanopyHeightM = toFiniteNumber(properties.p25CanopyHeightM ?? properties.p25_canopy_height_m);
  const p75CanopyHeightM = toFiniteNumber(properties.p75CanopyHeightM ?? properties.p75_canopy_height_m);
  const p90CanopyHeightM = toFiniteNumber(properties.p90CanopyHeightM ?? properties.p90_canopy_height_m);
  const p95CanopyHeightM = toFiniteNumber(properties.p95CanopyHeightM ?? properties.p95_canopy_height_m);
  const interquartileRangeM = toFiniteNumber(properties.interquartileRangeM ?? properties.interquartile_range_m);
  const coefficientOfVariation = toFiniteNumber(properties.coefficientOfVariation ?? properties.coefficient_of_variation);
  const totalCanopyVolumeProxyM3 = toFiniteNumber(properties.totalCanopyVolumeProxyM3 ?? properties.total_canopy_volume_proxy_m3);
  const analyzedAreaHa = toFiniteNumber(properties.analyzedAreaHa ?? properties.analyzed_area_ha);
  const aoiAreaHa = toFiniteNumber(properties.aoiAreaHa ?? properties.aoi_area_ha);
  const coverageFraction = toFiniteNumber(properties.coverageFraction ?? properties.coverage_fraction);
  const validPixelCount = toFiniteNumber(properties.validPixelCount ?? properties.valid_pixel_count);

  if (
    minCanopyHeightM === null ||
    maxCanopyHeightM === null ||
    meanCanopyHeightM === null ||
    medianCanopyHeightM === null ||
    stdDevCanopyHeightM === null ||
    varianceCanopyHeightM2 === null ||
    p10CanopyHeightM === null ||
    p25CanopyHeightM === null ||
    p75CanopyHeightM === null ||
    p90CanopyHeightM === null ||
    p95CanopyHeightM === null ||
    interquartileRangeM === null ||
    coefficientOfVariation === null ||
    totalCanopyVolumeProxyM3 === null ||
    analyzedAreaHa === null ||
    aoiAreaHa === null ||
    coverageFraction === null ||
    validPixelCount === null
  ) {
    return null;
  }

  return {
    minCanopyHeightM,
    maxCanopyHeightM,
    meanCanopyHeightM,
    medianCanopyHeightM,
    stdDevCanopyHeightM,
    varianceCanopyHeightM2,
    p10CanopyHeightM,
    p25CanopyHeightM,
    p75CanopyHeightM,
    p90CanopyHeightM,
    p95CanopyHeightM,
    interquartileRangeM,
    coefficientOfVariation,
    totalCanopyVolumeProxyM3,
    analyzedAreaHa,
    aoiAreaHa,
    coverageFraction,
    validPixelCount,
    canopyCoverByThreshold: [],
  };
}

function resolvePrecomputedChmStatsFromEntries(
  properties: Array<{ key: string; value: string }>,
): ChmStatsResult | null {
  const record: Record<string, unknown> = {};

  for (const entry of properties) {
    const normalizedKey = entry.key.trim();
    if (!normalizedKey) {
      continue;
    }

    record[normalizedKey] = entry.value;
  }

  return resolvePrecomputedChmStats(record);
}

function resolvePrecomputedAgbStats(properties: Record<string, unknown>): AgbStatsResult | null {
  const baselineYear = toFiniteNumber(properties.baselineYear ?? properties.baseline_year);
  const comparisonYear = toFiniteNumber(properties.comparisonYear ?? properties.comparison_year);
  const minAgbMgHa = toFiniteNumber(properties.minAgbMgHa ?? properties.min_agb_mg_ha);
  const maxAgbMgHa = toFiniteNumber(properties.maxAgbMgHa ?? properties.max_agb_mg_ha);
  const meanAgbMgHa = toFiniteNumber(properties.meanAgbMgHa ?? properties.mean_agb_mg_ha);
  const medianAgbMgHa = toFiniteNumber(properties.medianAgbMgHa ?? properties.median_agb_mg_ha);
  const stdDevAgbMgHa = toFiniteNumber(properties.stdDevAgbMgHa ?? properties.std_dev_agb_mg_ha);
  const varianceAgbMgHa2 = toFiniteNumber(properties.varianceAgbMgHa2 ?? properties.variance_agb_mg_ha2);
  const p10AgbMgHa = toFiniteNumber(properties.p10AgbMgHa ?? properties.p10_agb_mg_ha);
  const p25AgbMgHa = toFiniteNumber(properties.p25AgbMgHa ?? properties.p25_agb_mg_ha);
  const p75AgbMgHa = toFiniteNumber(properties.p75AgbMgHa ?? properties.p75_agb_mg_ha);
  const p90AgbMgHa = toFiniteNumber(properties.p90AgbMgHa ?? properties.p90_agb_mg_ha);
  const p95AgbMgHa = toFiniteNumber(properties.p95AgbMgHa ?? properties.p95_agb_mg_ha);
  const interquartileRangeMgHa = toFiniteNumber(properties.interquartileRangeMgHa ?? properties.interquartile_range_mg_ha);
  const coefficientOfVariation = toFiniteNumber(properties.coefficientOfVariation ?? properties.coefficient_of_variation);
  const totalAgbMg = toFiniteNumber(properties.totalAgbMg ?? properties.total_agb_mg);
  const totalAgbMgHa = toFiniteNumber(properties.totalAgbMgHa ?? properties.total_agb_mg_ha);
  const baselineTotalAgbMg = toFiniteNumber(properties.baselineTotalAgbMg ?? properties.baseline_total_agb_mg);
  const comparisonTotalAgbMg = toFiniteNumber(properties.comparisonTotalAgbMg ?? properties.comparison_total_agb_mg);
  const agbIncreaseMg = toFiniteNumber(properties.agbIncreaseMg ?? properties.agb_increase_mg);
  const agbDecreaseMg = toFiniteNumber(properties.agbDecreaseMg ?? properties.agb_decrease_mg);
  const netChangeAgbMg = toFiniteNumber(properties.netChangeAgbMg ?? properties.net_change_agb_mg);
  const netChangeAgbMgHa = toFiniteNumber(properties.netChangeAgbMgHa ?? properties.net_change_agb_mg_ha);
  const netChangePercent = toFiniteNumber(properties.netChangePercent ?? properties.net_change_percent);
  const agbIncreaseAreaHa = toFiniteNumber(properties.agbIncreaseAreaHa ?? properties.agb_increase_area_ha);
  const agbDecreaseAreaHa = toFiniteNumber(properties.agbDecreaseAreaHa ?? properties.agb_decrease_area_ha);
  const analyzedAreaHa = toFiniteNumber(properties.analyzedAreaHa ?? properties.analyzed_area_ha);
  const aoiAreaHa = toFiniteNumber(properties.aoiAreaHa ?? properties.aoi_area_ha);
  const coverageFraction = toFiniteNumber(properties.coverageFraction ?? properties.coverage_fraction);
  const validPixelCount = toFiniteNumber(properties.validPixelCount ?? properties.valid_pixel_count);

  if (
    baselineYear === null ||
    comparisonYear === null ||
    minAgbMgHa === null ||
    maxAgbMgHa === null ||
    meanAgbMgHa === null ||
    medianAgbMgHa === null ||
    stdDevAgbMgHa === null ||
    varianceAgbMgHa2 === null ||
    p10AgbMgHa === null ||
    p25AgbMgHa === null ||
    p75AgbMgHa === null ||
    p90AgbMgHa === null ||
    p95AgbMgHa === null ||
    interquartileRangeMgHa === null ||
    coefficientOfVariation === null ||
    totalAgbMg === null ||
    totalAgbMgHa === null ||
    baselineTotalAgbMg === null ||
    comparisonTotalAgbMg === null ||
    agbIncreaseMg === null ||
    agbDecreaseMg === null ||
    netChangeAgbMg === null ||
    netChangeAgbMgHa === null ||
    netChangePercent === null ||
    agbIncreaseAreaHa === null ||
    agbDecreaseAreaHa === null ||
    analyzedAreaHa === null ||
    aoiAreaHa === null ||
    coverageFraction === null ||
    validPixelCount === null
  ) {
    return null;
  }

  return {
    baselineYear,
    comparisonYear,
    minAgbMgHa,
    maxAgbMgHa,
    meanAgbMgHa,
    medianAgbMgHa,
    stdDevAgbMgHa,
    varianceAgbMgHa2,
    p10AgbMgHa,
    p25AgbMgHa,
    p75AgbMgHa,
    p90AgbMgHa,
    p95AgbMgHa,
    interquartileRangeMgHa,
    coefficientOfVariation,
    totalAgbMg,
    totalAgbMgHa,
    baselineTotalAgbMg,
    comparisonTotalAgbMg,
    agbIncreaseMg,
    agbDecreaseMg,
    netChangeAgbMg,
    netChangeAgbMgHa,
    netChangePercent,
    agbIncreaseAreaHa,
    agbDecreaseAreaHa,
    analyzedAreaHa,
    aoiAreaHa,
    coverageFraction,
    validPixelCount,
    agbCoverByThreshold: [],
  };
}

function resolvePrecomputedAgbStatsFromEntries(
  properties: Array<{ key: string; value: string }>,
): AgbStatsResult | null {
  const record: Record<string, unknown> = {};

  for (const entry of properties) {
    const normalizedKey = entry.key.trim();
    if (!normalizedKey) {
      continue;
    }

    record[normalizedKey] = entry.value;
  }

  return resolvePrecomputedAgbStats(record);
}


export default function MapContainer() {
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [isLandcoverVisible, setIsLandcoverVisible] = useState(false);
  const [landcoverOpacity, setLandcoverOpacity] = useState(DEFAULT_LANDCOVER_OPACITY);
  const [isAgbVisible, setIsAgbVisible] = useState(false);
  const [agbOpacity, setAgbOpacity] = useState(DEFAULT_AGB_OPACITY);
  const [isChmIndonesiaVisible, setIsChmIndonesiaVisible] = useState(false);
  const [chmIndonesiaOpacity, setChmIndonesiaOpacity] = useState(DEFAULT_CHM_OPACITY);
  const [isChmKetapangVisible, setIsChmKetapangVisible] = useState(false);
  const [chmKetapangOpacity, setChmKetapangOpacity] = useState(DEFAULT_CHM_OPACITY);
  const [isSatelliteVisible, setIsSatelliteVisible] = useState(true);
  const [isBoundariesAndPlacesVisible, setIsBoundariesAndPlacesVisible] = useState(true);
  const [isLegendOpen, setIsLegendOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isFrameLoading, setIsFrameLoading] = useState(false);
  const [isHoveringOverlayPanel, setIsHoveringOverlayPanel] = useState(false);
  const [isCapturingMap, setIsCapturingMap] = useState(false);
  const [isCaptureMapAiming, setIsCaptureMapAiming] = useState(false);
  const [captureMapPixelRect, setCaptureMapPixelRect] = useState<ReturnType<typeof getCaptureMapScreenFocusRect> | null>(null);
  const [captureMapError, setCaptureMapError] = useState<string | null>(null);
  const [landcoverStatsBaselineYear, setLandcoverStatsBaselineYear] = useState(1990);
  const [landcoverStatsResultCache, setLandcoverStatsResultCache] = useState<Record<string, LandcoverStatsResult>>({});
  const [chmStatsResultCache, setChmStatsResultCache] = useState<Record<string, ChmStatsResult>>({});
  const [agbStatsResultCache, setAgbStatsResultCache] = useState<Record<string, AgbStatsResult>>({});
  const [landcoverStatsSelectionUid, setLandcoverStatsSelectionUid] = useState<string | null>(null);
  const [chmStatsSelectionUid, setChmStatsSelectionUid] = useState<string | null>(null);
  const [agbStatsSelectionUid, setAgbStatsSelectionUid] = useState<string | null>(null);
  const [mapContext, setMapContext] = useState<MapContextState>({
    map: null,
  });
  const vectorDropzoneRef = useRef<VectorDropzoneHandle | null>(null);
  const selectedVectorUidRef = useRef<string | null>(null);
  const geojsonFormatRef = useRef(new GeoJSON());
  const hasLoadedWorkshopRegionsRef = useRef(false);
  const hasRestoredBoundaryExtentRef = useRef(false);
  const landcoverStatsJob = useLandcoverStatsJob({
    baseUrl: process.env.NEXT_PUBLIC_LANDCOVER_STATS_API_BASE_URL,
  });
  const chmStatsJob = useChmStatsJob({
    baseUrl: process.env.NEXT_PUBLIC_CHM_STATS_API_BASE_URL,
  });
  const agbStatsJob = useAgbStatsJob({
    baseUrl: process.env.NEXT_PUBLIC_AGB_STATS_API_BASE_URL,
  });
  const resetLandcoverStatsJob = landcoverStatsJob.reset;
  const resetChmStatsJob = chmStatsJob.reset;
  const resetAgbStatsJob = agbStatsJob.reset;

  const pmtilesBaseUrl =
    process.env.NEXT_PUBLIC_R2_PMTILES_BASE_URL ?? DEFAULT_R2_PMTILES_BASE_URL;
  const agbPmtilesBaseUrl =
    process.env.NEXT_PUBLIC_R2_AGB_PMTILES_BASE_URL ?? DEFAULT_R2_AGB_PMTILES_BASE_URL;
  const chmIndonesiaPmtilesUrl =
    process.env.NEXT_PUBLIC_R2_CHM_PMTILES_URL ?? DEFAULT_R2_CHM_PMTILES_URL;
  const chmKetapangPmtilesUrl =
    process.env.NEXT_PUBLIC_R2_CHM_KETAPANG_PMTILES_URL ?? DEFAULT_R2_CHM_KETAPANG_PMTILES_URL;
  const missingPmtilesUrl = !pmtilesBaseUrl;
  const activeRasterLayer = isLandcoverVisible
    ? "landcover"
    : isAgbVisible
      ? "agb"
      : (isChmIndonesiaVisible || isChmKetapangVisible)
        ? "chm"
        : null;
  const activeTimelineMinYear =
    activeRasterLayer === "agb" ? AGB_MIN_YEAR : activeRasterLayer === "chm" ? year : MIN_YEAR;
  const activeTimelineMaxYear =
    activeRasterLayer === "agb" ? AGB_MAX_YEAR : activeRasterLayer === "chm" ? year : MAX_YEAR;
  const landcoverArchiveOptions = useMemo<PmtilesArchiveOptions>(() => ({
    minYear: MIN_YEAR,
    maxYear: MAX_YEAR,
  }), []);
  const agbArchiveOptions = useMemo<PmtilesArchiveOptions>(() => ({
    minYear: AGB_MIN_YEAR,
    maxYear: AGB_MAX_YEAR,
    fileSuffix: AGB_FILE_SUFFIX,
  }), []);
  const chmIndonesiaArchiveOptions = useMemo<PmtilesArchiveOptions>(() => ({
    staticArchiveUrl: chmIndonesiaPmtilesUrl,
  }), [chmIndonesiaPmtilesUrl]);
  const chmKetapangArchiveOptions = useMemo<PmtilesArchiveOptions>(() => ({
    staticArchiveUrl: chmKetapangPmtilesUrl,
  }), [chmKetapangPmtilesUrl]);

  const onLandcoverVisibilityChange = useCallback((visible: boolean) => {
    setIsLandcoverVisible(visible);
    if (visible) {
      setIsAgbVisible(false);
      setIsChmIndonesiaVisible(false);
      setIsChmKetapangVisible(false);
      setYear((previousYear) => Math.max(MIN_YEAR, Math.min(MAX_YEAR, previousYear)));
      return;
    }
  }, []);

  const onAgbVisibilityChange = useCallback((visible: boolean) => {
    setIsAgbVisible(visible);
    if (visible) {
      setIsLandcoverVisible(false);
      setIsChmIndonesiaVisible(false);
      setIsChmKetapangVisible(false);
      setYear((previousYear) => Math.max(AGB_MIN_YEAR, Math.min(AGB_MAX_YEAR, previousYear)));
      return;
    }
  }, []);

  const onChmIndonesiaVisibilityChange = useCallback((visible: boolean) => {
    setIsChmIndonesiaVisible(visible);
    if (visible) {
      setIsLandcoverVisible(false);
      setIsAgbVisible(false);
    }
  }, []);

  const onChmKetapangVisibilityChange = useCallback((visible: boolean) => {
    setIsChmKetapangVisible(visible);
    if (visible) {
      setIsLandcoverVisible(false);
      setIsAgbVisible(false);
    }
  }, []);

  const onMapReady = useCallback((payload: MapCanvasReadyPayload) => {
    if (process.env.NODE_ENV !== "production") {
      (globalThis as typeof globalThis & { __BC_MAP__?: OLMap }).__BC_MAP__ = payload.map;
    }

    setMapContext({
      map: payload.map,
    });
  }, []);

  const fitMapToCommunityPolygonExtent = useCallback((extent: Extent) => {
    if (!mapContext.map) {
      return;
    }

    const isValidExtent = extent.every((value) => Number.isFinite(value));
    const hasArea = extent[0] < extent[2] && extent[1] < extent[3];
    if (!isValidExtent || !hasArea) {
      return;
    }

    const isDesktop = window.matchMedia("(min-width: 768px)").matches;
    const padding = isDesktop ? [36, 40, 36, 320] : [120, 16, 104, 16];
    const maxZoom = isDesktop ? 15 : 14;

    mapContext.map.getView().fit(extent, {
      duration: 500,
      maxZoom,
      padding,
    });

    try {
      localStorage.setItem(LAST_BOUNDARY_EXTENT_STORAGE_KEY, JSON.stringify(extent));
    } catch {
      // Ignore storage failures (private mode/quota) and continue map interaction.
    }
  }, [mapContext.map]);

  useEffect(() => {
    if (!mapContext.map || hasRestoredBoundaryExtentRef.current) {
      return;
    }

    hasRestoredBoundaryExtentRef.current = true;

    let parsedExtent: unknown;
    try {
      const rawExtent = localStorage.getItem(LAST_BOUNDARY_EXTENT_STORAGE_KEY);
      if (!rawExtent) {
        return;
      }
      parsedExtent = JSON.parse(rawExtent);
    } catch {
      return;
    }

    if (!Array.isArray(parsedExtent) || parsedExtent.length !== 4) {
      return;
    }

    const extent = parsedExtent.map((value) => Number(value));
    const isValidExtent = extent.every((value) => Number.isFinite(value));
    const hasArea = extent[0] < extent[2] && extent[1] < extent[3];
    if (!isValidExtent || !hasArea) {
      return;
    }

    const isDesktop = window.matchMedia("(min-width: 768px)").matches;
    const padding = isDesktop ? [36, 40, 36, 320] : [120, 16, 104, 16];
    const maxZoom = isDesktop ? 15 : 14;

    mapContext.map.getView().fit(extent as Extent, {
      duration: 0,
      maxZoom,
      padding,
    });
  }, [mapContext.map]);

  const {
    vectorLayers,
    communityPolygonItems,
    mapControlVectorLayerItems,
    activeLegendLayers,
    onVectorLayerAdd,
    onVectorLayerVisibilityChange,
    onVectorLayerOpacityChange,
    onVectorLayerGroupingColumnChange,
    onCommunityPolygonFocus,
    removeVectorLayer,
  } = useMapVectorLayers({
    map: mapContext.map,
    fitMapToCommunityPolygonExtent,
    selectedVectorUidRef,
    isLandcoverVisible,
    isAgbVisible,
    isChmVisible: isChmIndonesiaVisible || isChmKetapangVisible,
  });

  const {
    isDrawingPolygon,
    drawingVertices,
    pendingPolygonConfirm,
    pendingPointConfirm,
    startDrawing,
    cancelDrawing,
    confirmPendingPolygon,
    discardPendingPolygon,
    confirmPendingPoint,
    discardPendingPoint,
  } = useCommunityPolygonDrawing({
    map: mapContext.map,
    maxCommunityBoundaryBufferMeters: MAX_COMMUNITY_BOUNDARY_BUFFER_METERS,
    maxCommunityBoundaryBufferKilometers: MAX_COMMUNITY_BOUNDARY_BUFFER_KM,
    onVectorLayerAdd,
    onMessage: setStatusMessage,
  });

  const {
    threatMapPixelRect,
    threatMapDiagnostics,
    threatMapDisplayProgress,
    displayedThreatMapError,
    isThreatMapAiming,
    isThreatMapGenerating,
    onThreatMapYearFrameReady,
    onStartThreatMap,
    onCancelThreatMap,
    onGenerateThreatMap,
  } = useThreatMapExportFlow({
    map: mapContext.map,
    year,
    vectorLayers,
    isDrawingPolygon,
    cancelDrawing,
    isFrameLoading,
    onStopPlayback: () => {},
    onMessage: setStatusMessage,
  });


  const floatingMessage = useMemo(() => {
    if (missingPmtilesUrl) {
      return "Set NEXT_PUBLIC_R2_PMTILES_BASE_URL to load annual landcover PMTiles.";
    }

    return statusMessage;
  }, [missingPmtilesUrl, statusMessage]);

  const landcoverRenderMode = "passthrough" as const;
  const agbRenderMode = "passthrough" as const;
  const chmRenderMode = "chm" as const;

  const onCaptureMap = useCallback(async () => {
    if (!mapContext.map) {
      setCaptureMapError("Map is still loading. Try again in a moment.");
      return;
    }

    if (isThreatMapGenerating || isThreatMapAiming) {
      setCaptureMapError("Finish Threat Map mode before capturing the map.");
      return;
    }

    setCaptureMapError(null);
    setIsCaptureMapAiming(true);
    setStatusMessage("Capture map aiming is active. Pan or zoom, then click Generate.");
  }, [
    isThreatMapAiming,
    isThreatMapGenerating,
    mapContext.map,
  ]);

  const onCancelCaptureMapAiming = useCallback(() => {
    setIsCaptureMapAiming(false);
    setCaptureMapPixelRect(null);
    setCaptureMapError(null);
    setStatusMessage("Capture map canceled.");
  }, []);

  const onGenerateCaptureMap = useCallback(async () => {
    if (!mapContext.map) {
      setCaptureMapError("Map is still loading. Try again in a moment.");
      return;
    }

    if (isThreatMapGenerating || isThreatMapAiming) {
      setCaptureMapError("Finish Threat Map mode before capturing the map.");
      return;
    }

    const frozenRect = getCaptureMapScreenFocusRect(mapContext.map);
    if (!frozenRect || !frozenRect.fitsViewport) {
      setCaptureMapError("Capture focus square must fit fully inside the map viewport.");
      setStatusMessage("Capture map requires the focus square to fit fully in view.");
      return;
    }

    setIsCapturingMap(true);
    setCaptureMapError(null);

    try {
      const result = await captureMapWithLegendPng(mapContext.map, activeLegendLayers, {
        isSatelliteVisible,
        isBoundariesAndPlacesVisible,
        year,
      });
      downloadBlob(result.blob, result.filename);
      setIsCaptureMapAiming(false);
      setCaptureMapPixelRect(null);
      setStatusMessage("Map PNG captured with legend.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to capture map PNG.";
      setCaptureMapError(message);
      setStatusMessage(`Map capture failed: ${message}`);
    } finally {
      setIsCapturingMap(false);
    }
  }, [
    activeLegendLayers,
    isBoundariesAndPlacesVisible,
    isSatelliteVisible,
    isThreatMapAiming,
    isThreatMapGenerating,
    mapContext.map,
    year,
  ]);

  useEffect(() => {
    if (!mapContext.map || !isCaptureMapAiming) {
      return;
    }

    const updateOverlay = () => {
      const pixelRect = getCaptureMapScreenFocusRect(mapContext.map!);
      setCaptureMapPixelRect(pixelRect);
    };

    updateOverlay();
    const view = mapContext.map.getView();
    mapContext.map.on("moveend", updateOverlay);
    mapContext.map.on("change:size", updateOverlay);
    view.on("change:resolution", updateOverlay);

    return () => {
      mapContext.map?.un("moveend", updateOverlay);
      mapContext.map?.un("change:size", updateOverlay);
      view.un("change:resolution", updateOverlay);
    };
  }, [isCaptureMapAiming, mapContext.map]);

  const {
    hoveredVectorInfo,
    selectedVectorInfo,
    clearHoveredForLayer,
    clearSelectedForLayer,
  } = useMapPointerInteractions({
    map: mapContext.map,
    vectorLayers,
    isDrawingPolygon,
    hasPendingPolygonConfirm: Boolean(pendingPolygonConfirm || pendingPointConfirm),
    selectedVectorUidRef,
  });

  const deleteCommunityPolygon = useCallback(
    (fileName: string) => {
      removeVectorLayer(fileName);
      clearHoveredForLayer(fileName);
      clearSelectedForLayer(fileName);

      setStatusMessage(`${fileName} removed.`);
    },
    [clearHoveredForLayer, clearSelectedForLayer, removeVectorLayer],
  );

  useEffect(() => {
    if (!mapContext.map || hasLoadedWorkshopRegionsRef.current) {
      return;
    }

    hasLoadedWorkshopRegionsRef.current = true;
    let isCancelled = false;

    const loadBuiltInVectorLayers = async () => {
      const mapInstance = mapContext.map;
      if (!mapInstance) {
        return;
      }

      const manifestResponses = await Promise.all([
        fetch("/api/workshop-regions", { cache: "no-store" }),
        fetch("/api/concessions", { cache: "no-store" }),
        fetch("/api/jkpp-hcs-carbon", { cache: "no-store" }),
      ]);

      const [
        workshopManifestResponse,
        concessionsManifestResponse,
        jkppManifestResponse,
      ] = manifestResponses;
      if (!workshopManifestResponse.ok) {
        throw new Error(`Failed to read workshop regions (${workshopManifestResponse.status}).`);
      }

      if (!concessionsManifestResponse.ok) {
        throw new Error(`Failed to read concessions (${concessionsManifestResponse.status}).`);
      }

      if (!jkppManifestResponse.ok) {
        throw new Error(`Failed to read JKPP HCS Carbon files (${jkppManifestResponse.status}).`);
      }

      const workshopManifest = (await workshopManifestResponse.json()) as WorkshopRegionsApiResponse;
      const concessionsManifest = (await concessionsManifestResponse.json()) as ConcessionsApiResponse;
      const jkppManifest = (await jkppManifestResponse.json()) as JkppHcsCarbonApiResponse;

      const builtInLayers = [
        ...concessionsManifest.concessions.map((fileName) => ({
          fileName,
          assetPath: "/concessions",
          defaultFillOpacity: CONCESSION_DEFAULT_FILL_OPACITY,
          zIndex: CONCESSION_VECTOR_Z_INDEX,
          properties: {
            isConcessionLayer: true,
            concessionFile: fileName,
          },
        })),
        ...jkppManifest.files.map((fileName) => ({
          fileName,
          assetPath: "/jkpp-hcs-carbon",
          defaultFillOpacity: CONCESSION_DEFAULT_FILL_OPACITY,
          zIndex: CONCESSION_VECTOR_Z_INDEX,
          properties: {
            isJkppHcsCarbonLayer: true,
            jkppHcsCarbonFile: fileName,
          },
        })),
      ];

      let loadedLayerCount = 0;

      if (workshopManifest.regions.length > 0) {
        const workshopFeatures = [] as ReturnType<typeof geojsonFormatRef.current.readFeatures>;

        for (const regionFileName of workshopManifest.regions) {
          if (isCancelled) {
            return;
          }

          const encodedName = encodeURIComponent(regionFileName);
          const regionResponse = await fetch(`/workshop-regions/${encodedName}`, { cache: "no-store" });
          if (!regionResponse.ok) {
            continue;
          }

          const regionGeoJson = (await regionResponse.json()) as FeatureCollection<Geometry, GeoJsonProperties>;
          const features = geojsonFormatRef.current.readFeatures(regionGeoJson, {
            dataProjection: "EPSG:3857",
            featureProjection: "EPSG:3857",
          });

          for (const feature of features) {
            if (!feature.get("workshopRegionName")) {
              feature.set("workshopRegionName", formatLayerName(regionFileName), true);
            }
          }

          workshopFeatures.push(...features);
        }

        if (workshopFeatures.length > 0) {
          const workshopLayerName = "Workshop Regions";
          const workshopLayer = new VectorLayer({
            source: new VectorSource({ features: workshopFeatures }),
            zIndex: WORKSHOP_VECTOR_Z_INDEX,
            properties: {
              name: workshopLayerName,
              isVectorUploadLayer: true,
              isWorkshopRegionLayer: true,
            },
          });

          mapInstance.addLayer(workshopLayer);

          onVectorLayerAdd(
            workshopLayerName,
            {
              layer: workshopLayer,
              category: "reference",
              defaultColor: BUILT_IN_VECTOR_LAYER_COLORS[0],
              defaultFillOpacity: WORKSHOP_DEFAULT_FILL_OPACITY,
              defaultVisibility: false,
              availableGroupingColumns: getGroupableColumns(
                workshopFeatures.map((feature) => feature.getProperties() as Record<string, unknown>),
              ),
            },
          );

          loadedLayerCount += 1;
        }
      }

      for (const [index, builtInLayer] of builtInLayers.entries()) {
        if (isCancelled) {
          return;
        }

        const encodedName = encodeURIComponent(builtInLayer.fileName);
        const layerResponse = await fetch(`${builtInLayer.assetPath}/${encodedName}`, { cache: "no-store" });
        if (!layerResponse.ok) {
          continue;
        }

        const layerGeoJson = (await layerResponse.json()) as FeatureCollection<Geometry, GeoJsonProperties>;
        const features = geojsonFormatRef.current.readFeatures(layerGeoJson, {
          dataProjection: "EPSG:4326",
          featureProjection: "EPSG:3857",
        });

        if (features.length === 0) {
          continue;
        }

        const layerName = formatLayerName(builtInLayer.fileName);
        const layer = new VectorLayer({
          source: new VectorSource({ features }),
          zIndex: builtInLayer.zIndex,
          properties: {
            name: layerName,
            isVectorUploadLayer: true,
            ...builtInLayer.properties,
          },
        });

        mapInstance.addLayer(layer);

        onVectorLayerAdd(
          layerName,
          {
            layer,
            category: "reference",
            defaultColor: BUILT_IN_VECTOR_LAYER_COLORS[(index + 1) % BUILT_IN_VECTOR_LAYER_COLORS.length],
            defaultFillOpacity: builtInLayer.defaultFillOpacity,
            defaultVisibility: false,
            availableGroupingColumns: getGroupableColumns(
              features.map((feature) => feature.getProperties() as Record<string, unknown>),
            ),
          },
          { fitToExtent: false },
        );
        loadedLayerCount += 1;
      }

      if (!isCancelled && loadedLayerCount > 0) {
        setStatusMessage(`Loaded ${loadedLayerCount} built-in reference layer${loadedLayerCount === 1 ? "" : "s"}.`);
      }
    };

    loadBuiltInVectorLayers().catch((error) => {
      hasLoadedWorkshopRegionsRef.current = false;
      if (isCancelled) {
        return;
      }

      const message = error instanceof Error ? error.message : "Failed to load workshop regions.";
      setStatusMessage(message);
    });

    return () => {
      isCancelled = true;
    };
  }, [mapContext.map, onVectorLayerAdd]);

  useLayoutEffect(() => {
    for (const vectorLayerState of Object.values(vectorLayers)) {
      vectorLayerState.layer.changed();
    }
    mapContext.map?.renderSync();
  }, [mapContext.map, selectedVectorInfo?.selectionUid, vectorLayers]);


  const selectedPolygonInfo =
    selectedVectorInfo && vectorLayers[selectedVectorInfo.layerName]
      ? selectedVectorInfo
      : null;
  const selectedPolygonPanelInfo =
    selectedPolygonInfo
      ? {
          selectionUid: selectedPolygonInfo.selectionUid,
          layerName: selectedPolygonInfo.layerName,
          groupingColumn: selectedPolygonInfo.groupingColumn,
          groupingValue: selectedPolygonInfo.groupingValue,
          properties: selectedPolygonInfo.properties,
          areaSquareKilometers: selectedPolygonInfo.areaSquareKilometers,
          areaHectares: selectedPolygonInfo.areaHectares,
          geometryType: selectedPolygonInfo.geometryType,
          precomputedLandcoverStats:
            resolvePrecomputedLandcoverStats(selectedPolygonInfo.rawProperties) ??
            resolvePrecomputedLandcoverStatsFromEntries(selectedPolygonInfo.properties),
          precomputedChmStats:
            resolvePrecomputedChmStats(selectedPolygonInfo.rawProperties) ??
            resolvePrecomputedChmStatsFromEntries(selectedPolygonInfo.properties),
          precomputedAgbStats:
            resolvePrecomputedAgbStats(selectedPolygonInfo.rawProperties) ??
            resolvePrecomputedAgbStatsFromEntries(selectedPolygonInfo.properties),
        }
      : null;

  const selectedLandcoverStatsCacheKey = selectedPolygonInfo
    ? `${selectedPolygonInfo.selectionUid}:${landcoverStatsBaselineYear}:${year}`
    : null;
  const selectedChmStatsCacheKey = selectedPolygonInfo
    ? selectedPolygonInfo.selectionUid
    : null;
  const selectedAgbStatsCacheKey = selectedPolygonInfo
    ? selectedPolygonInfo.selectionUid
    : null;

  const cachedLandcoverStatsResult = selectedLandcoverStatsCacheKey
    ? landcoverStatsResultCache[selectedLandcoverStatsCacheKey] ?? null
    : null;
  const cachedChmStatsResult = selectedChmStatsCacheKey
    ? chmStatsResultCache[selectedChmStatsCacheKey] ?? null
    : null;
  const cachedAgbStatsResult = selectedAgbStatsCacheKey
    ? agbStatsResultCache[selectedAgbStatsCacheKey] ?? null
    : null;
  const selectedPolygonGeoJson = useMemo<FeatureCollection<Geometry, GeoJsonProperties> | null>(() => {
    if (!selectedPolygonInfo?.geometry) {
      return null;
    }

    try {
      const geometry = new GeoJSON().writeGeometryObject(selectedPolygonInfo.geometry, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857",
      }) as Geometry;

      const properties = Object.fromEntries(
        selectedPolygonInfo.properties.map((entry) => [entry.key, entry.value]),
      );

      const feature: GeoJsonFeature<Geometry, GeoJsonProperties> = {
        type: "Feature",
        geometry,
        properties: {
          ...properties,
          layerName: selectedPolygonInfo.layerName,
          groupingColumn: selectedPolygonInfo.groupingColumn,
          groupingValue: selectedPolygonInfo.groupingValue,
        },
      };

      return {
        type: "FeatureCollection",
        features: [feature],
      };
    } catch {
      return null;
    }
  }, [selectedPolygonInfo]);

  useEffect(() => {
    resetLandcoverStatsJob();
    resetChmStatsJob();
    resetAgbStatsJob();
    setLandcoverStatsSelectionUid(null);
    setChmStatsSelectionUid(null);
    setAgbStatsSelectionUid(selectedPolygonInfo?.selectionUid ?? null);
  }, [resetAgbStatsJob, resetChmStatsJob, resetLandcoverStatsJob, selectedPolygonInfo?.selectionUid]);

  useEffect(() => {
    if (
      !selectedLandcoverStatsCacheKey
      || landcoverStatsJob.status !== "succeeded"
      || !landcoverStatsJob.result
    ) {
      return;
    }

    setLandcoverStatsResultCache((previous) => {
      const nextResult = landcoverStatsJob.result;
      if (!nextResult) {
        return previous;
      }

      if (previous[selectedLandcoverStatsCacheKey] === nextResult) {
        return previous;
      }

      return {
        ...previous,
        [selectedLandcoverStatsCacheKey]: nextResult,
      };
    });
  }, [landcoverStatsJob.result, landcoverStatsJob.status, selectedLandcoverStatsCacheKey]);

  useEffect(() => {
    if (
      !selectedChmStatsCacheKey
      || chmStatsJob.status !== "succeeded"
      || !chmStatsJob.result
    ) {
      return;
    }

    setChmStatsResultCache((previous) => {
      const nextResult = chmStatsJob.result;
      if (!nextResult) {
        return previous;
      }

      if (previous[selectedChmStatsCacheKey] === nextResult) {
        return previous;
      }

      return {
        ...previous,
        [selectedChmStatsCacheKey]: nextResult,
      };
    });
  }, [chmStatsJob.result, chmStatsJob.status, selectedChmStatsCacheKey]);

  useEffect(() => {
    if (
      !selectedAgbStatsCacheKey
      || (agbStatsJob.status !== "succeeded" && agbStatsJob.status !== "partial_success")
      || !agbStatsJob.result
      || !shouldUseAgbStatsResultForSelection(
        agbStatsSelectionUid,
        selectedPolygonInfo?.selectionUid ?? null,
      )
    ) {
      return;
    }

    setAgbStatsResultCache((previous) => {
      const nextResult = agbStatsJob.result;
      if (!nextResult) {
        return previous;
      }

      if (previous[selectedAgbStatsCacheKey] === nextResult) {
        return previous;
      }

      return {
        ...previous,
        [selectedAgbStatsCacheKey]: nextResult,
      };
    });
  }, [agbStatsJob.result, agbStatsJob.status, agbStatsSelectionUid, selectedAgbStatsCacheKey, selectedPolygonInfo?.selectionUid]);

  const landcoverStatsJobView = useMemo(() => {
    const shouldReuseLandcoverStats = shouldUseStatsResultForSelection(
      landcoverStatsSelectionUid,
      selectedPolygonInfo?.selectionUid ?? null,
    );

    if (
      selectedPolygonInfo
      && landcoverStatsJob.status === "idle"
      && !landcoverStatsJob.error
      && cachedLandcoverStatsResult
      && shouldReuseLandcoverStats
    ) {
      return {
        ...landcoverStatsJob,
        status: "succeeded" as const,
        message: "Loaded cached stats for this polygon.",
        result: cachedLandcoverStatsResult,
        error: null,
      };
    }

    return {
      ...landcoverStatsJob,
      result: shouldReuseLandcoverStats ? landcoverStatsJob.result ?? null : null,
    };
  }, [cachedLandcoverStatsResult, landcoverStatsJob, landcoverStatsSelectionUid, selectedPolygonInfo]);

  const chmStatsJobView = useMemo(() => {
    const shouldReuseChmStats = shouldUseStatsResultForSelection(
      chmStatsSelectionUid,
      selectedPolygonInfo?.selectionUid ?? null,
    );

    if (
      selectedPolygonInfo
      && chmStatsJob.status === "idle"
      && !chmStatsJob.error
      && cachedChmStatsResult
      && shouldReuseChmStats
    ) {
      return {
        ...chmStatsJob,
        status: "succeeded" as const,
        message: "Loaded cached stats for this polygon.",
        result: cachedChmStatsResult,
        error: null,
      };
    }

    return {
      ...chmStatsJob,
      result: shouldReuseChmStats ? chmStatsJob.result ?? null : null,
    };
  }, [cachedChmStatsResult, chmStatsJob, chmStatsSelectionUid, selectedPolygonInfo]);

  const agbStatsJobView = useMemo(() => {
    const agbStatsResultMatchesSelection = shouldUseAgbStatsResultForSelection(
      agbStatsSelectionUid,
      selectedPolygonInfo?.selectionUid ?? null,
    );

    if (
      selectedPolygonInfo
      && agbStatsJob.status === "idle"
      && !agbStatsJob.error
      && cachedAgbStatsResult
      && agbStatsResultMatchesSelection
    ) {
      return {
        ...agbStatsJob,
        status: "succeeded" as const,
        message: "Loaded cached stats for this polygon.",
        result: cachedAgbStatsResult,
        error: null,
      };
    }

    return {
      ...agbStatsJob,
      result: agbStatsResultMatchesSelection ? agbStatsJob.result ?? null : null,
    };
  }, [agbStatsJob, agbStatsSelectionUid, cachedAgbStatsResult, selectedPolygonInfo]);

  const onDownloadSelectedPolygonGeoJson = useCallback(() => {
    if (!selectedPolygonInfo?.geometry) {
      setStatusMessage("No feature geometry selected for download.");
      return;
    }

    try {
      const geometry = geojsonFormatRef.current.writeGeometryObject(selectedPolygonInfo.geometry, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857",
      }) as Geometry;

      const properties = Object.fromEntries(
        selectedPolygonInfo.properties.map((entry) => [entry.key, entry.value]),
      );

      const feature: GeoJsonFeature<Geometry, GeoJsonProperties> = {
        type: "Feature",
        geometry,
        properties: {
          ...properties,
          layerName: selectedPolygonInfo.layerName,
          groupingColumn: selectedPolygonInfo.groupingColumn,
          groupingValue: selectedPolygonInfo.groupingValue,
        },
      };

      const payload: FeatureCollection<Geometry, GeoJsonProperties> = {
        type: "FeatureCollection",
        features: [feature],
      };

      const fileSafeLayerName = selectedPolygonInfo.layerName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "selected-polygon";
      const filename = `${fileSafeLayerName}.geojson`;

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/geo+json",
      });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);

      setStatusMessage(`Downloaded ${filename}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate GeoJSON download.";
      setStatusMessage(`Polygon download failed: ${message}`);
    }
  }, [selectedPolygonInfo]);

  const onRunLandcoverStats = useCallback(async () => {
    if (!selectedPolygonGeoJson || !selectedPolygonInfo) {
      setStatusMessage("No polygon geometry selected for landcover stats.");
      return;
    }

    if (!selectedPolygonInfo.geometryType?.includes("Polygon")) {
      setStatusMessage("Landcover stats requires a polygon selection.");
      return;
    }

    if (!Number.isInteger(landcoverStatsBaselineYear) || !Number.isInteger(year)) {
      setStatusMessage("Baseline year and comparison year must be set before running landcover stats.");
      return;
    }

    if (landcoverStatsBaselineYear === year) {
      setStatusMessage("Baseline year must differ from the comparison year.");
      return;
    }

    try {
      const selectionUid = selectedPolygonInfo.selectionUid;
      setLandcoverStatsSelectionUid(selectionUid);
      setStatusMessage(`Queued landcover stats for ${selectedPolygonInfo.layerName}.`);

      await landcoverStatsJob.startJob({
        geojson: selectedPolygonGeoJson,
        baselineYear: landcoverStatsBaselineYear,
        comparisonYear: year,
      });

      setStatusMessage(`Landcover stats ready for ${selectedPolygonInfo.layerName}.`);
    } catch (error) {
      const message = formatLandcoverStatsError(error);
      setStatusMessage(`Landcover stats failed for ${selectedPolygonInfo.layerName}: ${message}`);
    }
  }, [landcoverStatsBaselineYear, landcoverStatsJob, landcoverStatsResultCache, selectedLandcoverStatsCacheKey, selectedPolygonGeoJson, selectedPolygonInfo, year]);

  const onCancelLandcoverStats = useCallback(() => {
    landcoverStatsJob.cancel();
    setStatusMessage("Landcover stats request cancelled.");
  }, [landcoverStatsJob]);

  const onRunChmStats = useCallback(async () => {
    if (!selectedPolygonGeoJson || !selectedPolygonInfo) {
      setStatusMessage("No polygon geometry selected for CHM stats.");
      return;
    }

    if (!selectedPolygonInfo.geometryType?.includes("Polygon")) {
      setStatusMessage("CHM stats requires a polygon selection.");
      return;
    }

    try {
      const selectionUid = selectedPolygonInfo.selectionUid;
      setChmStatsSelectionUid(selectionUid);
      setStatusMessage(`Queued CHM stats for ${selectedPolygonInfo.layerName}.`);

      await chmStatsJob.startJob({
        geojson: selectedPolygonGeoJson,
      });

      setStatusMessage(`CHM stats ready for ${selectedPolygonInfo.layerName}.`);
    } catch (error) {
      const message = formatChmStatsError(error);
      setStatusMessage(`CHM stats failed for ${selectedPolygonInfo.layerName}: ${message}`);
    }
  }, [chmStatsJob, chmStatsResultCache, selectedChmStatsCacheKey, selectedPolygonGeoJson, selectedPolygonInfo]);

  const onCancelChmStats = useCallback(() => {
    chmStatsJob.cancel();
    setStatusMessage("CHM stats request cancelled.");
  }, [chmStatsJob]);

  const onRunAgbStats = useCallback(async () => {
    if (!selectedPolygonGeoJson || !selectedPolygonInfo) {
      setStatusMessage("No polygon geometry selected for AGB stats.");
      return;
    }

    if (!selectedPolygonInfo.geometryType?.includes("Polygon")) {
      setStatusMessage("AGB stats requires a polygon selection.");
      return;
    }

    const selectionUid = selectedPolygonInfo.selectionUid;
    setAgbStatsSelectionUid(selectionUid);

    try {
      setStatusMessage(`Queued AGB stats for ${selectedPolygonInfo.layerName}.`);

      const completedJob = await agbStatsJob.startJob({
        geojson: selectedPolygonGeoJson,
      });

      if (completedJob.status === "succeeded" || completedJob.status === "partial_success") {
        setAgbStatsResultCache((previous) => {
          if (!completedJob.result) {
            return previous;
          }

          const cacheKey = selectionUid;
          if (previous[cacheKey] === completedJob.result) {
            return previous;
          }

          return {
            ...previous,
            [cacheKey]: completedJob.result,
          };
        });
      }

      if (completedJob.status === "partial_success") {
        setStatusMessage(`AGB stats partially completed for ${selectedPolygonInfo.layerName}.`);
        return;
      }

      if (completedJob.status === "cancelled") {
        setStatusMessage(`AGB stats was cancelled for ${selectedPolygonInfo.layerName}.`);
        return;
      }

      setStatusMessage(`AGB stats ready for ${selectedPolygonInfo.layerName}.`);
    } catch (error) {
      const message = formatAgbStatsError(error);
      setStatusMessage(`AGB stats failed for ${selectedPolygonInfo.layerName}: ${message}`);
    }
  }, [agbStatsJob, agbStatsResultCache, selectedAgbStatsCacheKey, selectedPolygonGeoJson, selectedPolygonInfo]);

  const onCancelAgbStats = useCallback(() => {
    agbStatsJob.cancel();
    setStatusMessage("AGB stats request cancelled.");
  }, [agbStatsJob]);

  const hoverVectorTooltipStyle =
    hoveredVectorInfo && mapContext.map
      ? (() => {
          const mapSize = mapContext.map.getSize();
          const tooltipWidth = 288;
          const tooltipHeight = 68;
          const offsetX = 16;
          const offsetY = 30;
          const left = mapSize
            ? Math.min(hoveredVectorInfo.pixelX + offsetX, Math.max(12, mapSize[0] - tooltipWidth - 12))
            : hoveredVectorInfo.pixelX + offsetX;
          const top = mapSize
            ? Math.min(
                Math.max(12, hoveredVectorInfo.pixelY - offsetY),
                Math.max(12, mapSize[1] - tooltipHeight - 12),
              )
            : hoveredVectorInfo.pixelY - offsetY;

          return { left, top };
        })()
      : null;

  return (
    <section className="relative h-[100dvh] w-full overflow-hidden bg-gradient-to-br from-cyan-50 via-sky-100 to-blue-200 text-foreground">
      <MapCanvas
        satelliteVisible={isSatelliteVisible}
        boundariesAndPlacesVisible={isBoundariesAndPlacesVisible}
        onReady={onMapReady}
      />

      {!missingPmtilesUrl && isLandcoverVisible ? (
        <PmtilesLayer
          map={mapContext.map}
          year={year}
          visible
          opacity={landcoverOpacity}
          renderMode={landcoverRenderMode}
          baseUrl={pmtilesBaseUrl}
          archiveOptions={landcoverArchiveOptions}
          prefetchNeighbors={!isThreatMapGenerating}
          onFrameLoadingChange={setIsFrameLoading}
          onYearFrameReady={onThreatMapYearFrameReady}
        />
      ) : null}

      {isAgbVisible ? (
        <PmtilesLayer
          map={mapContext.map}
          year={year}
          visible
          opacity={agbOpacity}
          renderMode={agbRenderMode}
          baseUrl={agbPmtilesBaseUrl}
          archiveOptions={agbArchiveOptions}
          prefetchNeighbors={!isThreatMapGenerating}
          onFrameLoadingChange={setIsFrameLoading}
          onYearFrameReady={onThreatMapYearFrameReady}
        />
      ) : null}

      {isChmIndonesiaVisible ? (
        <PmtilesLayer
          map={mapContext.map}
          year={year}
          visible
          opacity={chmIndonesiaOpacity}
          renderMode={chmRenderMode}
          baseUrl={chmIndonesiaPmtilesUrl}
          archiveOptions={chmIndonesiaArchiveOptions}
          prefetchNeighbors={!isThreatMapGenerating}
          onFrameLoadingChange={setIsFrameLoading}
          onYearFrameReady={onThreatMapYearFrameReady}
        />
      ) : null}

      {isChmKetapangVisible ? (
        <PmtilesLayer
          map={mapContext.map}
          year={year}
          visible
          opacity={chmKetapangOpacity}
          renderMode={chmRenderMode}
          baseUrl={chmKetapangPmtilesUrl}
          archiveOptions={chmKetapangArchiveOptions}
          prefetchNeighbors={!isThreatMapGenerating}
          onFrameLoadingChange={setIsFrameLoading}
          onYearFrameReady={onThreatMapYearFrameReady}
        />
      ) : null}

      <VectorDropzone
        ref={vectorDropzoneRef}
        map={mapContext.map}
        onMessage={setStatusMessage}
        onVectorLayerAdd={onVectorLayerAdd}
      />

      <div className="pointer-events-none absolute inset-0 z-50">
        <OverlayHoverBoundary onHoverChange={setIsHoveringOverlayPanel}>
          <MapTopPanels
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
            vectorLayerItems={mapControlVectorLayerItems}
            activeLegendLayers={activeLegendLayers}
            isLegendOpen={isLegendOpen}
            onSatelliteChange={setIsSatelliteVisible}
            onBoundariesAndPlacesChange={setIsBoundariesAndPlacesVisible}
            onLandcoverChange={onLandcoverVisibilityChange}
            onLandcoverOpacityChange={setLandcoverOpacity}
            onAgbChange={onAgbVisibilityChange}
            onAgbOpacityChange={setAgbOpacity}
            onChmIndonesiaChange={onChmIndonesiaVisibilityChange}
            onChmIndonesiaOpacityChange={setChmIndonesiaOpacity}
            onChmKetapangChange={onChmKetapangVisibilityChange}
            onChmKetapangOpacityChange={setChmKetapangOpacity}
            onVectorLayerChange={onVectorLayerVisibilityChange}
            onVectorLayerOpacityChange={onVectorLayerOpacityChange}
            onLegendOpenChange={setIsLegendOpen}
            selectedPolygonInfo={selectedPolygonPanelInfo}
            canDownloadSelectedPolygon={Boolean(selectedPolygonInfo?.geometry)}
            onDownloadSelectedPolygonGeoJson={onDownloadSelectedPolygonGeoJson}
            landcoverStatsBaselineYear={landcoverStatsBaselineYear}
            comparisonYear={year}
            onLandcoverStatsBaselineYearChange={setLandcoverStatsBaselineYear}
            onRunLandcoverStats={onRunLandcoverStats}
            onCancelLandcoverStats={onCancelLandcoverStats}
            landcoverStatsJob={{
              status: landcoverStatsJobView.status,
              jobId: landcoverStatsJobView.jobId,
              progress: landcoverStatsJobView.progress,
              etaSeconds: landcoverStatsJobView.etaSeconds,
              message: landcoverStatsJobView.message,
              error: landcoverStatsJobView.error,
              result: landcoverStatsJobView.result,
            }}
            onRunChmStats={onRunChmStats}
            onCancelChmStats={onCancelChmStats}
            chmStatsJob={{
              status: chmStatsJobView.status,
              jobId: chmStatsJobView.jobId,
              progress: chmStatsJobView.progress,
              etaSeconds: chmStatsJobView.etaSeconds,
              message: chmStatsJobView.message,
              error: chmStatsJobView.error,
              result: chmStatsJobView.result,
            }}
            onRunAgbStats={onRunAgbStats}
            onCancelAgbStats={onCancelAgbStats}
            agbStatsJob={{
              status: agbStatsJobView.status,
              jobId: agbStatsJobView.jobId,
              progress: agbStatsJobView.progress,
              etaSeconds: agbStatsJobView.etaSeconds,
              message: agbStatsJobView.message,
              error: agbStatsJobView.error,
              result: agbStatsJobView.result,
            }}
            primaryAction={
              <CommunityMapPanel
                embedded
                items={communityPolygonItems}
                isDrawingPolygon={isDrawingPolygon}
                drawnVertexCount={drawingVertices.length}
                onUploadClick={() => vectorDropzoneRef.current?.openFilePicker()}
                onStartDrawing={() => {
                  if (isThreatMapAiming || isThreatMapGenerating) {
                    setStatusMessage("Finish Threat Map mode before starting polygon drawing.");
                    return;
                  }

                  startDrawing();
                }}
                onCancelDrawing={cancelDrawing}
                onPolygonFocus={onCommunityPolygonFocus}
                onPolygonVisibilityChange={onVectorLayerVisibilityChange}
                onPolygonOpacityChange={onVectorLayerOpacityChange}
                onPolygonGroupingColumnChange={onVectorLayerGroupingColumnChange}
                onPolygonDelete={deleteCommunityPolygon}
              />
            }
            exportsAction={
              <ExportsPanel
                disabled={isThreatMapGenerating || isCapturingMap}
                onCaptureMapClick={() => {
                  void onCaptureMap();
                }}
                onCancelCaptureMapAiming={onCancelCaptureMapAiming}
                isCapturingMap={isCapturingMap}
                isCaptureMapAiming={isCaptureMapAiming}
                captureMapError={captureMapError}
                onThreatMapClick={onStartThreatMap}
                onCancelThreatMapGeneration={() => onCancelThreatMap("Threat Map cancel requested.")}
                isThreatMapAiming={isThreatMapAiming}
                isThreatMapGenerating={isThreatMapGenerating}
                threatMapProgress={threatMapDisplayProgress}
                threatMapDiagnostics={threatMapDiagnostics}
                threatMapError={displayedThreatMapError}
              />
            }
          />
        </OverlayHoverBoundary>

        <ThreatMapOverlay
          isVisible={isThreatMapAiming || isCaptureMapAiming}
          pixelRect={isCaptureMapAiming ? captureMapPixelRect : threatMapPixelRect}
          sideKilometers={THREAT_MAP_SQUARE_SIDE_KM}
          minYear={MIN_YEAR}
          maxYear={MAX_YEAR}
          canGenerate={Boolean((isCaptureMapAiming ? captureMapPixelRect : threatMapPixelRect)?.fitsViewport)}
          displayedError={isCaptureMapAiming ? captureMapError : displayedThreatMapError}
          onCancel={() => {
            if (isCaptureMapAiming) {
              onCancelCaptureMapAiming();
              return;
            }

            onCancelThreatMap();
          }}
          onGenerate={() => {
            if (isCaptureMapAiming) {
              void onGenerateCaptureMap();
              return;
            }

            void onGenerateThreatMap();
          }}
          generateLabel={isCaptureMapAiming ? "Generate PNG" : "Generate"}
          footerText={
            isCaptureMapAiming
              ? "Aim the fixed screen square, then generate focused PNG. Zoom changes map detail inside the square."
              : undefined
          }
        />

        <HoverVectorTooltip
          hoveredVector={hoveredVectorInfo}
          hoverTooltipStyle={hoverVectorTooltipStyle}
          isVisible={Boolean(
            hoveredVectorInfo && hoverVectorTooltipStyle && !isHoveringOverlayPanel,
          )}
        />

        <PolygonConfirmDialog
          open={Boolean(pendingPolygonConfirm)}
          metrics={pendingPolygonConfirm?.metrics ?? null}
          capBufferKilometers={MAX_COMMUNITY_BOUNDARY_BUFFER_METERS / 1000}
          formatArea={formatAreaSquareKilometers}
          formatKilometers={formatKilometers}
          onCancel={() => {
            discardPendingPolygon();
          }}
          onConfirm={() => {
            confirmPendingPolygon();
          }}
        />

        <PointLabelDialog
          open={Boolean(pendingPointConfirm)}
          onCancel={() => {
            discardPendingPoint();
          }}
          onConfirm={(label) => {
            confirmPendingPoint(label);
          }}
        />

        {activeRasterLayer && activeRasterLayer !== "chm" && !isThreatMapAiming && !isThreatMapGenerating ? (
          <OverlayHoverBoundary onHoverChange={setIsHoveringOverlayPanel}>
            <MapBottomSlider
              year={year}
              minYear={activeTimelineMinYear}
              maxYear={activeTimelineMaxYear}
              isFrameLoading={isFrameLoading}
              onYearChange={setYear}
            />
          </OverlayHoverBoundary>
        ) : null}

        <FloatingStatusMessage message={floatingMessage} />
      </div>
    </section>
  );
}