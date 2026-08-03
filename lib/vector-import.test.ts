import { describe, expect, it, vi } from "vitest";

import { MAX_GEOJSON_UPLOAD_SIZE_BYTES, parseVectorFile } from "@/lib/vector-import";

describe("vector-import", () => {
  it("parses GeoJSON uploads", async () => {
    const text = vi.fn().mockResolvedValue('{"type":"FeatureCollection","features":[]}');
    const file = {
      name: "sample.geojson",
      size: 42,
      text,
    } as unknown as File;

    await expect(parseVectorFile(file)).resolves.toEqual({
      fileName: "sample.geojson",
      geojson: {
        type: "FeatureCollection",
        features: [],
      },
    });
    expect(text).toHaveBeenCalledTimes(1);
  });

  it("fails fast for oversized GeoJSON uploads before reading the whole file", async () => {
    const text = vi.fn().mockRejectedValue(new Error("should not read file"));
    const file = {
      name: "Indonesia_legal_classification.geojson",
      size: MAX_GEOJSON_UPLOAD_SIZE_BYTES + 1,
      text,
    } as unknown as File;

    await expect(parseVectorFile(file)).rejects.toThrow(
      /GeoJSON uploads larger than 100\.0 MB are not supported in the browser uploader\./,
    );
    expect(text).not.toHaveBeenCalled();
  });
});