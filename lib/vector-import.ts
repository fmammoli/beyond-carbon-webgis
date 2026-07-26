import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import { kml as kmlToGeoJson } from "@tmcw/togeojson";
import JSZip from "jszip";
import proj4 from "proj4";
import shp from "shpjs";

type AnyFeature = Feature<Geometry, GeoJsonProperties>;

const TARGET_CRS = "EPSG:3857";
const DEFAULT_CRS = "EPSG:4326";

type FeatureCollectionWithCrs = FeatureCollection<Geometry, GeoJsonProperties> & {
  crs?: { type?: string; properties?: { name?: string } };
};

const SUPPORTED_VECTOR_EXTENSIONS = new Set([
  ".zip",
  ".geojson",
  ".json",
  ".kml",
  ".shp",
  ".dbf",
  ".shx",
  ".prj",
  ".cpg",
  ".sbn",
  ".sbx",
  ".qix",
]);

export type ParsedVectorFile = {
  fileName: string;
  geojson: FeatureCollection<Geometry, GeoJsonProperties>;
};

function toFeatureCollection(
  input: FeatureCollection<Geometry, GeoJsonProperties> | AnyFeature,
): FeatureCollection<Geometry, GeoJsonProperties> {
  if (input.type === "FeatureCollection") {
    return input;
  }

  return {
    type: "FeatureCollection",
    features: [input],
  };
}

function normalizeShapefileResult(
  input:
    | FeatureCollection<Geometry, GeoJsonProperties>
    | FeatureCollection<Geometry, GeoJsonProperties>[],
): FeatureCollection<Geometry, GeoJsonProperties> {
  if (Array.isArray(input)) {
    return {
      type: "FeatureCollection",
      features: input.flatMap((item) => item.features),
    };
  }

  return input;
}

function getFileExtension(fileName: string): string {
  const lowerName = fileName.toLowerCase();
  const lastDotIndex = lowerName.lastIndexOf(".");
  return lastDotIndex >= 0 ? lowerName.slice(lastDotIndex) : "";
}

export function filterVectorFiles(files: File[]): File[] {
  return files.filter((file) => SUPPORTED_VECTOR_EXTENSIONS.has(getFileExtension(file.name)));
}

function getFileBaseName(fileName: string): string {
  const lowerName = fileName.toLowerCase();
  const lastDotIndex = lowerName.lastIndexOf(".");
  return lastDotIndex >= 0 ? lowerName.slice(0, lastDotIndex) : lowerName;
}

export function groupFilesByBaseName(files: File[]): File[][] {
  const groups = new Map<string, File[]>();

  for (const file of files) {
    const baseName = getFileBaseName(file.name);
    const existingGroup = groups.get(baseName) ?? [];
    existingGroup.push(file);
    groups.set(baseName, existingGroup);
  }

  return Array.from(groups.values());
}

function transformToTargetCrs(geojson: FeatureCollection<Geometry, GeoJsonProperties>): FeatureCollection<Geometry, GeoJsonProperties> {
  const sourceCrs = (geojson as FeatureCollectionWithCrs).crs?.properties?.name;
  const sourceCrsCode = sourceCrs ?? DEFAULT_CRS;

  if (sourceCrsCode === TARGET_CRS) {
    return geojson;
  }

  if (!sourceCrsCode || sourceCrsCode === DEFAULT_CRS) {
    return geojson;
  }

  try {
    const geojsonWithCrs = geojson as FeatureCollectionWithCrs;
    const transformedFeatures: AnyFeature[] = [];

    for (const feature of geojsonWithCrs.features) {
      if (!feature.geometry) {
        transformedFeatures.push(feature as AnyFeature);
        continue;
      }

      const transformedGeometry = transformGeometry(feature.geometry, sourceCrsCode, TARGET_CRS);
      transformedFeatures.push({ ...feature, geometry: transformedGeometry } as AnyFeature);
    }

    return {
      ...geojsonWithCrs,
      features: transformedFeatures,
    };
  } catch {
    return geojson;
  }
}

