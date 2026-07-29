"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Feature as GeoJsonFeature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import type OLMap from "ol/Map";
import type { Extent } from "ol/extent";
import GeoJSON from "ol/format/GeoJSON";
import type TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import XYZ from "ol/source/XYZ";
import VectorSource from "ol/source/Vector";
import "ol/ol.css";

import {
  AGB_FILE_SUFFIX,
  AGB_MAX_YEAR,
  AGB_MIN_YEAR,
  DEFAULT_AGB_OPACITY,
  DEFAULT_CHM_OPACITY,
  DEFAULT_R2_AGB_PMTILES_BASE_URL,
  DEFAULT_R2_CHM_PMTILES_URL,
  DEFAULT_LANDCOVER_OPACITY,
  DEFAULT_R2_PMTILES_BASE_URL,
  DEFAULT_YEAR,
  MAX_YEAR,
  MIN_YEAR,
  PLAY_PREFETCH_MAX_VISIBLE_TILES,
  PLAY_PREFETCH_TILE_CONCURRENCY,
  PLAY_PREFETCH_YEAR_WINDOW,
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
  HoverAgbTooltip,
  HoverChmTooltip,
  HoverClassTooltip,
  HoverVectorTooltip,
  MapBottomSlider,
  OverlayHoverBoundary,
  MapTopPanels,
} from "@/components/gis/map-overlay-panels";
import {
  ThreatMapOverlay,
} from "@/components/gis/threat-map-overlay";
import { PolygonConfirmDialog } from "@/components/gis/polygon-confirm-dialog";
import { PmtilesLayer } from "@/components/gis/pmtiles-layer";
import { VectorDropzone, type VectorDropzoneHandle } from "@/components/gis/vector-dropzone";
import { useLandcoverStatsJob } from "@/hooks/use-landcover-stats-job";
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
import { MAPBIOMAS_CLASS_LOOKUP } from "@/lib/mapbiomas-colors";
import { type LandcoverStatsResult, formatLandcoverStatsError } from "@/lib/landcover-stats";
import {
  getPmtilesZoomRange,
  prefetchViewportPmtilesYears,
  type PmtilesArchiveOptions,
  type PmtilesTileRequest,
  type PmtilesZoomRange,
} from "@/lib/pmtiles-source";
import { getGroupableColumns } from "@/lib/vector-grouping";

type MapContextState = {
  map: OLMap | null;
};

const MAX_COMMUNITY_BOUNDARY_BUFFER_KM = MAX_COMMUNITY_BOUNDARY_BUFFER_METERS / 1000;
const WORKSHOP_VECTOR_Z_INDEX = 2000;
const WORKSHOP_DEFAULT_FILL_OPACITY = 0;

type WorkshopRegionsApiResponse = {
  regions: string[];
};

function collectViewportTileRequests(map: OLMap, maxTiles: number): PmtilesTileRequest[] {
  const size = map.getSize();
  if (!size) {
    return [];
  }

  const view = map.getView();
  const projection = view.getProjection();
  const zoom = Math.max(0, Math.round(view.getZoom() ?? 0));
  const source = new XYZ({ crossOrigin: "anonymous" });
  const tileGrid = source.getTileGridForProjection(projection);

  if (!tileGrid) {
    return [];
  }

  const extent = view.calculateExtent(size);
  const tileRange = tileGrid.getTileRangeForExtentAndZ(extent, zoom);
  const collected: PmtilesTileRequest[] = [];

  for (let x = tileRange.minX; x <= tileRange.maxX; x += 1) {
    for (let y = tileRange.minY; y <= tileRange.maxY; y += 1) {
      collected.push({ z: zoom, x, y });

      if (collected.length >= maxTiles) {
        return collected;
      }
    }
  }

  return collected;
}

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

