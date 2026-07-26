import { bbox } from "@turf/turf";
import type { FeatureCollection, Geometry, GeoJsonProperties } from "geojson";

const S3_BUCKET = "dataforgood-fb-data";
const S3_REGION = "us-east-1";
const DATASET_PATH = "forests/v2/global/dinov3_global_chm_v2_ml3";

export function getS3Url(key: string): string {
  // Use path-style URL to avoid regional issues
  return `https://s3.us-east-1.amazonaws.com/${S3_BUCKET}/${key}`;
}

export async function getTilesGeoJson(): Promise<FeatureCollection<Geometry, GeoJsonProperties>> {
  // Fetch tiles through our Next.js API route (no CORS issues)
  const response = await fetch("/api/canopy/tiles");
  if (!response.ok) {
    throw new Error(`Failed to fetch tiles: ${response.statusText}`);
  }
  return response.json() as Promise<FeatureCollection<Geometry, GeoJsonProperties>>;
}

export async function findIntersectingTiles(
  geojson: FeatureCollection<Geometry, GeoJsonProperties>,
): Promise<string[]> {
  try {
    // Get bounding box of the uploaded geometry
    const [minLon, minLat, maxLon, maxLat] = bbox(geojson);

    // Fetch tiles GeoJSON from S3
    const tilesGeoJson = await getTilesGeoJson();

    // Find tiles that intersect with the bounding box
    const intersectingTiles: string[] = [];

    for (const feature of tilesGeoJson.features) {
      const tileBbox = bbox(feature);
      const [tileMinLon, tileMinLat, tileMaxLon, tileMaxLat] = tileBbox;

      // Check if bounding boxes intersect
      const intersects =
        !(maxLon < tileMinLon || minLon > tileMaxLon || maxLat < tileMinLat || minLat > tileMaxLat);

      if (intersects) {
        const quadkey = feature.properties?.quadkey || feature.properties?.tile;
        if (quadkey) {
          intersectingTiles.push(quadkey);
        }
      }
    }

    return intersectingTiles;
  } catch (error) {
    console.error("Error finding intersecting tiles:", error);
    return [];
  }
}

export function getCanopyTileUrls(quadkeys: string[]): string[] {
  return quadkeys.map((quadkey) => getS3Url(`${DATASET_PATH}/chm/${quadkey}.tif`));
}

export async function getCanopyTileUrlsForGeometry(
  geojson: FeatureCollection<Geometry, GeoJsonProperties>,
): Promise<string[]> {
  const quadkeys = await findIntersectingTiles(geojson);
  return getCanopyTileUrls(quadkeys);
}
