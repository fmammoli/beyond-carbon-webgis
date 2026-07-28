"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Feature as GeoJsonFeature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import { bboxClip } from "@turf/turf";
import type OLMap from "ol/Map";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import type { Coordinate } from "ol/coordinate";
import type { Extent } from "ol/extent";
import Feature from "ol/Feature";
import GeoJSON from "ol/format/GeoJSON";
import type OlGeometry from "ol/geom/Geometry";
import type TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import { transform } from "ol/proj";
import VectorSource from "ol/source/Vector";
import { getArea as getGeodesicArea, getDistance as getGeodesicDistance } from "ol/sphere";
import XYZ from "ol/source/XYZ";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import { getUid } from "ol/util";
import "ol/ol.css";

import {
  DEFAULT_LANDCOVER_OPACITY,
  DEFAULT_R2_PMTILES_BASE_URL,
  DEFAULT_YEAR,
  MAX_YEAR,
  MIN_YEAR,
  PLAY_PREFETCH_MAX_VISIBLE_TILES,
  PLAY_PREFETCH_TILE_CONCURRENCY,
  PLAY_PREFETCH_YEAR_WINDOW,
  THREAT_MAP_SQUARE_SIDE_KM,
  type ThreatMapExportPreset,
} from "@/lib/gis-constants";
import {
  MAX_COMMUNITY_BOUNDARY_BUFFER_METERS,
} from "@/lib/community-boundary";
import { MapCanvas, type MapCanvasReadyPayload } from "@/components/gis/map-canvas";
import {
  CommunityMapPanel,
  type CommunityPolygonItem,
} from "@/components/gis/community-map-panel";
import { ExportsPanel } from "@/components/gis/exports-panel";
import {
  FloatingStatusMessage,
  HoverClassTooltip,
  HoverVectorTooltip,
  MapBottomSlider,
  OverlayHoverBoundary,
  MapTopPanels,
} from "@/components/gis/map-overlay-panels";
import type { ActiveLegendLayer } from "@/components/gis/legend";
import { PmtilesLayer } from "@/components/gis/pmtiles-layer";
import { VectorDropzone, type VectorDropzoneHandle } from "@/components/gis/vector-dropzone";
import { useLandcoverStatsJob } from "@/hooks/use-landcover-stats-job";
import { useThreatMapJob } from "@/hooks/use-threat-map-job";
import { MAPBIOMAS_CLASS_LOOKUP, resolveMapbiomasClassCodeFromRgb } from "@/lib/mapbiomas-colors";
import { formatLandcoverStatsError } from "@/lib/landcover-stats";
import { isThreatMapTerminalStatus } from "@/lib/threat-map";
import {
  getPmtilesZoomRange,
  prefetchViewportPmtilesYears,
  type PmtilesTileRequest,
  type PmtilesZoomRange,
} from "@/lib/pmtiles-source";
import { Button } from "@/components/ui/button";
import {
  buildGroupColorMap,
  DEFAULT_GROUP_PALETTE,
  EMPTY_GROUP_LABEL,
  normalizeGroupValue,
} from "@/lib/vector-grouping";
import {
  getThreatMapPixelRect,
  type ThreatMapPixelRect,
} from "@/lib/threat-map-export";

type MapContextState = {
  map: OLMap | null;
};

type HoverPixelInfo = {
  code: number | null;
  red: number;
  green: number;
  blue: number;
  alpha: number;
  pixelX: number;
  pixelY: number;
  requestedZoom: number | null;
  sourceZoom: number | null;
};

type VectorLayerState = {
  layer: VectorLayer<VectorSource>;
  isVisible: boolean;
  fillOpacity: number;
  availableGroupingColumns: string[];
  groupingColumn: string | null;
  groupingValueColors: Record<string, string>;
  groupingValueCounts: Record<string, number>;
};

type HoveredVectorInfo = {
  layerName: string;
  groupingColumn: string | null;
  groupingValue: string;
  pixelX: number;
  pixelY: number;
};

type SelectedVectorInfo = {
  layerName: string;
  groupingColumn: string | null;
  groupingValue: string;
  geometry: OlGeometry | null;
  properties: Array<{ key: string; value: string }>;
  areaSquareKilometers: number | null;
  areaHectares: number | null;
  selectionKey: string;
  selectionUid: string;
};

type AreaMetrics = {
  areaSquareKilometers: number | null;
  areaHectares: number | null;
};

type PendingPolygonConfirmState = {
  vertices: Coordinate[];
  metrics: PolygonDraftMetrics;
};

type PolygonDraftMetrics = {
  areaSquareKilometers: number;
  requiredBufferKilometers: number;
  maxAllowedBufferKilometers: number;
  exceedsBufferLimit: boolean;
};

type ThreatMapExportStatus = "idle" | "aiming" | "generating";

type ThreatMapProgress = {
  phaseLabel: string;
  statusLabel: string;
  percent: number | null;
  frameIndex: number | null;
  totalFrames: number | null;
  year: number | null;
};

type ThreatMapExportDiagnostics = {
  requestedYear: number | null;
  readyYear: number | null;
  awaitToken: number;
  resolvedToken: number;
  renderedCoverage: number;
  frameLoading: boolean;
  matched: boolean;
};

const UPLOADED_VECTOR_Z_INDEX = 2000;
const DEFAULT_VECTOR_FILL_OPACITY = 0.2;
const DRAW_LAYER_Z_INDEX = 2300;
const DRAW_CLOSE_TOLERANCE_PIXELS = 14;
const MAX_COMMUNITY_BOUNDARY_BUFFER_KM = MAX_COMMUNITY_BOUNDARY_BUFFER_METERS / 1000;
const DEFAULT_VECTOR_STROKE_COLOR = "#ff3b30";
function rgbaFromHex(hexColor: string, alpha: number): string {
  const sanitized = hexColor.replace("#", "");
  if (sanitized.length !== 6) {
    return `rgba(255, 59, 48, ${alpha})`;
  }

  const red = Number.parseInt(sanitized.slice(0, 2), 16);
  const green = Number.parseInt(sanitized.slice(2, 4), 16);
  const blue = Number.parseInt(sanitized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

const DRAW_POINT_STYLE = new Style({
  image: new CircleStyle({
    radius: 4,
    fill: new Fill({ color: "#0f172a" }),
    stroke: new Stroke({ color: "#ffffff", width: 1.5 }),
  }),
});

const DRAW_FIRST_POINT_STYLE = new Style({
  image: new CircleStyle({
    radius: 7,
    fill: new Fill({ color: "rgba(255,255,255,0.95)" }),
    stroke: new Stroke({ color: "#0f172a", width: 2.5 }),
  }),
});

const DRAW_LINE_STYLE = new Style({
  stroke: new Stroke({
    color: "#0f172a",
    width: 2,
    lineDash: [6, 5],
  }),
});

const DRAW_POLYGON_PREVIEW_STYLE = new Style({
  stroke: new Stroke({
    color: "#0f172a",
    width: 2,
  }),
  fill: new Fill({ color: "rgba(15, 23, 42, 0.12)" }),
});

function createVectorStyle(fillOpacity: number, color = DEFAULT_VECTOR_STROKE_COLOR): Style {
  return new Style({
    stroke: new Stroke({
      color,
      width: 2,
    }),
    fill: new Fill({
      color: rgbaFromHex(color, fillOpacity),
    }),
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color }),
      stroke: new Stroke({ color: "#ffffff", width: 1.5 }),
    }),
  });
}

function createHighlightedVectorStyle(
  fillOpacity: number,
  color = DEFAULT_VECTOR_STROKE_COLOR,
): Style[] {
  return [
    new Style({
      stroke: new Stroke({
        color: "#ffffff",
        width: 6,
      }),
      fill: new Fill({
        color: rgbaFromHex(color, Math.min(0.35, fillOpacity + 0.12)),
      }),
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({ color: "#ffffff" }),
        stroke: new Stroke({ color: "#ffffff", width: 2 }),
      }),
    }),
    new Style({
      stroke: new Stroke({
        color,
        width: 3,
      }),
      fill: new Fill({
        color: rgbaFromHex(color, Math.min(0.45, fillOpacity + 0.18)),
      }),
      image: new CircleStyle({
        radius: 6,
        fill: new Fill({ color }),
        stroke: new Stroke({ color: "#ffffff", width: 2 }),
      }),
    }),
  ];
}

