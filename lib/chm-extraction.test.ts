import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection } from "geojson";

import {
  ChmApiError,
  createChmJob,
  downloadChmResult,
  getChmJob,
  pollChmJob,
} from "@/lib/chm-extraction";

const FEATURE_COLLECTION = {
  type: "FeatureCollection",
  features: [],
} as FeatureCollection;

describe("chm-extraction client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a job and polls until success", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "job-1",
        status: "queued",
        message: "CHM extraction job created",
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "job-1",
        status: "running",
        progress: 35,
        message: "working",
        result: null,
        error: null,
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "job-1",
        status: "succeeded",
        result: {
          downloadUrl: "/api/v1/chm/jobs/job-1/download",
          contentType: "image/tiff",
        },
        error: null,
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "image/tiff" }), {
        status: 200,
        headers: { "Content-Type": "image/tiff" },
      }));

    vi.stubGlobal("fetch", fetchMock);

    const createdJob = await createChmJob(FEATURE_COLLECTION, { baseUrl: "/api/v1/chm" });
    expect(createdJob.jobId).toBe("job-1");

    const completedJob = await pollChmJob("job-1", {
      baseUrl: "/api/v1/chm",
      wait: async () => undefined,
      initialIntervalMs: 0,
      maxIntervalMs: 0,
      backoffIntervalMs: 0,
    });

    expect(completedJob.status).toBe("succeeded");
    const download = await downloadChmResult(completedJob.result!.downloadUrl, { baseUrl: "/api/v1/chm" });
    expect(download.filename).toBe("chm_job-1.tif");
    expect(download.blob.size).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("surfaces failed job state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      jobId: "job-2",
      status: "failed",
      error: { code: "AOI_LIMIT", message: "AOI exceeds max square side" },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const job = await getChmJob("job-2", { baseUrl: "/api/v1/chm" });
    expect(job.status).toBe("failed");
    expect(job.error?.message).toContain("AOI exceeds max square side");
  });

  it("treats early download as a 409 error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Job not complete" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(downloadChmResult("job-3", { baseUrl: "/api/v1/chm" })).rejects.toMatchObject({
      status: 409,
      message: "Job not complete",
    });
  });

  it("backs off on 429 responses during polling", async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "rate limited" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "rate limited" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "rate limited" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jobId: "job-4",
        status: "succeeded",
        result: { downloadUrl: "/api/v1/chm/jobs/job-4/download", contentType: "image/tiff" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    const completed = await pollChmJob("job-4", {
      baseUrl: "/api/v1/chm",
      wait,
      initialIntervalMs: 2500,
      maxIntervalMs: 10_000,
      backoffIntervalMs: 10_000,
      backoffMaxIntervalMs: 30_000,
    });

    expect(completed.status).toBe("succeeded");
    expect(wait).toHaveBeenNthCalledWith(1, 10_000, undefined);
    expect(wait).toHaveBeenNthCalledWith(2, 20_000, undefined);
    expect(wait).toHaveBeenNthCalledWith(3, 30_000, undefined);
  });

  it("surfaces auth failures distinctly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "nope" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(getChmJob("job-5", { baseUrl: "/api/v1/chm" })).rejects.toBeInstanceOf(ChmApiError);
    await expect(getChmJob("job-5", { baseUrl: "/api/v1/chm" })).rejects.toMatchObject({
      status: 401,
      message: "Invalid API key",
    });
  });
});