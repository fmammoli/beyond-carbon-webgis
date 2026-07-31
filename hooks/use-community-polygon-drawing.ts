"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import type { Coordinate } from "ol/coordinate";
import type OLMap from "ol/Map";
import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import { transform } from "ol/proj";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { getArea as getGeodesicArea, getDistance as getGeodesicDistance } from "ol/sphere";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";

const DEFAULT_VECTOR_FILL_OPACITY = 0;
const UPLOADED_VECTOR_Z_INDEX = 2000;
const DRAW_LAYER_Z_INDEX = 2300;
const DRAW_CLOSE_TOLERANCE_PIXELS = 14;

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

type PolygonDraftMetrics = {
  areaSquareKilometers: number;
  requiredBufferKilometers: number;
  maxAllowedBufferKilometers: number;
  exceedsBufferLimit: boolean;
};

type PendingPolygonConfirmState = {
  vertices: Coordinate[];
  metrics: PolygonDraftMetrics;
};

type PendingPointConfirmState = {
  coordinate: Coordinate;
};

type UseCommunityPolygonDrawingParams = {
  map: OLMap | null;
  maxCommunityBoundaryBufferMeters: number;
  maxCommunityBoundaryBufferKilometers: number;
  onVectorLayerAdd: (
    fileName: string,
    payload: {
      layer: VectorLayer<VectorSource>;
      defaultFillOpacity: number;
      availableGroupingColumns: string[];
    },
  ) => void;
  onMessage: (message: string) => void;
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

function isNearFirstVertex(map: OLMap, first: Coordinate, candidate: Coordinate): boolean {
  const [firstPxX, firstPxY] = map.getPixelFromCoordinate(first);
  const [candidatePxX, candidatePxY] = map.getPixelFromCoordinate(candidate);
  const dx = firstPxX - candidatePxX;
  const dy = firstPxY - candidatePxY;
  return Math.sqrt(dx * dx + dy * dy) <= DRAW_CLOSE_TOLERANCE_PIXELS;
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

function calculatePolygonDraftMetrics(
  vertices: Coordinate[],
  maxCommunityBoundaryBufferMeters: number,
  maxCommunityBoundaryBufferKilometers: number,
): PolygonDraftMetrics {
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
    maxAllowedBufferKilometers: maxCommunityBoundaryBufferKilometers,
    exceedsBufferLimit: maxDistanceMeters > maxCommunityBoundaryBufferMeters,
  };
}

function createCenteredMaxSquareVertices(
  vertices: Coordinate[],
  maxCommunityBoundaryBufferMeters: number,
): Coordinate[] {
  const [centerX, centerY] = calculatePolygonCentroid(vertices);
  const halfSide = maxCommunityBoundaryBufferMeters;

  return [
    [centerX - halfSide, centerY - halfSide],
    [centerX + halfSide, centerY - halfSide],
    [centerX + halfSide, centerY + halfSide],
    [centerX - halfSide, centerY + halfSide],
  ];
}

export function useCommunityPolygonDrawing({
  map,
  maxCommunityBoundaryBufferMeters,
  maxCommunityBoundaryBufferKilometers,
  onVectorLayerAdd,
  onMessage,
}: UseCommunityPolygonDrawingParams) {
  const [isDrawingPolygon, setIsDrawingPolygon] = useState(false);
  const [drawingVertices, setDrawingVertices] = useState<Coordinate[]>([]);
  const [pendingPolygonConfirm, setPendingPolygonConfirm] =
    useState<PendingPolygonConfirmState | null>(null);
  const [pendingPointConfirm, setPendingPointConfirm] =
    useState<PendingPointConfirmState | null>(null);

  const drawingVerticesRef = useRef<Coordinate[]>([]);
  const drawingLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const communityPolygonCounterRef = useRef(1);
  const communityPointCounterRef = useRef(1);

  const clearDrawingState = useCallback(() => {
    drawingVerticesRef.current = [];
    setDrawingVertices([]);
  }, []);

  const cancelDrawing = useCallback(() => {
    setIsDrawingPolygon(false);
    setPendingPolygonConfirm(null);
    setPendingPointConfirm(null);
    clearDrawingState();
    onMessage("Polygon drawing canceled.");
  }, [clearDrawingState, onMessage]);

  const startDrawing = useCallback(() => {
    setIsDrawingPolygon(true);
    setPendingPolygonConfirm(null);
    setPendingPointConfirm(null);
    clearDrawingState();
    onMessage(
      "Drawing started. Click vertices, then click the first vertex to close the polygon.",
    );
  }, [clearDrawingState, onMessage]);

  const finalizePolygonDrawing = useCallback((vertices: Coordinate[]) => {
    if (vertices.length < 3) {
      onMessage("At least 3 vertices are required to form a polygon.");
      return;
    }

    const metrics = calculatePolygonDraftMetrics(
      vertices,
      maxCommunityBoundaryBufferMeters,
      maxCommunityBoundaryBufferKilometers,
    );

    setPendingPolygonConfirm({ vertices: [...vertices], metrics });

    const baseMessage =
      `Review your polygon. Area ${formatAreaSquareKilometers(metrics.areaSquareKilometers)} km². ` +
      `Required centroid buffer ${formatKilometers(metrics.requiredBufferKilometers)} km ` +
      `of ${formatKilometers(metrics.maxAllowedBufferKilometers)} km max.`;

    if (metrics.exceedsBufferLimit) {
      const overflowKilometers = metrics.requiredBufferKilometers - metrics.maxAllowedBufferKilometers;
      onMessage(
        `${baseMessage} This is too large by ${formatKilometers(overflowKilometers)} km and will be clipped if you confirm.`,
      );
    } else {
      onMessage(baseMessage);
    }
  }, [maxCommunityBoundaryBufferKilometers, maxCommunityBoundaryBufferMeters, onMessage]);

  const finalizePointDrawing = useCallback((coordinate: Coordinate) => {
    setPendingPointConfirm({
      coordinate: [...coordinate],
    });
    onMessage("Point marker detected. Add an optional label and confirm.");
  }, [onMessage]);

  const confirmPendingPolygon = useCallback(() => {
    if (!map || !pendingPolygonConfirm) {
      return;
    }

    const { metrics } = pendingPolygonConfirm;
    const vertices = metrics.exceedsBufferLimit
      ? createCenteredMaxSquareVertices(pendingPolygonConfirm.vertices, maxCommunityBoundaryBufferMeters)
      : pendingPolygonConfirm.vertices;

    const fileName = `Community polygon ${communityPolygonCounterRef.current}`;
    communityPolygonCounterRef.current += 1;

    const polygon = new Polygon([[...vertices, vertices[0]!]]);
    const feature = new Feature({ geometry: polygon });
    const source = new VectorSource({ features: [feature] });

    const layer = new VectorLayer({
      source,
      zIndex: UPLOADED_VECTOR_Z_INDEX,
      properties: {
        name: fileName,
        isVectorUploadLayer: true,
        isCommunityPolygonLayer: true,
      },
    });

    map.addLayer(layer);
    onVectorLayerAdd(fileName, {
      layer,
      defaultFillOpacity: DEFAULT_VECTOR_FILL_OPACITY,
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
      onMessage(
        `${fileName} added. ${measurementSummary} Your polygon was automatically reduced to the maximum ${formatKilometers(metrics.maxAllowedBufferKilometers)} km square buffer centered on your drawing.`,
      );
    } else {
      onMessage(`${fileName} added. ${measurementSummary}`);
    }
  }, [clearDrawingState, map, maxCommunityBoundaryBufferMeters, onMessage, onVectorLayerAdd, pendingPolygonConfirm]);

  const discardPendingPolygon = useCallback(() => {
    setPendingPolygonConfirm(null);
    clearDrawingState();
    onMessage("Polygon discarded. Continue drawing a new polygon.");
  }, [clearDrawingState, onMessage]);

  const confirmPendingPoint = useCallback((labelInput: string) => {
    if (!map || !pendingPointConfirm) {
      return;
    }

    const pointLabel = labelInput.trim();
    const pointIndex = communityPointCounterRef.current;
    communityPointCounterRef.current += 1;
    const fileName = pointLabel
      ? `Community point ${pointIndex}: ${pointLabel}`
      : `Community point ${pointIndex}`;

    const pointFeature = new Feature({
      geometry: new Point(pendingPointConfirm.coordinate),
      ...(pointLabel ? { name: pointLabel } : {}),
    });

    const source = new VectorSource({ features: [pointFeature] });
    const layer = new VectorLayer({
      source,
      zIndex: UPLOADED_VECTOR_Z_INDEX,
      properties: {
        name: fileName,
        isVectorUploadLayer: true,
        isCommunityPolygonLayer: true,
        isCommunityPointLayer: true,
      },
    });

    map.addLayer(layer);
    onVectorLayerAdd(fileName, {
      layer,
      defaultFillOpacity: DEFAULT_VECTOR_FILL_OPACITY,
      availableGroupingColumns: pointLabel ? ["name"] : [],
    });

    clearDrawingState();
    setPendingPointConfirm(null);
    setPendingPolygonConfirm(null);
    setIsDrawingPolygon(false);

    onMessage(pointLabel ? `${fileName} added.` : "Point marker added.");
  }, [clearDrawingState, map, onMessage, onVectorLayerAdd, pendingPointConfirm]);

  const discardPendingPoint = useCallback(() => {
    setPendingPointConfirm(null);
    clearDrawingState();
    onMessage("Point marker discarded. Continue drawing a new feature.");
  }, [clearDrawingState, onMessage]);

  useEffect(() => {
    drawingVerticesRef.current = drawingVertices;
  }, [drawingVertices]);

  useEffect(() => {
    if (!map) {
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

    map.addLayer(layer);
    drawingLayerRef.current = layer;

    return () => {
      map.removeLayer(layer);
      drawingLayerRef.current = null;
    };
  }, [map]);

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
    if (!map || !isDrawingPolygon || pendingPolygonConfirm) {
      return;
    }

    const target = map.getTargetElement();
    if (!target) {
      return;
    }

    const previousCursor = target.style.cursor;
    target.style.cursor = "crosshair";

    return () => {
      target.style.cursor = previousCursor;
    };
  }, [isDrawingPolygon, map, pendingPolygonConfirm]);

  useEffect(() => {
    if (!map || !isDrawingPolygon || pendingPolygonConfirm || pendingPointConfirm) {
      return;
    }

    const handleMapSingleClick = (
      event: MapBrowserEvent<PointerEvent | KeyboardEvent | WheelEvent>,
    ) => {
      const currentVertices = drawingVerticesRef.current;

      if (
        currentVertices.length === 1
        && isNearFirstVertex(map, currentVertices[0]!, event.coordinate)
      ) {
        finalizePointDrawing(currentVertices[0]!);
        return;
      }

      if (
        currentVertices.length >= 3 &&
        isNearFirstVertex(map, currentVertices[0]!, event.coordinate)
      ) {
        finalizePolygonDrawing(currentVertices);
        return;
      }

      const nextVertices = [...currentVertices, event.coordinate];
      drawingVerticesRef.current = nextVertices;
      setDrawingVertices(nextVertices);
      if (nextVertices.length >= 3) {
        onMessage(
          `Drawing polygon: ${nextVertices.length} points. Click the highlighted first point to close.`,
        );
      } else {
        onMessage(
          `Drawing polygon: ${nextVertices.length} point${nextVertices.length === 1 ? "" : "s"}.`,
        );
      }
    };

    map.on("singleclick", handleMapSingleClick);

    return () => {
      map.un("singleclick", handleMapSingleClick);
    };
  }, [finalizePointDrawing, finalizePolygonDrawing, isDrawingPolygon, map, onMessage, pendingPointConfirm, pendingPolygonConfirm]);

  return {
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
  };
}

export type { PendingPointConfirmState, PendingPolygonConfirmState, PolygonDraftMetrics };
