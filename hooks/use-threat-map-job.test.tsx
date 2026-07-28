import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection } from "geojson";

import { useThreatMapJob } from "@/hooks/use-threat-map-job";

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

describe("useThreatMapJob", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("transitions queued -> running -> succeeded and auto-downloads mp4", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "tm-2",
        status: "queued",
        message: "queued",
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "tm-2",
        status: "running",
        createdAt: "2026-07-28T00:00:00.000Z",
        progress: 25,
        currentYear: 1998,
        warnings: [],
        result: null,
        error: null,
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "tm-2",
        status: "succeeded",
        createdAt: "2026-07-28T00:00:00.000Z",
        progress: 100,
        currentYear: 2024,
        warnings: [],
        result: {
          downloadUrl: "/api/v1/threat-map/jobs/tm-2/download",
          contentType: "video/mp4",
          artifactType: "mp4",
          sizeBytes: 456,
          yearsRendered: 35,
          yearsExpected: 35,
          fallbackReasonCode: null,
        },
        error: null,
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }), {
        status: 200,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Disposition": "attachment; filename=threat_map_tm-2.mp4",
        },
      }));

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useThreatMapJob({
      baseUrl: "http://127.0.0.1:8000",
      apiKey: "test-key",
      pollIntervalMs: 0,
      wait: async () => undefined,
      enableClientEncoding: false,
    }));

    await act(async () => {
      await result.current.submit({
        geojson: FEATURE_COLLECTION,
        preset: "balanced",
        outputFormat: "mp4",
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("succeeded");
    });

    expect(result.current.downloadedArtifact?.artifactType).toBe("mp4");
    expect(result.current.downloadedArtifact?.filename).toBe("threat_map_tm-2.mp4");
    expect(result.current.isPolling).toBe(false);
  });

  it("surfaces failed state from poll response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "tm-3",
        status: "deferred",
        message: "deferred",
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "tm-3",
        status: "failed",
        createdAt: "2026-07-28T00:00:00.000Z",
        warnings: ["bad AOI precision"],
        result: null,
        error: {
          code: "RENDER_FAILED",
          message: "Renderer crashed",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useThreatMapJob({
      baseUrl: "http://127.0.0.1:8000",
      apiKey: "test-key",
      pollIntervalMs: 0,
      wait: async () => undefined,
      enableClientEncoding: false,
    }));

    await act(async () => {
      await result.current.submit({
        geojson: FEATURE_COLLECTION,
        preset: "balanced",
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("failed");
    });

    expect(result.current.error).toEqual({
      code: "RENDER_FAILED",
      message: "Renderer crashed",
    });
    expect(result.current.warnings).toEqual(["bad AOI precision"]);
  });

  it("supports cancel flow", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "tm-4",
        status: "queued",
        message: "queued",
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockImplementationOnce(() => new Promise<Response>(() => undefined))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "tm-4",
        status: "cancelled",
        createdAt: "2026-07-28T00:00:00.000Z",
        warnings: [],
        result: null,
        error: {
          code: "CLIENT_CANCELLED",
          message: "Cancelled by user",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useThreatMapJob({
      baseUrl: "http://127.0.0.1:8000",
      apiKey: "test-key",
      pollIntervalMs: 0,
      wait: async () => undefined,
      enableClientEncoding: false,
    }));

    await act(async () => {
      void result.current.submit({
        geojson: FEATURE_COLLECTION,
        preset: "balanced",
      });
    });

    await act(async () => {
      await result.current.cancel();
    });

    await waitFor(() => {
      expect(result.current.status).toBe("cancelled");
    });

    expect(result.current.error).toEqual({
      code: "CLIENT_CANCELLED",
      message: "Cancelled by user",
    });
  });
});