function collectGroupingStats(
  features: Feature<OlGeometry>[],
  groupingColumn: string | null,
): { valueCounts: Record<string, number>; valueColors: Record<string, string> } {
  if (!groupingColumn) {
    return {
      valueCounts: {},
      valueColors: {},
    };
  }

  const normalizedValues = features.map((feature) => normalizeGroupValue(feature.get(groupingColumn)));
  const counts = normalizedValues.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});

  return {
    valueCounts: counts,
    valueColors: buildGroupColorMap(Object.keys(counts), DEFAULT_GROUP_PALETTE),
  };
}

function applyVectorLayerStyle(
  layer: VectorLayer<VectorSource>,
  fillOpacity: number,
  groupingColumn: string | null,
  groupingValueColors: Record<string, string>,
  selectedFeatureUidRef: { current: string | null },
) {
  const styleCache = new Map<string, Style>();
  const highlightedStyleCache = new Map<string, Style[]>();

  layer.setStyle((feature) => {
    const featureGeometryType = feature.getGeometry()?.getType();
    const groupValue = groupingColumn ? normalizeGroupValue(feature.get(groupingColumn)) : EMPTY_GROUP_LABEL;
    const color = groupingColumn
      ? (groupingValueColors[groupValue] ?? DEFAULT_VECTOR_STROKE_COLOR)
      : DEFAULT_VECTOR_STROKE_COLOR;
    const featureUid = getUid(feature);
    const isSelected = selectedFeatureUidRef.current !== null && featureUid === selectedFeatureUidRef.current;
    const geometryBucket = featureGeometryType?.includes("Point")
      ? "point"
      : featureGeometryType?.includes("Line")
        ? "line"
        : "polygon";

    const key = `${geometryBucket}:${color}:${fillOpacity}`;
    if (isSelected) {
      const highlightedKey = `${key}:selected`;
      const existingHighlighted = highlightedStyleCache.get(highlightedKey);
      if (existingHighlighted) {
        return existingHighlighted;
      }

      const highlightedStyle = createHighlightedVectorStyle(fillOpacity, color);
      highlightedStyleCache.set(highlightedKey, highlightedStyle);
      return highlightedStyle;
    }

    const existing = styleCache.get(key);
    if (existing) {
      return existing;
    }

    const style = createVectorStyle(fillOpacity, color);
    styleCache.set(key, style);
    return style;
  });
}

function isNearFirstVertex(map: OLMap, first: Coordinate, candidate: Coordinate): boolean {
  const [firstPxX, firstPxY] = map.getPixelFromCoordinate(first);
  const [candidatePxX, candidatePxY] = map.getPixelFromCoordinate(candidate);
  const dx = firstPxX - candidatePxX;
  const dy = firstPxY - candidatePxY;
  return Math.sqrt(dx * dx + dy * dy) <= DRAW_CLOSE_TOLERANCE_PIXELS;
}

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

function calculatePolygonCentroid(vertices: Coordinate[]): Coordinate {
  if (vertices.length < 3) {
    return [...vertices[0]!];
  }

  let twiceAreaSum = 0;
  let centroidXSum = 0;
  let centroidYSum = 0;

  for (let index = 0; index < vertices.length; index += 1) {
    const [x0, y0] = vertices[index]!;
    const [x1, y1] = vertices[(index + 1) % vertices.length]!;
    const cross = x0 * y1 - x1 * y0;
    twiceAreaSum += cross;
    centroidXSum += (x0 + x1) * cross;
    centroidYSum += (y0 + y1) * cross;
  }

  if (Math.abs(twiceAreaSum) < 1e-8) {
    const polygon = new Polygon([[...vertices, vertices[0]!]]);
    const [minX, minY, maxX, maxY] = polygon.getExtent();
    return [(minX + maxX) / 2, (minY + maxY) / 2];
  }

  return [
    centroidXSum / (3 * twiceAreaSum),
    centroidYSum / (3 * twiceAreaSum),
  ];
}

function calculatePolygonDraftMetrics(vertices: Coordinate[]): PolygonDraftMetrics {
  const polygon = new Polygon([[...vertices, vertices[0]!]]);
  const areaSquareMeters = Math.abs(
    getGeodesicArea(polygon, {
      projection: "EPSG:3857",
    }),
  );

  const centroid = calculatePolygonCentroid(vertices);
  const centroidLonLat = transform([...centroid], "EPSG:3857", "EPSG:4326");
  const maxDistanceMeters = vertices.reduce((largestDistance, vertex) => {
    const vertexLonLat = transform([...vertex], "EPSG:3857", "EPSG:4326");
    const distance = getGeodesicDistance(centroidLonLat, vertexLonLat);
    return Math.max(largestDistance, distance);
  }, 0);

  const requiredBufferKilometers = maxDistanceMeters / 1000;

  return {
    areaSquareKilometers: areaSquareMeters / 1_000_000,
    requiredBufferKilometers,
    maxAllowedBufferKilometers: MAX_COMMUNITY_BOUNDARY_BUFFER_KM,
    exceedsBufferLimit: maxDistanceMeters > MAX_COMMUNITY_BOUNDARY_BUFFER_METERS,
  };
}

function getHoveredFeatureAreaMetrics(
  geometry: OlGeometry | undefined,
): AreaMetrics {
  if (!geometry || !geometry.getType().includes("Polygon")) {
    return {
      areaSquareKilometers: null,
      areaHectares: null,
    };
  }

  const areaSquareMeters = Math.abs(
    getGeodesicArea(geometry, {
      projection: "EPSG:3857",
    }),
  );

  return {
    areaSquareKilometers: areaSquareMeters / 1_000_000,
    areaHectares: areaSquareMeters / 10_000,
  };
}

function createCenteredMaxSquareVertices(vertices: Coordinate[]): Coordinate[] {
  const [centerX, centerY] = calculatePolygonCentroid(vertices);
  const halfSide = MAX_COMMUNITY_BOUNDARY_BUFFER_METERS;

  return [
    [centerX - halfSide, centerY - halfSide],
    [centerX + halfSide, centerY - halfSide],
    [centerX + halfSide, centerY + halfSide],
    [centerX - halfSide, centerY + halfSide],
  ];
}

type GeoJsonBbox = [number, number, number, number];

function isCoordWithinBbox(coord: [number, number], bbox: GeoJsonBbox): boolean {
  return coord[0] >= bbox[0]
    && coord[0] <= bbox[2]
    && coord[1] >= bbox[1]
    && coord[1] <= bbox[3];
}

function clipFeatureToBbox(
  feature: GeoJsonFeature<Geometry, GeoJsonProperties>,
  bbox: GeoJsonBbox,
): GeoJsonFeature<Geometry, GeoJsonProperties> | null {
  const geometry = feature.geometry;
  if (!geometry) {
    return null;
  }

  if (geometry.type === "Point") {
    return isCoordWithinBbox(geometry.coordinates as [number, number], bbox) ? feature : null;
  }

  if (geometry.type === "MultiPoint") {
    const coordinates = geometry.coordinates.filter((coord) => isCoordWithinBbox(coord as [number, number], bbox));
    if (coordinates.length === 0) {
      return null;
    }

    return {
      ...feature,
      geometry: {
        ...geometry,
        coordinates,
      },
    };
  }

  try {
    const clipped = bboxClip(feature as never, bbox) as GeoJsonFeature<Geometry, GeoJsonProperties>;
    if (!clipped?.geometry) {
      return null;
    }

    return {
      ...clipped,
      properties: feature.properties,
    };
  } catch {
    return feature;
  }
}

function saveBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function getImageExtensionFromPath(pathValue: string): string {
  const match = pathValue.toLowerCase().match(/\.(png|jpg|jpeg|webp)$/);
  if (!match) {
    return "png";
  }

  return match[1] === "jpeg" ? "jpg" : match[1]!;
}

