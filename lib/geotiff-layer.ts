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

    // Create GeoTIFF source directly from S3 URL (no proxy needed)
    const source = new GeoTIFFSource({
      sources: [
        {
          url: url,
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