function formatWorkshopRegionName(fileName: string): string {
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


export default function MapContainer() {
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLandcoverVisible, setIsLandcoverVisible] = useState(false);
  const [landcoverOpacity, setLandcoverOpacity] = useState(DEFAULT_LANDCOVER_OPACITY);
  const [isAgbVisible, setIsAgbVisible] = useState(false);
  const [agbOpacity, setAgbOpacity] = useState(DEFAULT_AGB_OPACITY);
  const [isChmVisible, setIsChmVisible] = useState(false);
  const [chmOpacity, setChmOpacity] = useState(DEFAULT_CHM_OPACITY);
  const [isSatelliteVisible, setIsSatelliteVisible] = useState(true);
  const [isBoundariesAndPlacesVisible, setIsBoundariesAndPlacesVisible] = useState(true);
  const [isLegendOpen, setIsLegendOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isFrameLoading, setIsFrameLoading] = useState(false);
  const isPreloadingYears = false;
  const [isHoveringOverlayPanel, setIsHoveringOverlayPanel] = useState(false);
  const [landcoverStatsBaselineYear, setLandcoverStatsBaselineYear] = useState(1990);
  const [pmtilesZoomRangeState, setPmtilesZoomRangeState] = useState<{
    cacheKey: string;
    range: PmtilesZoomRange | null;
  } | null>(null);
  const [pmtilesLayer, setPmtilesLayer] = useState<TileLayer<XYZ> | null>(null);
  const [mapContext, setMapContext] = useState<MapContextState>({
    map: null,
  });
  const vectorDropzoneRef = useRef<VectorDropzoneHandle | null>(null);
  const selectedVectorUidRef = useRef<string | null>(null);
  const geojsonFormatRef = useRef(new GeoJSON());
  const hasLoadedWorkshopRegionsRef = useRef(false);
  const landcoverStatsJob = useLandcoverStatsJob({
    baseUrl: process.env.NEXT_PUBLIC_LANDCOVER_STATS_API_BASE_URL,
    apiKey: process.env.NEXT_PUBLIC_LANDCOVER_STATS_API_KEY,
  });
  const resetLandcoverStatsJob = landcoverStatsJob.reset;

  const pmtilesBaseUrl =
    process.env.NEXT_PUBLIC_R2_PMTILES_BASE_URL ?? DEFAULT_R2_PMTILES_BASE_URL;
  const agbPmtilesBaseUrl =
    process.env.NEXT_PUBLIC_R2_AGB_PMTILES_BASE_URL ?? DEFAULT_R2_AGB_PMTILES_BASE_URL;
  const chmPmtilesUrl =
    process.env.NEXT_PUBLIC_R2_CHM_PMTILES_URL ?? DEFAULT_R2_CHM_PMTILES_URL;
  const missingPmtilesUrl = !pmtilesBaseUrl;
  const activeRasterLayer = isLandcoverVisible
    ? "landcover"
    : isAgbVisible
      ? "agb"
      : isChmVisible
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
  const chmArchiveOptions = useMemo<PmtilesArchiveOptions>(() => ({
    staticArchiveUrl: chmPmtilesUrl,
  }), [chmPmtilesUrl]);
  const activePmtilesBaseUrl =
    activeRasterLayer === "agb"
      ? agbPmtilesBaseUrl
      : activeRasterLayer === "chm"
        ? chmPmtilesUrl
        : pmtilesBaseUrl;
  const activeArchiveOptions =
    activeRasterLayer === "agb"
      ? agbArchiveOptions
      : activeRasterLayer === "chm"
        ? chmArchiveOptions
        : landcoverArchiveOptions;

  const onLandcoverVisibilityChange = useCallback((visible: boolean) => {
    setIsLandcoverVisible(visible);
    if (visible) {
      setIsAgbVisible(false);
      setIsChmVisible(false);
      setYear((previousYear) => Math.max(MIN_YEAR, Math.min(MAX_YEAR, previousYear)));
      return;
    }

    setIsPlaying(false);
  }, []);

  const onAgbVisibilityChange = useCallback((visible: boolean) => {
    setIsAgbVisible(visible);
    if (visible) {
      setIsLandcoverVisible(false);
      setIsChmVisible(false);
      setYear((previousYear) => Math.max(AGB_MIN_YEAR, Math.min(AGB_MAX_YEAR, previousYear)));
      return;
    }

    setIsPlaying(false);
  }, []);

  const onChmVisibilityChange = useCallback((visible: boolean) => {
    setIsChmVisible(visible);
    if (visible) {
      setIsLandcoverVisible(false);
      setIsAgbVisible(false);
    }

    setIsPlaying(false);
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
  }, [mapContext.map]);

  const {
    vectorLayers,
    communityPolygonItems,
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
    isChmVisible,
  });

  const {
    isDrawingPolygon,
    drawingVertices,
    pendingPolygonConfirm,
    startDrawing,
    cancelDrawing,
    confirmPendingPolygon,
    discardPendingPolygon,
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
    onStopPlayback: () => setIsPlaying(false),
    onMessage: setStatusMessage,
  });


  const floatingMessage = useMemo(() => {
    if (missingPmtilesUrl) {
      return "Set NEXT_PUBLIC_R2_PMTILES_BASE_URL to load annual landcover PMTiles.";
    }

    return statusMessage;
  }, [missingPmtilesUrl, statusMessage]);

  const landcoverRenderMode = "classified" as const;
  const agbRenderMode = "ylgn" as const;
  const chmRenderMode = "chm" as const;
  const pmtilesZoomRangeKey =
    activeRasterLayer && activePmtilesBaseUrl
      ? `${activeRasterLayer}:${activePmtilesBaseUrl}:${year}`
      : null;
  const pmtilesZoomRange =
    pmtilesZoomRangeKey && pmtilesZoomRangeState?.cacheKey === pmtilesZoomRangeKey
      ? pmtilesZoomRangeState.range
      : null;

  const {
    hoverPixelInfo,
    hoverAgbPixelInfo,
    hoverChmPixelInfo,
    hoveredVectorInfo,
    selectedVectorInfo,
    clearHoveredForLayer,
    clearSelectedForLayer,
  } = useMapPointerInteractions({
    map: mapContext.map,
    isLandcoverVisible,
    isAgbVisible,
    isChmVisible,
    pmtilesLayer,
    pmtilesZoomRange,
    vectorLayers,
    isDrawingPolygon,
    hasPendingPolygonConfirm: Boolean(pendingPolygonConfirm),
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

    const loadWorkshopRegions = async () => {
      const manifestResponse = await fetch("/api/workshop-regions", { cache: "no-store" });
      if (!manifestResponse.ok) {
        throw new Error(`Failed to read workshop regions (${manifestResponse.status}).`);
      }

      const manifest = (await manifestResponse.json()) as WorkshopRegionsApiResponse;
      const mapInstance = mapContext.map;
      if (!mapInstance) {
        return;
      }
      let loadedRegionCount = 0;

      for (const regionFileName of manifest.regions) {
        if (isCancelled) {
          return;
        }

        const encodedName = encodeURIComponent(regionFileName);
        const regionResponse = await fetch(`/workshop-regions/${encodedName}`, { cache: "force-cache" });
        if (!regionResponse.ok) {
          continue;
        }

        const regionGeoJson = (await regionResponse.json()) as FeatureCollection<Geometry, GeoJsonProperties>;
        const features = geojsonFormatRef.current.readFeatures(regionGeoJson, {
          dataProjection: "EPSG:4326",
          featureProjection: "EPSG:3857",
        });

        if (features.length === 0) {
          continue;
        }

        const regionName = formatWorkshopRegionName(regionFileName);
        const layer = new VectorLayer({
          source: new VectorSource({ features }),
          zIndex: WORKSHOP_VECTOR_Z_INDEX,
          properties: {
            name: regionName,
            isVectorUploadLayer: true,
            isWorkshopRegionLayer: true,
            workshopRegionFile: regionFileName,
          },
        });

        mapInstance.addLayer(layer);

        onVectorLayerAdd(
          regionName,
          {
            layer,
            defaultFillOpacity: WORKSHOP_DEFAULT_FILL_OPACITY,
            availableGroupingColumns: getGroupableColumns(
              features.map((feature) => feature.getProperties() as Record<string, unknown>),
            ),
          },
          { fitToExtent: false },
        );
        loadedRegionCount += 1;
      }

      if (!isCancelled && loadedRegionCount > 0) {
        setStatusMessage(`Loaded ${loadedRegionCount} workshop region polygon${loadedRegionCount === 1 ? "" : "s"}.`);
      }
    };

    loadWorkshopRegions().catch((error) => {
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

  useEffect(() => {
    if (!pmtilesZoomRangeKey) {
      return;
    }

    let isCancelled = false;

    getPmtilesZoomRange(activePmtilesBaseUrl, year, activeArchiveOptions)
      .then((range) => {
        if (isCancelled) {
          return;
        }

        setPmtilesZoomRangeState({ cacheKey: pmtilesZoomRangeKey, range });
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        setPmtilesZoomRangeState({ cacheKey: pmtilesZoomRangeKey, range: null });
      });

    return () => {
      isCancelled = true;
    };
  }, [activeArchiveOptions, activePmtilesBaseUrl, pmtilesZoomRangeKey, year]);

  useEffect(() => {
    if (
      !isPlaying ||
      !activeRasterLayer ||
      activeRasterLayer === "chm" ||
      !activePmtilesBaseUrl ||
      !mapContext.map
    ) {
      return;
    }

    const yearMin = activeRasterLayer === "agb" ? AGB_MIN_YEAR : MIN_YEAR;
    const yearMax = activeRasterLayer === "agb" ? AGB_MAX_YEAR : MAX_YEAR;
    const minPrefetchYear = Math.max(yearMin, year - PLAY_PREFETCH_YEAR_WINDOW);
    const maxPrefetchYear = Math.min(yearMax, year + PLAY_PREFETCH_YEAR_WINDOW);
    const yearsToPrefetch: number[] = [];

    for (let candidateYear = minPrefetchYear; candidateYear <= maxPrefetchYear; candidateYear += 1) {
      yearsToPrefetch.push(candidateYear);
    }

    const tileRequests = collectViewportTileRequests(
      mapContext.map,
      PLAY_PREFETCH_MAX_VISIBLE_TILES,
    );

    void prefetchViewportPmtilesYears(activePmtilesBaseUrl, yearsToPrefetch, tileRequests, {
      maxTiles: PLAY_PREFETCH_MAX_VISIBLE_TILES,
      maxConcurrency: PLAY_PREFETCH_TILE_CONCURRENCY,
      archive: activeArchiveOptions,
    });
  }, [
    activeArchiveOptions,
    activePmtilesBaseUrl,
    activeRasterLayer,
    isPlaying,
    mapContext.map,
    year,
  ]);


  useLayoutEffect(() => {
    for (const vectorLayerState of Object.values(vectorLayers)) {
      vectorLayerState.layer.changed();
    }
    mapContext.map?.renderSync();
  }, [mapContext.map, selectedVectorInfo?.selectionUid, vectorLayers]);


  const hoveredClass =
    hoverPixelInfo?.code !== null && hoverPixelInfo?.code !== undefined
      ? MAPBIOMAS_CLASS_LOOKUP[hoverPixelInfo.code]
      : null;
  const selectedPolygonInfo =
    selectedVectorInfo && vectorLayers[selectedVectorInfo.layerName]
      ? selectedVectorInfo
      : null;
  const selectedPolygonPanelInfo =
    selectedPolygonInfo
      ? {
          layerName: selectedPolygonInfo.layerName,
          groupingColumn: selectedPolygonInfo.groupingColumn,
          groupingValue: selectedPolygonInfo.groupingValue,
          properties: selectedPolygonInfo.properties,
          areaSquareKilometers: selectedPolygonInfo.areaSquareKilometers,
          areaHectares: selectedPolygonInfo.areaHectares,
          precomputedLandcoverStats:
            resolvePrecomputedLandcoverStats(selectedPolygonInfo.rawProperties) ??
            resolvePrecomputedLandcoverStatsFromEntries(selectedPolygonInfo.properties),
        }
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
  }, [resetLandcoverStatsJob, selectedPolygonInfo?.selectionKey]);

  const onDownloadSelectedPolygonGeoJson = useCallback(() => {
    if (!selectedPolygonInfo?.geometry) {
      setStatusMessage("No polygon geometry selected for download.");
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

    if (!Number.isInteger(landcoverStatsBaselineYear) || !Number.isInteger(year)) {
      setStatusMessage("Baseline year and comparison year must be set before running landcover stats.");
      return;
    }

    if (landcoverStatsBaselineYear === year) {
      setStatusMessage("Baseline year must differ from the comparison year.");
      return;
    }

    try {
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
  }, [landcoverStatsBaselineYear, landcoverStatsJob, selectedPolygonGeoJson, selectedPolygonInfo, year]);

  const onCancelLandcoverStats = useCallback(() => {
    landcoverStatsJob.cancel();
    setStatusMessage("Landcover stats request cancelled.");
  }, [landcoverStatsJob]);

  const hoverTooltipStyle =
    (hoverPixelInfo || hoverAgbPixelInfo || hoverChmPixelInfo) && mapContext.map
      ? (() => {
          const mapSize = mapContext.map.getSize();
          const tooltipWidth = 192;
          const tooltipHeight = 44;
          const offsetX = 16;
          const offsetY = 30;
          const hoverX = hoverPixelInfo?.pixelX ?? hoverAgbPixelInfo?.pixelX ?? hoverChmPixelInfo?.pixelX ?? 0;
          const hoverY = hoverPixelInfo?.pixelY ?? hoverAgbPixelInfo?.pixelY ?? hoverChmPixelInfo?.pixelY ?? 0;
          const left = mapSize
            ? Math.min(hoverX + offsetX, Math.max(12, mapSize[0] - tooltipWidth - 12))
            : hoverX + offsetX;
          const top = mapSize
            ? Math.min(
                Math.max(12, hoverY - offsetY),
                Math.max(12, mapSize[1] - tooltipHeight - 12),
              )
            : hoverY - offsetY;

          return { left, top };
        })()
      : null;
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
          onLayerReady={setPmtilesLayer}
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
          onLayerReady={setPmtilesLayer}
          onFrameLoadingChange={setIsFrameLoading}
          onYearFrameReady={onThreatMapYearFrameReady}
        />
      ) : null}

      {isChmVisible ? (
        <PmtilesLayer
          map={mapContext.map}
          year={year}
          visible
          opacity={chmOpacity}
          renderMode={chmRenderMode}
          baseUrl={chmPmtilesUrl}
          archiveOptions={chmArchiveOptions}
          prefetchNeighbors={!isThreatMapGenerating}
          onLayerReady={setPmtilesLayer}
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
            isChmVisible={isChmVisible}
            chmOpacity={chmOpacity}
            activeLegendLayers={activeLegendLayers}
            isLegendOpen={isLegendOpen}
            onSatelliteChange={setIsSatelliteVisible}
            onBoundariesAndPlacesChange={setIsBoundariesAndPlacesVisible}
            onLandcoverChange={onLandcoverVisibilityChange}
            onLandcoverOpacityChange={setLandcoverOpacity}
            onAgbChange={onAgbVisibilityChange}
            onAgbOpacityChange={setAgbOpacity}
            onChmChange={onChmVisibilityChange}
            onChmOpacityChange={setChmOpacity}
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
              status: landcoverStatsJob.status,
              jobId: landcoverStatsJob.jobId,
              progress: landcoverStatsJob.progress,
              etaSeconds: landcoverStatsJob.etaSeconds,
              message: landcoverStatsJob.message,
              error: landcoverStatsJob.error,
              result: landcoverStatsJob.result ?? null,
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
                disabled={isThreatMapGenerating}
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
          isVisible={isThreatMapAiming}
          pixelRect={threatMapPixelRect}
          sideKilometers={THREAT_MAP_SQUARE_SIDE_KM}
          minYear={MIN_YEAR}
          maxYear={MAX_YEAR}
          canGenerate={Boolean(threatMapPixelRect?.fitsViewport)}
          displayedError={displayedThreatMapError}
          onCancel={() => onCancelThreatMap()}
          onGenerate={() => {
            void onGenerateThreatMap();
          }}
        />

        <HoverVectorTooltip
          hoveredVector={hoveredVectorInfo}
          hoveredClass={
            isLandcoverVisible && hoverPixelInfo?.alpha && hoverPixelInfo.alpha > 0
              ? hoveredClass
              : null
          }
          hoveredClassCode={
            isLandcoverVisible && hoverPixelInfo?.alpha && hoverPixelInfo.alpha > 0
              ? hoverPixelInfo.code
              : null
          }
          hoverTooltipStyle={hoverVectorTooltipStyle}
          isVisible={Boolean(
            hoveredVectorInfo && hoverVectorTooltipStyle && !isHoveringOverlayPanel,
          )}
        />

        <HoverClassTooltip
          hoveredClass={hoveredClass}
          hoverTooltipStyle={hoverTooltipStyle}
          isVisible={Boolean(
            hoverPixelInfo &&
              hoverTooltipStyle &&
              isLandcoverVisible &&
              hoverPixelInfo.alpha > 0 &&
              !hoveredVectorInfo &&
              !isHoveringOverlayPanel,
          )}
        />

        <HoverAgbTooltip
          rawValue={hoverAgbPixelInfo?.rawValue ?? 0}
          scaledValue={hoverAgbPixelInfo?.scaledValue ?? 0}
          color={hoverAgbPixelInfo?.color ?? "#f7fcb9"}
          hoverTooltipStyle={hoverTooltipStyle}
          isVisible={Boolean(
            isAgbVisible &&
              hoverAgbPixelInfo &&
              hoverTooltipStyle &&
              hoverAgbPixelInfo.rawValue > 0 &&
              !hoveredVectorInfo &&
              !isHoveringOverlayPanel,
          )}
        />

        <HoverChmTooltip
          rawValue={hoverChmPixelInfo?.rawValue ?? 0}
          scaledValue={hoverChmPixelInfo?.scaledValue ?? 0}
          color={hoverChmPixelInfo?.color ?? "#1e782d"}
          hoverTooltipStyle={hoverTooltipStyle}
          isVisible={Boolean(
            isChmVisible &&
              hoverChmPixelInfo &&
              hoverTooltipStyle &&
              hoverChmPixelInfo.rawValue > 0 &&
              !hoveredVectorInfo &&
              !isHoveringOverlayPanel,
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

        {activeRasterLayer && activeRasterLayer !== "chm" && !isThreatMapAiming && !isThreatMapGenerating ? (
          <OverlayHoverBoundary onHoverChange={setIsHoveringOverlayPanel}>
            <MapBottomSlider
              year={year}
              minYear={activeTimelineMinYear}
              maxYear={activeTimelineMaxYear}
              isPlaying={isPlaying}
              canAdvance={!isFrameLoading}
              isFrameLoading={isFrameLoading}
              isPreloadingYears={isPreloadingYears}
              onYearChange={setYear}
              onPlayingChange={setIsPlaying}
            />
          </OverlayHoverBoundary>
        ) : null}

        <FloatingStatusMessage message={floatingMessage} />
      </div>
    </section>
  );
}