export default function MapContainer() {
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLandcoverVisible, setIsLandcoverVisible] = useState(true);
  const [landcoverOpacity, setLandcoverOpacity] = useState(DEFAULT_LANDCOVER_OPACITY);
  const [isSatelliteVisible, setIsSatelliteVisible] = useState(true);
  const [isBoundariesAndPlacesVisible, setIsBoundariesAndPlacesVisible] = useState(true);
  const [isLegendOpen, setIsLegendOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isFrameLoading, setIsFrameLoading] = useState(false);
  const isPreloadingYears = false;
  const [hoverPixelInfo, setHoverPixelInfo] = useState<HoverPixelInfo | null>(null);
  const [hoveredVectorInfo, setHoveredVectorInfo] = useState<HoveredVectorInfo | null>(null);
  const [isHoveringOverlayPanel, setIsHoveringOverlayPanel] = useState(false);
  const [selectedVectorInfo, setSelectedVectorInfo] = useState<SelectedVectorInfo | null>(null);
  const [landcoverStatsBaselineYear, setLandcoverStatsBaselineYear] = useState(1990);
  const [pmtilesZoomRangeState, setPmtilesZoomRangeState] = useState<{
    cacheKey: string;
    range: PmtilesZoomRange | null;
  } | null>(null);
  const [pmtilesLayer, setPmtilesLayer] = useState<TileLayer<XYZ> | null>(null);
  const [mapContext, setMapContext] = useState<MapContextState>({
    map: null,
  });
  const [vectorLayers, setVectorLayers] = useState<Record<string, VectorLayerState>>({});
  const [communityMapLayerNames, setCommunityMapLayerNames] = useState<string[]>([]);
  const [isDrawingPolygon, setIsDrawingPolygon] = useState(false);
  const [drawingVertices, setDrawingVertices] = useState<Coordinate[]>([]);
  const [pendingPolygonConfirm, setPendingPolygonConfirm] =
    useState<PendingPolygonConfirmState | null>(null);
  const [threatMapExportStatus, setThreatMapExportStatus] =
    useState<ThreatMapExportStatus>("idle");
  const [threatMapError, setThreatMapError] = useState<string | null>(null);
  const [threatMapPixelRect, setThreatMapPixelRect] = useState<ThreatMapPixelRect | null>(null);
  const [threatMapDiagnostics, setThreatMapDiagnostics] =
    useState<ThreatMapExportDiagnostics | null>(null);
  const [threatMapExportPreset, setThreatMapExportPreset] =
    useState<ThreatMapExportPreset>("balanced");
  const vectorDropzoneRef = useRef<VectorDropzoneHandle | null>(null);
  const drawingVerticesRef = useRef<Coordinate[]>([]);
  const drawingLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const selectedVectorUidRef = useRef<string | null>(null);
  const communityPolygonCounterRef = useRef(1);
  const geojsonFormatRef = useRef(new GeoJSON());
  const isFrameLoadingRef = useRef(isFrameLoading);
  const threatMapCancelRef = useRef(false);
  const threatMapAwaitedYearRef = useRef<number | null>(null);
  const threatMapAwaitTokenRef = useRef(0);
  const threatMapResolvedTokenRef = useRef(0);
  const threatMapDiagnosticsUpdateAtRef = useRef(0);
  const threatMapDeliveredJobIdRef = useRef<string | null>(null);
  const landcoverStatsJob = useLandcoverStatsJob({
    baseUrl: process.env.NEXT_PUBLIC_LANDCOVER_STATS_API_BASE_URL,
    apiKey: process.env.NEXT_PUBLIC_LANDCOVER_STATS_API_KEY,
  });
  const threatMapJob = useThreatMapJob({
    apiKey: process.env.NEXT_PUBLIC_THREAT_MAP_API_KEY,
    pollIntervalMs: 4000,
    autoDownloadOnTerminal: true,
    enableClientEncoding: true,
  });
  const resetLandcoverStatsJob = landcoverStatsJob.reset;

  const pmtilesBaseUrl =
    process.env.NEXT_PUBLIC_R2_PMTILES_BASE_URL ?? DEFAULT_R2_PMTILES_BASE_URL;
  const missingPmtilesUrl = !pmtilesBaseUrl;
  const hasThreatMapDownload = Boolean(threatMapJob.encodedMp4Blob)
    || threatMapJob.downloadedArtifact?.artifactType === "mp4";
  const hasThreatMapFailure = threatMapJob.status === "failed"
    || threatMapJob.status === "cancelled"
    || Boolean(threatMapJob.encodingError);
  const isThreatMapGenerating = threatMapExportStatus === "generating"
    && !hasThreatMapDownload
    && !hasThreatMapFailure;
  const isThreatMapAiming = threatMapExportStatus === "aiming"
    || (threatMapExportStatus === "generating" && (hasThreatMapDownload || hasThreatMapFailure));

  const onMapReady = useCallback((payload: MapCanvasReadyPayload) => {
    if (process.env.NODE_ENV !== "production") {
      (globalThis as typeof globalThis & { __BC_MAP__?: OLMap }).__BC_MAP__ = payload.map;
    }

    setMapContext({
      map: payload.map,
    });
  }, []);

  useEffect(() => {
    isFrameLoadingRef.current = isFrameLoading;
  }, [isFrameLoading]);

  const onThreatMapYearFrameReady = useCallback((readyYear: number) => {
    if (threatMapAwaitedYearRef.current !== readyYear) {
      setThreatMapDiagnostics((previous) => {
        if (!previous) {
          return null;
        }

        return {
          ...previous,
          readyYear,
          matched: false,
        };
      });
      return;
    }

    threatMapResolvedTokenRef.current = threatMapAwaitTokenRef.current;
    setThreatMapDiagnostics((previous) => {
      if (!previous) {
        return null;
      }

      return {
        ...previous,
        readyYear,
        resolvedToken: threatMapResolvedTokenRef.current,
        frameLoading: isFrameLoadingRef.current,
        matched: true,
      };
    });
  }, []);

  useEffect(() => {
    if (!mapContext.map || !isThreatMapAiming) {
      return;
    }

    const updateOverlay = () => {
      const pixelRect = getThreatMapPixelRect(mapContext.map!, THREAT_MAP_SQUARE_SIDE_KM);
      setThreatMapPixelRect(pixelRect);
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
  }, [isThreatMapAiming, mapContext.map]);

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

  const onVectorLayerAdd = useCallback((
    fileName: string,
    payload: {
      layer: VectorLayer<VectorSource>;
      defaultFillOpacity: number;
      availableGroupingColumns: string[];
    },
  ) => {
    setCommunityMapLayerNames((prev) => (prev.includes(fileName) ? prev : [...prev, fileName]));

    setVectorLayers((prev) => {
      const existing = prev[fileName];
      const nextFillOpacity = existing?.fillOpacity ?? payload.defaultFillOpacity;
      const nextGroupingColumn =
        existing?.groupingColumn && payload.availableGroupingColumns.includes(existing.groupingColumn)
          ? existing.groupingColumn
          : null;

      const vectorLayer = payload.layer;
      const featureSource = vectorLayer.getSource();
      const featureList = featureSource?.getFeatures() ?? [];
      const groupingStats = collectGroupingStats(featureList, nextGroupingColumn);

      vectorLayer.setVisible(existing?.isVisible ?? true);
      applyVectorLayerStyle(
        vectorLayer,
        nextFillOpacity,
        nextGroupingColumn,
        groupingStats.valueColors,
        selectedVectorUidRef,
      );

      return {
        ...prev,
        [fileName]: {
          layer: vectorLayer,
          isVisible: existing?.isVisible ?? true,
          fillOpacity: nextFillOpacity,
          availableGroupingColumns: payload.availableGroupingColumns,
          groupingColumn: nextGroupingColumn,
          groupingValueColors: groupingStats.valueColors,
          groupingValueCounts: groupingStats.valueCounts,
        },
      };
    });

    const source = payload.layer.getSource();
    const extent = source?.getExtent();
    if (extent) {
      fitMapToCommunityPolygonExtent(extent);
    }
  }, [fitMapToCommunityPolygonExtent]);

  const onVectorLayerVisibilityChange = useCallback((fileName: string, isVisible: boolean) => {
    setVectorLayers((prev) => {
      const existing = prev[fileName];
      if (!existing) {
        return prev;
      }

      existing.layer.setVisible(isVisible);

      return {
        ...prev,
        [fileName]: {
          ...existing,
          isVisible,
        },
      };
    });
  }, []);

  const onVectorLayerOpacityChange = useCallback((fileName: string, fillOpacity: number) => {
    setVectorLayers((prev) => {
      const existing = prev[fileName];
      if (!existing) {
        return prev;
      }

      applyVectorLayerStyle(
        existing.layer,
        fillOpacity,
        existing.groupingColumn,
        existing.groupingValueColors,
        selectedVectorUidRef,
      );

      return {
        ...prev,
        [fileName]: {
          ...existing,
          fillOpacity,
        },
      };
    });
  }, []);

  const onVectorLayerGroupingColumnChange = useCallback((fileName: string, groupingColumn: string | null) => {
    setVectorLayers((prev) => {
      const existing = prev[fileName];
      if (!existing) {
        return prev;
      }

      const normalizedGrouping =
        groupingColumn && existing.availableGroupingColumns.includes(groupingColumn)
          ? groupingColumn
          : null;
      const source = existing.layer.getSource();
      const features = source?.getFeatures() ?? [];
      const groupingStats = collectGroupingStats(features, normalizedGrouping);

      applyVectorLayerStyle(
        existing.layer,
        existing.fillOpacity,
        normalizedGrouping,
        groupingStats.valueColors,
        selectedVectorUidRef,
      );

      return {
        ...prev,
        [fileName]: {
          ...existing,
          groupingColumn: normalizedGrouping,
          groupingValueColors: groupingStats.valueColors,
          groupingValueCounts: groupingStats.valueCounts,
        },
      };
    });
  }, []);

  const onCommunityPolygonFocus = useCallback((fileName: string) => {
    const layerState = vectorLayers[fileName];
    if (!layerState) {
      return;
    }

    const source = layerState.layer.getSource();
    const extent = source?.getExtent();
    if (!extent) {
      return;
    }

    fitMapToCommunityPolygonExtent(extent);
  }, [fitMapToCommunityPolygonExtent, vectorLayers]);

  const clearDrawingState = useCallback(() => {
    drawingVerticesRef.current = [];
    setDrawingVertices([]);
  }, []);

  const cancelDrawing = useCallback(() => {
    setIsDrawingPolygon(false);
    setPendingPolygonConfirm(null);
    clearDrawingState();
    setStatusMessage("Polygon drawing canceled.");
  }, [clearDrawingState]);

  const onStartThreatMap = useCallback(() => {
    if (!mapContext.map) {
      setStatusMessage("Map is still loading. Try Threat Map again in a moment.");
      return;
    }

    if (isDrawingPolygon) {
      cancelDrawing();
    }

    setIsPlaying(false);
    threatMapCancelRef.current = false;
    threatMapAwaitedYearRef.current = null;
    threatMapAwaitTokenRef.current = 0;
    threatMapResolvedTokenRef.current = 0;
    threatMapDiagnosticsUpdateAtRef.current = 0;
    setThreatMapError(null);
    setThreatMapDiagnostics(null);
    threatMapDeliveredJobIdRef.current = null;
    threatMapJob.reset();
    setThreatMapExportStatus("aiming");
    setStatusMessage("Threat Map aiming is active. Pan or zoom, then click Generate.");
  }, [cancelDrawing, isDrawingPolygon, mapContext.map, threatMapJob]);

  const onCancelThreatMap = useCallback((message = "Threat Map canceled.") => {
    threatMapCancelRef.current = true;
    threatMapAwaitedYearRef.current = null;
    threatMapAwaitTokenRef.current = 0;
    threatMapResolvedTokenRef.current = 0;
    threatMapDiagnosticsUpdateAtRef.current = 0;
    setThreatMapExportStatus("idle");
    setThreatMapDiagnostics(null);
    setThreatMapPixelRect(null);
    setThreatMapError(null);
    if (threatMapJob.isPolling) {
      void threatMapJob.cancel();
    }
    setStatusMessage(message);
  }, [threatMapJob]);

  const onGenerateThreatMap = useCallback(async () => {
    if (!mapContext.map) {
      setStatusMessage("Map is still loading. Try Threat Map again in a moment.");
      return;
    }

    const map = mapContext.map;

    const frozenRect = getThreatMapPixelRect(map, THREAT_MAP_SQUARE_SIDE_KM);
    if (!frozenRect || !frozenRect.fitsViewport) {
      setThreatMapError(`Zoom in until the ${THREAT_MAP_SQUARE_SIDE_KM} km square fits fully inside the map viewport.`);
      setStatusMessage(`Threat Map requires the full ${THREAT_MAP_SQUARE_SIDE_KM} km square to fit in view.`);
      return;
    }

    const topLeft = map.getCoordinateFromPixel([frozenRect.left, frozenRect.top]);
    const topRight = map.getCoordinateFromPixel([frozenRect.left + frozenRect.width, frozenRect.top]);
    const bottomRight = map.getCoordinateFromPixel([frozenRect.left + frozenRect.width, frozenRect.top + frozenRect.height]);
    const bottomLeft = map.getCoordinateFromPixel([frozenRect.left, frozenRect.top + frozenRect.height]);

    const ring = [topLeft, topRight, bottomRight, bottomLeft, topLeft]
      .map((coordinate) => [coordinate[0], coordinate[1]] as [number, number]);

    const squareBbox3857: GeoJsonBbox = [
      Math.min(...ring.map((coord) => coord[0])),
      Math.min(...ring.map((coord) => coord[1])),
      Math.max(...ring.map((coord) => coord[0])),
      Math.max(...ring.map((coord) => coord[1])),
    ];

    const squareExtent: Extent = [
      Math.min(topLeft[0], topRight[0], bottomRight[0], bottomLeft[0]),
      Math.min(topLeft[1], topRight[1], bottomRight[1], bottomLeft[1]),
      Math.max(topLeft[0], topRight[0], bottomRight[0], bottomLeft[0]),
      Math.max(topLeft[1], topRight[1], bottomRight[1], bottomLeft[1]),
    ];

    const overlayFeatures: Array<GeoJsonFeature<Geometry, GeoJsonProperties>> = [];
    for (const [layerName, layerState] of Object.entries(vectorLayers)) {
      if (!layerState.isVisible) {
        continue;
      }

      const features = layerState.layer.getSource()?.getFeatures() ?? [];

      for (const feature of features) {
        const geometry = feature.getGeometry();
        if (!geometry || !geometry.intersectsExtent(squareExtent)) {
          continue;
        }

        try {
          const geometryObject = geojsonFormatRef.current.writeGeometryObject(geometry, {
            dataProjection: "EPSG:3857",
            featureProjection: "EPSG:3857",
          }) as Geometry;

          const sourceProperties = feature.getProperties();
          const sanitizedProperties: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(sourceProperties)) {
            if (key === "geometry" || typeof value === "function" || value === undefined) {
              continue;
            }

            try {
              sanitizedProperties[key] = JSON.parse(JSON.stringify(value));
            } catch {
              // Skip non-serializable properties.
            }
          }

          const overlayFeature: GeoJsonFeature<Geometry, GeoJsonProperties> = {
            type: "Feature",
            geometry: geometryObject,
            properties: {
              ...sanitizedProperties,
              source: "threat-map-overlay",
              layerName,
              groupingColumn: layerState.groupingColumn,
            },
          };

          const clippedOverlayFeature = clipFeatureToBbox(overlayFeature, squareBbox3857);
          if (clippedOverlayFeature) {
            overlayFeatures.push(clippedOverlayFeature);
          }
        } catch {
          // Skip geometries that cannot be converted to GeoJSON.
        }
      }
    }

    const preset = threatMapExportPreset === "high" || threatMapExportPreset === "ultra"
      ? "high"
      : "balanced";

    setThreatMapExportStatus("generating");
    setThreatMapError(null);
    setThreatMapDiagnostics(null);
    threatMapDeliveredJobIdRef.current = null;

    try {
      await threatMapJob.submit({
        geojson: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Polygon",
                coordinates: [ring],
              },
              properties: {
                source: "threat-map-square",
              },
            },
            ...overlayFeatures,
          ],
        },
        preset,
        outputFormat: "frames_tar_gz",
      });
      setStatusMessage(
        `Threat Map job submitted. Generating... (${overlayFeatures.length} overlay feature${overlayFeatures.length === 1 ? "" : "s"} included)`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Threat Map export failed.";
      setThreatMapExportStatus("aiming");
      setThreatMapError(message);
      setStatusMessage(`Threat Map export failed: ${message}`);
    }
  }, [
    geojsonFormatRef,
    mapContext.map,
    threatMapJob,
    threatMapExportPreset,
    vectorLayers,
  ]);

  useEffect(() => {
    if (threatMapExportStatus !== "generating") {
      return;
    }

    if (threatMapJob.status === "idle" || threatMapJob.status === "submitting") {
      return;
    }

    if (!isThreatMapTerminalStatus(threatMapJob.status)) {
      return;
    }

    const alreadyDelivered = threatMapDeliveredJobIdRef.current === threatMapJob.jobId;
    if (alreadyDelivered || !threatMapJob.jobId) {
      return;
    }

    if (threatMapJob.encodedMp4Blob) {
      saveBlob(threatMapJob.encodedMp4Blob, `threat-map-${MIN_YEAR}-${MAX_YEAR}.mp4`);

      if (threatMapJob.boundaryFrames) {
        const firstFrameExtension = getImageExtensionFromPath(threatMapJob.boundaryFrames.first.path);
        const lastFrameExtension = getImageExtensionFromPath(threatMapJob.boundaryFrames.last.path);

        saveBlob(
          threatMapJob.boundaryFrames.first.blob,
          `threat-map-${threatMapJob.boundaryFrames.first.year}.${firstFrameExtension}`,
        );
        saveBlob(
          threatMapJob.boundaryFrames.last.blob,
          `threat-map-${threatMapJob.boundaryFrames.last.year}.${lastFrameExtension}`,
        );
      }

      threatMapDeliveredJobIdRef.current = threatMapJob.jobId;
      return;
    }

    if (threatMapJob.downloadedArtifact?.artifactType === "mp4") {
      saveBlob(
        threatMapJob.downloadedArtifact.blob,
        threatMapJob.downloadedArtifact.filename || `threat-map-${MIN_YEAR}-${MAX_YEAR}.mp4`,
      );
      threatMapDeliveredJobIdRef.current = threatMapJob.jobId;
    }
  }, [
    threatMapExportStatus,
    threatMapJob.currentYear,
    threatMapJob.boundaryFrames,
    threatMapJob.downloadedArtifact,
    threatMapJob.encodedMp4Blob,
    threatMapJob.encodingError,
    threatMapJob.error,
    threatMapJob.jobId,
    threatMapJob.progress,
    threatMapJob.status,
  ]);

  const threatMapDisplayProgress = useMemo<ThreatMapProgress | null>(() => {
    if (!isThreatMapGenerating) {
      return null;
    }

    if (threatMapJob.encodingProgress) {
      const { stage, completed, total, message } = threatMapJob.encodingProgress;
      const safeTotal = Number.isFinite(total) && total > 0 ? total : null;
      const safeCompleted = Number.isFinite(completed) && completed >= 0 ? completed : 0;
      const percent = safeTotal ? Math.round((safeCompleted / safeTotal) * 100) : null;

      if (stage === "extracting") {
        return {
          phaseLabel: "Preparing frames",
          statusLabel: message,
          percent,
          frameIndex: null,
          totalFrames: safeTotal,
          year: threatMapJob.currentYear ?? year,
        };
      }

      if (stage === "parsing_manifest") {
        return {
          phaseLabel: "Reading manifest",
          statusLabel: message,
          percent,
          frameIndex: null,
          totalFrames: safeTotal,
          year: threatMapJob.currentYear ?? year,
        };
      }

      return {
        phaseLabel: "Encoding MP4 in browser",
        statusLabel: message,
        percent,
        frameIndex: safeTotal ? Math.min(safeTotal, Math.max(0, safeCompleted)) : null,
        totalFrames: safeTotal,
        year: threatMapJob.currentYear ?? year,
      };
    }

    const progressValue = threatMapJob.progress ?? 0;
    const clampedProgress = Math.max(0, Math.min(100, Math.round(progressValue)));
    const totalFrames = MAX_YEAR - MIN_YEAR + 1;
    const frameIndex = Math.max(1, Math.min(totalFrames, Math.round((clampedProgress / 100) * totalFrames)));

    return {
      phaseLabel: "Rendering yearly frames",
      statusLabel: threatMapJob.message ?? "Threat Map job is running...",
      percent: clampedProgress,
      frameIndex,
      totalFrames,
      year: threatMapJob.currentYear ?? year,
    };
  }, [
    isThreatMapGenerating,
    threatMapJob.currentYear,
    threatMapJob.encodingProgress,
    threatMapJob.message,
    threatMapJob.progress,
    year,
  ]);

  const displayedThreatMapError =
    threatMapError
    ?? threatMapJob.error?.message
    ?? threatMapJob.encodingError
    ?? null;

  const commitPolygon = useCallback(
    (polygonToCommit: PendingPolygonConfirmState) => {
      if (!mapContext.map) {
        return;
      }

      const { metrics } = polygonToCommit;
      const vertices = metrics.exceedsBufferLimit
        ? createCenteredMaxSquareVertices(polygonToCommit.vertices)
        : polygonToCommit.vertices;

      const fileName = `Community polygon ${communityPolygonCounterRef.current}`;
      communityPolygonCounterRef.current += 1;

      const polygon = new Polygon([[...vertices, vertices[0]!]]);
      const feature = new Feature({ geometry: polygon });
      const source = new VectorSource({ features: [feature] });
      const fillOpacity = DEFAULT_VECTOR_FILL_OPACITY;

      const layer = new VectorLayer({
        source,
        style: createVectorStyle(fillOpacity),
        zIndex: UPLOADED_VECTOR_Z_INDEX,
        properties: {
          name: fileName,
          isVectorUploadLayer: true,
          isCommunityPolygonLayer: true,
        },
      });

      mapContext.map.addLayer(layer);
      onVectorLayerAdd(fileName, {
        layer,
        defaultFillOpacity: fillOpacity,
        availableGroupingColumns: [],
      });

      clearDrawingState();
      setPendingPolygonConfirm(null);
      setIsDrawingPolygon(false);

      const measurementSummary =
        `Area ${formatAreaSquareKilometers(metrics.areaSquareKilometers)} km². ` +
        `Required centroid buffer ${formatKilometers(metrics.requiredBufferKilometers)} km ` +
        `of ${formatKilometers(metrics.maxAllowedBufferKilometers)} km max.`;

      if (metrics.exceedsBufferLimit) {
        setStatusMessage(
          `${fileName} added. ${measurementSummary} Your polygon was automatically reduced to the maximum ${formatKilometers(metrics.maxAllowedBufferKilometers)} km square buffer centered on your drawing.`,
        );
      } else {
        setStatusMessage(
          `${fileName} added. ${measurementSummary}`,
        );
      }
    },
    [clearDrawingState, mapContext.map, onVectorLayerAdd],
  );

  const finalizePolygonDrawing = useCallback(
    (vertices: Coordinate[]) => {
      if (vertices.length < 3) {
        setStatusMessage("At least 3 vertices are required to form a polygon.");
        return;
      }

      const metrics = calculatePolygonDraftMetrics(vertices);

      setPendingPolygonConfirm({ vertices: [...vertices], metrics });

      const baseMessage =
        `Review your polygon. Area ${formatAreaSquareKilometers(metrics.areaSquareKilometers)} km². ` +
        `Required centroid buffer ${formatKilometers(metrics.requiredBufferKilometers)} km ` +
        `of ${formatKilometers(metrics.maxAllowedBufferKilometers)} km max.`;

      if (metrics.exceedsBufferLimit) {
        const overflowKilometers = metrics.requiredBufferKilometers - metrics.maxAllowedBufferKilometers;
        setStatusMessage(
          `${baseMessage} This is too large by ${formatKilometers(overflowKilometers)} km and will be clipped if you confirm.`,
        );
      } else {
        setStatusMessage(baseMessage);
      }
    },
    [],
  );

  const deleteCommunityPolygon = useCallback(
    (fileName: string) => {
      setCommunityMapLayerNames((prev) => prev.filter((name) => name !== fileName));

      setVectorLayers((prev) => {
        const existing = prev[fileName];
        if (existing && mapContext.map) {
          mapContext.map.removeLayer(existing.layer);
        }

        const next = { ...prev };
        delete next[fileName];
        return next;
      });

      setHoveredVectorInfo((prev) => {
        if (!prev || prev.layerName !== fileName) {
          return prev;
        }

        return null;
      });

      setSelectedVectorInfo((prev) => {
        if (!prev || prev.layerName !== fileName) {
          return prev;
        }

        selectedVectorUidRef.current = null;
        return null;
      });

      setStatusMessage(`${fileName} removed.`);
    },
    [mapContext.map],
  );

  const communityPolygonItems = useMemo<CommunityPolygonItem[]>(() => {
    return communityMapLayerNames
      .map((fileName) => {
        const vectorLayer = vectorLayers[fileName];
        if (!vectorLayer) {
          return null;
        }

        return {
          fileName,
          isVisible: vectorLayer.isVisible,
          opacity: vectorLayer.fillOpacity,
          groupingColumn: vectorLayer.groupingColumn,
          availableGroupingColumns: vectorLayer.availableGroupingColumns,
          groupCount: Object.keys(vectorLayer.groupingValueCounts).length,
          groupingPreview: Object.entries(vectorLayer.groupingValueCounts)
            .map(([value, count]) => ({
              value,
              count,
              color: vectorLayer.groupingValueColors[value] ?? DEFAULT_VECTOR_STROKE_COLOR,
            }))
            .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
            .slice(0, 6),
        };
      })
      .filter((item): item is CommunityPolygonItem => item !== null);
  }, [communityMapLayerNames, vectorLayers]);

  const activeLegendLayers = useMemo<ActiveLegendLayer[]>(() => {
    const layers: ActiveLegendLayer[] = [];

    if (isLandcoverVisible) {
      layers.push({
        id: "landcover",
        kind: "landcover",
        title: "Landcover",
      });
    }

    for (const [fileName, data] of Object.entries(vectorLayers)) {
      if (!data.isVisible) {
        continue;
      }

      layers.push({
        id: `vector:${fileName}`,
        kind: "vector",
        title: fileName,
        fillOpacity: data.fillOpacity,
        groupingColumn: data.groupingColumn,
        groups: Object.entries(data.groupingValueCounts).map(([value, count]) => ({
          value,
          count,
          color: data.groupingValueColors[value] ?? DEFAULT_VECTOR_STROKE_COLOR,
        })),
      });
    }

    return layers;
  }, [isLandcoverVisible, vectorLayers]);

  const floatingMessage = useMemo(() => {
    if (missingPmtilesUrl) {
      return "Set NEXT_PUBLIC_R2_PMTILES_BASE_URL to load annual landcover PMTiles.";
    }

    return statusMessage;
  }, [missingPmtilesUrl, statusMessage]);

  const landcoverRenderMode = "classified" as const;
  const pmtilesZoomRangeKey = missingPmtilesUrl ? null : `${pmtilesBaseUrl}:${year}`;
  const pmtilesZoomRange =
    pmtilesZoomRangeKey && pmtilesZoomRangeState?.cacheKey === pmtilesZoomRangeKey
      ? pmtilesZoomRangeState.range
      : null;

  useEffect(() => {
    if (!pmtilesZoomRangeKey) {
      return;
    }

    let isCancelled = false;

    getPmtilesZoomRange(pmtilesBaseUrl, year)
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
  }, [pmtilesBaseUrl, pmtilesZoomRangeKey, year]);

  useEffect(() => {
    if (!isPlaying || missingPmtilesUrl || !mapContext.map || !isLandcoverVisible) {
      return;
    }

    const minPrefetchYear = Math.max(MIN_YEAR, year - PLAY_PREFETCH_YEAR_WINDOW);
    const maxPrefetchYear = Math.min(MAX_YEAR, year + PLAY_PREFETCH_YEAR_WINDOW);
    const yearsToPrefetch: number[] = [];

    for (let candidateYear = minPrefetchYear; candidateYear <= maxPrefetchYear; candidateYear += 1) {
      yearsToPrefetch.push(candidateYear);
    }

    const tileRequests = collectViewportTileRequests(
      mapContext.map,
      PLAY_PREFETCH_MAX_VISIBLE_TILES,
    );

    void prefetchViewportPmtilesYears(pmtilesBaseUrl, yearsToPrefetch, tileRequests, {
      maxTiles: PLAY_PREFETCH_MAX_VISIBLE_TILES,
      maxConcurrency: PLAY_PREFETCH_TILE_CONCURRENCY,
    });
  }, [
    isLandcoverVisible,
    isPlaying,
    mapContext.map,
    missingPmtilesUrl,
    pmtilesBaseUrl,
    year,
  ]);

  useEffect(() => {
    if (!mapContext.map) {
      return;
    }

    let hoverUpdateFrameId: number | null = null;
    let latestPixel: [number, number] | null = null;

    const readPixelComponent = (
      pixelData: Uint8ClampedArray | Uint8Array | Float32Array | DataView,
      index: number,
      fallback: number,
    ): number => {
      if (pixelData instanceof DataView) {
        return pixelData.byteLength > index ? pixelData.getUint8(index) : fallback;
      }

      return pixelData.length > index ? Number(pixelData[index]) : fallback;
    };

    const handlePointerMove = (
      event: MapBrowserEvent<PointerEvent | KeyboardEvent | WheelEvent>,
    ) => {
      const [pixelX, pixelY] = event.pixel;

      const hoveredVectorResult = mapContext.map?.forEachFeatureAtPixel(
        event.pixel,
        (featureCandidate, layerCandidate) => {
          const vectorLayer = layerCandidate as VectorLayer<VectorSource> | null;
          if (!vectorLayer || !vectorLayer.get("isVectorUploadLayer")) {
            return null;
          }

          const layerName = vectorLayer.get("name");
          if (typeof layerName !== "string") {
            return null;
          }

          return {
            feature: featureCandidate,
            layerName,
          };
        },
        { hitTolerance: 4 },
      );

      if (hoveredVectorResult?.feature) {
        const layerState = vectorLayers[hoveredVectorResult.layerName];
        const groupingColumn = layerState?.groupingColumn ?? null;
        const groupingValue = groupingColumn
          ? normalizeGroupValue(hoveredVectorResult.feature.get(groupingColumn))
          : "Single color";

        setHoveredVectorInfo({
          layerName: hoveredVectorResult.layerName,
          groupingColumn,
          groupingValue,
          pixelX,
          pixelY,
        });
      } else {
        setHoveredVectorInfo(null);
      }

      if (event.dragging || !isLandcoverVisible || !pmtilesLayer) {
        if (hoverUpdateFrameId !== null) {
          window.cancelAnimationFrame(hoverUpdateFrameId);
          hoverUpdateFrameId = null;
        }

        latestPixel = null;

        setHoverPixelInfo(null);
        return;
      }

      latestPixel = [pixelX, pixelY];

      setHoverPixelInfo((previous) => {
        if (!previous) {
          return previous;
        }

        if (previous.pixelX === pixelX && previous.pixelY === pixelY) {
          return previous;
        }

        return {
          ...previous,
          pixelX,
          pixelY,
        };
      });

      if (hoverUpdateFrameId !== null) {
        return;
      }

      hoverUpdateFrameId = window.requestAnimationFrame(() => {
        hoverUpdateFrameId = null;

        if (!latestPixel) {
          return;
        }

        const [nextPixelX, nextPixelY] = latestPixel;

        const pixelData = pmtilesLayer.getData([nextPixelX, nextPixelY]);
        if (!pixelData || pixelData.byteLength === 0) {
          setHoverPixelInfo(null);
          return;
        }

        const red = readPixelComponent(pixelData, 0, 0);
        const green = readPixelComponent(pixelData, 1, red);
        const blue = readPixelComponent(pixelData, 2, red);
        const alpha = readPixelComponent(pixelData, 3, 255);

        const code =
          alpha === 0
            ? null
            : resolveMapbiomasClassCodeFromRgb(red, green, blue, alpha);

        const viewZoom = mapContext.map?.getView().getZoom();
        const requestedZoom = Number.isFinite(viewZoom) ? Math.round(viewZoom ?? 0) : null;
        const sourceZoom =
          requestedZoom === null || !pmtilesZoomRange
            ? requestedZoom
            : Math.max(
                pmtilesZoomRange.minZoom,
                Math.min(pmtilesZoomRange.maxZoom, requestedZoom),
              );

        setHoverPixelInfo((previous) => {
          if (
            previous &&
            previous.code === code &&
            previous.red === red &&
            previous.green === green &&
            previous.blue === blue &&
            previous.alpha === alpha &&
            previous.pixelX === nextPixelX &&
            previous.pixelY === nextPixelY &&
            previous.requestedZoom === requestedZoom &&
            previous.sourceZoom === sourceZoom
          ) {
            return previous;
          }

          return {
            code,
            red,
            green,
            blue,
            alpha,
            pixelX: nextPixelX,
            pixelY: nextPixelY,
            requestedZoom,
            sourceZoom,
          };
        });
      });
    };

    mapContext.map.on("pointermove", handlePointerMove);

    return () => {
      if (hoverUpdateFrameId !== null) {
        window.cancelAnimationFrame(hoverUpdateFrameId);
      }

      mapContext.map?.un("pointermove", handlePointerMove);
    };
  }, [isLandcoverVisible, mapContext.map, pmtilesLayer, pmtilesZoomRange, vectorLayers]);

  useEffect(() => {
    if (!mapContext.map || isDrawingPolygon || pendingPolygonConfirm) {
      return;
    }

    const handleMapSingleClick = (
      event: MapBrowserEvent<PointerEvent | KeyboardEvent | WheelEvent>,
    ) => {
      const selectedVectorResult = mapContext.map?.forEachFeatureAtPixel(
        event.pixel,
        (featureCandidate, layerCandidate) => {
          const vectorLayer = layerCandidate as VectorLayer<VectorSource> | null;
          if (!vectorLayer || !vectorLayer.get("isVectorUploadLayer")) {
            return null;
          }

          const layerName = vectorLayer.get("name");
          if (typeof layerName !== "string") {
            return null;
          }

          return {
            feature: featureCandidate,
            layerName,
          };
        },
        { hitTolerance: 4 },
      );

      if (!selectedVectorResult?.feature) {
        setSelectedVectorInfo(null);
        selectedVectorUidRef.current = null;
        mapContext.map?.renderSync();
        return;
      }

      const geometry =
        selectedVectorResult.feature instanceof Feature
          ? selectedVectorResult.feature.getGeometry()?.clone() ?? null
          : null;
      const layerState = vectorLayers[selectedVectorResult.layerName];
      const allProps = selectedVectorResult.feature.getProperties() as Record<string, unknown>;
      const areaMetrics =
        selectedVectorResult.feature instanceof Feature
          ? getHoveredFeatureAreaMetrics(selectedVectorResult.feature.getGeometry())
          : { areaSquareKilometers: null, areaHectares: null };
      const groupingColumn = layerState?.groupingColumn ?? null;
      const groupingValue = groupingColumn
        ? normalizeGroupValue(selectedVectorResult.feature.get(groupingColumn))
        : "Single color";

      const allProperties = Object.entries(allProps)
        .filter(([key, value]) => key !== "geometry" && value !== undefined && value !== null)
        .map(([key, value]) => ({ key, value: String(value) }));
      const selectionKey = `${selectedVectorResult.layerName}:${allProperties
        .slice(0, 6)
        .map((entry) => `${entry.key}=${entry.value}`)
        .join("|")}`;
      const selectionUid = getUid(selectedVectorResult.feature);

      selectedVectorUidRef.current = selectionUid;
      mapContext.map?.renderSync();

      setSelectedVectorInfo({
        layerName: selectedVectorResult.layerName,
        groupingColumn,
        groupingValue,
        geometry,
        properties: allProperties,
        areaSquareKilometers: areaMetrics.areaSquareKilometers,
        areaHectares: areaMetrics.areaHectares,
        selectionKey,
        selectionUid,
      });
    };

    mapContext.map.on("singleclick", handleMapSingleClick);

    return () => {
      mapContext.map?.un("singleclick", handleMapSingleClick);
    };
  }, [isDrawingPolygon, mapContext.map, pendingPolygonConfirm, vectorLayers]);

  useLayoutEffect(() => {
    for (const vectorLayerState of Object.values(vectorLayers)) {
      vectorLayerState.layer.changed();
    }
    mapContext.map?.renderSync();
  }, [mapContext.map, selectedVectorInfo?.selectionUid, vectorLayers]);

  useEffect(() => {
    drawingVerticesRef.current = drawingVertices;
  }, [drawingVertices]);

  useEffect(() => {
    if (!mapContext.map) {
      return;
    }

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      zIndex: DRAW_LAYER_Z_INDEX,
      properties: {
        isDrawingLayer: true,
      },
    });

    mapContext.map.addLayer(layer);
    drawingLayerRef.current = layer;

    return () => {
      mapContext.map?.removeLayer(layer);
      drawingLayerRef.current = null;
    };
  }, [mapContext.map]);

  useEffect(() => {
    const source = drawingLayerRef.current?.getSource();
    if (!source) {
      return;
    }

    source.clear();

    if (!isDrawingPolygon || drawingVertices.length === 0) {
      return;
    }

    if (drawingVertices.length >= 3) {
      const polygonFeature = new Feature({
        geometry: new Polygon([[...drawingVertices, drawingVertices[0]!]]),
      });
      polygonFeature.setStyle(DRAW_POLYGON_PREVIEW_STYLE);
      source.addFeature(polygonFeature);
    }

    if (drawingVertices.length >= 2) {
      const lineFeature = new Feature({
        geometry: new LineString(drawingVertices),
      });
      lineFeature.setStyle(DRAW_LINE_STYLE);
      source.addFeature(lineFeature);
    }

    for (const [index, coordinate] of drawingVertices.entries()) {
      const pointFeature = new Feature({
        geometry: new Point(coordinate),
      });
      pointFeature.setStyle(index === 0 ? DRAW_FIRST_POINT_STYLE : DRAW_POINT_STYLE);
      source.addFeature(pointFeature);
    }
  }, [drawingVertices, isDrawingPolygon]);

  useEffect(() => {
    if (!mapContext.map || !isDrawingPolygon || pendingPolygonConfirm) {
      return;
    }

    const target = mapContext.map.getTargetElement();
    if (!target) {
      return;
    }

    const previousCursor = target.style.cursor;
    target.style.cursor = "crosshair";

    return () => {
      target.style.cursor = previousCursor;
    };
  }, [isDrawingPolygon, mapContext.map, pendingPolygonConfirm]);

  useEffect(() => {
    if (!mapContext.map || !isDrawingPolygon) {
      return;
    }

    const handleMapSingleClick = (
      event: MapBrowserEvent<PointerEvent | KeyboardEvent | WheelEvent>,
    ) => {
      const currentVertices = drawingVerticesRef.current;

      if (
        currentVertices.length >= 3 &&
        isNearFirstVertex(mapContext.map!, currentVertices[0]!, event.coordinate)
      ) {
        finalizePolygonDrawing(currentVertices);
        return;
      }

      const nextVertices = [...currentVertices, event.coordinate];
      drawingVerticesRef.current = nextVertices;
      setDrawingVertices(nextVertices);
      if (nextVertices.length >= 3) {
        setStatusMessage(
          `Drawing polygon: ${nextVertices.length} points. Click the highlighted first point to close.`,
        );
      } else {
        setStatusMessage(
          `Drawing polygon: ${nextVertices.length} point${nextVertices.length === 1 ? "" : "s"}.`,
        );
      }
    };

    mapContext.map.on("singleclick", handleMapSingleClick);

    return () => {
      mapContext.map?.un("singleclick", handleMapSingleClick);
    };
  }, [finalizePolygonDrawing, isDrawingPolygon, mapContext.map, pendingPolygonConfirm]);

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
    hoverPixelInfo && mapContext.map
      ? (() => {
          const mapSize = mapContext.map.getSize();
          const tooltipWidth = 192;
          const tooltipHeight = 44;
          const offsetX = 16;
          const offsetY = 30;
          const left = mapSize
            ? Math.min(hoverPixelInfo.pixelX + offsetX, Math.max(12, mapSize[0] - tooltipWidth - 12))
            : hoverPixelInfo.pixelX + offsetX;
          const top = mapSize
            ? Math.min(
                Math.max(12, hoverPixelInfo.pixelY - offsetY),
                Math.max(12, mapSize[1] - tooltipHeight - 12),
              )
            : hoverPixelInfo.pixelY - offsetY;

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

      {!missingPmtilesUrl ? (
        <PmtilesLayer
          map={mapContext.map}
          year={year}
          visible={isLandcoverVisible}
          opacity={landcoverOpacity}
          renderMode={landcoverRenderMode}
          baseUrl={pmtilesBaseUrl}
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
            activeLegendLayers={activeLegendLayers}
            isLegendOpen={isLegendOpen}
            onSatelliteChange={setIsSatelliteVisible}
            onBoundariesAndPlacesChange={setIsBoundariesAndPlacesVisible}
            onLandcoverChange={setIsLandcoverVisible}
            onLandcoverOpacityChange={setLandcoverOpacity}
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

                  setIsDrawingPolygon(true);
                  setPendingPolygonConfirm(null);
                  clearDrawingState();
                  setStatusMessage(
                    "Drawing started. Click vertices, then click the first vertex to close the polygon.",
                  );
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
                qualityPreset={threatMapExportPreset}
                onQualityPresetChange={setThreatMapExportPreset}
              />
            }
          />
        </OverlayHoverBoundary>

        {(isThreatMapAiming || isThreatMapGenerating) && threatMapPixelRect ? (
          <div className="pointer-events-none absolute inset-0 z-[65]">
            <div
              className="absolute left-0 right-0 top-0 bg-black/50"
              style={{ height: `${Math.max(0, threatMapPixelRect.top)}px` }}
            />
            <div
              className="absolute bottom-0 left-0 right-0 bg-black/50"
              style={{ top: `${Math.max(0, threatMapPixelRect.top + threatMapPixelRect.height)}px` }}
            />
            <div
              className="absolute bg-black/50"
              style={{
                left: 0,
                top: `${Math.max(0, threatMapPixelRect.top)}px`,
                width: `${Math.max(0, threatMapPixelRect.left)}px`,
                height: `${Math.max(1, threatMapPixelRect.height)}px`,
              }}
            />
            <div
              className="absolute bg-black/50"
              style={{
                left: `${Math.max(0, threatMapPixelRect.left + threatMapPixelRect.width)}px`,
                top: `${Math.max(0, threatMapPixelRect.top)}px`,
                right: 0,
                height: `${Math.max(1, threatMapPixelRect.height)}px`,
              }}
            />

            <div
              className="absolute border-2 border-white/90 shadow-[0_0_0_1px_rgba(15,23,42,0.4)]"
              style={{
                left: `${threatMapPixelRect.left}px`,
                top: `${threatMapPixelRect.top}px`,
                width: `${threatMapPixelRect.width}px`,
                height: `${threatMapPixelRect.height}px`,
              }}
            />

            <div
              className="pointer-events-auto absolute flex items-center gap-2"
              style={{
                left: `${Math.max(16, threatMapPixelRect.left)}px`,
                top: `${Math.max(12, threatMapPixelRect.top - 44)}px`,
              }}
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onCancelThreatMap()}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isThreatMapGenerating || !threatMapPixelRect.fitsViewport}
                onClick={() => {
                  void onGenerateThreatMap();
                }}
              >
                Generate
              </Button>
            </div>

            <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-md border border-white/80 bg-white/92 px-3 py-2 text-xs text-slate-800 shadow-lg">
              Aim a fixed {THREAT_MAP_SQUARE_SIDE_KM} km square, then generate MP4 ({MIN_YEAR}-{MAX_YEAR}).
            </div>

            {displayedThreatMapError ? (
              <div className="pointer-events-none absolute bottom-20 left-1/2 max-w-[min(90vw,36rem)] -translate-x-1/2 rounded-md border border-rose-200 bg-rose-50/95 px-3 py-2 text-xs text-rose-900 shadow-lg">
                {displayedThreatMapError}
              </div>
            ) : null}

            {isThreatMapGenerating && threatMapDisplayProgress ? (
              <div className="pointer-events-none absolute right-4 top-4 rounded-md border border-cyan-200 bg-white/95 px-3 py-2 text-xs text-slate-900 shadow-lg">
                <p className="font-semibold">{threatMapDisplayProgress.phaseLabel}</p>
                <p className="mt-1">{threatMapDisplayProgress.statusLabel}</p>
                {threatMapDisplayProgress.percent !== null ? (
                  <p>Progress: {threatMapDisplayProgress.percent}%</p>
                ) : null}
                {threatMapDisplayProgress.year !== null ? (
                  <p>Year: {threatMapDisplayProgress.year}</p>
                ) : null}
                {threatMapDisplayProgress.frameIndex !== null && threatMapDisplayProgress.totalFrames !== null ? (
                  <p>
                    Frame: {threatMapDisplayProgress.frameIndex} / {threatMapDisplayProgress.totalFrames}
                  </p>
                ) : null}
                {threatMapDiagnostics ? (
                  <>
                    <p className="mt-1 font-mono text-[11px]">
                      Request/Ready: {threatMapDiagnostics.requestedYear ?? "-"}/{threatMapDiagnostics.readyYear ?? "-"}
                    </p>
                    <p className="font-mono text-[11px]">
                      Token: {threatMapDiagnostics.resolvedToken}/{threatMapDiagnostics.awaitToken}
                    </p>
                    <p className="font-mono text-[11px]">
                      Coverage: {(threatMapDiagnostics.renderedCoverage * 100).toFixed(1)}%
                    </p>
                    <p className="font-mono text-[11px]">
                      State: {threatMapDiagnostics.frameLoading ? "loading" : "ready"} ({threatMapDiagnostics.matched ? "matched" : "waiting"})
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

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

        {pendingPolygonConfirm ? (
          <div className="pointer-events-auto absolute inset-0 z-[70] grid place-items-center bg-black/35 px-4">
            <div className="w-full max-w-md rounded-xl border border-cyan-200/80 bg-white p-4 shadow-2xl">
              <h3 className="text-base font-semibold text-cyan-950">Use this polygon?</h3>
              <p className="mt-2 text-sm text-slate-700">
                This flow uses a simplified square boundary.
              </p>
              <div className="mt-3 rounded-lg border border-cyan-200/90 bg-cyan-50/80 px-3 py-2">
                <p className="text-xs text-slate-700">
                  Area: <span className="font-semibold text-slate-900">{formatAreaSquareKilometers(pendingPolygonConfirm.metrics.areaSquareKilometers)} km²</span>
                </p>
                <p className="mt-1 text-xs text-slate-700">
                  Buffer from centroid to farthest vertex: <span className="font-semibold text-slate-900">{formatKilometers(pendingPolygonConfirm.metrics.requiredBufferKilometers)} km</span>
                </p>
                <p className="mt-1 text-xs text-slate-700">
                  Maximum allowed buffer: <span className="font-semibold text-slate-900">{formatKilometers(pendingPolygonConfirm.metrics.maxAllowedBufferKilometers)} km</span>
                </p>
              </div>
              {pendingPolygonConfirm.metrics.exceedsBufferLimit ? (
                <p className="mt-2 text-xs font-medium text-rose-700">
                  This polygon exceeds the max buffer by {formatKilometers(pendingPolygonConfirm.metrics.requiredBufferKilometers - pendingPolygonConfirm.metrics.maxAllowedBufferKilometers)} km. If you confirm, it will be automatically reduced to the maximum centered square.
                </p>
              ) : (
                <p className="mt-2 text-xs font-medium text-emerald-700">
                  This polygon is within the {formatKilometers(pendingPolygonConfirm.metrics.maxAllowedBufferKilometers)} centroid buffer limit.
                </p>
              )}
              <p className="mt-1 text-xs text-slate-600">
                The square is capped at {(MAX_COMMUNITY_BOUNDARY_BUFFER_METERS / 1000).toFixed(0)} km from the center. Cancel to discard and draw another one.
              </p>
              <div className="mt-4 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setPendingPolygonConfirm(null);
                    clearDrawingState();
                    setStatusMessage("Polygon discarded. Continue drawing a new polygon.");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="bg-cyan-700 text-white hover:bg-cyan-600"
                  onClick={() => commitPolygon(pendingPolygonConfirm)}
                >
                  Confirm polygon
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {isLandcoverVisible && !isThreatMapAiming && !isThreatMapGenerating ? (
          <OverlayHoverBoundary onHoverChange={setIsHoveringOverlayPanel}>
            <MapBottomSlider
              year={year}
              minYear={MIN_YEAR}
              maxYear={MAX_YEAR}
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