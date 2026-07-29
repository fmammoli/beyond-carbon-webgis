"use client";

import { useCallback, useMemo, useState, type MutableRefObject } from "react";
import type { Extent } from "ol/extent";
import type OlGeometry from "ol/geom/Geometry";
import VectorLayer from "ol/layer/Vector";
import type OLMap from "ol/Map";
import VectorSource from "ol/source/Vector";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import { getUid } from "ol/util";

import type { CommunityPolygonItem } from "@/components/gis/community-map-panel";
import type { ActiveLegendLayer } from "@/components/gis/legend";
import {
  buildGroupColorMap,
  DEFAULT_GROUP_PALETTE,
  EMPTY_GROUP_LABEL,
  normalizeGroupValue,
} from "@/lib/vector-grouping";

export type VectorLayerState = {
  layer: VectorLayer<VectorSource>;
  isVisible: boolean;
  fillOpacity: number;
  availableGroupingColumns: string[];
  groupingColumn: string | null;
  groupingValueColors: Record<string, string>;
  groupingValueCounts: Record<string, number>;
};

type UseMapVectorLayersParams = {
  map: OLMap | null;
  fitMapToCommunityPolygonExtent: (extent: Extent) => void;
  selectedVectorUidRef: MutableRefObject<string | null>;
  isLandcoverVisible: boolean;
  isAgbVisible: boolean;
  isChmVisible: boolean;
};

type VectorLayerAddPayload = {
  layer: VectorLayer<VectorSource>;
  defaultFillOpacity: number;
  availableGroupingColumns: string[];
};

type VectorLayerAddOptions = {
  fitToExtent?: boolean;
};

const DEFAULT_VECTOR_STROKE_COLOR = "#ff3b30";
const MIN_HIT_DETECTION_FILL_OPACITY = 0.001;

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

function createVectorStyle(fillOpacity: number, color = DEFAULT_VECTOR_STROKE_COLOR): Style {
  const effectiveFillOpacity =
    fillOpacity <= 0 ? MIN_HIT_DETECTION_FILL_OPACITY : fillOpacity;

  return new Style({
    stroke: new Stroke({
      color,
      width: 2,
    }),
    fill: new Fill({
      color: rgbaFromHex(color, effectiveFillOpacity),
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
  const effectiveFillOpacity =
    fillOpacity <= 0 ? MIN_HIT_DETECTION_FILL_OPACITY : fillOpacity;

  return [
    new Style({
      stroke: new Stroke({
        color: "#ffffff",
        width: 6,
      }),
      fill: new Fill({
        color: "rgba(255, 255, 255, 0)",
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
        color: rgbaFromHex(color, effectiveFillOpacity),
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
  features: import("ol/Feature").default<OlGeometry>[],
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
  selectedVectorUidRef: { current: string | null },
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
    const isSelected = selectedVectorUidRef.current !== null && featureUid === selectedVectorUidRef.current;
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

export function useMapVectorLayers({
  map,
  fitMapToCommunityPolygonExtent,
  selectedVectorUidRef,
  isLandcoverVisible,
  isAgbVisible,
  isChmVisible,
}: UseMapVectorLayersParams) {
  const [vectorLayers, setVectorLayers] = useState<Record<string, VectorLayerState>>({});
  const [communityMapLayerNames, setCommunityMapLayerNames] = useState<string[]>([]);

  const onVectorLayerAdd = useCallback((
    fileName: string,
    payload: VectorLayerAddPayload,
    options?: VectorLayerAddOptions,
  ) => {
    setCommunityMapLayerNames((prev) => [fileName, ...prev.filter((name) => name !== fileName)]);

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
    if (options?.fitToExtent !== false && extent) {
      fitMapToCommunityPolygonExtent(extent);
    }
  }, [fitMapToCommunityPolygonExtent, selectedVectorUidRef]);

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
  }, [selectedVectorUidRef]);

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
  }, [selectedVectorUidRef]);

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

  const removeVectorLayer = useCallback((fileName: string) => {
    setCommunityMapLayerNames((prev) => prev.filter((name) => name !== fileName));

    setVectorLayers((prev) => {
      const existing = prev[fileName];
      if (existing && map) {
        map.removeLayer(existing.layer);
      }

      const next = { ...prev };
      delete next[fileName];
      return next;
    });
  }, [map]);

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

    if (isAgbVisible) {
      layers.push({
        id: "agb",
        kind: "agb",
        title: "Above Ground Biomass",
      });
    }

    if (isChmVisible) {
      layers.push({
        id: "chm",
        kind: "chm",
        title: "Canopy Height Model",
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
  }, [isAgbVisible, isChmVisible, isLandcoverVisible, vectorLayers]);

  return {
    vectorLayers,
    communityPolygonItems,
    activeLegendLayers,
    onVectorLayerAdd,
    onVectorLayerVisibilityChange,
    onVectorLayerOpacityChange,
    onVectorLayerGroupingColumnChange,
    onCommunityPolygonFocus,
    removeVectorLayer,
  };
}
