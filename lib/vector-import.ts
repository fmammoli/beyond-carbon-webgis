import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import { kml as kmlToGeoJson } from "@tmcw/togeojson";
import shp from "shpjs";

type AnyFeature = Feature<Geometry, GeoJsonProperties>;

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

  return toFeatureCollection(geojson);
}

function parseKmlToGeoJson(raw: string): FeatureCollection<Geometry, GeoJsonProperties> {
  const dom = new DOMParser().parseFromString(raw, "application/xml");
  const converted = kmlToGeoJson(dom) as FeatureCollection<Geometry, GeoJsonProperties>;
  return converted;
}

export async function parseVectorFile(file: File): Promise<ParsedVectorFile> {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".zip")) {
    const buffer = await file.arrayBuffer();
    const parsed = await shp(buffer);

    return {
      fileName: file.name,
      geojson: normalizeShapefileResult(parsed as FeatureCollection<Geometry, GeoJsonProperties>),
    };
  }

  if (lowerName.endsWith(".geojson") || lowerName.endsWith(".json")) {
    const text = await file.text();
    return {
      fileName: file.name,
      geojson: parseJsonToGeoJson(text),
    };
  }

  if (lowerName.endsWith(".kml")) {
    const text = await file.text();
    return {
      fileName: file.name,
      geojson: parseKmlToGeoJson(text),
    };
  }

  throw new Error("Unsupported file type. Use .zip, .geojson, .json, or .kml files.");
}