import type Map from "ol/Map";

import type { ActiveLegendLayer } from "@/components/gis/legend";
import { agbLegend } from "@/lib/agb-legend";
import { chmLegend } from "@/lib/chm-legend";
import { MAPBIOMAS_CLASSES } from "@/lib/mapbiomas-colors";
import { captureCompositedMapCanvas } from "@/lib/threat-map-export";

const LEGEND_PADDING = 16;
const LEGEND_LINE_HEIGHT = 18;
const LEGEND_SECTION_GAP = 14;
const LEGEND_COLUMN_GAP = 24;
const LEGEND_TITLE_FONT = "600 18px 'Segoe UI', sans-serif";
const LEGEND_LAYER_FONT = "600 14px 'Segoe UI', sans-serif";
const LEGEND_TEXT_FONT = "12px 'Segoe UI', sans-serif";
const LEGEND_MUTED_TEXT = "#475569";
const LEGEND_BORDER = "#cbd5e1";
const LEGEND_BACKGROUND = "rgba(255,255,255,0.96)";
const FALLBACK_FOCUS_SIDE_RATIO = 0.42;

type MapCaptureLegendContext = {
  isSatelliteVisible: boolean;
  isBoundariesAndPlacesVisible: boolean;
  year: number;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function getMapCaptureFilename(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const min = pad2(date.getMinutes());
  return `map-capture-${yyyy}-${mm}-${dd}-${hh}${min}.png`;
}

function estimateLegendHeight(
  activeLayers: ActiveLegendLayer[],
  legendContext: MapCaptureLegendContext,
): number {
  let headerHeight = LEGEND_LINE_HEIGHT * 2 + 6;
  headerHeight += LEGEND_LINE_HEIGHT;

  if (legendContext.isSatelliteVisible) {
    headerHeight += LEGEND_LINE_HEIGHT;
  }

  if (legendContext.isBoundariesAndPlacesVisible) {
    headerHeight += LEGEND_LINE_HEIGHT;
  }

  headerHeight += 6;

  if (activeLayers.length === 0) {
    return LEGEND_PADDING * 2 + 8 + headerHeight + LEGEND_LINE_HEIGHT * 2;
  }

  const columns = splitLayersIntoColumns(activeLayers);
  const leftColumnHeight = columns.left.reduce((sum, layer) => sum + getLayerLegendHeight(layer), 0);
  const rightColumnHeight = columns.right.reduce((sum, layer) => sum + getLayerLegendHeight(layer), 0);
  const columnsHeight = Math.max(leftColumnHeight, rightColumnHeight);

  return LEGEND_PADDING * 2 + 8 + headerHeight + columnsHeight;
}

function getLayerLegendHeight(layer: ActiveLegendLayer): number {
  let lines = 1;

  if (layer.kind === "landcover") {
    lines += MAPBIOMAS_CLASSES.length;
  } else if (layer.kind === "agb") {
    lines += agbLegend.labels.length;
  } else if (layer.kind === "chm") {
    lines += chmLegend.labels.length;
  } else if (layer.kind === "vector") {
    if (layer.groupingColumn && layer.groups && layer.groups.length > 0) {
      lines += 1 + layer.groups.length;
    } else {
      lines += 2;
    }
  }

  return lines * LEGEND_LINE_HEIGHT + LEGEND_SECTION_GAP;
}

function splitLayersIntoColumns(activeLayers: ActiveLegendLayer[]): {
  left: ActiveLegendLayer[];
  right: ActiveLegendLayer[];
} {
  const left: ActiveLegendLayer[] = [];
  const right: ActiveLegendLayer[] = [];
  let leftHeight = 0;
  let rightHeight = 0;

  for (const layer of activeLayers) {
    const layerHeight = getLayerLegendHeight(layer);
    if (leftHeight <= rightHeight) {
      left.push(layer);
      leftHeight += layerHeight;
    } else {
      right.push(layer);
      rightHeight += layerHeight;
    }
  }

  return { left, right };
}

function drawLegendHeader(context: CanvasRenderingContext2D, x: number, y: number): number {
  context.fillStyle = "#0f172a";
  context.font = LEGEND_TITLE_FONT;
  context.fillText("Layer Legend / Legenda Layer", x, y);

  context.font = LEGEND_TEXT_FONT;
  context.fillStyle = LEGEND_MUTED_TEXT;
  context.fillText("Visible layers at capture time / Layer terlihat saat tangkapan", x, y + LEGEND_LINE_HEIGHT);

  return y + LEGEND_LINE_HEIGHT * 2 + 6;
}

function drawLegendContext(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  legendContext: MapCaptureLegendContext,
): number {
  context.font = LEGEND_TEXT_FONT;
  context.fillStyle = LEGEND_MUTED_TEXT;
  context.fillText(`Year / Tahun: ${legendContext.year}`, x, y);
  y += LEGEND_LINE_HEIGHT;

  if (legendContext.isSatelliteVisible) {
    context.fillText("Base map / Peta dasar: Satellite / Satelit", x, y);
    y += LEGEND_LINE_HEIGHT;
  }

  if (legendContext.isBoundariesAndPlacesVisible) {
    context.fillText("Reference labels / Label referensi: Boundaries & places / Batas dan tempat", x, y);
    y += LEGEND_LINE_HEIGHT;
  }

  return y + 6;
}

function drawLegendSwatch(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  label: string,
  opacity = 1,
): number {
  context.save();
  context.globalAlpha = opacity;
  context.fillStyle = color;
  context.fillRect(x, y - 10, 14, 14);
  context.restore();

  context.strokeStyle = "#94a3b8";
  context.lineWidth = 1;
  context.strokeRect(x, y - 10, 14, 14);

  context.font = LEGEND_TEXT_FONT;
  context.fillStyle = "#0f172a";
  context.fillText(label, x + 22, y + 1);

  return y + LEGEND_LINE_HEIGHT;
}

function drawRasterStops(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  colors: readonly string[],
  labels: readonly string[],
): number {
  const stops = Math.min(colors.length, labels.length);

  for (let i = 0; i < stops; i += 1) {
    y = drawLegendSwatch(context, x, y, colors[i] ?? "#94a3b8", labels[i] ?? "-");
  }

  return y;
}

function drawLayerLegend(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  layer: ActiveLegendLayer,
): number {
  context.fillStyle = "#0f172a";
  context.font = LEGEND_LAYER_FONT;
  const bilingualTitle = layer.titleId
    && layer.titleId.toLowerCase() !== layer.title.toLowerCase()
    ? `${layer.title} / ${layer.titleId}`
    : layer.title;
  context.fillText(bilingualTitle, x, y);
  y += LEGEND_LINE_HEIGHT;

  if (layer.kind === "landcover") {
    for (const item of MAPBIOMAS_CLASSES) {
      const englishLabel = item.label.replace(/^\d+\.\d+\s*/, "").trim();
      const indonesianLabel = item.labelId.replace(/^\d+\.\d+\s*/, "").trim();
      const bilingualLabel = indonesianLabel
        && indonesianLabel.toLowerCase() !== englishLabel.toLowerCase()
        ? `${englishLabel} / ${indonesianLabel}`
        : englishLabel;
      y = drawLegendSwatch(context, x, y, item.color, bilingualLabel);
    }
  } else if (layer.kind === "agb") {
    y = drawRasterStops(context, x, y, agbLegend.colors, agbLegend.labels);
  } else if (layer.kind === "chm") {
    y = drawRasterStops(context, x, y, chmLegend.colors, chmLegend.labels);
  } else {
    if (layer.groupingColumn && layer.groups && layer.groups.length > 0) {
      context.font = LEGEND_TEXT_FONT;
      context.fillStyle = LEGEND_MUTED_TEXT;
      context.fillText(`Grouped by / Dikelompokkan berdasarkan: ${layer.groupingColumn}`, x, y);
      y += LEGEND_LINE_HEIGHT;

      const groups = layer.groups
        .slice()
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

      for (const group of groups) {
        y = drawLegendSwatch(
          context,
          x,
          y,
          group.color,
          `${group.value} (${group.count})`,
          layer.fillOpacity,
        );
      }
    } else {
      const baseColor = layer.baseColor ?? "#ff3b30";
      y = drawLegendSwatch(context, x, y, baseColor, "Boundary stroke / Garis batas");
      y = drawLegendSwatch(
        context,
        x,
        y,
        baseColor,
        `Polygon fill / Isi poligon (${Math.round(layer.fillOpacity * 100)}%)`,
        layer.fillOpacity,
      );
    }
  }

  return y + LEGEND_SECTION_GAP;
}

function drawLegendPanel(
  context: CanvasRenderingContext2D,
  panelX: number,
  panelY: number,
  panelWidth: number,
  panelHeight: number,
  activeLayers: ActiveLegendLayer[],
  legendContext: MapCaptureLegendContext,
): void {
  context.fillStyle = LEGEND_BACKGROUND;
  context.fillRect(panelX, panelY, panelWidth, panelHeight);

  context.strokeStyle = LEGEND_BORDER;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(panelX, panelY);
  context.lineTo(panelX + panelWidth, panelY);
  context.stroke();

  const contentX = panelX + LEGEND_PADDING;
  const contentWidth = Math.max(0, panelWidth - LEGEND_PADDING * 2);
  const columnWidth = Math.max(1, Math.floor((contentWidth - LEGEND_COLUMN_GAP) / 2));
  let cursorY = panelY + LEGEND_PADDING + 8;
  cursorY = drawLegendHeader(context, contentX, cursorY);
  cursorY = drawLegendContext(context, contentX, cursorY, legendContext);

  if (activeLayers.length === 0) {
    context.font = LEGEND_TEXT_FONT;
    context.fillStyle = LEGEND_MUTED_TEXT;
    context.fillText("No visible thematic layers / Tidak ada layer tematik terlihat", contentX, cursorY + LEGEND_LINE_HEIGHT);
    return;
  }

  const columns = splitLayersIntoColumns(activeLayers);
  let leftCursorY = cursorY;
  let rightCursorY = cursorY;
  const rightColumnX = contentX + columnWidth + LEGEND_COLUMN_GAP;

  context.save();
  context.beginPath();
  context.rect(contentX, panelY, columnWidth, panelHeight);
  context.clip();
  for (const layer of columns.left) {
    leftCursorY = drawLayerLegend(context, contentX, leftCursorY, layer);
  }
  context.restore();

  context.save();
  context.beginPath();
  context.rect(rightColumnX, panelY, columnWidth, panelHeight);
  context.clip();
  for (const layer of columns.right) {
    rightCursorY = drawLayerLegend(context, rightColumnX, rightCursorY, layer);
  }
  context.restore();
}

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/png");
  });

  if (!blob) {
    throw new Error("Failed to encode PNG blob from canvas.");
  }

  return blob;
}

