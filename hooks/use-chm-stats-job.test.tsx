import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection } from "geojson";

import { useChmStatsJob } from "@/hooks/use-chm-stats-job";

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

describe("useChmStatsJob", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("transitions from idle to succeeded", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "chm-job-1",
        status: "queued",
        message: "created",
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "chm-job-1",
        status: "running",
        progress: 50,
        etaSeconds: 30,
        message: "running",
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "chm-job-1",
        status: "succeeded",
        createdAt: "2026-07-30T00:00:00.000Z",
        result: {
          minCanopyHeightM: 1,
          maxCanopyHeightM: 30,
          meanCanopyHeightM: 10,
          medianCanopyHeightM: 9,
          stdDevCanopyHeightM: 4,
          varianceCanopyHeightM2: 16,
          p10CanopyHeightM: 3,
          p25CanopyHeightM: 5,
          p75CanopyHeightM: 14,
          p90CanopyHeightM: 20,
          p95CanopyHeightM: 24,
          interquartileRangeM: 9,
          coefficientOfVariation: 0.4,
          totalCanopyVolumeProxyM3: 5000,
          analyzedAreaHa: 10,
          aoiAreaHa: 10.5,
          coverageFraction: 0.95,
          validPixelCount: 100,
          canopyCoverByThreshold: [],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChmStatsJob({
      baseUrl: "/api/v1/chm/stats",
      pollIntervalMs: 0,
      maxRetries: 0,
      maxDurationMs: 10_000,
    }));

    await act(async () => {
      await result.current.startJob({
        geojson: FEATURE_COLLECTION,
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("succeeded");
    });

    expect(result.current.jobId).toBe("chm-job-1");
    expect(result.current.result?.meanCanopyHeightM).toBe(10);
    expect(result.current.isPolling).toBe(false);
  });

  it("surfaces failed jobs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      jobId: "chm-job-2",
      status: "failed",
      error: { code: "LIMIT", message: "AOI intersects too many tiles" },
    }), { status: 202, headers: { "Content-Type": "application/json" } })));

    const { result } = renderHook(() => useChmStatsJob({ baseUrl: "/api/v1/chm/stats" }));

    await act(async () => {
      await result.current.startJob({
        geojson: FEATURE_COLLECTION,
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("failed");
    });

    expect(result.current.error).toEqual({
      code: "LIMIT",
      message: "AOI intersects too many tiles",
    });
  });

  it("resets when cancelled", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChmStatsJob({ baseUrl: "/api/v1/chm/stats" }));

    const startPromise = act(async () => {
      void result.current.startJob({
        geojson: FEATURE_COLLECTION,
      });
    });

    result.current.cancel();
    await startPromise;

    expect(result.current.status).toBe("idle");
    expect(result.current.jobId).toBeNull();
  });
});
