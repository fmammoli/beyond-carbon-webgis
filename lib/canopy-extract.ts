import type { FeatureCollection, GeoJsonProperties, Geometry } from "geojson";

import {
  DEFAULT_CHM_429_BACKOFF_MS,
  DEFAULT_CHM_API_BASE_URL,
  DEFAULT_CHM_INITIAL_POLL_INTERVAL_MS,
  DEFAULT_CHM_MAX_POLL_INTERVAL_MS,
  type ChmApiError,
  type ChmClientOptions,
  type ChmDownloadResult,
  type ChmJob,
  type ChmJobError,
  type ChmJobResult,
  type ChmJobStatus,
  type ChmPollOptions,
  createChmJob,
  downloadChmResult,
  getChmJob,
  pollChmJob,
} from "@/lib/chm-extraction";

export const DEFAULT_CANOPY_BUFFER_KM = 20;
export const DEFAULT_CANOPY_OUTPUT = "tif" as const;
export const DEFAULT_CANOPY_JOB_POLL_INTERVAL_MS = DEFAULT_CHM_INITIAL_POLL_INTERVAL_MS;

export type CanopyExtractionOutput = "tif" | "geojson" | "both";

export type CanopyExtractionRequest = {
  geometry: FeatureCollection<Geometry, GeoJsonProperties>;
  bufferKm?: number;
  output?: CanopyExtractionOutput;
  sourceFileName?: string;
};

export type CanopyExtractionJobStatus = ChmJobStatus;
export type CanopyExtractionJobError = ChmJobError;
export type CanopyExtractionJobResult = ChmJobResult;
export type CanopyExtractionJob = ChmJob;
export type CanopyExtractionDownloadResult = ChmDownloadResult;
export type CanopyExtractionApiError = ChmApiError;
export type CanopyExtractionClientOptions = ChmClientOptions;
export type CanopyExtractionPollOptions = ChmPollOptions;

export { DEFAULT_CHM_429_BACKOFF_MS, DEFAULT_CHM_API_BASE_URL, DEFAULT_CHM_INITIAL_POLL_INTERVAL_MS, DEFAULT_CHM_MAX_POLL_INTERVAL_MS };

export const createCanopyExtractionJob = createChmJob;
export const getCanopyExtractionJob = getChmJob;
export { createChmJob, downloadChmResult, getChmJob, pollChmJob };

export async function getCanopyExtractionBlobUrlFromJob(
  jobIdOrDownloadUrl: string | { jobId?: string; downloadUrl?: string },
): Promise<string> {
  const candidate = typeof jobIdOrDownloadUrl === "string"
    ? jobIdOrDownloadUrl
    : jobIdOrDownloadUrl.downloadUrl ?? jobIdOrDownloadUrl.jobId ?? "";

  const result = await downloadChmResult(candidate);
  return URL.createObjectURL(result.blob);
}

export async function waitForCanopyExtractionJob(
  jobId: string,
  options?: {
    pollIntervalMs?: number;
    baseUrl?: string;
    signal?: AbortSignal;
  },
): Promise<CanopyExtractionJob> {
  return pollChmJob(jobId, {
    baseUrl: options?.baseUrl,
    signal: options?.signal,
    initialIntervalMs: options?.pollIntervalMs ?? DEFAULT_CHM_INITIAL_POLL_INTERVAL_MS,
    maxIntervalMs: DEFAULT_CHM_MAX_POLL_INTERVAL_MS,
    backoffIntervalMs: DEFAULT_CHM_429_BACKOFF_MS,
  });
}

/**
 * Legacy convenience wrapper that now uses async jobs under the hood.
 */
export async function getCanopyExtractionBlobUrl(
  geometry: FeatureCollection<Geometry, GeoJsonProperties>,
): Promise<string> {
  const createdJob = await createChmJob(geometry);
  const completedJob = await waitForCanopyExtractionJob(createdJob.jobId);

  if (completedJob.status !== "succeeded" || !completedJob.result) {
    const message = completedJob.error?.message ?? completedJob.message ?? "Canopy extraction did not complete successfully.";
    throw new Error(message);
  }

  return getCanopyExtractionBlobUrlFromJob(completedJob.result.downloadUrl);
}

export async function submitCanopyExtractionRequest(
  request: CanopyExtractionRequest,
): Promise<CanopyExtractionJob> {
  return createChmJob(request.geometry);
}