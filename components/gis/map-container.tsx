"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Feature as GeoJsonFeature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import type Map from "ol/Map";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import type { Coordinate } from "ol/coordinate";
import Feature from "ol/Feature";
import GeoJSON from "ol/format/GeoJSON";
import type BaseLayer from "ol/layer/Base";
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
} from "@/lib/gis-constants";
import {
  buildCommunityBoundaryGeoJson,
  getAoiSquareSideKilometers,
  MAX_COMMUNITY_BOUNDARY_BUFFER_METERS,
} from "@/lib/community-boundary";
import {
  createCanopyExtractionJob,
  downloadChmResult,
  pollChmJob,
  type CanopyExtractionJobStatus,
} from "@/lib/canopy-extract";
import { createGeoTIFFLayer, DEFAULT_CANOPY_OPACITY } from "@/lib/geotiff-layer";
import { MapCanvas, type MapCanvasReadyPayload } from "@/components/gis/map-canvas";
import {
  CommunityMapPanel,
  type CommunityPolygonItem,
} from "@/components/gis/community-map-panel";
import {
  FloatingStatusMessage,
  HoverClassTooltip,
  MapBottomSlider,
  MapTopPanels,
  PixelInspectorPanel,
} from "@/components/gis/map-overlay-panels";
import type { ActiveLegendLayer } from "@/components/gis/legend";
import type { CanopyLayerItem } from "@/components/gis/map-controls";
import { PmtilesLayer } from "@/components/gis/pmtiles-layer";
import { VectorDropzone, type VectorDropzoneHandle } from "@/components/gis/vector-dropzone";
import { MAPBIOMAS_CLASS_LOOKUP, MAPBIOMAS_CLASS_COLOR_RGB_LOOKUP } from "@/lib/mapbiomas-colors";
import {
  getPmtilesZoomRange,
  prefetchAllPmtilesYears,
  prefetchViewportPmtilesYears,
  type PmtilesTileRequest,
  type PmtilesZoomRange,
} from "@/lib/pmtiles-source";
import { Button } from "@/components/ui/button";

type MapContextState = {
  map: Map | null;
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
  layer: BaseLayer;
  isVisible: boolean;
  fillOpacity: number;
  setFillOpacity: (opacity: number) => void;
};

type CanopyLayerState = {
  tileUrls: string[];
  isLoading: boolean;
  isVisible: boolean;
  opacity: number;
  layers?: BaseLayer[];
  requestGeometry?: FeatureCollection<Geometry, GeoJsonProperties>;
  jobId?: string;
  jobStatus?: "idle" | CanopyExtractionJobStatus;
  progress?: number | null;
  etaSeconds?: number | null;
  resultDownloadUrl?: string;
  statusMessage?: string;
  error?: {
    code: string;
    message: string;
  };
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

const UPLOADED_VECTOR_Z_INDEX = 2000;
const DEFAULT_VECTOR_FILL_OPACITY = 0.2;
const DRAW_LAYER_Z_INDEX = 2300;
const DRAW_CLOSE_TOLERANCE_PIXELS = 14;
const MAX_COMMUNITY_BOUNDARY_BUFFER_KM = MAX_COMMUNITY_BOUNDARY_BUFFER_METERS / 1000;

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

function createVectorStyle(fillOpacity: number): Style {
  return new Style({
    stroke: new Stroke({
      color: "#ff3b30",
      width: 2,
    }),
    fill: new Fill({
      color: `rgba(255, 59, 48, ${fillOpacity})`,
    }),
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color: "#ff3b30" }),
      stroke: new Stroke({ color: "#ffffff", width: 1.5 }),
    }),
  });
}

function isNearFirstVertex(map: Map, first: Coordinate, candidate: Coordinate): boolean {
  const [firstPxX, firstPxY] = map.getPixelFromCoordinate(first);
  const [candidatePxX, candidatePxY] = map.getPixelFromCoordinate(candidate);
  const dx = firstPxX - candidatePxX;
  const dy = firstPxY - candidatePxY;
  return Math.sqrt(dx * dx + dy * dy) <= DRAW_CLOSE_TOLERANCE_PIXELS;
}

function resolveClassCodeFromRenderedRgb(red: number, green: number, blue: number): number | null {
  const tolerance = 2;

  for (const [codeText, color] of Object.entries(MAPBIOMAS_CLASS_COLOR_RGB_LOOKUP)) {
    const [targetRed, targetGreen, targetBlue] = color;
    const isMatch =
      Math.abs(targetRed - red) <= tolerance &&
      Math.abs(targetGreen - green) <= tolerance &&
      Math.abs(targetBlue - blue) <= tolerance;

    if (isMatch) {
      return Number(codeText);
    }
  }

  return null;
}

