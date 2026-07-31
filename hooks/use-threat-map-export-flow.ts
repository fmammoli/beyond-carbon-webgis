"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Feature as GeoJsonFeature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import { bboxClip } from "@turf/turf";
import GeoJSON from "ol/format/GeoJSON";
import type { Extent } from "ol/extent";
import type OLMap from "ol/Map";
import { transform as transformCoordinate } from "ol/proj";

import {
  MAX_YEAR,
  MIN_YEAR,
  THREAT_MAP_SQUARE_SIDE_KM,
} from "@/lib/gis-constants";
import { useThreatMapJob } from "@/hooks/use-threat-map-job";
import { isThreatMapTerminalStatus } from "@/lib/threat-map";
import {
  getThreatMapPixelRect,
  type ThreatMapPixelRect,
} from "@/lib/threat-map-export";
import type { VectorLayerState } from "@/hooks/use-map-vector-layers";
import type {
  ThreatMapOverlayDiagnostics,
  ThreatMapOverlayProgress,
} from "@/components/gis/threat-map-overlay";

type ThreatMapExportStatus = "idle" | "aiming" | "generating";

type UseThreatMapExportFlowParams = {
  map: OLMap | null;
  year: number;
  vectorLayers: Record<string, VectorLayerState>;
  isDrawingPolygon: boolean;
  cancelDrawing: () => void;
  isFrameLoading: boolean;
  onStopPlayback: () => void;
  onMessage: (message: string) => void;
};

type GeoJsonBbox = [number, number, number, number];

function isCoordWithinBbox(coord: [number, number], bbox: GeoJsonBbox): boolean {
  return coord[0] >= bbox[0]
    && coord[0] <= bbox[2]
    && coord[1] >= bbox[1]
    && coord[1] <= bbox[3];
}

function collectGeometryCoordinates(geometry: Geometry): [number, number][] {
  const flattened: [number, number][] = [];

  const visit = (value: unknown) => {
    if (!Array.isArray(value) || value.length === 0) {
      return;
    }

    if (typeof value[0] === "number") {
      const coordinate = value as number[];
      if (coordinate.length >= 2) {
        flattened.push([coordinate[0]!, coordinate[1]!]);
      }
      return;
    }

    for (const child of value) {
      visit(child);
    }
  };

  if (geometry.type === "GeometryCollection") {
    for (const child of geometry.geometries) {
      flattened.push(...collectGeometryCoordinates(child));
    }
    return flattened;
  }

  visit((geometry as Exclude<Geometry, { type: "GeometryCollection" }>).coordinates);
  return flattened;
}

function isGeometryFullyWithinBbox(geometry: Geometry, bbox: GeoJsonBbox): boolean {
  const coordinates = collectGeometryCoordinates(geometry);
  if (coordinates.length === 0) {
    return false;
  }

  return coordinates.every((coord) => isCoordWithinBbox(coord, bbox));
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
    // Conservative fallback: include only if already fully within AOI.
    return isGeometryFullyWithinBbox(geometry, bbox) ? feature : null;
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

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toThreatMapLayerId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "overlay-layer";
}

