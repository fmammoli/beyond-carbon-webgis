import type { Feature, FeatureCollection, Geometry, GeoJsonProperties } from "geojson";

import type {
  CreateThreatMapJobRequest,
  ThreatMapGeoJsonCrs,
  ThreatMapOverlayLayer,
  ThreatMapOverlayLayerStyle,
  ThreatMapOutputFormat,
  ThreatMapPreset,
} from "@/lib/threat-map";

type Position = [number, number];

type SanitizedGeometry =
  | Extract<Geometry, { type: "Point" }>
  | Extract<Geometry, { type: "MultiPoint" }>
  | Extract<Geometry, { type: "LineString" }>
  | Extract<Geometry, { type: "MultiLineString" }>
  | Extract<Geometry, { type: "Polygon" }>
  | Extract<Geometry, { type: "MultiPolygon" }>
  | Extract<Geometry, { type: "GeometryCollection" }>;

type SanitizedFeature = Feature<Geometry, GeoJsonProperties>;
type SanitizedFeatureCollection = FeatureCollection<Geometry, GeoJsonProperties>;

type SanitizedThreatMapRequest = CreateThreatMapJobRequest;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizeCoordPair(raw: unknown): Position | null {
  if (!Array.isArray(raw) || raw.length < 2) {
    return null;
  }

  const x = raw[0];
  const y = raw[1];
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    return null;
  }

  return [x, y];
}

function samePos(left: Position, right: Position): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function sanitizeLinearRing(rawRing: unknown): Position[] | null {
  if (!Array.isArray(rawRing)) {
    return null;
  }

  const points: Position[] = [];
  for (const rawPoint of rawRing) {
    const point = sanitizeCoordPair(rawPoint);
    if (!point) {
      continue;
    }

    if (points.length > 0 && samePos(points[points.length - 1]!, point)) {
      continue;
    }

    points.push(point);
  }

  if (points.length < 3) {
    return null;
  }

  if (!samePos(points[0]!, points[points.length - 1]!)) {
    points.push(points[0]!);
  }

  return points.length >= 4 ? points : null;
}

function sanitizeLineStringCoords(rawCoords: unknown): Position[] {
  if (!Array.isArray(rawCoords)) {
    return [];
  }

  const points: Position[] = [];
  for (const rawPoint of rawCoords) {
    const point = sanitizeCoordPair(rawPoint);
    if (!point) {
      continue;
    }

    if (points.length > 0 && samePos(points[points.length - 1]!, point)) {
      continue;
    }

    points.push(point);
  }

  return points.length >= 2 ? points : [];
}

function sanitizePolygonCoords(rawCoords: unknown): Position[][] {
  if (!Array.isArray(rawCoords)) {
    return [];
  }

  const rings: Position[][] = [];
  for (const rawRing of rawCoords) {
    const ring = sanitizeLinearRing(rawRing);
    if (ring) {
      rings.push(ring);
    }
  }

  return rings;
}

function sanitizeGeometry(geometry: unknown): SanitizedGeometry | null {
  if (!geometry || typeof geometry !== "object") {
    return null;
  }

  const record = geometry as { type?: unknown; coordinates?: unknown; geometries?: unknown };
  const type = record.type;

  if (type === "Point") {
    const point = sanitizeCoordPair(record.coordinates);
    return point ? { type: "Point", coordinates: point } : null;
  }

  if (type === "MultiPoint") {
    if (!Array.isArray(record.coordinates)) {
      return null;
    }

    const points = record.coordinates
      .map((coordinate) => sanitizeCoordPair(coordinate))
      .filter((coordinate): coordinate is Position => coordinate !== null);

    return points.length > 0 ? { type: "MultiPoint", coordinates: points } : null;
  }

  if (type === "LineString") {
    const points = sanitizeLineStringCoords(record.coordinates);
    return points.length > 0 ? { type: "LineString", coordinates: points } : null;
  }

  if (type === "MultiLineString") {
    if (!Array.isArray(record.coordinates)) {
      return null;
    }

    const lines = record.coordinates
      .map((line) => sanitizeLineStringCoords(line))
      .filter((line): line is Position[] => line.length >= 2);

    return lines.length > 0 ? { type: "MultiLineString", coordinates: lines } : null;
  }

  if (type === "Polygon") {
    const rings = sanitizePolygonCoords(record.coordinates);
    return rings.length > 0 ? { type: "Polygon", coordinates: rings } : null;
  }

  if (type === "MultiPolygon") {
    if (!Array.isArray(record.coordinates)) {
      return null;
    }

    const polygons = record.coordinates
      .map((polygon) => sanitizePolygonCoords(polygon))
      .filter((polygon): polygon is Position[][] => polygon.length > 0);

    return polygons.length > 0 ? { type: "MultiPolygon", coordinates: polygons } : null;
  }

  if (type === "GeometryCollection") {
    if (!Array.isArray(record.geometries)) {
      return null;
    }

    const geometries = record.geometries
      .map((entry) => sanitizeGeometry(entry))
      .filter((entry): entry is SanitizedGeometry => entry !== null);

    return geometries.length > 0 ? { type: "GeometryCollection", geometries } : null;
  }

  return null;
}

