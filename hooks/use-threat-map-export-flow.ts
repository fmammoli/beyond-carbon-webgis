"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Feature as GeoJsonFeature, GeoJsonProperties, Geometry } from "geojson";
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

    const ring = [topLeft, topRight, bottomRight, bottomLeft, topLeft]
      .map((coordinate) => [coordinate[0], coordinate[1]] as [number, number]);

    const ringWgs84 = ring.map((coordinate) =>
      transformCoordinate(coordinate, mapProjectionCode, "EPSG:4326") as [number, number]);

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

          const clippedOverlayFeature = clipFeatureToBbox(overlayFeature, squareBboxMapProjection);
          if (clippedOverlayFeature) {
            const clippedGeometry = clippedOverlayFeature.geometry;
            const projectedGeometry = geojsonFormatRef.current.readGeometry(clippedGeometry as never, {
              dataProjection: mapProjectionCode,
              featureProjection: mapProjectionCode,
            });
            projectedGeometry.transform(mapProjectionCode, "EPSG:4326");

            overlayFeatures.push({
              ...clippedOverlayFeature,
              geometry: geojsonFormatRef.current.writeGeometryObject(projectedGeometry, {
                dataProjection: "EPSG:4326",
                featureProjection: "EPSG:4326",
              }) as Geometry,
            });
          }
        } catch {
          // Skip geometries that cannot be converted to GeoJSON.
        }
      }
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
                coordinates: [ringWgs84],
              },
              properties: {
                source: "threat-map-square",
              },
            },
            ...overlayFeatures,
          ],
        },
        geojsonCrs: "EPSG:4326",
        preset: "balanced",
        outputFormat: "frames_tar_gz",
      });
      onMessage(
        `Threat Map job submitted. Generating... (${overlayFeatures.length} overlay feature${overlayFeatures.length === 1 ? "" : "s"} included)`
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
