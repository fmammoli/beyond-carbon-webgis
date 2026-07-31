import { describe, expect, it } from "vitest";

import { sanitizeThreatMapRequest } from "@/lib/threat-map-sanitizer";

type InvalidPolygonGeoJson = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: {
    type: "Polygon";
    coordinates: unknown;
  };
};

describe("threat-map sanitizer", () => {
  it("drops invalid overlays and preserves valid point label/name", () => {
    const sanitized = sanitizeThreatMapRequest({
      geojson: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
            },
          },
        ],
      },
      geojsonCrs: "EPSG:3857",
      overlayLayers: [
        {
          id: "camp-a",
          label: "Camp A",
          geojsonCrs: "EPSG:3857",
          geojson: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Point",
              coordinates: [11885750, -694750],
            },
          },
          showInLegend: true,
          legendOrder: 20,
        },
        {
          id: "broken",
          label: "Broken",
          geojsonCrs: "EPSG:3857",
          geojson: ({
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [[[null, 0], [1, 0], [1, 1], [null, 0]]],
            },
          } satisfies InvalidPolygonGeoJson) as unknown as {
            type: "Feature";
            properties: Record<string, unknown>;
            geometry: {
              type: "Polygon";
              coordinates: Array<Array<[number, number]>>;
            };
          },
        },
      ],
      preset: "balanced",
      outputFormat: "frames_tar_gz",
    });

    expect(sanitized.overlayLayers).toHaveLength(1);

    const pointLayer = sanitized.overlayLayers?.[0];
    expect(pointLayer?.id).toBe("camp-a");
    expect(pointLayer?.label).toBe("Camp A");
    expect(pointLayer?.geojson.type).toBe("Feature");

    if (!pointLayer || pointLayer.geojson.type !== "Feature") {
      throw new Error("Expected point layer geojson feature");
    }

    const pointFeature = pointLayer.geojson as {
      type: "Feature";
      properties?: { name?: string };
      geometry?: { type?: string; coordinates?: unknown };
    };

    expect(pointFeature.properties?.name).toBe("Camp A");
    expect(pointFeature.geometry?.type).toBe("Point");
  });

  it("repairs duplicate and unclosed polygon ring points", () => {
    const sanitized = sanitizeThreatMapRequest({
      geojson: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                ],
              ],
            },
          },
        ],
      },
      geojsonCrs: "EPSG:3857",
      overlayLayers: [
        {
          id: "poly",
          label: "Poly",
          geojsonCrs: "EPSG:3857",
          geojson: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [2, 0],
                  [2, 0],
                  [2, 2],
                  [0, 2],
                ],
              ],
            },
          },
        },
      ],
      preset: "balanced",
    });

    const overlayGeojson = sanitized.overlayLayers?.[0]?.geojson;
    if (!overlayGeojson || overlayGeojson.type !== "Feature" || overlayGeojson.geometry?.type !== "Polygon") {
      throw new Error("Expected polygon feature in sanitized overlay");
    }

    const polygonGeometry = overlayGeojson.geometry;
    expect(polygonGeometry.type).toBe("Polygon");
    expect(polygonGeometry.coordinates[0]?.[0]).toEqual([0, 0]);
    expect(polygonGeometry.coordinates[0]?.at(-1)).toEqual([0, 0]);
    expect(polygonGeometry.coordinates[0]?.length).toBeGreaterThanOrEqual(4);
  });
});
