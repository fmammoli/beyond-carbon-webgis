import { describe, expect, it } from "vitest";

import {
  buildGroupColorMap,
  EMPTY_GROUP_LABEL,
  getGroupableColumns,
  normalizeGroupValue,
} from "@/lib/vector-grouping";

describe("vector-grouping", () => {
  it("normalizes empty-ish values", () => {
    expect(normalizeGroupValue(null)).toBe(EMPTY_GROUP_LABEL);
    expect(normalizeGroupValue(undefined)).toBe(EMPTY_GROUP_LABEL);
    expect(normalizeGroupValue("")).toBe(EMPTY_GROUP_LABEL);
    expect(normalizeGroupValue("   ")).toBe(EMPTY_GROUP_LABEL);
    expect(normalizeGroupValue("Village A")).toBe("Village A");
    expect(normalizeGroupValue(12)).toBe("12");
    expect(normalizeGroupValue(true)).toBe("true");
  });

  it("finds groupable columns with at least two distinct values", () => {
    const columns = getGroupableColumns([
      { geometry: { type: "Polygon" }, village: "A", district: "North", area: 10 },
      { geometry: { type: "Polygon" }, village: "B", district: "North", area: 20 },
      { geometry: { type: "Polygon" }, village: "A", district: "South", area: 10 },
    ]);

    expect(columns).toEqual(["area", "district", "village"]);
  });

  it("creates stable color mapping for identical value sets", () => {
    const firstMap = buildGroupColorMap(["A", "B", "C"]);
    const secondMap = buildGroupColorMap(["C", "A", "B"]);

    expect(firstMap).toEqual(secondMap);
    expect(Object.keys(firstMap).sort()).toEqual(["A", "B", "C"]);
  });

  it("filters likely id columns and high-cardinality fields", () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      objectid: String(index + 1),
      parcel_id: `PID-${index + 1}`,
      village: index % 2 === 0 ? "A" : "B",
      owner: `Owner ${index + 1}`,
    }));

    const columns = getGroupableColumns(rows);

    expect(columns).toEqual(["village"]);
  });
});
