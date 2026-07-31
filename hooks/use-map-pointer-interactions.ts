"use client";

import { useCallback, useEffect, useState, type MutableRefObject } from "react";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import Feature from "ol/Feature";
import type OlGeometry from "ol/geom/Geometry";
import type OLMap from "ol/Map";
import { getArea as getGeodesicArea } from "ol/sphere";
import { getUid } from "ol/util";

import { normalizeGroupValue } from "@/lib/vector-grouping";
import type { VectorLayerState } from "@/hooks/use-map-vector-layers";

export type HoveredVectorInfo = {
  layerName: string;
  groupingColumn: string | null;
  groupingValue: string;
  placeLabel: string | null;
  pixelX: number;
  pixelY: number;
};

function readHoverPlaceLabel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export type SelectedVectorInfo = {
  layerName: string;
  groupingColumn: string | null;
  groupingValue: string;
  geometryType: string | null;
  geometry: OlGeometry | null;
  rawProperties: Record<string, unknown>;
  properties: Array<{ key: string; value: string }>;
  areaSquareKilometers: number | null;
  areaHectares: number | null;
  selectionKey: string;
  selectionUid: string;
};

type UseMapPointerInteractionsParams = {
  map: OLMap | null;
  vectorLayers: Record<string, VectorLayerState>;
  isDrawingPolygon: boolean;
  hasPendingPolygonConfirm: boolean;
  selectedVectorUidRef: MutableRefObject<string | null>;
};

type AreaMetrics = {
  areaSquareKilometers: number | null;
  areaHectares: number | null;
};

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

export function useMapPointerInteractions({
  map,
  vectorLayers,
  isDrawingPolygon,
  hasPendingPolygonConfirm,
  selectedVectorUidRef,
}: UseMapPointerInteractionsParams) {
  const [hoveredVectorInfo, setHoveredVectorInfo] = useState<HoveredVectorInfo | null>(null);
  const [selectedVectorInfo, setSelectedVectorInfo] = useState<SelectedVectorInfo | null>(null);

  useEffect(() => {
    if (!map) {
      return;
    }

    const handlePointerMove = (
      event: MapBrowserEvent<PointerEvent | KeyboardEvent | WheelEvent>,
    ) => {
      const [pixelX, pixelY] = event.pixel;

      const hoveredVectorResult = map.forEachFeatureAtPixel(
        event.pixel,
        (featureCandidate, layerCandidate) => {
          const vectorLayer = layerCandidate as import("ol/layer/Vector").default<import("ol/source/Vector").default> | null;
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
          placeLabel: readHoverPlaceLabel(hoveredVectorResult.feature.get("place")),
          pixelX,
          pixelY,
        });
      } else {
        setHoveredVectorInfo(null);
      }
    };

    map.on("pointermove", handlePointerMove);

    return () => {
      map.un("pointermove", handlePointerMove);
    };
  }, [map, vectorLayers]);

  useEffect(() => {
    if (!map || isDrawingPolygon || hasPendingPolygonConfirm) {
      return;
    }

    const handleMapSingleClick = (
      event: MapBrowserEvent<PointerEvent | KeyboardEvent | WheelEvent>,
    ) => {
      const selectedVectorResult = map.forEachFeatureAtPixel(
        event.pixel,
        (featureCandidate, layerCandidate) => {
          const vectorLayer = layerCandidate as import("ol/layer/Vector").default<import("ol/source/Vector").default> | null;
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
        map.renderSync();
        return;
      }

      const geometry =
        selectedVectorResult.feature instanceof Feature
          ? selectedVectorResult.feature.getGeometry()?.clone() ?? null
          : null;
      const geometryType = geometry?.getType() ?? null;
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
      map.renderSync();

      setSelectedVectorInfo({
        layerName: selectedVectorResult.layerName,
        groupingColumn,
        groupingValue,
        geometryType,
        geometry,
        rawProperties: allProps,
        properties: allProperties,
        areaSquareKilometers: areaMetrics.areaSquareKilometers,
        areaHectares: areaMetrics.areaHectares,
        selectionKey,
        selectionUid,
      });
    };

    map.on("singleclick", handleMapSingleClick);

    return () => {
      map.un("singleclick", handleMapSingleClick);
    };
  }, [hasPendingPolygonConfirm, isDrawingPolygon, map, selectedVectorUidRef, vectorLayers]);

  const clearHoveredForLayer = useCallback((layerName: string) => {
    setHoveredVectorInfo((previous) => {
      if (!previous || previous.layerName !== layerName) {
        return previous;
      }

      return null;
    });
  }, []);

  const clearSelectedForLayer = useCallback((layerName: string) => {
    setSelectedVectorInfo((previous) => {
      if (!previous || previous.layerName !== layerName) {
        return previous;
      }

      selectedVectorUidRef.current = null;
      map?.renderSync();
      return null;
    });
  }, [map, selectedVectorUidRef]);

  return {
    hoveredVectorInfo,
    selectedVectorInfo,
    clearHoveredForLayer,
    clearSelectedForLayer,
  };
}
