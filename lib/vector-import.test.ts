import { describe, expect, it, vi } from "vitest";

import { MAX_GEOJSON_UPLOAD_SIZE_BYTES, parseVectorFile } from "@/lib/vector-import";

const MINIMAL_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark>
    <name>Test Point</name>
    <Point><coordinates>110.0,-7.0,0</coordinates></Point>
  </Placemark>
</kml>`;

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

  it("parses KML uploads", async () => {
    const text = vi.fn().mockResolvedValue(MINIMAL_KML);
    const file = {
      name: "sample.kml",
      size: MINIMAL_KML.length,
      text,
    } as unknown as File;

    const result = await parseVectorFile(file);
    expect(result.fileName).toBe("sample.kml");
    expect(result.geojson.type).toBe("FeatureCollection");
    expect(result.geojson.features.length).toBeGreaterThan(0);
    expect(text).toHaveBeenCalledTimes(1);
  });

  it("fails fast for oversized KML uploads before reading the whole file", async () => {
    const text = vi.fn().mockRejectedValue(new Error("should not read file"));
    const file = {
      name: "large.kml",
      size: MAX_GEOJSON_UPLOAD_SIZE_BYTES + 1,
      text,
    } as unknown as File;

    await expect(parseVectorFile(file)).rejects.toThrow(
      /KML uploads larger than 100\.0 MB are not supported in the browser uploader\./,
    );
    expect(text).not.toHaveBeenCalled();
  });

  it("rejects malformed KML with a descriptive error", async () => {
    const malformedKml = "this is not xml <<< broken";
    const text = vi.fn().mockResolvedValue(malformedKml);
    const file = {
      name: "broken.kml",
      size: malformedKml.length,
      text,
    } as unknown as File;

    await expect(parseVectorFile(file)).rejects.toThrow(
      /The KML file contains invalid XML and could not be parsed\./,
    );
  });
});