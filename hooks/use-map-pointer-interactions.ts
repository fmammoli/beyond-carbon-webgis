"use client";

import { useCallback, useEffect, useState, type MutableRefObject } from "react";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import Feature from "ol/Feature";
import type OlGeometry from "ol/geom/Geometry";
import type TileLayer from "ol/layer/Tile";
import type OLMap from "ol/Map";
import { getArea as getGeodesicArea } from "ol/sphere";
import XYZ from "ol/source/XYZ";
import { getUid } from "ol/util";

import {
  AGB_SCALE_FACTOR,
  AGB_TRANSPARENT_RAW_THRESHOLD,
  getAgbDisplayColor,
} from "@/lib/agb-legend";
import {
  CHM_SCALE_FACTOR,
  CHM_TRANSPARENT_RAW_THRESHOLD,
  getChmDisplayColor,
} from "@/lib/chm-legend";
import { resolveMapbiomasClassCodeFromRgb } from "@/lib/mapbiomas-colors";
import type { PmtilesZoomRange } from "@/lib/pmtiles-source";
import { normalizeGroupValue } from "@/lib/vector-grouping";
import type { VectorLayerState } from "@/hooks/use-map-vector-layers";

export type HoverPixelInfo = {
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

export type HoverAgbPixelInfo = {
  rawValue: number;
  scaledValue: number;
  color: string;
  pixelX: number;
  pixelY: number;
  requestedZoom: number | null;
  sourceZoom: number | null;
};

export type HoverChmPixelInfo = {
  rawValue: number;
  scaledValue: number;
  color: string;
  pixelX: number;
  pixelY: number;
  requestedZoom: number | null;
  sourceZoom: number | null;
};

export type HoveredVectorInfo = {
  layerName: string;
  groupingColumn: string | null;
  groupingValue: string;
  pixelX: number;
  pixelY: number;
};

export type SelectedVectorInfo = {
  layerName: string;
  groupingColumn: string | null;
  groupingValue: string;
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
  isLandcoverVisible: boolean;
  isAgbVisible: boolean;
  isChmVisible: boolean;
  pmtilesLayer: TileLayer<XYZ> | null;
  pmtilesZoomRange: PmtilesZoomRange | null;
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
  isLandcoverVisible,
  isAgbVisible,
  isChmVisible,
  pmtilesLayer,
  pmtilesZoomRange,
  vectorLayers,
  isDrawingPolygon,
  hasPendingPolygonConfirm,
  selectedVectorUidRef,
}: UseMapPointerInteractionsParams) {
  const [hoverPixelInfo, setHoverPixelInfo] = useState<HoverPixelInfo | null>(null);
  const [hoverAgbPixelInfo, setHoverAgbPixelInfo] = useState<HoverAgbPixelInfo | null>(null);
  const [hoverChmPixelInfo, setHoverChmPixelInfo] = useState<HoverChmPixelInfo | null>(null);
  const [hoveredVectorInfo, setHoveredVectorInfo] = useState<HoveredVectorInfo | null>(null);
  const [selectedVectorInfo, setSelectedVectorInfo] = useState<SelectedVectorInfo | null>(null);

  useEffect(() => {
    if (!map) {
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
          pixelX,
          pixelY,
        });
      } else {
        setHoveredVectorInfo(null);
      }

      if (event.dragging || (!isLandcoverVisible && !isAgbVisible && !isChmVisible) || !pmtilesLayer) {
        if (hoverUpdateFrameId !== null) {
          window.cancelAnimationFrame(hoverUpdateFrameId);
          hoverUpdateFrameId = null;
        }

        latestPixel = null;

        setHoverPixelInfo(null);
        setHoverAgbPixelInfo(null);
        setHoverChmPixelInfo(null);
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
          setHoverAgbPixelInfo(null);
          setHoverChmPixelInfo(null);
          return;
        }

        const red = readPixelComponent(pixelData, 0, 0);
        const green = readPixelComponent(pixelData, 1, red);
        const blue = readPixelComponent(pixelData, 2, red);
        const alpha = readPixelComponent(pixelData, 3, 255);

        const viewZoom = map.getView().getZoom();
        const requestedZoom = Number.isFinite(viewZoom) ? Math.round(viewZoom ?? 0) : null;
        const sourceZoom =
          requestedZoom === null || !pmtilesZoomRange
            ? requestedZoom
            : Math.max(
                pmtilesZoomRange.minZoom,
                Math.min(pmtilesZoomRange.maxZoom, requestedZoom),
              );

        if (isAgbVisible) {
          if (alpha === 0 || red <= AGB_TRANSPARENT_RAW_THRESHOLD) {
            setHoverAgbPixelInfo(null);
            return;
          }

          const rawValue = red;
          const scaledValue = rawValue / AGB_SCALE_FACTOR;
          const color = getAgbDisplayColor(rawValue);

          setHoverAgbPixelInfo((previous) => {
            if (
              previous &&
              previous.rawValue === rawValue &&
              previous.scaledValue === scaledValue &&
              previous.color === color &&
              previous.pixelX === nextPixelX &&
              previous.pixelY === nextPixelY &&
              previous.requestedZoom === requestedZoom &&
              previous.sourceZoom === sourceZoom
            ) {
              return previous;
            }

            return {
              rawValue,
              scaledValue,
              color,
              pixelX: nextPixelX,
              pixelY: nextPixelY,
              requestedZoom,
              sourceZoom,
            };
          });

          setHoverPixelInfo(null);
          setHoverChmPixelInfo(null);
          return;
        }

        setHoverAgbPixelInfo(null);

        if (isChmVisible) {
          if (alpha === 0 || red <= CHM_TRANSPARENT_RAW_THRESHOLD) {
            setHoverChmPixelInfo(null);
            return;
          }

          const rawValue = red;
          const scaledValue = rawValue / CHM_SCALE_FACTOR;
          const color = getChmDisplayColor(rawValue);

          setHoverChmPixelInfo((previous) => {
            if (
              previous &&
              previous.rawValue === rawValue &&
              previous.scaledValue === scaledValue &&
              previous.color === color &&
              previous.pixelX === nextPixelX &&
              previous.pixelY === nextPixelY &&
              previous.requestedZoom === requestedZoom &&
              previous.sourceZoom === sourceZoom
            ) {
              return previous;
            }

            return {
              rawValue,
              scaledValue,
              color,
              pixelX: nextPixelX,
              pixelY: nextPixelY,
              requestedZoom,
              sourceZoom,
            };
          });

          setHoverPixelInfo(null);
          return;
        }

        setHoverChmPixelInfo(null);

        const code =
          alpha === 0
            ? null
            : resolveMapbiomasClassCodeFromRgb(red, green, blue, alpha);

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

    map.on("pointermove", handlePointerMove);

    return () => {
      if (hoverUpdateFrameId !== null) {
        window.cancelAnimationFrame(hoverUpdateFrameId);
      }

      map.un("pointermove", handlePointerMove);
    };
  }, [isAgbVisible, isChmVisible, isLandcoverVisible, map, pmtilesLayer, pmtilesZoomRange, vectorLayers]);

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
    hoverPixelInfo,
    hoverAgbPixelInfo,
    hoverChmPixelInfo,
    hoveredVectorInfo,
    selectedVectorInfo,
    clearHoveredForLayer,
    clearSelectedForLayer,
  };
}