export type MapCaptureResult = {
  blob: Blob;
  filename: string;
};

type FocusRect = {
  left: number;
  top: number;
  side: number;
};

export type CaptureMapScreenFocusRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  fitsViewport: boolean;
};

function getCaptureMapScreenFocusRectFromSize(
  viewportWidth: number,
  viewportHeight: number,
): CaptureMapScreenFocusRect {
  const side = Math.max(1, Math.round(Math.min(viewportWidth, viewportHeight) * FALLBACK_FOCUS_SIDE_RATIO));
  const left = Math.round((viewportWidth - side) / 2);
  const top = Math.round((viewportHeight - side) / 2);

  return {
    left,
    top,
    width: side,
    height: side,
    fitsViewport: side <= viewportWidth && side <= viewportHeight,
  };
}

export function getCaptureMapScreenFocusRect(map: Map): CaptureMapScreenFocusRect | null {
  const mapSize = map.getSize();
  if (!mapSize || mapSize[0] <= 0 || mapSize[1] <= 0) {
    return null;
  }

  return getCaptureMapScreenFocusRectFromSize(mapSize[0], mapSize[1]);
}

function resolveFocusRect(map: Map, mapCanvas: HTMLCanvasElement): FocusRect {
  const mapSize = map.getSize();
  const mapWidthPx = mapCanvas.width;
  const mapHeightPx = mapCanvas.height;

  const fallbackSide = Math.max(1, Math.round(Math.min(mapWidthPx, mapHeightPx) * FALLBACK_FOCUS_SIDE_RATIO));
  if (!mapSize || mapSize[0] <= 0 || mapSize[1] <= 0) {
    return {
      left: Math.round((mapWidthPx - fallbackSide) / 2),
      top: Math.round((mapHeightPx - fallbackSide) / 2),
      side: fallbackSide,
    };
  }

  const capturePixelRatio = Math.max(1, mapWidthPx / mapSize[0]);
  const screenFocusRect = getCaptureMapScreenFocusRectFromSize(mapSize[0], mapSize[1]);
  const side = Math.max(1, Math.round(screenFocusRect.width * capturePixelRatio));
  const clampedSide = Math.min(side, mapWidthPx, mapHeightPx);
  const left = Math.round((mapWidthPx - clampedSide) / 2);
  const top = Math.round((mapHeightPx - clampedSide) / 2);

  return {
    left,
    top,
    side: clampedSide,
  };
}

