import type { FeatureCollection, GeoJsonProperties, Geometry, Position } from "geojson";

export const MAX_COMMUNITY_BOUNDARY_BUFFER_METERS = 30000;
export const MAX_AOI_SQUARE_SIDE_KM = 60;
const MIN_AOI_SQUARE_SIDE_KM = 0.05;
const KM_PER_DEGREE_LAT = 110.574;
const KM_PER_DEGREE_LON_AT_EQUATOR = 111.320;

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function createEmptyBounds(): Bounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

function expandBounds(bounds: Bounds, x: number, y: number): void {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

function summarizeGeometry(geometry: Geometry, bounds: Bounds): void {
  if (geometry.type === "Point") {
    const [x, y] = geometry.coordinates;
    expandBounds(bounds, x, y);
    return;
  }

  if (geometry.type === "MultiPoint" || geometry.type === "LineString") {
    for (const [x, y] of geometry.coordinates) {
      expandBounds(bounds, x, y);
    }
    return;
  }

  if (geometry.type === "MultiLineString") {
    for (const line of geometry.coordinates) {
      for (const [x, y] of line) {
        expandBounds(bounds, x, y);
      }
    }
    return;
  }

  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) {
      for (const [x, y] of ring) {
        expandBounds(bounds, x, y);
      }
    }
    return;
  }

  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        for (const [x, y] of ring) {
          expandBounds(bounds, x, y);
        }
      }
    }
    return;
  }

  if (geometry.type === "GeometryCollection") {
    for (const childGeometry of geometry.geometries) {
      summarizeGeometry(childGeometry, bounds);
    }
  }
}

function getLongitudeKmPerDegree(latitudeDegrees: number): number {
  const latitudeRadians = (latitudeDegrees * Math.PI) / 180;
  const scaled = KM_PER_DEGREE_LON_AT_EQUATOR * Math.cos(latitudeRadians);
  return Math.max(Math.abs(scaled), 0.000001);
}

function getSquareSideKilometersFromBounds(bounds: Bounds): {
  widthKm: number;
  heightKm: number;
  requestedSquareSideKm: number;
  centerLatitude: number;
} {
  const centerLatitude = (bounds.minY + bounds.maxY) / 2;
  const lonKmPerDegree = getLongitudeKmPerDegree(centerLatitude);
  const widthDegrees = Math.max(0, bounds.maxX - bounds.minX);
  const heightDegrees = Math.max(0, bounds.maxY - bounds.minY);
  const widthKm = widthDegrees * lonKmPerDegree;
  const heightKm = heightDegrees * KM_PER_DEGREE_LAT;

  return {
    widthKm,
    heightKm,
    requestedSquareSideKm: Math.max(widthKm, heightKm),
    centerLatitude,
  };
}

function summarizeFeatureCollectionBounds(
  input: FeatureCollection<Geometry, GeoJsonProperties>,
): Bounds {
  const bounds = createEmptyBounds();

  for (const feature of input.features) {
    if (!feature.geometry) {
      continue;
    }

    summarizeGeometry(feature.geometry, bounds);
  }

  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.maxY)
  ) {
    throw new Error("The selected geometry does not contain any coordinates.");
  }

  return bounds;
}

export function getAoiSquareSideKilometers(
  input: FeatureCollection<Geometry, GeoJsonProperties>,
): number {
  const bounds = summarizeFeatureCollectionBounds(input);
  const metrics = getSquareSideKilometersFromBounds(bounds);
  return metrics.requestedSquareSideKm;
}

export function buildCommunityBoundaryGeoJson(
  input: FeatureCollection<Geometry, GeoJsonProperties>,
): {
  boundary: FeatureCollection<Geometry, GeoJsonProperties>;
  wasClipped: boolean;
  requestedSideKilometers: number;
  finalSideKilometers: number;
  maxAllowedSideKilometers: number;
} {
  const bounds = summarizeFeatureCollectionBounds(input);

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const squareMetrics = getSquareSideKilometersFromBounds(bounds);
  const requestedSideKilometers = squareMetrics.requestedSquareSideKm;
  const finalSideKilometers = Math.min(
    Math.max(requestedSideKilometers, MIN_AOI_SQUARE_SIDE_KM),
    MAX_AOI_SQUARE_SIDE_KM,
  );
  const wasClipped = requestedSideKilometers > MAX_AOI_SQUARE_SIDE_KM;

  const halfSideKilometers = finalSideKilometers / 2;
  const lonKmPerDegree = getLongitudeKmPerDegree(squareMetrics.centerLatitude);
  const halfSideLonDegrees = halfSideKilometers / lonKmPerDegree;
  const halfSideLatDegrees = halfSideKilometers / KM_PER_DEGREE_LAT;

  const ring: Position[] = [
    [centerX - halfSideLonDegrees, centerY - halfSideLatDegrees],
    [centerX + halfSideLonDegrees, centerY - halfSideLatDegrees],
    [centerX + halfSideLonDegrees, centerY + halfSideLatDegrees],
    [centerX - halfSideLonDegrees, centerY + halfSideLatDegrees],
    [centerX - halfSideLonDegrees, centerY - halfSideLatDegrees],
  ];

  return {
    boundary: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [ring],
          },
          properties: {},
        },
      ],
    },
    wasClipped,
    requestedSideKilometers,
    finalSideKilometers,
    maxAllowedSideKilometers: MAX_AOI_SQUARE_SIDE_KM,
  };
}