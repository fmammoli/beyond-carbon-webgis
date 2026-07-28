export const agbLegend = {
  scheme: "Aboveground Biomass Density",
  breaks: [0, 50, 100, 150, 200, 250, 300],
  colors: ["#ffffff", "#f5efcf", "#ded37a", "#9ecd68", "#4fa35f", "#1f3a93"],
  labels: [
    "0 - 50",
    "50 - 100",
    "100 - 150",
    "150 - 200",
    "200 - 250",
    "> 300",
  ],
} as const;

export const AGB_SCALE_FACTOR = 1;
export const AGB_TRANSPARENT_RAW_THRESHOLD = 1;

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

export const agbLegendRgbColors = agbLegend.colors.map((hexColor) => hexToRgb(hexColor));

function rgbToCss(rgb: readonly [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function interpolateChannel(start: number, end: number, t: number): number {
  return Math.round(start + (end - start) * t);
}

export function getAgbDisplayColor(value: number): string {
  const normalizedValue = normalizeRawAgbToLegendValue(value);
  const max = agbLegend.breaks[agbLegend.breaks.length - 1] ?? 300;
  const ratio = max > 0 ? Math.max(0, Math.min(1, normalizedValue / max)) : 0;
  const scaledIndex = ratio * (agbLegendRgbColors.length - 1);
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.min(agbLegendRgbColors.length - 1, lowerIndex + 1);
  const mix = scaledIndex - lowerIndex;

  const lowerColor = agbLegendRgbColors[lowerIndex] ?? agbLegendRgbColors[0] ?? [255, 255, 255];
  const upperColor = agbLegendRgbColors[upperIndex] ?? lowerColor;

  return rgbToCss([
    interpolateChannel(lowerColor[0], upperColor[0], mix),
    interpolateChannel(lowerColor[1], upperColor[1], mix),
    interpolateChannel(lowerColor[2], upperColor[2], mix),
  ]);
}

export function normalizeRawAgbToLegendValue(rawValue: number): number {
  const min = agbLegend.breaks[0];
  const max = agbLegend.breaks[agbLegend.breaks.length - 1];
  const encodedValue = Math.max(0, rawValue);
  return Math.max(min, Math.min(max, encodedValue));
}

export function getAgbLegendColorIndex(value: number): number {
  const breaks = agbLegend.breaks;

  for (let index = 0; index < breaks.length - 1; index += 1) {
    const lower = breaks[index];
    const upper = breaks[index + 1];
    const isLastBin = index === breaks.length - 2;

    if (value >= lower && (isLastBin ? value <= upper : value < upper)) {
      return index;
    }
  }

  if (value < breaks[0]) {
    return 0;
  }

  return breaks.length - 2;
}
