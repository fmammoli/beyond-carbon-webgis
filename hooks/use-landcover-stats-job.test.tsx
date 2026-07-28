import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection } from "geojson";

import { useLandcoverStatsJob } from "@/hooks/use-landcover-stats-job";

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

describe("useLandcoverStatsJob", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("transitions from idle to succeeded", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "stats-1",
        status: "queued",
        message: "created",
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "stats-1",
        status: "running",
        progress: 42,
        etaSeconds: 60,
        message: "running",
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "stats-1",
        status: "succeeded",
        createdAt: "2026-07-28T00:00:00.000Z",
        result: {
          baselineYear: 1990,
          comparisonYear: 2024,
          forestLossHa: 12,
          forestGainHa: 3,
          netForestChangeHa: -9,
          baselineForestAreaHa: 110,
          comparisonForestAreaHa: 101,
          analyzedAreaHa: 120,
          aoiAreaHa: 125,
          coverageFraction: 0.95,
          validPixelCount: 900,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useLandcoverStatsJob({
      baseUrl: "/api/v1/landcover/stats",
      apiKey: "test-key",
      pollIntervalMs: 0,
      maxRetries: 0,
      maxDurationMs: 10_000,
    }));

    await act(async () => {
      await result.current.startJob({
        geojson: FEATURE_COLLECTION,
        baselineYear: 1990,
        comparisonYear: 2024,
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("succeeded");
    });

    expect(result.current.jobId).toBe("stats-1");
    expect(result.current.result?.forestLossHa).toBe(12);
    expect(result.current.isPolling).toBe(false);
  });

  it("surfaces failed jobs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      jobId: "stats-2",
      status: "failed",
      error: { code: "LIMIT", message: "AOI exceeds max square side" },
    }), { status: 202, headers: { "Content-Type": "application/json" } })));

    const { result } = renderHook(() => useLandcoverStatsJob({ baseUrl: "/api/v1/landcover/stats" }));

    await act(async () => {
      await result.current.startJob({
        geojson: FEATURE_COLLECTION,
        baselineYear: 1990,
        comparisonYear: 2024,
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe("failed");
    });

    expect(result.current.error).toEqual({
      code: "LIMIT",
      message: "AOI exceeds max square side",
    });
  });

  it("resets when cancelled", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useLandcoverStatsJob({ baseUrl: "/api/v1/landcover/stats" }));

    const startPromise = act(async () => {
      void result.current.startJob({
        geojson: FEATURE_COLLECTION,
        baselineYear: 1990,
        comparisonYear: 2024,
      });
    });

    result.current.cancel();
    await startPromise;

    expect(result.current.status).toBe("idle");
    expect(result.current.jobId).toBeNull();
  });

});