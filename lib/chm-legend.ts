export const chmLegend = {
  scheme: "Canopy Height Model",
  breaks: [0, 4, 8, 12, 16, 19, 23, 27, 30],
  colors: [
    "#440154",
    "#472c7a",
    "#3b518b",
    "#2c718e",
    "#21918c",
    "#27ad81",
    "#5cc863",
    "#aadc32",
    "#fde725",
  ],
  labels: ["0", "4", "8", "12", "16", "19", "23", "27", "30"],
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

function buildColorLut(
  colors: ReadonlyArray<readonly [number, number, number]>,
  size = 256,
): Array<readonly [number, number, number]> {
  const lut: Array<readonly [number, number, number]> = new Array(size);

  for (let index = 0; index < size; index += 1) {
    const ratio = size > 1 ? index / (size - 1) : 0;
    const scaledIndex = ratio * (colors.length - 1);
    const lowerIndex = Math.floor(scaledIndex);
    const upperIndex = Math.min(colors.length - 1, lowerIndex + 1);
    const mix = scaledIndex - lowerIndex;

    const lowerColor = colors[lowerIndex] ?? colors[0] ?? [0, 0, 0];
    const upperColor = colors[upperIndex] ?? lowerColor;

    lut[index] = [
      interpolateChannel(lowerColor[0], upperColor[0], mix),
      interpolateChannel(lowerColor[1], upperColor[1], mix),
      interpolateChannel(lowerColor[2], upperColor[2], mix),
    ] as const;
  }

  return lut;
}

export const CHM_VIRIDIS_LUT = buildColorLut(chmLegendRgbColors);

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

export function getChmDisplayRgb(value: number): readonly [number, number, number] {
  const normalizedValue = normalizeRawChmToLegendValue(value);
  const max = chmLegend.breaks[chmLegend.breaks.length - 1] ?? 60;
  const ratio = max > 0 ? Math.max(0, Math.min(1, normalizedValue / max)) : 0;
  const lutIndex = Math.min(
    CHM_VIRIDIS_LUT.length - 1,
    Math.round(ratio * (CHM_VIRIDIS_LUT.length - 1)),
  );

  return CHM_VIRIDIS_LUT[lutIndex] ?? CHM_VIRIDIS_LUT[0] ?? [0, 0, 0];
}

export function getChmDisplayColor(value: number): string {
  return rgbToCss(getChmDisplayRgb(value));
}