function sanitizeProperties(properties: unknown): GeoJsonProperties {
  return properties && typeof properties === "object"
    ? (properties as GeoJsonProperties)
    : {};
}

function sanitizeFeature(feature: unknown): SanitizedFeature | null {
  if (!feature || typeof feature !== "object") {
    return null;
  }

  const record = feature as { type?: unknown; geometry?: unknown; properties?: unknown };
  if (record.type !== "Feature") {
    return null;
  }

  const geometry = sanitizeGeometry(record.geometry);
  if (!geometry) {
    return null;
  }

  return {
    type: "Feature",
    geometry,
    properties: sanitizeProperties(record.properties),
  };
}

function sanitizeFeatureCollection(collection: unknown): SanitizedFeatureCollection | null {
  if (!collection || typeof collection !== "object") {
    return null;
  }

  const record = collection as { type?: unknown; features?: unknown };
  if (record.type !== "FeatureCollection" || !Array.isArray(record.features)) {
    return null;
  }

  const features = record.features
    .map((entry) => sanitizeFeature(entry))
    .filter((entry): entry is SanitizedFeature => entry !== null);

  if (features.length === 0) {
    return null;
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

function sanitizeOverlayGeojson(geojson: unknown): ThreatMapOverlayLayer["geojson"] | null {
  if (!geojson || typeof geojson !== "object") {
    return null;
  }

  const record = geojson as { type?: unknown };

  if (record.type === "FeatureCollection") {
    return sanitizeFeatureCollection(geojson);
  }

  if (record.type === "Feature") {
    return sanitizeFeature(geojson);
  }

  return null;
}

function hasRenderableGeometry(geojson: unknown): boolean {
  if (!geojson || typeof geojson !== "object") {
    return false;
  }

  const record = geojson as { type?: unknown; features?: unknown; geometry?: unknown };

  if (record.type === "FeatureCollection") {
    return Array.isArray(record.features) && record.features.length > 0;
  }

  if (record.type === "Feature") {
    return Boolean(record.geometry);
  }

  return (
    record.type === "Point"
    || record.type === "MultiPoint"
    || record.type === "LineString"
    || record.type === "MultiLineString"
    || record.type === "Polygon"
    || record.type === "MultiPolygon"
    || record.type === "GeometryCollection"
  );
}

function ensurePointName(
  geojson: ThreatMapOverlayLayer["geojson"],
  layerLabel: string,
): ThreatMapOverlayLayer["geojson"] {
  if (geojson.type !== "Feature") {
    return geojson;
  }

  const geometryType = geojson.geometry?.type;
  if (geometryType !== "Point" && geometryType !== "MultiPoint") {
    return geojson;
  }

  const existingName = typeof geojson.properties?.name === "string" ? geojson.properties.name.trim() : "";
  if (existingName) {
    return geojson;
  }

  return {
    ...geojson,
    properties: {
      ...(geojson.properties ?? {}),
      name: layerLabel,
    },
  };
}

export function sanitizeOverlayLayer(layer: ThreatMapOverlayLayer): ThreatMapOverlayLayer | null {
  const sanitizedGeojson = sanitizeOverlayGeojson(layer.geojson);
  if (!sanitizedGeojson || !hasRenderableGeometry(sanitizedGeojson)) {
    return null;
  }

  const layerLabel = layer.label.trim() || layer.id;
  const geojsonWithPointName = ensurePointName(
    sanitizedGeojson as ThreatMapOverlayLayer["geojson"],
    layerLabel,
  );

  return {
    id: layer.id,
    label: layerLabel,
    geojsonCrs: layer.geojsonCrs,
    geojson: geojsonWithPointName,
    style: layer.style,
    showInLegend: layer.showInLegend,
    legendOrder: layer.legendOrder,
  };
}

export function sanitizeThreatMapRequest(input: CreateThreatMapJobRequest): SanitizedThreatMapRequest {
  const sanitizedLayers = (input.overlayLayers ?? [])
    .map((layer) => sanitizeOverlayLayer(layer))
    .filter((layer): layer is ThreatMapOverlayLayer => layer !== null);

  return {
    ...input,
    overlayLayers: sanitizedLayers,
  };
}
