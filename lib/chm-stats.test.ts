import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection } from "geojson";

import {
  ChmStatsValidationError,
  createChmStatsJob,
  getChmStatsJob,
  startChmStatsAndPoll,
  validateChmStatsRequest,
} from "@/lib/chm-stats";

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

describe("chm-stats client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a CHM stats job successfully", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      jobId: "chm-stats-1",
      status: "queued",
      message: "created",
    }), { status: 202, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    const created = await createChmStatsJob({
      geojson: POLYGON_FEATURE_COLLECTION,
      canopyThresholdsM: [2, 5, 10],
    }, {
      baseUrl: "/api/v1/chm/stats",
      apiKey: "test-key",
    });

    expect(created.jobId).toBe("chm-stats-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/chm/stats/jobs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-API-Key": "test-key",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("polls CHM stats until success", async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "chm-stats-2",
        status: "queued",
        message: "queued",
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "chm-stats-2",
        status: "running",
        progress: 55,
        etaSeconds: 25,
        message: "running",
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "chm-stats-2",
        status: "succeeded",
        createdAt: "2026-07-30T00:00:00.000Z",
        finishedAt: "2026-07-30T00:01:00.000Z",
        result: {
          minCanopyHeightM: 0.4,
          maxCanopyHeightM: 43.2,
          meanCanopyHeightM: 12.1,
          medianCanopyHeightM: 10.7,
          stdDevCanopyHeightM: 6.2,
          varianceCanopyHeightM2: 38.44,
          p10CanopyHeightM: 2.1,
          p25CanopyHeightM: 5.4,
          p75CanopyHeightM: 16.2,
          p90CanopyHeightM: 24.8,
          p95CanopyHeightM: 31.3,
          interquartileRangeM: 10.8,
          coefficientOfVariation: 0.512,
          totalCanopyVolumeProxyM3: 12345.67,
          analyzedAreaHa: 11.5,
          aoiAreaHa: 12.0,
          coverageFraction: 0.9583,
          validPixelCount: 45678,
          canopyCoverByThreshold: [
            { thresholdM: 2, coverRatio: 0.91, coverPercent: 91, coverAreaHa: 10.47 },
            { thresholdM: 5, coverRatio: 0.76, coverPercent: 76, coverAreaHa: 8.74 },
          ],
          metadata: {
            sourceUrl: "http://example.com/chm.pmtiles",
            sourceFormat: "pmtiles_png",
            zoom: 12,
            tileCount: 8,
            histogramBins: 64,
            histogramMinM: 0,
            histogramMaxM: 60,
            thresholdsM: "2,5,10",
          },
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    const completed = await startChmStatsAndPoll({
      geojson: POLYGON_FEATURE_COLLECTION,
    }, {
      baseUrl: "/api/v1/chm/stats",
      wait,
      pollIntervalMs: 0,
      maxRetries: 0,
      maxDurationMs: 10_000,
    });

    expect(completed.status).toBe("succeeded");
    expect(completed.result?.meanCanopyHeightM).toBe(12.1);
    expect(completed.result?.canopyCoverByThreshold.length).toBe(2);
    expect(wait).toHaveBeenCalledWith(0, undefined);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("normalizes snake_case fields in status response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      job_id: "chm-stats-3",
      status: "completed",
      created_at: "2026-07-30T00:00:00.000Z",
      result: {
        min_canopy_height_m: 1,
        max_canopy_height_m: 2,
        mean_canopy_height_m: 1.5,
        median_canopy_height_m: 1.4,
        std_dev_canopy_height_m: 0.2,
        variance_canopy_height_m2: 0.04,
        p10_canopy_height_m: 1.1,
        p25_canopy_height_m: 1.2,
        p75_canopy_height_m: 1.8,
        p90_canopy_height_m: 1.9,
        p95_canopy_height_m: 2,
        interquartile_range_m: 0.6,
        coefficient_of_variation: 0.133,
        total_canopy_volume_proxy_m3: 100,
        analyzed_area_ha: 2,
        aoi_area_ha: 2.2,
        coverage_fraction: 0.9,
        valid_pixel_count: 1000,
        canopy_cover_by_threshold: [
          { threshold_m: 2, cover_ratio: 0.4, cover_percent: 40, cover_area_ha: 0.8 },
        ],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const job = await getChmStatsJob("chm-stats-3", { baseUrl: "/api/v1/chm/stats" });

    expect(job.jobId).toBe("chm-stats-3");
    expect(job.status).toBe("succeeded");
    expect(job.result?.canopyCoverByThreshold[0]?.thresholdM).toBe(2);
  });

  it("rejects invalid threshold arrays", () => {
    expect(() => validateChmStatsRequest({
      geojson: POLYGON_FEATURE_COLLECTION,
      canopyThresholdsM: [2, -1],
    })).toThrow(ChmStatsValidationError);
  });
});
