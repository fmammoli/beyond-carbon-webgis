import GeoTIFFSource from "ol/source/GeoTIFF";
import WebGLTile from "ol/layer/WebGLTile";

export interface GeoTIFFLayerResult {
  layer: WebGLTile;
  source: GeoTIFFSource;
}

export async function createGeoTIFFLayer(
  url: string,
  layerName: string,
): Promise<GeoTIFFLayerResult | null> {
  try {
    console.log("Creating GeoTIFF layer for URL:", url);

    // Extract the S3 key from the URL (remove bucket name)
    // URL format: https://s3.us-east-1.amazonaws.com/dataforgood-fb-data/forests/...
    // We need: forests/v2/global/dinov3_global_chm_v2_ml3/...
    const fullPath = url.split("amazonaws.com/")[1];
    if (!fullPath) {
      throw new Error(`Invalid S3 URL: ${url}`);
    }
    
    // Remove the bucket name (first path segment)
    const key = fullPath.split("/").slice(1).join("/");
    if (!key) {
      throw new Error(`Could not extract key from URL: ${url}`);
    }

    // Use the proxy endpoint for CORS-safe access
    const proxyUrl = `/api/geofile?key=${encodeURIComponent(key)}`;
    console.log("Using proxy URL:", proxyUrl);

    // Create GeoTIFF source with the proxy URL
    const source = new GeoTIFFSource({
      sources: [
        {
          url: proxyUrl,
        },
      ],
    });
    console.log("GeoTIFFSource created");

    // Create WebGLTile layer with color mapping for canopy height
    const layer = new WebGLTile({
      source,
      style: {
        color: [
          "interpolate",
          ["linear"],
          ["band", 1],
          0, "#000000",      // 0m - black
          10, "#006600",     // 10m - dark green
          20, "#00cc00",     // 20m - green
          30, "#ccff00",     // 30m - yellow-green
          40, "#ffcc00",     // 40m - yellow
          50, "#ff8800",     // 50m - orange
          60, "#ff0000",     // 60m+ - red
        ],
      },
      properties: {
        name: layerName,
        isCanopyLayer: true,
      },
    });
    
    console.log("WebGLTile layer created:", layerName);

    return { layer, source };
  } catch (error) {
    console.error("Failed to create GeoTIFF layer:", error);
    return null;
  }
}