function collectViewportTileRequests(map: Map, maxTiles: number): PmtilesTileRequest[] {
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

function getAoiSideText(valueKm: number): string {
  return `${formatKilometers(valueKm)} km`;
}

function formatCanopyError(error: { code?: string | null; message?: string | null } | null | undefined): string {
  if (!error) {
    return "Canopy extraction failed.";
  }

  const code = error.code?.trim() || "CHM_JOB_FAILED";
  const message = error.message?.trim() || "Canopy extraction failed.";
  return `${code}: ${message}`;
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
  const [isPreloadingYears, setIsPreloadingYears] = useState(false);
  const [hoverPixelInfo, setHoverPixelInfo] = useState<HoverPixelInfo | null>(null);
  const [pmtilesZoomRangeState, setPmtilesZoomRangeState] = useState<{
    cacheKey: string;
    range: PmtilesZoomRange | null;
  } | null>(null);
  const [pmtilesLayer, setPmtilesLayer] = useState<TileLayer<XYZ> | null>(null);
  const [mapContext, setMapContext] = useState<MapContextState>({
    map: null,
  });
  const [vectorLayers, setVectorLayers] = useState<Record<string, VectorLayerState>>({});
  const [canopyLayers, setCanopyLayers] = useState<Record<string, CanopyLayerState>>({});
  const [communityMapLayerNames, setCommunityMapLayerNames] = useState<string[]>([]);
  const [isDrawingPolygon, setIsDrawingPolygon] = useState(false);
  const [drawingVertices, setDrawingVertices] = useState<Coordinate[]>([]);
  const [pendingPolygonConfirm, setPendingPolygonConfirm] =
    useState<PendingPolygonConfirmState | null>(null);
  const hasPrefetchedAllYearsRef = useRef(false);
  const vectorDropzoneRef = useRef<VectorDropzoneHandle | null>(null);
  const drawingVerticesRef = useRef<Coordinate[]>([]);
  const drawingLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const communityPolygonCounterRef = useRef(1);
  const geojsonFormatRef = useRef(new GeoJSON());
  const canopyJobGenerationRef = useRef<Record<string, number>>({});
  const canopyJobControllersRef = useRef<Record<string, AbortController | null>>({});
  const canopyLayersRef = useRef<Record<string, CanopyLayerState>>({});

  const pmtilesBaseUrl =
    process.env.NEXT_PUBLIC_R2_PMTILES_BASE_URL ?? DEFAULT_R2_PMTILES_BASE_URL;
  const missingPmtilesUrl = !pmtilesBaseUrl;

  const onMapReady = useCallback((payload: MapCanvasReadyPayload) => {
    setMapContext({
      map: payload.map,
    });
  }, []);

  useEffect(() => {
    canopyLayersRef.current = canopyLayers;
  }, [canopyLayers]);

  const abortCanopyJobRequest = useCallback((fileName: string) => {
    canopyJobControllersRef.current[fileName]?.abort();
    canopyJobControllersRef.current[fileName] = null;
  }, []);

  const bumpCanopyJobGeneration = useCallback((fileName: string) => {
    const nextGeneration = (canopyJobGenerationRef.current[fileName] ?? 0) + 1;
    canopyJobGenerationRef.current[fileName] = nextGeneration;
    abortCanopyJobRequest(fileName);
    return nextGeneration;
  }, [abortCanopyJobRequest]);

  const revokeCanopyLayerTileUrls = useCallback((tileUrls?: string[]) => {
    if (!tileUrls) {
      return;
    }

    for (const url of tileUrls) {
      if (url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    }
  }, []);

  const disposeCanopyLayerArtifacts = useCallback((fileName: string, layerState?: CanopyLayerState) => {
    if (layerState?.layers && mapContext.map) {
      for (const layer of layerState.layers) {
        mapContext.map.removeLayer(layer);
      }
    }

    revokeCanopyLayerTileUrls(layerState?.tileUrls);
    abortCanopyJobRequest(fileName);
  }, [abortCanopyJobRequest, mapContext.map, revokeCanopyLayerTileUrls]);

  const applyCanopyJobResult = useCallback(async (
    fileName: string,
    jobId: string,
    jobResultUrl: string,
    generation: number,
  ) => {
    const download = await downloadChmResult(jobResultUrl);
    const blobUrl = URL.createObjectURL(download.blob);

    if (canopyJobGenerationRef.current[fileName] !== generation) {
      URL.revokeObjectURL(blobUrl);
      return;
    }

    const result = await createGeoTIFFLayer(blobUrl, fileName);
    URL.revokeObjectURL(blobUrl);

    if (!result || !mapContext.map) {
      throw new Error("Unable to create GeoTIFF layer from canopy download.");
    }

    const { layer, source } = result;
    mapContext.map.addLayer(layer);

    if (canopyJobGenerationRef.current[fileName] !== generation) {
      mapContext.map.removeLayer(layer);
      return;
    }

    try {
      const viewConfig = await source.getView();

      if (viewConfig.extent) {
        const existingView = mapContext.map.getView();
        const mapSize = mapContext.map.getSize();

        existingView.fit(viewConfig.extent, {
          duration: 500,
          padding: [24, 24, 24, 24],
          size: mapSize,
          maxZoom: 18,
        });

        const sourceMaxResolution =
          Array.isArray(viewConfig.resolutions) &&
          typeof viewConfig.resolutions[0] === "number"
            ? viewConfig.resolutions[0]
            : null;

        if (sourceMaxResolution !== null) {
          const currentResolution = existingView.getResolution();

          if (typeof currentResolution === "number" && currentResolution > sourceMaxResolution) {
            existingView.setResolution(sourceMaxResolution);
          }
        }
      }
    } catch (error) {
      console.warn("Failed to set view from canopy GeoTIFF metadata:", error);
    }

    setCanopyLayers((prev) => {
      const existing = prev[fileName];

      if (!existing) {
        mapContext.map?.removeLayer(layer);
        return prev;
      }

      layer.setVisible(existing.isVisible);
      layer.setOpacity(existing.opacity);

      return {
        ...prev,
        [fileName]: {
          ...existing,
          tileUrls: [jobResultUrl],
          isLoading: false,
          isVisible: existing.isVisible,
          opacity: existing.opacity,
          layers: [layer],
          requestGeometry: existing.requestGeometry,
          jobId,
          jobStatus: "succeeded",
          progress: 100,
          etaSeconds: 0,
          resultDownloadUrl: jobResultUrl,
          statusMessage: `Canopy extraction ready for ${fileName}.`,
          error: undefined,
        },
      };
    });

    setStatusMessage(`Canopy extraction ready for ${fileName}.`);
  }, [mapContext.map]);

  const pollCanopyExtractionJob = useCallback(async function runCanopyExtractionPoll(
    fileName: string,
    jobId: string,
    generation: number,
    controller: AbortController,
  ) {
    if (canopyJobGenerationRef.current[fileName] !== generation) {
      return;
    }

    try {
      const job = await pollChmJob(jobId, {
        initialIntervalMs: 2500,
        maxIntervalMs: 10_000,
        backoffIntervalMs: 10_000,
        backoffMaxIntervalMs: 30_000,
        signal: controller.signal,
        onUpdate: (nextJob) => {
          if (canopyJobGenerationRef.current[fileName] !== generation) {
            return;
          }

          setCanopyLayers((prev) => {
            const existing = prev[fileName];

            if (!existing) {
              return prev;
            }

            const nextStatusMessage =
              nextJob.message ??
              (nextJob.status === "queued"
                ? `Queued canopy extraction for ${fileName}.`
                : nextJob.status === "running"
                  ? `Processing canopy extraction for ${fileName}...`
                  : existing.statusMessage);

            return {
              ...prev,
              [fileName]: {
                ...existing,
                jobId,
                jobStatus: nextJob.status,
                progress: nextJob.progress ?? null,
                etaSeconds: nextJob.etaSeconds ?? null,
                resultDownloadUrl: nextJob.result?.downloadUrl ?? existing.resultDownloadUrl,
                statusMessage: nextStatusMessage,
                isLoading: nextJob.status === "queued" || nextJob.status === "running",
                error: nextJob.status === "failed"
                  ? {
                      code: nextJob.error?.code ?? "CHM_JOB_FAILED",
                      message: nextJob.error?.message ?? nextJob.message ?? "Canopy extraction failed.",
                    }
                  : undefined,
              },
            };
          });
        },
      });

      if (canopyJobGenerationRef.current[fileName] !== generation) {
        return;
      }

      if (job.status === "failed") {
        const failureMessage = formatCanopyError(job.error ?? { message: job.message });
        setStatusMessage(`Canopy extraction failed for ${fileName}: ${failureMessage}`);
        return;
      }

      if (!job.result?.downloadUrl) {
        throw new Error("Canopy extraction succeeded without a download URL.");
      }

      await applyCanopyJobResult(fileName, jobId, job.result.downloadUrl, generation);
    } catch (error) {
      if (canopyJobGenerationRef.current[fileName] !== generation) {
        return;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      const message = error instanceof Error ? error.message : "Unknown extraction error.";

      setCanopyLayers((prev) => {
        const existing = prev[fileName];

        if (!existing) {
          return prev;
        }

        return {
          ...prev,
          [fileName]: {
            ...existing,
            isLoading: false,
            jobStatus: "failed",
            progress: null,
            etaSeconds: null,
            statusMessage: `Canopy extraction failed for ${fileName}: ${message}`,
            error: {
              code: "CHM_JOB_FAILED",
              message,
            },
          },
        };
      });

      setStatusMessage(`Canopy extraction failed for ${fileName}: ${message}`);
    }
  }, [applyCanopyJobResult]);

  const queueCanopyExtractionForGeometry = useCallback((
    fileName: string,
    geometry?: FeatureCollection<Geometry, GeoJsonProperties>,
  ) => {
    if (!geometry) {
      return;
    }

    const nextGeneration = bumpCanopyJobGeneration(fileName);
    const existingLayerState = canopyLayersRef.current[fileName];
    disposeCanopyLayerArtifacts(fileName, existingLayerState);

    setCanopyLayers((prev) => {
      return {
        ...prev,
        [fileName]: {
          tileUrls: [],
          isLoading: false,
          isVisible: existingLayerState?.isVisible ?? true,
          opacity: existingLayerState?.opacity ?? DEFAULT_CANOPY_OPACITY,
          layers: undefined,
          requestGeometry: geometry,
          jobId: undefined,
          jobStatus: "idle",
          progress: null,
          etaSeconds: null,
          resultDownloadUrl: undefined,
          statusMessage: `Canopy extraction ready for ${fileName}.`,
          error: undefined,
        },
      };
    });

    setStatusMessage(`Canopy extraction ready for ${fileName}. Select Generate CHM in Layer Controls.`);

    canopyJobGenerationRef.current[fileName] = nextGeneration;
  }, [bumpCanopyJobGeneration, disposeCanopyLayerArtifacts]);

  const startCanopyExtractionForGeometry = useCallback(async (
    fileName: string,
    geometry: FeatureCollection<Geometry, GeoJsonProperties>,
  ) => {
    const aoiSideKm = getAoiSquareSideKilometers(geometry);
    const nextGeneration = bumpCanopyJobGeneration(fileName);
    const existingLayerState = canopyLayersRef.current[fileName];
    disposeCanopyLayerArtifacts(fileName, existingLayerState);

    setCanopyLayers((prev) => {
      return {
        ...prev,
        [fileName]: {
          tileUrls: [],
          isLoading: true,
          isVisible: existingLayerState?.isVisible ?? true,
          opacity: existingLayerState?.opacity ?? DEFAULT_CANOPY_OPACITY,
          layers: undefined,
          requestGeometry: geometry,
          jobId: undefined,
          jobStatus: "queued",
          progress: null,
          etaSeconds: null,
          resultDownloadUrl: undefined,
          statusMessage: `Queued canopy extraction for ${fileName}.`,
          error: undefined,
        },
      };
    });

    const controller = new AbortController();
    canopyJobControllersRef.current[fileName] = controller;

    setStatusMessage(
      `Queued canopy extraction for ${fileName}. AOI square side ${getAoiSideText(aoiSideKm)} (limit about 60 km).`,
    );

    try {
      const job = await createCanopyExtractionJob(geometry, {
        signal: controller.signal,
      });

      if (canopyJobGenerationRef.current[fileName] !== nextGeneration) {
        return;
      }

      setCanopyLayers((prev) => {
        const existing = prev[fileName];

        if (!existing) {
          return prev;
        }

        return {
          ...prev,
          [fileName]: {
            ...existing,
            jobId: job.jobId,
            jobStatus: job.status,
            progress: job.progress ?? null,
            etaSeconds: job.etaSeconds ?? null,
            resultDownloadUrl: job.result?.downloadUrl ?? existing.resultDownloadUrl,
            statusMessage: job.message ?? `Queued canopy extraction for ${fileName}.`,
            isLoading: job.status === "queued" || job.status === "running",
            error: undefined,
          },
        };
      });

      if (job.status === "failed") {
        const failureMessage = formatCanopyError(job.error ?? { message: job.message });
        setStatusMessage(`Canopy extraction failed for ${fileName}: ${failureMessage}`);
        return;
      }

      if (job.status !== "queued" && job.status !== "running") {
        if (!job.result?.downloadUrl) {
          throw new Error("Canopy extraction succeeded without a download URL.");
        }

        await applyCanopyJobResult(fileName, job.jobId, job.result.downloadUrl, nextGeneration);
        return;
      }

      await pollCanopyExtractionJob(fileName, job.jobId, nextGeneration, controller);
    } catch (error) {
      if (canopyJobGenerationRef.current[fileName] !== nextGeneration) {
        return;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      const message = error instanceof Error ? error.message : "Unknown extraction error.";

      setCanopyLayers((prev) => {
        const existing = prev[fileName];

        if (!existing) {
          return prev;
        }

        return {
          ...prev,
          [fileName]: {
            ...existing,
            isLoading: false,
            jobStatus: "failed",
            progress: null,
            etaSeconds: null,
            statusMessage: `Canopy extraction failed for ${fileName}: ${message}`,
            error: {
              code: "CHM_JOB_FAILED",
              message,
            },
          },
        };
      });

      setStatusMessage(`Canopy extraction failed for ${fileName}: ${message}`);
    } finally {
      if (canopyJobControllersRef.current[fileName] === controller) {
        canopyJobControllersRef.current[fileName] = null;
      }
    }
  }, [applyCanopyJobResult, bumpCanopyJobGeneration, disposeCanopyLayerArtifacts, pollCanopyExtractionJob]);

  const onVectorLayerAdd = useCallback((
    fileName: string,
    payload: {
      layer: BaseLayer;
      defaultFillOpacity: number;
      setFillOpacity: (opacity: number) => void;
    },
  ) => {
    setCommunityMapLayerNames((prev) => (prev.includes(fileName) ? prev : [...prev, fileName]));

    setVectorLayers((prev) => {
      const existing = prev[fileName];
      const nextFillOpacity = existing?.fillOpacity ?? payload.defaultFillOpacity;

      payload.layer.setVisible(existing?.isVisible ?? true);
      payload.setFillOpacity(nextFillOpacity);

      return {
        ...prev,
        [fileName]: {
          layer: payload.layer,
          isVisible: existing?.isVisible ?? true,
          fillOpacity: nextFillOpacity,
          setFillOpacity: payload.setFillOpacity,
        },
      };
    });
  }, []);

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

      existing.setFillOpacity(fillOpacity);

      return {
        ...prev,
        [fileName]: {
          ...existing,
          fillOpacity,
        },
      };
    });
  }, []);

  const onCanopyLayerVisibilityChange = useCallback((fileName: string, isVisible: boolean) => {
    setCanopyLayers((prev) => {
      const existing = prev[fileName];
      if (!existing) {
        return prev;
      }

      if (existing.layers) {
        for (const layer of existing.layers) {
          layer.setVisible(isVisible);
        }
      }

      return {
        ...prev,
        [fileName]: {
          ...existing,
          isVisible,
        },
      };
    });
  }, []);

  const onCanopyLayerOpacityChange = useCallback((fileName: string, opacity: number) => {
    setCanopyLayers((prev) => {
      const existing = prev[fileName];
      if (!existing) {
        return prev;
      }

      if (existing.layers) {
        for (const layer of existing.layers) {
          layer.setOpacity(opacity);
        }
      }

      return {
        ...prev,
        [fileName]: {
          ...existing,
          opacity,
        },
      };
    });
  }, []);

  const onCanopyLayerStart = useCallback((fileName: string) => {
    const canopyLayer = canopyLayers[fileName];

    if (!canopyLayer?.requestGeometry || canopyLayer.isLoading) {
      return;
    }

    void startCanopyExtractionForGeometry(fileName, canopyLayer.requestGeometry);
  }, [canopyLayers, startCanopyExtractionForGeometry]);

  const onCanopyLayerDownload = useCallback(async (fileName: string) => {
    const canopyLayer = canopyLayers[fileName];
    const downloadTarget = canopyLayer?.resultDownloadUrl ?? canopyLayer?.jobId;

    if (!canopyLayer || canopyLayer.jobStatus !== "succeeded" || !downloadTarget) {
      return;
    }

    try {
      const result = await downloadChmResult(downloadTarget);
      const objectUrl = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = result.filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setStatusMessage(`Downloaded canopy result for ${fileName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "CHM download failed.";
      setStatusMessage(`Canopy download failed for ${fileName}: ${message}`);
    }
  }, [canopyLayers]);

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
      let fillOpacity = DEFAULT_VECTOR_FILL_OPACITY;

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

      const setFillOpacity = (opacity: number) => {
        fillOpacity = opacity;
        layer.setStyle(createVectorStyle(fillOpacity));
      };

      mapContext.map.addLayer(layer);
      onVectorLayerAdd(fileName, {
        layer,
        defaultFillOpacity: fillOpacity,
        setFillOpacity,
      });

      const geojsonFeature = geojsonFormatRef.current.writeFeatureObject(feature, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857",
      }) as GeoJsonFeature<Geometry, GeoJsonProperties>;

      const boundaryGeoJson = buildCommunityBoundaryGeoJson({
        type: "FeatureCollection",
        features: [geojsonFeature],
      });

      queueCanopyExtractionForGeometry(fileName, boundaryGeoJson.boundary);

      const layerExtent = source.getExtent();
      if (layerExtent) {
        mapContext.map.getView().fit(layerExtent, {
          duration: 500,
          maxZoom: 12,
          padding: [40, 40, 40, 40],
        });
      }

      clearDrawingState();
      setPendingPolygonConfirm(null);
      setIsDrawingPolygon(false);

      const measurementSummary =
        `Area ${formatAreaSquareKilometers(metrics.areaSquareKilometers)} km². ` +
        `Required centroid buffer ${formatKilometers(metrics.requiredBufferKilometers)} km ` +
        `of ${formatKilometers(metrics.maxAllowedBufferKilometers)} km max.`;

      if (boundaryGeoJson.wasClipped) {
        setStatusMessage(
          `${fileName} added. ${measurementSummary} AOI side ${getAoiSideText(boundaryGeoJson.requestedSideKilometers)} exceeded ${getAoiSideText(boundaryGeoJson.maxAllowedSideKilometers)} and was clipped to ${getAoiSideText(boundaryGeoJson.finalSideKilometers)}. Use Layer Controls to generate the Canopy Height layer.`,
        );
      } else if (metrics.exceedsBufferLimit) {
        setStatusMessage(
          `${fileName} added. ${measurementSummary} Your polygon was automatically reduced to the maximum ${formatKilometers(metrics.maxAllowedBufferKilometers)} km square buffer centered on your drawing. Use Layer Controls to generate the Canopy Height layer.`,
        );
      } else {
        setStatusMessage(
          `${fileName} added. ${measurementSummary} Use Layer Controls to generate the Canopy Height layer.`,
        );
      }
    },
    [clearDrawingState, mapContext.map, onVectorLayerAdd, queueCanopyExtractionForGeometry],
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
          `${baseMessage} This is too large by ${formatKilometers(overflowKilometers)} km and will be clipped for CHM extraction.`,
        );
      } else {
        setStatusMessage(baseMessage);
      }
    },
    [],
  );

  const deleteCommunityPolygon = useCallback(
    (fileName: string) => {
      bumpCanopyJobGeneration(fileName);
      const existingCanopyLayer = canopyLayersRef.current[fileName];
      disposeCanopyLayerArtifacts(fileName, existingCanopyLayer);

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

      setCanopyLayers((prev) => {
        const next = { ...prev };
        delete next[fileName];
        return next;
      });

      setStatusMessage(`${fileName} removed.`);
    },
    [bumpCanopyJobGeneration, disposeCanopyLayerArtifacts, mapContext.map],
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
          isCanopyLoading: false,
        };
      })
      .filter((item): item is CommunityPolygonItem => item !== null);
  }, [communityMapLayerNames, vectorLayers]);

  const canopyLayerItems = useMemo<CanopyLayerItem[]>(() => {
    return Object.entries(canopyLayers).map(([fileName, data]) => ({
      fileName,
      sourceName: fileName,
      isVisible: data.isVisible,
      opacity: data.opacity,
      isLoading: data.isLoading,
      jobStatus: data.jobStatus,
      progress: data.progress,
      etaSeconds: data.etaSeconds,
      statusMessage: data.statusMessage,
      canDownload: Boolean(data.requestGeometry),
      hasData: data.tileUrls.length > 0 || Boolean(data.layers?.length),
      error: data.error,
    }));
  }, [canopyLayers]);

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
      });
    }

    for (const [fileName, data] of Object.entries(canopyLayers)) {
      if (!data.isVisible || (data.tileUrls.length === 0 && !data.layers?.length)) {
        continue;
      }

      layers.push({
        id: `canopy:${fileName}`,
        kind: "canopy",
        title: fileName,
        isLoading: data.isLoading,
      });
    }

    return layers;
  }, [canopyLayers, isLandcoverVisible, vectorLayers]);

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
    return () => {
      for (const controller of Object.values(canopyJobControllersRef.current)) {
        controller?.abort();
      }

      canopyJobControllersRef.current = {};
      canopyJobGenerationRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!isPlaying || missingPmtilesUrl || hasPrefetchedAllYearsRef.current) {
      return;
    }

    hasPrefetchedAllYearsRef.current = true;
    setIsPreloadingYears(true);

    let isCancelled = false;

    prefetchAllPmtilesYears(pmtilesBaseUrl)
      .catch(() => {
        // Warmup is best-effort and should never break playback.
      })
      .finally(() => {
        if (!isCancelled) {
          setIsPreloadingYears(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isPlaying, missingPmtilesUrl, pmtilesBaseUrl]);

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

  // Handle creating and adding GeoTIFF layers to the map
  useEffect(() => {
    if (!mapContext.map) {
      return;
    }

    const createAndAddLayers = async () => {
      for (const [fileName, layerData] of Object.entries(canopyLayers)) {
        // If layers already exist, just update visibility
        if (layerData.layers && layerData.layers.length > 0) {
          for (const layer of layerData.layers) {
            layer.setVisible(layerData.isVisible);
          }
          continue;
        }

        // If still loading or no URLs, skip
        if (layerData.isLoading || layerData.tileUrls.length === 0) {
          continue;
        }

        // Create a layer for each tile URL
        const createdLayers: BaseLayer[] = [];
        let shouldUpdateView = true; // Update view only for the first layer
        
        for (const tileUrl of layerData.tileUrls) {
          console.log(`Creating GeoTIFF layer from tile URL: ${tileUrl}`);
          const result = await createGeoTIFFLayer(tileUrl, fileName);
          if (result && mapContext.map) {
            const { layer, source } = result;
            console.log(`Adding layer to map: ${layer.get("name")}`);
            mapContext.map.addLayer(layer);
            layer.setVisible(layerData.isVisible);
            layer.setOpacity(layerData.opacity);
            console.log(`Layer added and visibility set to: ${layerData.isVisible}`);
            createdLayers.push(layer);

            // Update map view using GeoTIFF metadata (only for first layer)
            if (shouldUpdateView) {
              shouldUpdateView = false;
              try {
                // Use GeoTIFF extent to fit the existing map view. Replacing the
                // entire view with GeoTIFF resolutions can lock zoom-out behavior.
                const viewConfig = await source.getView();
                console.log("GeoTIFF view config:", viewConfig);

                if (viewConfig.extent) {
                  const existingView = mapContext.map.getView();
                  const mapSize = mapContext.map.getSize();

                  existingView.fit(viewConfig.extent, {
                    duration: 500,
                    padding: [24, 24, 24, 24],
                    size: mapSize,
                    maxZoom: 18,
                  });

                  const sourceMaxResolution =
                    Array.isArray(viewConfig.resolutions) &&
                    typeof viewConfig.resolutions[0] === "number"
                      ? viewConfig.resolutions[0]
                      : null;

                  // If fit lands too coarse, clamp to the GeoTIFF's first
                  // renderable resolution so the raster is visible immediately.
                  if (sourceMaxResolution !== null) {
                    const currentResolution = existingView.getResolution();
                    if (
                      typeof currentResolution === "number" &&
                      currentResolution > sourceMaxResolution
                    ) {
                      existingView.setResolution(sourceMaxResolution);
                    }
                  }
                }
              } catch (err) {
                console.warn("Failed to set view from GeoTIFF metadata:", err);
              }
            }
          } else {
            console.warn(`Failed to create layer from ${tileUrl}`);
          }
        }

        // Update state with layer references
        if (createdLayers.length > 0) {
          setCanopyLayers((prev) => ({
            ...prev,
            [fileName]: { ...prev[fileName]!, layers: createdLayers },
          }));
        }
      }
    };

    createAndAddLayers().catch((error) => {
      console.error("Error creating GeoTIFF layers:", error);
    });

    // Cleanup: remove detached canopy layers from the map.
    if (mapContext.map) {
      const currentCanopyLayerSet = new Set(
        Object.values(canopyLayers).flatMap((layerData) => layerData.layers ?? []),
      );

      const existingCanopyLayers = mapContext.map
        .getLayers()
        .getArray()
        .filter((layer) => layer.get("isCanopyLayer"));

      for (const layer of existingCanopyLayers) {
          if (!currentCanopyLayerSet.has(layer)) {
          mapContext.map.removeLayer(layer);
        }
      }
    }
  }, [canopyLayers, mapContext.map]);

  useEffect(() => {
    if (!mapContext.map || !pmtilesLayer) {
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
      if (event.dragging || !isLandcoverVisible) {
        if (hoverUpdateFrameId !== null) {
          window.cancelAnimationFrame(hoverUpdateFrameId);
          hoverUpdateFrameId = null;
        }

        latestPixel = null;

        setHoverPixelInfo(null);
        return;
      }

      const [pixelX, pixelY] = event.pixel;
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
            : resolveClassCodeFromRenderedRgb(red, green, blue);

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
  }, [isLandcoverVisible, mapContext.map, pmtilesLayer, pmtilesZoomRange]);

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
          onLayerReady={setPmtilesLayer}
          onFrameLoadingChange={setIsFrameLoading}
        />
      ) : null}

      <VectorDropzone
        ref={vectorDropzoneRef}
        map={mapContext.map}
        onMessage={setStatusMessage}
        onVectorLayerAdd={onVectorLayerAdd}
        onCanopyExtractionQueued={queueCanopyExtractionForGeometry}
      />

      <div className="pointer-events-none absolute inset-0 z-50">
        <MapTopPanels
          isSatelliteVisible={isSatelliteVisible}
          isBoundariesAndPlacesVisible={isBoundariesAndPlacesVisible}
          isLandcoverVisible={isLandcoverVisible}
          landcoverOpacity={landcoverOpacity}
          canopyLayers={canopyLayerItems}
          activeLegendLayers={activeLegendLayers}
          isLegendOpen={isLegendOpen}
          onSatelliteChange={setIsSatelliteVisible}
          onBoundariesAndPlacesChange={setIsBoundariesAndPlacesVisible}
          onLandcoverChange={setIsLandcoverVisible}
          onLandcoverOpacityChange={setLandcoverOpacity}
          onCanopyLayerStart={onCanopyLayerStart}
          onCanopyLayerDownload={onCanopyLayerDownload}
          onCanopyLayerVisibilityChange={onCanopyLayerVisibilityChange}
          onCanopyLayerOpacityChange={onCanopyLayerOpacityChange}
          onLegendOpenChange={setIsLegendOpen}
          primaryAction={
            <CommunityMapPanel
              items={communityPolygonItems}
              isDrawingPolygon={isDrawingPolygon}
              drawnVertexCount={drawingVertices.length}
              onUploadClick={() => vectorDropzoneRef.current?.openFilePicker()}
              onStartDrawing={() => {
                setIsDrawingPolygon(true);
                setPendingPolygonConfirm(null);
                clearDrawingState();
                setStatusMessage(
                  "Drawing started. Click vertices, then click the first vertex to close the polygon.",
                );
              }}
              onCancelDrawing={cancelDrawing}
              onPolygonVisibilityChange={onVectorLayerVisibilityChange}
              onPolygonOpacityChange={onVectorLayerOpacityChange}
              onPolygonDelete={deleteCommunityPolygon}
            />
          }
        />

        <HoverClassTooltip
          hoveredClass={hoveredClass}
          hoverTooltipStyle={hoverTooltipStyle}
          isVisible={Boolean(
            hoverPixelInfo && hoverTooltipStyle && isLandcoverVisible && hoverPixelInfo.alpha > 0,
          )}
        />

        {pendingPolygonConfirm ? (
          <div className="pointer-events-auto absolute inset-0 z-[70] grid place-items-center bg-black/35 px-4">
            <div className="w-full max-w-md rounded-xl border border-cyan-200/80 bg-white p-4 shadow-2xl">
              <h3 className="text-base font-semibold text-cyan-950">Use this polygon?</h3>
              <p className="mt-2 text-sm text-slate-700">
                The CHM request will use a simplified square boundary.
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

        {isLandcoverVisible ? (
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
        ) : null}

        <PixelInspectorPanel
          hoverPixelInfo={hoverPixelInfo}
          hoveredClass={hoveredClass}
          pmtilesZoomRange={pmtilesZoomRange}
          isVisible={Boolean(hoverPixelInfo && mapContext.map && pmtilesLayer && isLandcoverVisible)}
        />

        <FloatingStatusMessage message={floatingMessage} />
      </div>
    </section>
  );
}