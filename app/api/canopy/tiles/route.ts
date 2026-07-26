import { NextResponse } from "next/server";
import type { FeatureCollection, Geometry, GeoJsonProperties } from "geojson";

const S3_BUCKET = "dataforgood-fb-data";
const S3_REGION = "us-east-1";
const DATASET_PATH = "forests/v2/global/dinov3_global_chm_v2_ml3";

function getS3Url(key: string): string {
  // Use path-style URL to avoid regional issues
  return `https://s3.us-east-1.amazonaws.com/${S3_BUCKET}/${key}`;
}

export async function GET() {
  try {
    const tilesUrl = getS3Url(`${DATASET_PATH}/tiles.geojson`);
    console.log("Fetching tiles from:", tilesUrl);

    const response = await fetch(tilesUrl, {
      redirect: "follow",
      headers: {
        "Accept": "application/json",
      },
    });

    console.log("Response status:", response.status, response.statusText);

    if (!response.ok) {
      const text = await response.text();
      console.error("S3 response error:", text);
      return NextResponse.json(
        { error: `Failed to fetch tiles from S3: ${response.statusText}`, status: response.status },
        { status: response.status },
      );
    }

    const data = (await response.json()) as FeatureCollection<Geometry, GeoJsonProperties>;
    console.log("Successfully fetched tiles, features count:", data.features?.length);
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error fetching tiles:", message, error);
    return NextResponse.json({ error: `Failed to fetch tiles: ${message}` }, { status: 500 });
  }
}
