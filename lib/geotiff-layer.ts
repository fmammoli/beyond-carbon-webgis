import GeoTIFFSource from "ol/source/GeoTIFF";
import WebGLTile from "ol/layer/WebGLTile";

const CANOPY_COLOR_STOPS: Array<{ value: number; color: [number, number, number, number] }> = [
  { value: 0, color: [0, 0, 0, 0] },
  { value: 1, color: [30, 120, 45, 0.7] },
  { value: 15, color: [85, 180, 70, 0.8] },
  { value: 30, color: [180, 210, 80, 0.85] },
  { value: 45, color: [245, 175, 55, 0.9] },
  { value: 60, color: [220, 75, 35, 0.95] },
];

const DEFAULT_CANOPY_OPACITY = 0.95;

export interface GeoTIFFLayerResult {
  layer: WebGLTile;
  source: GeoTIFFSource;
}

function buildCanopyColorRampExpression() {
  const expression: Array<number | string | (number | string)[]> = [
    "interpolate",
    ["linear"],
    ["band", 1],
  ];

  for (const stop of CANOPY_COLOR_STOPS) {
    expression.push(stop.value);
    expression.push(["color", ...stop.color]);
  }

  return expression;
}

export async function createGeoTIFFLayer(
  url: string,
  layerName: string,
): Promise<GeoTIFFLayerResult | null> {
  try {
    console.log("Creating GeoTIFF layer for URL:", url);

    let sourceConfig: { url?: string; blob?: Blob };

    // Support both blob URLs and direct static URLs from /public.
    if (url.startsWith("blob:")) {
      console.log("Fetching blob URL to get Blob object:", url);
      const response = await fetch(url);
      const blob = await response.blob();
      console.log("Blob fetched, size:", blob.size);
      sourceConfig = { blob };
    } else {
      sourceConfig = { url };
      console.log("Using direct GeoTIFF URL:", sourceConfig.url);
    }

    // Create GeoTIFF source with either blob or URL
    const source = new GeoTIFFSource({
      sources: [sourceConfig],
      normalize: false,
    });
    console.log("GeoTIFFSource created");

    const layer = new WebGLTile({
      source,
      style: {
        color: buildCanopyColorRampExpression(),
      },
      properties: {
        name: layerName,
        isCanopyLayer: true,
      },
      opacity: DEFAULT_CANOPY_OPACITY,
      zIndex: 1000,
    });
    
    console.log("WebGLTile layer created:", layerName);

    return { layer, source };
  } catch (error) {
    console.error("Failed to create GeoTIFF layer:", error);
    return null;
  }
}

export { CANOPY_COLOR_STOPS, DEFAULT_CANOPY_OPACITY };
