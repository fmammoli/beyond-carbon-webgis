import type Map from "ol/Map";
import { transform } from "ol/proj";

export type ThreatMapPixelRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  centerLonLat: [number, number];
  fitsViewport: boolean;
};

const KM_PER_DEGREE_LAT = 110.574;
const KM_PER_DEGREE_LON_AT_EQUATOR = 111.320;

function getLongitudeKmPerDegree(latitudeDegrees: number): number {
  const latitudeRadians = (latitudeDegrees * Math.PI) / 180;
  const scaled = KM_PER_DEGREE_LON_AT_EQUATOR * Math.cos(latitudeRadians);
  return Math.max(Math.abs(scaled), 0.000001);
}

export function getThreatMapPixelRect(
  map: Map,
  sideKilometers: number,
): ThreatMapPixelRect | null {
  const mapSize = map.getSize();
  if (!mapSize) {
    return null;
  }

  const center3857 = map.getView().getCenter();
  if (!center3857) {
    return null;
  }

  const centerLonLat = transform(center3857, "EPSG:3857", "EPSG:4326") as [number, number];
  const halfSideKm = sideKilometers / 2;
  const lonKmPerDegree = getLongitudeKmPerDegree(centerLonLat[1]);
  const halfSideLonDegrees = halfSideKm / lonKmPerDegree;
  const halfSideLatDegrees = halfSideKm / KM_PER_DEGREE_LAT;

  const leftLonLat: [number, number] = [centerLonLat[0] - halfSideLonDegrees, centerLonLat[1]];
  const rightLonLat: [number, number] = [centerLonLat[0] + halfSideLonDegrees, centerLonLat[1]];
  const topLonLat: [number, number] = [centerLonLat[0], centerLonLat[1] + halfSideLatDegrees];
  const bottomLonLat: [number, number] = [centerLonLat[0], centerLonLat[1] - halfSideLatDegrees];

  const leftPixel = map.getPixelFromCoordinate(transform(leftLonLat, "EPSG:4326", "EPSG:3857"));
  const rightPixel = map.getPixelFromCoordinate(transform(rightLonLat, "EPSG:4326", "EPSG:3857"));
  const topPixel = map.getPixelFromCoordinate(transform(topLonLat, "EPSG:4326", "EPSG:3857"));
  const bottomPixel = map.getPixelFromCoordinate(transform(bottomLonLat, "EPSG:4326", "EPSG:3857"));

  const width = Math.max(1, Math.abs(rightPixel[0] - leftPixel[0]));
  const height = Math.max(1, Math.abs(bottomPixel[1] - topPixel[1]));
  const centerX = mapSize[0] / 2;
  const centerY = mapSize[1] / 2;

  const left = centerX - width / 2;
  const top = centerY - height / 2;

  const fitsViewport = left >= 0 && top >= 0 && left + width <= mapSize[0] && top + height <= mapSize[1];

  return {
    left,
    top,
    width,
    height,
    centerLonLat,
    fitsViewport,
  };
}

export function captureCompositedMapCanvas(map: Map): HTMLCanvasElement | null {
  const mapSize = map.getSize();
  if (!mapSize) {
    return null;
  }

  const pixelRatio = Math.max(1, map.getPixelRatio() || 1);

  const composedCanvas = document.createElement("canvas");
  composedCanvas.width = Math.max(1, Math.round(mapSize[0] * pixelRatio));
  composedCanvas.height = Math.max(1, Math.round(mapSize[1] * pixelRatio));

  const context = composedCanvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.imageSmoothingEnabled = false;

  const viewport = map.getViewport();
  const layerCanvases = viewport.querySelectorAll<HTMLCanvasElement>(".ol-layer canvas, canvas.ol-layer");

  for (const layerCanvas of layerCanvases) {
    if (layerCanvas.width === 0 || layerCanvas.height === 0) {
      continue;
    }

    const parentElement = layerCanvas.parentElement as HTMLElement | null;
    const opacity = parentElement?.style.opacity;
    context.globalAlpha = opacity === "" || opacity === undefined ? 1 : Number.parseFloat(opacity);

    const transformStyle = layerCanvas.style.transform;
    if (transformStyle?.startsWith("matrix(")) {
      const matrix = transformStyle
        .slice("matrix(".length, -1)
        .split(",")
        .map((value) => Number.parseFloat(value.trim()));

      if (matrix.length === 6) {
        context.setTransform(
          matrix[0]! * pixelRatio,
          matrix[1]! * pixelRatio,
          matrix[2]! * pixelRatio,
          matrix[3]! * pixelRatio,
          matrix[4]! * pixelRatio,
          matrix[5]! * pixelRatio,
        );
      } else {
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      }
    } else {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    context.drawImage(layerCanvas, 0, 0);
  }

  context.globalAlpha = 1;
  context.setTransform(1, 0, 0, 1, 0, 0);

  return composedCanvas;
}