export function useThreatMapExportFlow({
  map,
  year,
  vectorLayers,
  isDrawingPolygon,
  cancelDrawing,
  isFrameLoading,
  onStopPlayback,
  onMessage,
}: UseThreatMapExportFlowParams) {
  const [threatMapExportStatus, setThreatMapExportStatus] =
    useState<ThreatMapExportStatus>("idle");
  const [threatMapError, setThreatMapError] = useState<string | null>(null);
  const [threatMapPixelRect, setThreatMapPixelRect] = useState<ThreatMapPixelRect | null>(null);
  const [threatMapDiagnostics, setThreatMapDiagnostics] =
    useState<ThreatMapOverlayDiagnostics | null>(null);

  const isFrameLoadingRef = useRef(isFrameLoading);
  const threatMapAwaitedYearRef = useRef<number | null>(null);
  const threatMapAwaitTokenRef = useRef(0);
  const threatMapResolvedTokenRef = useRef(0);
  const threatMapDiagnosticsUpdateAtRef = useRef(0);
  const threatMapDeliveredJobIdRef = useRef<string | null>(null);

  const geojsonFormatRef = useRef(new GeoJSON());

  const threatMapJob = useThreatMapJob({
    apiKey: process.env.NEXT_PUBLIC_THREAT_MAP_API_KEY,
    pollIntervalMs: 4000,
    autoDownloadOnTerminal: true,
    enableClientEncoding: true,
  });

  useEffect(() => {
    isFrameLoadingRef.current = isFrameLoading;
  }, [isFrameLoading]);

  const hasThreatMapDownload = Boolean(threatMapJob.encodedMp4Blob)
    || threatMapJob.downloadedArtifact?.artifactType === "mp4";
  const hasThreatMapFailure = threatMapJob.status === "failed"
    || threatMapJob.status === "cancelled"
    || Boolean(threatMapJob.encodingError);
  const isThreatMapGenerating = threatMapExportStatus === "generating"
    && !hasThreatMapDownload
    && !hasThreatMapFailure;
  const isThreatMapAiming = threatMapExportStatus === "aiming";

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
    if (!map || !isThreatMapAiming) {
      return;
    }

    const updateOverlay = () => {
      const pixelRect = getThreatMapPixelRect(map, THREAT_MAP_SQUARE_SIDE_KM);
      setThreatMapPixelRect(pixelRect);
    };

    updateOverlay();
    const view = map.getView();
    map.on("moveend", updateOverlay);
    map.on("change:size", updateOverlay);
    view.on("change:resolution", updateOverlay);

    return () => {
      map.un("moveend", updateOverlay);
      map.un("change:size", updateOverlay);
      view.un("change:resolution", updateOverlay);
    };
  }, [isThreatMapAiming, map]);

  const onStartThreatMap = useCallback(() => {
    if (!map) {
      onMessage("Map is still loading. Try Threat Map again in a moment.");
      return;
    }

    if (isDrawingPolygon) {
      cancelDrawing();
    }

    onStopPlayback();
    threatMapAwaitedYearRef.current = null;
    threatMapAwaitTokenRef.current = 0;
    threatMapResolvedTokenRef.current = 0;
    threatMapDiagnosticsUpdateAtRef.current = 0;
    setThreatMapError(null);
    setThreatMapDiagnostics(null);
    threatMapDeliveredJobIdRef.current = null;
    threatMapJob.reset();
    setThreatMapExportStatus("aiming");
    onMessage("Threat Map aiming is active. Pan or zoom, then click Generate.");
  }, [cancelDrawing, isDrawingPolygon, map, onMessage, onStopPlayback, threatMapJob]);

  const onCancelThreatMap = useCallback((message = "Threat Map canceled.") => {
    const shouldCancelRemoteJob = Boolean(threatMapJob.jobId)
      && (
        threatMapJob.status === "submitting"
        || threatMapJob.status === "deferred"
        || threatMapJob.status === "queued"
        || threatMapJob.status === "running"
      );

    threatMapAwaitedYearRef.current = null;
    threatMapAwaitTokenRef.current = 0;
    threatMapResolvedTokenRef.current = 0;
    threatMapDiagnosticsUpdateAtRef.current = 0;
    setThreatMapExportStatus("idle");
    setThreatMapDiagnostics(null);
    setThreatMapPixelRect(null);
    setThreatMapError(null);
    if (shouldCancelRemoteJob) {
      void threatMapJob.cancel();
    }
    onMessage(message);
  }, [onMessage, threatMapJob]);

  const onGenerateThreatMap = useCallback(async () => {
    if (!map) {
      onMessage("Map is still loading. Try Threat Map again in a moment.");
      return;
    }

    const frozenRect = getThreatMapPixelRect(map, THREAT_MAP_SQUARE_SIDE_KM);
    if (!frozenRect || !frozenRect.fitsViewport) {
      setThreatMapError(`Zoom in until the ${THREAT_MAP_SQUARE_SIDE_KM} km square fits fully inside the map viewport.`);
      onMessage(`Threat Map requires the full ${THREAT_MAP_SQUARE_SIDE_KM} km square to fit in view.`);
      return;
    }

    const topLeft = map.getCoordinateFromPixel([frozenRect.left, frozenRect.top]);
    const topRight = map.getCoordinateFromPixel([frozenRect.left + frozenRect.width, frozenRect.top]);
    const bottomRight = map.getCoordinateFromPixel([frozenRect.left + frozenRect.width, frozenRect.top + frozenRect.height]);
    const bottomLeft = map.getCoordinateFromPixel([frozenRect.left, frozenRect.top + frozenRect.height]);

    const mapProjectionCode = map.getView().getProjection()?.getCode() ?? "EPSG:3857";
    const threatMapGeojsonCrs = "EPSG:3857" as const;

    const ring = [topLeft, topRight, bottomRight, bottomLeft, topLeft]
      .map((coordinate) => [coordinate[0], coordinate[1]] as [number, number]);
    const ringThreatMapProjection = ring.map((coordinate) =>
      mapProjectionCode === threatMapGeojsonCrs
        ? coordinate
        : (transformCoordinate(coordinate, mapProjectionCode, threatMapGeojsonCrs) as [number, number])
    );

    const squareBboxMapProjection: GeoJsonBbox = [
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

    const overlayLayers: Array<{
      id: string;
      label: string;
      geojsonCrs: "EPSG:3857";
      geojson: FeatureCollection<Geometry, GeoJsonProperties> | GeoJsonFeature<Geometry, GeoJsonProperties>;
      style: {
        strokeColor?: string;
        strokeWidth?: number;
        fillColor?: string;
        fillOpacity?: number;
        markerColor?: string;
        markerOutlineColor?: string;
        markerSize?: number;
        labelColor?: string;
        labelBgColor?: string;
      };
      showInLegend: true;
      legendOrder: number;
    }> = [];
    let overlayLayerOrder = 10;

    for (const [layerName, layerState] of Object.entries(vectorLayers)) {
      if (!layerState.isVisible) {
        continue;
      }

      const features = layerState.layer.getSource()?.getFeatures() ?? [];
      const overlayFeaturesForLayer: Array<GeoJsonFeature<Geometry, GeoJsonProperties>> = [];
      let hasPointGeometry = false;
      let hasAreaOrLineGeometry = false;

      for (const feature of features) {
        const geometry = feature.getGeometry();
        if (!geometry || !geometry.intersectsExtent(squareExtent)) {
          continue;
        }

        try {
          const geometryObject = geojsonFormatRef.current.writeGeometryObject(geometry, {
            dataProjection: mapProjectionCode,
            featureProjection: mapProjectionCode,
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

          if (geometryObject.type === "Point" || geometryObject.type === "MultiPoint") {
            const existingName = readNonEmptyString(overlayFeature.properties?.name);
            if (!existingName) {
              const fallbackLabel = readNonEmptyString(overlayFeature.properties?.label);
              if (fallbackLabel) {
                overlayFeature.properties = {
                  ...overlayFeature.properties,
                  name: fallbackLabel,
                };
              }
            }
          }

          const clippedOverlayFeature = clipFeatureToBbox(overlayFeature, squareBboxMapProjection);
          if (clippedOverlayFeature) {
            const clippedGeometry = clippedOverlayFeature.geometry;
            const projectedGeometry = geojsonFormatRef.current.readGeometry(clippedGeometry as never, {
              dataProjection: mapProjectionCode,
              featureProjection: mapProjectionCode,
            });
            if (mapProjectionCode !== threatMapGeojsonCrs) {
              projectedGeometry.transform(mapProjectionCode, threatMapGeojsonCrs);
            }

            const projectedFeature = {
              ...clippedOverlayFeature,
              geometry: geojsonFormatRef.current.writeGeometryObject(projectedGeometry, {
                dataProjection: threatMapGeojsonCrs,
                featureProjection: threatMapGeojsonCrs,
              }) as Geometry,
            };

            if (projectedFeature.geometry.type === "Point" || projectedFeature.geometry.type === "MultiPoint") {
              hasPointGeometry = true;
            } else {
              hasAreaOrLineGeometry = true;
            }

            overlayFeaturesForLayer.push(projectedFeature);
          }
        } catch {
          // Skip geometries that cannot be converted to GeoJSON.
        }
      }

      if (overlayFeaturesForLayer.length === 0) {
        continue;
      }

      const onlyPointGeometries = hasPointGeometry && !hasAreaOrLineGeometry;
      const overlayGeojson: FeatureCollection<Geometry, GeoJsonProperties> | GeoJsonFeature<Geometry, GeoJsonProperties> =
        onlyPointGeometries && overlayFeaturesForLayer.length === 1
          ? overlayFeaturesForLayer[0]
          : {
              type: "FeatureCollection",
              features: overlayFeaturesForLayer,
            };

      overlayLayers.push({
        id: toThreatMapLayerId(layerName),
        label: layerName,
        geojsonCrs: threatMapGeojsonCrs,
        geojson: overlayGeojson,
        style: {
          ...(hasAreaOrLineGeometry
            ? {
                strokeColor: layerState.defaultColor,
                strokeWidth: 2,
                fillColor: layerState.defaultColor,
                fillOpacity: layerState.fillOpacity,
              }
            : {}),
          ...(hasPointGeometry
            ? {
                markerColor: layerState.defaultColor,
                markerOutlineColor: "#ffffff",
                markerSize: 8,
                labelColor: "#111827",
                labelBgColor: "#ffffff",
              }
            : {}),
        },
        showInLegend: true,
        legendOrder: overlayLayerOrder,
      });
      overlayLayerOrder += 10;
    }

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
                coordinates: [ringThreatMapProjection],
              },
              properties: {
                source: "threat-map-square",
              },
            },
          ],
        },
        geojsonCrs: threatMapGeojsonCrs,
        overlayLayers,
        preset: "balanced",
        outputFormat: "frames_tar_gz",
      });
      onMessage(
        `Threat Map job submitted. Generating... (${overlayLayers.length} overlay layer${overlayLayers.length === 1 ? "" : "s"} included)`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Threat Map export failed.";
      setThreatMapExportStatus("aiming");
      setThreatMapError(message);
      onMessage(`Threat Map export failed: ${message}`);
    }
  }, [map, onMessage, threatMapJob, vectorLayers]);

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
    threatMapJob.boundaryFrames,
    threatMapJob.downloadedArtifact,
    threatMapJob.encodedMp4Blob,
    threatMapJob.jobId,
    threatMapJob.status,
  ]);

  const threatMapDisplayProgress = useMemo<ThreatMapOverlayProgress | null>(() => {
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

  return {
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
  };
}
