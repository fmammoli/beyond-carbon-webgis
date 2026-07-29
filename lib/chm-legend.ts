export const chmLegend = {
  scheme: "Canopy Height Model",
  breaks: [0, 1, 15, 30, 45, 60],
  colors: ["#000000", "#1e782d", "#55b446", "#b4d250", "#f5af37", "#dc4b23"],
  labels: ["0", "1 - 15", "15 - 30", "30 - 45", "45 - 60", "> 60"],
} as const;

export const CHM_SCALE_FACTOR = 1;
export const CHM_TRANSPARENT_RAW_THRESHOLD = 0;

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.trim().replace("#", "");
  if (normalized.length !== 6) {
    return [0, 0, 0];
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) {
    return [0, 0, 0];
  }

  return [red, green, blue];
}

export const chmLegendRgbColors = chmLegend.colors.map((hexColor) => hexToRgb(hexColor));

function rgbToCss(rgb: readonly [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function interpolateChannel(start: number, end: number, t: number): number {
  return Math.round(start + (end - start) * t);
}

export function normalizeRawChmToLegendValue(rawValue: number): number {
  const min = chmLegend.breaks[0];
  const max = chmLegend.breaks[chmLegend.breaks.length - 1];
  const encodedValue = Math.max(0, rawValue);
  return Math.max(min, Math.min(max, encodedValue));
}

export function getChmDisplayColor(value: number): string {
  const normalizedValue = normalizeRawChmToLegendValue(value);
  const max = chmLegend.breaks[chmLegend.breaks.length - 1] ?? 60;
  const ratio = max > 0 ? Math.max(0, Math.min(1, normalizedValue / max)) : 0;
  const scaledIndex = ratio * (chmLegendRgbColors.length - 1);
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.min(chmLegendRgbColors.length - 1, lowerIndex + 1);
  const mix = scaledIndex - lowerIndex;

  const lowerColor = chmLegendRgbColors[lowerIndex] ?? chmLegendRgbColors[0] ?? [0, 0, 0];
  const upperColor = chmLegendRgbColors[upperIndex] ?? lowerColor;

  return rgbToCss([
    interpolateChannel(lowerColor[0], upperColor[0], mix),
    interpolateChannel(lowerColor[1], upperColor[1], mix),
    interpolateChannel(lowerColor[2], upperColor[2], mix),
  ]);
}