export async function captureMapWithLegendPng(
  map: Map,
  activeLegendLayers: ActiveLegendLayer[],
  legendContext: MapCaptureLegendContext,
): Promise<MapCaptureResult> {
  const mapCanvas = captureCompositedMapCanvas(map);
  if (!mapCanvas) {
    throw new Error("Map is not ready for capture.");
  }

  const focusRect = resolveFocusRect(map, mapCanvas);
  const cropSize = Math.max(1, focusRect.side);
  const legendHeightEstimate = estimateLegendHeight(activeLegendLayers, legendContext);
  const width = cropSize;
  const height = cropSize + legendHeightEstimate;

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = width;
  exportCanvas.height = height;

  const context = exportCanvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to initialize canvas context for export.");
  }

  context.imageSmoothingEnabled = false;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  // Export only the focused map square so the saved PNG matches user-selected focus.
  context.drawImage(
    mapCanvas,
    focusRect.left,
    focusRect.top,
    cropSize,
    cropSize,
    0,
    0,
    cropSize,
    cropSize,
  );

  drawLegendPanel(
    context,
    0,
    cropSize,
    width,
    legendHeightEstimate,
    activeLegendLayers,
    legendContext,
  );

  const blob = await canvasToPngBlob(exportCanvas);

  return {
    blob,
    filename: getMapCaptureFilename(),
  };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
