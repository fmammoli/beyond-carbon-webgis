import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection } from "geojson";

import {
  LandcoverStatsApiError,
  LandcoverStatsValidationError,
  createLandcoverStatsJob,
  getLandcoverStatsJob,
  startLandcoverStatsAndPoll,
  validateLandcoverStatsRequest,
} from "@/lib/landcover-stats";

const POLYGON_FEATURE_COLLECTION = {
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

describe("landcover-stats client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a job successfully", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      jobId: "stats-1",
      status: "queued",
      message: "created",
    }), { status: 202, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    const created = await createLandcoverStatsJob({
      geojson: POLYGON_FEATURE_COLLECTION,
      baselineYear: 1990,
      comparisonYear: 2024,
    }, {
      baseUrl: "/api/v1/landcover/stats",
      apiKey: "test-key",
    });

    expect(created.jobId).toBe("stats-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/landcover/stats/jobs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-API-Key": "test-key",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("surfaces 422 validation errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "INVALID_AOI", message: "Polygon is too large" },
      message: "Polygon is too large",
    }), { status: 422, headers: { "Content-Type": "application/json" } })));

    await expect(getLandcoverStatsJob("stats-2", { baseUrl: "/api/v1/landcover/stats" })).rejects.toMatchObject({
      status: 422,
      message: "Polygon is too large",
    });
  });

  it("surfaces 429 queue busy errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: "Queue is full",
    }), { status: 429, headers: { "Content-Type": "application/json" } })));

    await expect(createLandcoverStatsJob({
      geojson: POLYGON_FEATURE_COLLECTION,
      baselineYear: 1990,
      comparisonYear: 2024,
    }, { baseUrl: "/api/v1/landcover/stats" })).rejects.toMatchObject({
      status: 429,
      message: "Queue is full",
    });
  });

  it("polls until success", async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "stats-3",
        status: "queued",
        message: "queued",
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "stats-3",
        status: "running",
        progress: 40,
        etaSeconds: 30,
        message: "running",
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "stats-3",
        status: "succeeded",
        createdAt: "2026-07-28T00:00:00.000Z",
        finishedAt: "2026-07-28T00:02:00.000Z",
        result: {
          baselineYear: 1990,
          comparisonYear: 2024,
          forestLossHa: 10,
          forestLossPct: 98.397,
          forestGainHa: 2,
          forestGainPct: 0,
          netForestChangeHa: -8,
          baselineForestAreaHa: 100,
          comparisonForestAreaHa: 92,
          analyzedAreaHa: 120,
          aoiAreaHa: 130,
          coverageFraction: 0.92,
          validPixelCount: 1000,
          metadata: { algorithm: "v1" },
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    const completed = await startLandcoverStatsAndPoll({
      geojson: POLYGON_FEATURE_COLLECTION,
      baselineYear: 1990,
      comparisonYear: 2024,
    }, {
      baseUrl: "/api/v1/landcover/stats",
      apiKey: "test-key",
      wait,
      pollIntervalMs: 0,
      maxRetries: 0,
      maxDurationMs: 10_000,
    });

    expect(completed.status).toBe("succeeded");
    expect(completed.result?.forestLossHa).toBe(10);
    expect(completed.result?.forestLossPct).toBe(98.397);
    expect(completed.result?.forestGainPct).toBe(0);
    expect(wait).toHaveBeenCalledWith(0, undefined);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid requests before network calls", () => {
    expect(() => validateLandcoverStatsRequest({
      geojson: { type: "FeatureCollection", features: [] },
      baselineYear: 1990,
      comparisonYear: 1991,
    } as unknown as Parameters<typeof validateLandcoverStatsRequest>[0])).toThrow(LandcoverStatsValidationError);
  });

  it("exposes a friendly error message for auth failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "nope" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(getLandcoverStatsJob("stats-4", { baseUrl: "/api/v1/landcover/stats" })).rejects.toMatchObject({
      status: 401,
      message: "Invalid API key or landcover stats API is not configured.",
    });
  });

  it("times out when polling exceeds the configured duration", async () => {
    let currentTime = 0;
    vi.spyOn(Date, "now").mockImplementation(() => currentTime);

    const wait = vi.fn().mockImplementation(async (delayMs: number) => {
      currentTime += delayMs;
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "stats-5",
        status: "queued",
        message: "created",
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockImplementation(() => new Response(JSON.stringify({
        jobId: "stats-5",
        status: "running",
        progress: 5,
        etaSeconds: 120,
        message: "running",
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(startLandcoverStatsAndPoll({
      geojson: POLYGON_FEATURE_COLLECTION,
      baselineYear: 1990,
      comparisonYear: 2024,
    }, {
      baseUrl: "/api/v1/landcover/stats",
      apiKey: "test-key",
      wait,
      pollIntervalMs: 10,
      maxRetries: 0,
      maxDurationMs: 15,
    })).rejects.toThrow("timed out");

    expect(wait).toHaveBeenCalled();
  });

  it("normalizes completed status and snake_case fields from status endpoint", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        job_id: "stats-6",
        status: "queued",
        message: "queued",
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        job_id: "stats-6",
        status: "completed",
        created_at: "2026-07-28T00:00:00.000Z",
        started_at: "2026-07-28T00:00:01.000Z",
        finished_at: "2026-07-28T00:00:02.000Z",
        progress: 100,
        eta_seconds: 0,
        result: {
          baselineYear: 1990,
          comparisonYear: 2024,
          forestLossHa: 0,
          forest_loss_pct: 12.5,
          forestGainHa: 0,
          forest_gain_pct: 3.75,
          netForestChangeHa: 0,
          baselineForestAreaHa: 1,
          comparisonForestAreaHa: 1,
          analyzedAreaHa: 1,
          aoiAreaHa: 1,
          coverageFraction: 1,
          validPixelCount: 1,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    const completed = await startLandcoverStatsAndPoll({
      geojson: POLYGON_FEATURE_COLLECTION,
      baselineYear: 1990,
      comparisonYear: 2024,
    }, {
      baseUrl: "/api/v1/landcover/stats",
      pollIntervalMs: 0,
      maxRetries: 0,
      maxDurationMs: 10_000,
    });

    expect(completed.jobId).toBe("stats-6");
    expect(completed.status).toBe("succeeded");
    expect(completed.progress).toBe(100);
    expect(completed.etaSeconds).toBe(0);
    expect(completed.result?.forestLossPct).toBe(12.5);
    expect(completed.result?.forestGainPct).toBe(3.75);
  });
});