import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection } from "geojson";

import { useAgbStatsJob } from "@/hooks/use-agb-stats-job";

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

describe("useAgbStatsJob", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("transitions from idle to succeeded", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "agb-job-1",
        status: "queued",
        message: "created",
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "agb-job-1",
        status: "running",
        progress: 50,
        etaSeconds: 30,
        message: "running",
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "agb-job-1",
        status: "succeeded",
        createdAt: "2026-07-30T00:00:00.000Z",
        result: {
          baselineYear: 2000,
          comparisonYear: 2025,
          minAgbMgHa: 1,
          maxAgbMgHa: 30,
          meanAgbMgHa: 10,
          medianAgbMgHa: 9,
          stdDevAgbMgHa: 4,
          varianceAgbMgHa2: 16,
          p10AgbMgHa: 3,
          p25AgbMgHa: 5,
          p75AgbMgHa: 14,
          p90AgbMgHa: 20,
          p95AgbMgHa: 24,
          interquartileRangeMgHa: 9,
          coefficientOfVariation: 0.4,
          totalAgbMg: 5000,
          totalAgbMgHa: 500,
          baselineTotalAgbMg: 4800,
          comparisonTotalAgbMg: 5000,
          agbIncreaseMg: 350,
          agbDecreaseMg: 150,
          netChangeAgbMg: 200,
          netChangeAgbMgHa: 6.2,
          netChangePercent: 4.17,
          agbIncreaseAreaHa: 2,
          agbDecreaseAreaHa: 1,
          analyzedAreaHa: 10,
          aoiAreaHa: 10.5,
          coverageFraction: 0.95,
          validPixelCount: 100,
          agbCoverByThreshold: [],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAgbStatsJob({
      baseUrl: "/api/v1/ctrees/agb/stats",
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

    expect(result.current.jobId).toBe("agb-job-1");
    expect(result.current.result?.meanAgbMgHa).toBe(10);
    expect(result.current.isPolling).toBe(false);
  });

  it("treats partial_success as terminal with result", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "agb-job-ps",
        status: "queued",
        message: "created",
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "agb-job-ps",
        status: "partial_success",
        createdAt: "2026-07-30T00:00:00.000Z",
        result: {
          baselineYear: 2000,
          comparisonYear: 2025,
          minAgbMgHa: 1,
          maxAgbMgHa: 30,
          meanAgbMgHa: 10,
          medianAgbMgHa: 9,
          stdDevAgbMgHa: 4,
          varianceAgbMgHa2: 16,
          p10AgbMgHa: 3,
          p25AgbMgHa: 5,
          p75AgbMgHa: 14,
          p90AgbMgHa: 20,
          p95AgbMgHa: 24,
          interquartileRangeMgHa: 9,
          coefficientOfVariation: 0.4,
          totalAgbMg: 5000,
          totalAgbMgHa: 500,
          baselineTotalAgbMg: 4800,
          comparisonTotalAgbMg: 5000,
          agbIncreaseMg: 350,
          agbDecreaseMg: 150,
          netChangeAgbMg: 200,
          netChangeAgbMgHa: 6.2,
          netChangePercent: 4.17,
          agbIncreaseAreaHa: 2,
          agbDecreaseAreaHa: 1,
          analyzedAreaHa: 10,
          aoiAreaHa: 10.5,
          coverageFraction: 0.95,
          validPixelCount: 100,
          agbCoverByThreshold: [],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAgbStatsJob({
      baseUrl: "/api/v1/ctrees/agb/stats",
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
      expect(result.current.status).toBe("partial_success");
    });

    expect(result.current.result?.comparisonYear).toBe(2025);
  });

  it("surfaces failed jobs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      jobId: "agb-job-2",
      status: "failed",
      error: { code: "LIMIT", message: "AOI intersects too many tiles" },
    }), { status: 202, headers: { "Content-Type": "application/json" } })));

    const { result } = renderHook(() => useAgbStatsJob({ baseUrl: "/api/v1/ctrees/agb/stats" }));

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

    const { result } = renderHook(() => useAgbStatsJob({ baseUrl: "/api/v1/ctrees/agb/stats" }));

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
