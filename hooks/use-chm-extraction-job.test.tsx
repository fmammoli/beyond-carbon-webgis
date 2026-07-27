import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection } from "geojson";

import { useChmExtractionJob } from "@/hooks/use-chm-extraction-job";

const FEATURE_COLLECTION = {
  type: "FeatureCollection",
  features: [],
} as FeatureCollection;

describe("useChmExtractionJob", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("transitions from idle to succeeded", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "job-1",
        status: "queued",
        message: "created",
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "job-1",
        status: "running",
        progress: 45,
        etaSeconds: 75,
        message: "Extracting canopy height model",
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "job-1",
        status: "succeeded",
        etaSeconds: 0,
        result: { downloadUrl: "/api/v1/chm/jobs/job-1/download", contentType: "image/tiff" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChmExtractionJob({ baseUrl: "/api/v1/chm", initialIntervalMs: 0, maxIntervalMs: 0, backoffIntervalMs: 0, wait: async () => undefined }));

    await act(async () => {
      await result.current.startJob(FEATURE_COLLECTION);
    });

    await waitFor(() => {
      expect(result.current.status).toBe("succeeded");
    });

    expect(result.current.jobId).toBe("job-1");
    expect(result.current.etaSeconds).toBe(0);
    expect(result.current.isPolling).toBe(false);
  });

  it("surfaces failed jobs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      jobId: "job-2",
      status: "failed",
      error: { code: "LIMIT", message: "AOI exceeds limit" },
    }), { status: 202, headers: { "Content-Type": "application/json" } })));

    const { result } = renderHook(() => useChmExtractionJob({ baseUrl: "/api/v1/chm" }));

    await act(async () => {
      await result.current.startJob(FEATURE_COLLECTION);
    });

    await waitFor(() => {
      expect(result.current.status).toBe("failed");
    });

    expect(result.current.error).toEqual({
      code: "LIMIT",
      message: "AOI exceeds limit",
    });
  });
});