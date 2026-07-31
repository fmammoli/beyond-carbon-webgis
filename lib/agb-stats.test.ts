import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection } from "geojson";

import {
  AgbStatsValidationError,
  createAgbStatsJob,
  getAgbStatsJob,
  startAgbStatsAndPoll,
  validateAgbStatsRequest,
} from "@/lib/agb-stats";

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

describe("agb-stats client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a AGB stats job successfully", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      jobId: "agb-stats-1",
      status: "queued",
      message: "created",
    }), { status: 202, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    const created = await createAgbStatsJob({
      geojson: POLYGON_FEATURE_COLLECTION,
    }, {
      baseUrl: "/api/v1/ctrees/agb/stats",
      apiKey: "test-key",
    });

    expect(created.jobId).toBe("agb-stats-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/ctrees/agb/stats/jobs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-API-Key": "test-key",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("polls AGB stats until success", async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "agb-stats-2",
        status: "queued",
        message: "queued",
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "agb-stats-2",
        status: "running",
        progress: 55,
        etaSeconds: 25,
        message: "running",
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "agb-stats-2",
        status: "succeeded",
        createdAt: "2026-07-30T00:00:00.000Z",
        finishedAt: "2026-07-30T00:01:00.000Z",
        result: {
          baselineYear: 2000,
          comparisonYear: 2025,
          minAgbMgHa: 0.4,
          maxAgbMgHa: 243.2,
          meanAgbMgHa: 112.1,
          medianAgbMgHa: 110.7,
          stdDevAgbMgHa: 26.2,
          varianceAgbMgHa2: 686.44,
          p10AgbMgHa: 62.1,
          p25AgbMgHa: 85.4,
          p75AgbMgHa: 136.2,
          p90AgbMgHa: 164.8,
          p95AgbMgHa: 181.3,
          interquartileRangeMgHa: 50.8,
          coefficientOfVariation: 0.512,
          totalAgbMg: 12345.67,
          totalAgbMgHa: 1073.54,
          baselineTotalAgbMg: 11111.11,
          comparisonTotalAgbMg: 12345.67,
          agbIncreaseMg: 2300,
          agbDecreaseMg: 1065,
          netChangeAgbMg: 1235,
          netChangeAgbMgHa: 9.4,
          netChangePercent: 11.12,
          agbIncreaseAreaHa: 4.5,
          agbDecreaseAreaHa: 2.1,
          analyzedAreaHa: 11.5,
          aoiAreaHa: 12.0,
          coverageFraction: 0.9583,
          validPixelCount: 45678,
          agbCoverByThreshold: [
            { thresholdMgHa: 50, coverRatio: 0.91, coverPercent: 91, coverAreaHa: 10.47 },
            { thresholdMgHa: 100, coverRatio: 0.76, coverPercent: 76, coverAreaHa: 8.74 },
          ],
          metadata: { modelVersion: "agb-v1" },
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    const completed = await startAgbStatsAndPoll({
      geojson: POLYGON_FEATURE_COLLECTION,
    }, {
      baseUrl: "/api/v1/ctrees/agb/stats",
      wait,
      pollIntervalMs: 0,
      maxRetries: 0,
      maxDurationMs: 10_000,
    });

    expect(completed.status).toBe("succeeded");
    expect(completed.result?.meanAgbMgHa).toBe(112.1);
    expect(completed.result?.agbCoverByThreshold.length).toBe(2);
    expect(wait).toHaveBeenCalledWith(0, undefined);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("normalizes snake_case fields in status response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      job_id: "agb-stats-3",
      status: "completed",
      created_at: "2026-07-30T00:00:00.000Z",
      result: {
        baseline_year: 2000,
        comparison_year: 2025,
        min_agb_mg_ha: 1,
        max_agb_mg_ha: 2,
        mean_agb_mg_ha: 1.5,
        median_agb_mg_ha: 1.4,
        std_dev_agb_mg_ha: 0.2,
        variance_agb_mg_ha2: 0.04,
        p10_agb_mg_ha: 1.1,
        p25_agb_mg_ha: 1.2,
        p75_agb_mg_ha: 1.8,
        p90_agb_mg_ha: 1.9,
        p95_agb_mg_ha: 2,
        interquartile_range_mg_ha: 0.6,
        coefficient_of_variation: 0.133,
        total_agb_mg: 100,
        total_agb_mg_ha: 50,
        baseline_total_agb_mg: 90,
        comparison_total_agb_mg: 100,
        agb_increase_mg: 12,
        agb_decrease_mg: 2,
        net_change_agb_mg: 10,
        net_change_agb_mg_ha: 0.4,
        net_change_percent: 11.1,
        agb_increase_area_ha: 1.1,
        agb_decrease_area_ha: 0.4,
        analyzed_area_ha: 2,
        aoi_area_ha: 2.2,
        coverage_fraction: 0.9,
        valid_pixel_count: 1000,
        agb_cover_by_threshold: [
          { threshold_mg_ha: 50, cover_ratio: 0.4, cover_percent: 40, cover_area_ha: 0.8 },
        ],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const job = await getAgbStatsJob("agb-stats-3", { baseUrl: "/api/v1/ctrees/agb/stats" });

    expect(job.jobId).toBe("agb-stats-3");
    expect(job.status).toBe("succeeded");
    expect(job.result?.agbCoverByThreshold[0]?.thresholdMgHa).toBe(50);
  });

  it("supports partial_success as terminal", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "agb-stats-4",
        status: "queued",
        message: "created",
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "agb-stats-4",
        status: "partial_success",
        createdAt: "2026-07-30T00:00:00.000Z",
        message: "Some tiles unavailable",
        result: {
          baselineYear: 2000,
          comparisonYear: 2025,
          minAgbMgHa: 1,
          maxAgbMgHa: 2,
          meanAgbMgHa: 1.5,
          medianAgbMgHa: 1.4,
          stdDevAgbMgHa: 0.2,
          varianceAgbMgHa2: 0.04,
          p10AgbMgHa: 1.1,
          p25AgbMgHa: 1.2,
          p75AgbMgHa: 1.8,
          p90AgbMgHa: 1.9,
          p95AgbMgHa: 2,
          interquartileRangeMgHa: 0.6,
          coefficientOfVariation: 0.133,
          totalAgbMg: 100,
          totalAgbMgHa: 50,
          baselineTotalAgbMg: 90,
          comparisonTotalAgbMg: 100,
          agbIncreaseMg: 12,
          agbDecreaseMg: 2,
          netChangeAgbMg: 10,
          netChangeAgbMgHa: 0.4,
          netChangePercent: 11.1,
          agbIncreaseAreaHa: 1.1,
          agbDecreaseAreaHa: 0.4,
          analyzedAreaHa: 2,
          aoiAreaHa: 2.2,
          coverageFraction: 0.9,
          validPixelCount: 1000,
          agbCoverByThreshold: [],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const job = await startAgbStatsAndPoll({
      geojson: POLYGON_FEATURE_COLLECTION,
    }, {
      baseUrl: "/api/v1/ctrees/agb/stats",
      pollIntervalMs: 0,
      maxRetries: 0,
      maxDurationMs: 10_000,
    });

    expect(job.status).toBe("partial_success");
    expect(job.result?.validPixelCount).toBe(1000);
  });

  it("rejects invalid polygon request payload", () => {
    expect(() => validateAgbStatsRequest({
      geojson: {
        type: "FeatureCollection",
        features: [],
      },
    })).toThrow(AgbStatsValidationError);
  });
});
