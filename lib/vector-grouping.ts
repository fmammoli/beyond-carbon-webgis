type PropertyBag = Record<string, unknown>;

const EXCLUDED_KEYS = new Set(["geometry"]);
const EMPTY_GROUP_LABEL = "(empty)";

const DEFAULT_GROUP_PALETTE = [
  "#e76f51",
  "#2a9d8f",
  "#e9c46a",
  "#264653",
  "#f4a261",
  "#1d3557",
  "#e63946",
  "#457b9d",
  "#8ab17d",
  "#6d597a",
  "#ff7f11",
  "#0f4c5c",
] as const;

type GroupableColumnOptions = {
  minDistinctValues?: number;
  maxDistinctValues?: number;
  maxDistinctRatio?: number;
  excludeLikelyIdColumns?: boolean;
};

const DEFAULT_MAX_DISTINCT_VALUES = 20;
const DEFAULT_MAX_DISTINCT_RATIO = 0.9;

function isLikelyIdColumn(columnName: string): boolean {
  return /(^id$|_id$|^fid$|^gid$|objectid|uuid|identifier|code$)/i.test(columnName);
}

function isPrimitiveLike(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function normalizeGroupValue(value: unknown): string {
  if (value === null || value === undefined) {
    return EMPTY_GROUP_LABEL;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? EMPTY_GROUP_LABEL : trimmed;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return EMPTY_GROUP_LABEL;
    }

    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return EMPTY_GROUP_LABEL;
}

export function getGroupableColumns(
  propertiesByFeature: PropertyBag[],
  options: GroupableColumnOptions = {},
): string[] {
  const minDistinctValues = options.minDistinctValues ?? 2;
  const maxDistinctValues = options.maxDistinctValues ?? DEFAULT_MAX_DISTINCT_VALUES;
  const maxDistinctRatio = options.maxDistinctRatio ?? DEFAULT_MAX_DISTINCT_RATIO;
  const excludeLikelyIdColumns = options.excludeLikelyIdColumns ?? true;

  if (propertiesByFeature.length === 0) {
    return [];
  }

  const valuesByKey = new Map<string, Set<string>>();

  for (const properties of propertiesByFeature) {
    for (const [key, rawValue] of Object.entries(properties)) {
      if (EXCLUDED_KEYS.has(key)) {
        continue;
      }

      if (!isPrimitiveLike(rawValue) && rawValue !== undefined) {
        continue;
      }

      const normalized = normalizeGroupValue(rawValue);
      const existing = valuesByKey.get(key) ?? new Set<string>();
      existing.add(normalized);
      valuesByKey.set(key, existing);
    }
  }

  const totalRows = propertiesByFeature.length;

  return Array.from(valuesByKey.entries())
    .filter(([key, values]) => {
      if (values.size < minDistinctValues) {
        return false;
      }

      if (excludeLikelyIdColumns && isLikelyIdColumn(key)) {
        return false;
      }

      if (values.size > maxDistinctValues) {
        return false;
      }

      const distinctRatio = totalRows > 0 ? values.size / totalRows : 1;
      if (distinctRatio > maxDistinctRatio) {
        return false;
      }

      return true;
    })
    .map(([key]) => key)
    .sort((a, b) => a.localeCompare(b));
}

function hashString(input: string): number {
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

export function buildGroupColorMap(
  groupValues: string[],
  palette: readonly string[] = DEFAULT_GROUP_PALETTE,
): Record<string, string> {
  const uniqueValues = Array.from(new Set(groupValues)).sort((a, b) => a.localeCompare(b));
  const colorMap: Record<string, string> = {};
  const usedPaletteIndexes = new Set<number>();

  for (const value of uniqueValues) {
    if (palette.length === 0) {
      colorMap[value] = "#ff3b30";
      continue;
    }

    const hashIndex = hashString(value) % palette.length;
    let paletteIndex = hashIndex;

    if (uniqueValues.length <= palette.length) {
      let probeCount = 0;
      while (usedPaletteIndexes.has(paletteIndex) && probeCount < palette.length) {
        paletteIndex = (paletteIndex + 1) % palette.length;
        probeCount += 1;
      }
      usedPaletteIndexes.add(paletteIndex);
    }

    colorMap[value] = palette[paletteIndex] ?? "#ff3b30";
  }

  return colorMap;
}

export { DEFAULT_GROUP_PALETTE, EMPTY_GROUP_LABEL };