function transformGeometry(
  geometry: Geometry,
  sourceCrsCode: string,
  targetCrsCode: string,
): Geometry {
  if (geometry.type === "Point") {
    const [x, y] = geometry.coordinates;
    const [targetX, targetY] = proj4(sourceCrsCode, targetCrsCode, [x, y]);
    return { ...geometry, coordinates: [targetX, targetY] };
  }

  if (geometry.type === "MultiPoint") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((point) => {
        const [x, y] = point;
        const [targetX, targetY] = proj4(sourceCrsCode, targetCrsCode, [x, y]);
        return [targetX, targetY];
      }),
    };
  }

  if (geometry.type === "LineString") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((point) => {
        const [x, y] = point;
        const [targetX, targetY] = proj4(sourceCrsCode, targetCrsCode, [x, y]);
        return [targetX, targetY];
      }),
    };
  }

  if (geometry.type === "MultiLineString") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((line) =>
        line.map((point) => {
          const [x, y] = point;
          const [targetX, targetY] = proj4(sourceCrsCode, targetCrsCode, [x, y]);
          return [targetX, targetY];
        }),
      ),
    };
  }

  if (geometry.type === "Polygon") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((ring) =>
        ring.map((point) => {
          const [x, y] = point;
          const [targetX, targetY] = proj4(sourceCrsCode, targetCrsCode, [x, y]);
          return [targetX, targetY];
        }),
      ),
    };
  }

  if (geometry.type === "MultiPolygon") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) =>
        polygon.map((ring) =>
          ring.map((point) => {
            const [x, y] = point;
            const [targetX, targetY] = proj4(sourceCrsCode, targetCrsCode, [x, y]);
            return [targetX, targetY];
          }),
        ),
      ),
    };
  }

  if (geometry.type === "GeometryCollection") {
    return {
      ...geometry,
      geometries: geometry.geometries.map((childGeometry) => transformGeometry(childGeometry, sourceCrsCode, targetCrsCode)),
    };
  }

  return geometry;
}

function parseJsonToGeoJson(raw: string): FeatureCollection<Geometry, GeoJsonProperties> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The file is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
    throw new Error("JSON does not contain a valid GeoJSON object.");
  }

  const geojson = parsed as FeatureCollection<Geometry, GeoJsonProperties> | AnyFeature;
  if (geojson.type !== "Feature" && geojson.type !== "FeatureCollection") {
    throw new Error("Only GeoJSON Feature or FeatureCollection is supported.");
  }

  return transformToTargetCrs(toFeatureCollection(geojson));
}

function parseKmlToGeoJson(raw: string): FeatureCollection<Geometry, GeoJsonProperties> {
  const dom = new DOMParser().parseFromString(raw, "application/xml");
  const converted = kmlToGeoJson(dom) as FeatureCollection<Geometry, GeoJsonProperties>;
  return transformToTargetCrs(converted);
}

export async function parseVectorFile(fileOrFiles: File | File[]): Promise<ParsedVectorFile> {
  const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
  const lowerNames = files.map((file) => file.name.toLowerCase());

  if (lowerNames.some((name) => name.endsWith(".zip"))) {
    const zipFile = files.find((file) => file.name.toLowerCase().endsWith(".zip"));
    if (!zipFile) {
      throw new Error("The selected zip archive could not be read.");
    }

    const buffer = await zipFile.arrayBuffer();
    const parsed = await shp(buffer);

    return {
      fileName: zipFile.name,
      geojson: transformToTargetCrs(
        normalizeShapefileResult(parsed as FeatureCollection<Geometry, GeoJsonProperties>),
      ),
    };
  }

  if (lowerNames.some((name) => name.endsWith(".shp"))) {
    const shapefileFile = files.find((file) => file.name.toLowerCase().endsWith(".shp"));
    if (!shapefileFile) {
      throw new Error("The selected shapefile could not be read.");
    }

    if (files.length > 1) {
      const zip = new JSZip();
      for (const file of files) {
        zip.file(file.name, new Uint8Array(await file.arrayBuffer()));
      }

      const archiveBuffer = await zip.generateAsync({ type: "arraybuffer" });
      const parsed = await shp(archiveBuffer);

      return {
        fileName: shapefileFile.name,
        geojson: transformToTargetCrs(
          normalizeShapefileResult(parsed as FeatureCollection<Geometry, GeoJsonProperties>),
        ),
      };
    }

    throw new Error("Please upload the full shapefile bundle (.shp + .dbf + .shx) or a .zip archive.");
  }

  if (lowerNames.some((name) => name.endsWith(".geojson") || name.endsWith(".json"))) {
    const jsonFile = files.find((file) => file.name.toLowerCase().endsWith(".geojson") || file.name.toLowerCase().endsWith(".json"));
    if (!jsonFile) {
      throw new Error("The selected GeoJSON file could not be read.");
    }

    const text = await jsonFile.text();
    return {
      fileName: jsonFile.name,
      geojson: parseJsonToGeoJson(text),
    };
  }

  if (lowerNames.some((name) => name.endsWith(".kml"))) {
    const kmlFile = files.find((file) => file.name.toLowerCase().endsWith(".kml"));
    if (!kmlFile) {
      throw new Error("The selected KML file could not be read.");
    }

    const text = await kmlFile.text();
    return {
      fileName: kmlFile.name,
      geojson: parseKmlToGeoJson(text),
    };
  }

  throw new Error("Unsupported file type. Use .zip, .geojson, .json, .kml, or a shapefile bundle.");
}