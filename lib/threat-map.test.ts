import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection } from "geojson";

import {
  ThreatMapApiError,
  createThreatMapJob,
  downloadThreatMapArtifact,
  pollThreatMapJob,
} from "@/lib/threat-map";

const FEATURE_COLLECTION = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      },
      properties: {},
    },
  ],
} as FeatureCollection;

describe("threat-map client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("surfaces queue-full errors on create", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      message: "Queue is full",
      code: "QUEUE_FULL",
    }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    }))));

    await expect(createThreatMapJob({
      geojson: FEATURE_COLLECTION,
      preset: "balanced",
    }, {
      baseUrl: "http://127.0.0.1:8000",
      apiKey: "test-key",
    })).rejects.toBeInstanceOf(ThreatMapApiError);

    await expect(createThreatMapJob({
      geojson: FEATURE_COLLECTION,
      preset: "balanced",
    }, {
      baseUrl: "http://127.0.0.1:8000",
      apiKey: "test-key",
    })).rejects.toMatchObject({
      status: 429,
      message: "Queue is full",
      code: "QUEUE_FULL",
    });
  });

  it("polls until partial_success and then downloads the artifact", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "tm-1",
        status: "running",
        createdAt: "2026-07-28T00:00:00.000Z",
        progress: 45,
        warnings: [],
        result: null,
        error: null,
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "tm-1",
        status: "partial_success",
        createdAt: "2026-07-28T00:00:00.000Z",
        progress: 100,
        warnings: ["Used fallback ZIP output"],
        result: {
          downloadUrl: "/api/v1/threat-map/jobs/tm-1/download",
          contentType: "application/zip",
          artifactType: "zip",
          sizeBytes: 123,
          yearsRendered: 35,
          yearsExpected: 35,
          fallbackReasonCode: "ENCODE_FAILED",
        },
        error: null,
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "application/zip" }), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": "attachment; filename=threat_map_tm-1.zip",
        },
      }));

    vi.stubGlobal("fetch", fetchMock);

    const completed = await pollThreatMapJob("tm-1", {
      baseUrl: "http://127.0.0.1:8000",
      apiKey: "test-key",
      intervalMs: 0,
      wait: async () => undefined,
    });

    expect(completed.status).toBe("partial_success");

    const downloaded = await downloadThreatMapArtifact("tm-1", {
      baseUrl: "http://127.0.0.1:8000",
      apiKey: "test-key",
      expectedArtifactType: completed.result?.artifactType ?? undefined,
    });

    expect(downloaded.artifactType).toBe("zip");
    expect(downloaded.filename).toBe("threat_map_tm-1.zip");
    expect(downloaded.blob.size).toBeGreaterThan(0);
  });
});
