import type { FeatureCollection, GeoJsonProperties, Geometry } from "geojson";

export const DEFAULT_CHM_API_BASE_URL = "/api/v1/chm";
export const DEFAULT_CHM_LOCAL_DEV_API_KEY = "chm_beyond_carbon_workshop";
export const DEFAULT_CHM_INITIAL_POLL_INTERVAL_MS = 2500;
export const DEFAULT_CHM_MAX_POLL_INTERVAL_MS = 10_000;
export const DEFAULT_CHM_429_BACKOFF_MS = 10_000;
export const DEFAULT_CHM_429_BACKOFF_MAX_MS = 30_000;

export type ChmJobStatus = "queued" | "running" | "succeeded" | "failed";

export type ChmJobError = {
  code: string;
  message: string;
};

export type ChmJobResult = {
  downloadUrl: string;
  contentType: string;
};

export type ChmJob = {
  jobId: string;
  status: ChmJobStatus;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  progress?: number | null;
  etaSeconds?: number | null;
  message?: string | null;
  result?: ChmJobResult | null;
  error?: ChmJobError | null;
};

export type CreateChmJobResponse = Pick<ChmJob, "jobId" | "status" | "message"> &
  Partial<Pick<ChmJob, "progress" | "etaSeconds" | "result" | "error">>;
export type GetChmJobResponse = ChmJob;

export type ChmDownloadResult = {
  jobId: string;
  downloadUrl: string;
  filename: string;
  contentType: string;
  blob: Blob;
};

export type ChmClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  signal?: AbortSignal;
};

export type ChmPollOptions = ChmClientOptions & {
  initialIntervalMs?: number;
  maxIntervalMs?: number;
  backoffMaxIntervalMs?: number;
  backoffIntervalMs?: number;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  onUpdate?: (job: ChmJob) => void;
};

export class ChmApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: string;
  readonly payload?: unknown;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      details?: string;
      payload?: unknown;
      retryAfterMs?: number;
    },
  ) {
    super(message);
    this.name = "ChmApiError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.payload = options.payload;
    this.retryAfterMs = options.retryAfterMs;
  }
}

function resolveChmBaseUrl(baseUrl?: string): string {
  const candidate = (baseUrl ?? process.env.NEXT_PUBLIC_CHM_API_BASE_URL ?? DEFAULT_CHM_API_BASE_URL).trim();
  return candidate.replace(/\/$/, "");
}

function isLocalDevBaseUrl(baseUrl: string): boolean {
  if (baseUrl.startsWith("/")) {
    return false;
  }

  try {
    const parsed = new URL(baseUrl);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

function resolveChmApiKey(baseUrl?: string, providedApiKey?: string): string | null {
  const apiKey = (providedApiKey ?? process.env.UPSTREAM_API_KEY ?? "").trim();
  if (apiKey) {
    return apiKey;
  }

  const normalizedBaseUrl = resolveChmBaseUrl(baseUrl);
  if (isLocalDevBaseUrl(normalizedBaseUrl)) {
    return DEFAULT_CHM_LOCAL_DEV_API_KEY;
  }

  return null;
}

function buildChmRequestHeaders(
  options: {
    baseUrl?: string;
    apiKey?: string;
    includeJsonContentType?: boolean;
  } = {},
): HeadersInit {
  const headers: Record<string, string> = {};

  if (options.includeJsonContentType) {
    headers["Content-Type"] = "application/json";
  }

  const apiKey = resolveChmApiKey(options.baseUrl, options.apiKey);
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  return headers;
}

function resolveChmUrl(pathname: string, baseUrl?: string): string {
  const normalizedBaseUrl = resolveChmBaseUrl(baseUrl);
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;

  return `${normalizedBaseUrl}${normalizedPath}`;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) ||
    (error instanceof Error && error.name === "AbortError");
}

function createAbortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

function parseRetryAfterHeader(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsedSeconds = Number.parseFloat(value);
  if (Number.isFinite(parsedSeconds)) {
    return Math.max(0, Math.round(parsedSeconds * 1000));
  }

  const parsedDate = Date.parse(value);
  if (!Number.isFinite(parsedDate)) {
    return undefined;
  }

  return Math.max(0, parsedDate - Date.now());
}

function extractMessageFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim();
  }

  const nestedError = record.error;
  if (nestedError && typeof nestedError === "object") {
    const errorRecord = nestedError as Record<string, unknown>;
    if (typeof errorRecord.message === "string" && errorRecord.message.trim()) {
      return errorRecord.message.trim();
    }
  }

  if (typeof record.details === "string" && record.details.trim()) {
    return record.details.trim();
  }

  return null;
}

async function readErrorPayload(response: Response): Promise<{ payload?: unknown; rawText: string }> {
  const rawText = await response.text().catch(() => "");

  if (!rawText) {
    return { rawText: "" };
  }

  try {
    return { payload: JSON.parse(rawText) as unknown, rawText };
  } catch {
    return { rawText };
  }
}

async function throwForChmResponse(response: Response, fallbackMessage: string): Promise<never> {
  const { payload, rawText } = await readErrorPayload(response);
  const payloadMessage = extractMessageFromPayload(payload);
  const retryAfterMs = parseRetryAfterHeader(response.headers.get("retry-after"));
  const status = response.status;

  let message = (payloadMessage ?? rawText.trim()) || fallbackMessage;

  if (status === 401) {
    message = "Invalid API key";
  } else if (status === 404 && !payloadMessage && !rawText.trim()) {
    message = "Job not found";
  }

  throw new ChmApiError(message, {
    status,
    code: typeof (payload as { code?: unknown } | undefined)?.code === "string"
      ? (payload as { code: string }).code
      : undefined,
    details: rawText.trim() || undefined,
    payload,
    retryAfterMs,
  });
}

function extractJobIdFromDownloadUrl(downloadUrl: string): string | null {
  const match = downloadUrl.match(/\/jobs\/([^/]+)\/download(?:\?.*)?$/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function resolveDownloadUrl(jobIdOrDownloadUrl: string, baseUrl?: string): { jobId: string; downloadUrl: string } {
  const trimmedValue = jobIdOrDownloadUrl.trim();

  if (/^https?:\/\//i.test(trimmedValue) || trimmedValue.startsWith("/")) {
    const existingJobId = extractJobIdFromDownloadUrl(trimmedValue);
    if (existingJobId) {
      return { jobId: existingJobId, downloadUrl: trimmedValue };
    }

    return {
      jobId: trimmedValue,
      downloadUrl: trimmedValue,
    };
  }

  return {
    jobId: trimmedValue,
    downloadUrl: resolveChmUrl(`/jobs/${encodeURIComponent(trimmedValue)}/download`, baseUrl),
  };
}

async function waitForDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timeoutHandle = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timeoutHandle);
      signal?.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function createChmJob(
  featureCollection: FeatureCollection<Geometry, GeoJsonProperties>,
  options?: ChmClientOptions,
): Promise<CreateChmJobResponse> {
  const response = await fetch(resolveChmUrl("/jobs", options?.baseUrl), {
    method: "POST",
    headers: buildChmRequestHeaders({
      baseUrl: options?.baseUrl,
      apiKey: options?.apiKey,
      includeJsonContentType: true,
    }),
    body: JSON.stringify({
      geojson: featureCollection,
    }),
    signal: options?.signal,
  });

  if (!response.ok) {
    await throwForChmResponse(response, "CHM extraction job creation failed.");
  }

  return (await response.json()) as CreateChmJobResponse;
}

export async function getChmJob(jobId: string, options?: ChmClientOptions): Promise<GetChmJobResponse> {
  const response = await fetch(resolveChmUrl(`/jobs/${encodeURIComponent(jobId)}`, options?.baseUrl), {
    method: "GET",
    headers: buildChmRequestHeaders({
      baseUrl: options?.baseUrl,
      apiKey: options?.apiKey,
    }),
    cache: "no-store",
    signal: options?.signal,
  });

  if (!response.ok) {
    await throwForChmResponse(response, "CHM extraction job lookup failed.");
  }

  return (await response.json()) as GetChmJobResponse;
}

export async function downloadChmResult(
  jobIdOrDownloadUrl: string,
  options?: ChmClientOptions,
): Promise<ChmDownloadResult> {
  const { jobId, downloadUrl } = resolveDownloadUrl(jobIdOrDownloadUrl, options?.baseUrl);
  const response = await fetch(downloadUrl, {
    method: "GET",
    headers: buildChmRequestHeaders({
      baseUrl: options?.baseUrl,
      apiKey: options?.apiKey,
    }),
    signal: options?.signal,
  });

  if (!response.ok) {
    await throwForChmResponse(response, "CHM extraction download failed.");
  }

  const blob = await response.blob();

  if (blob.size === 0) {
    throw new ChmApiError("Empty CHM extraction download.", {
      status: 502,
      payload: undefined,
    });
  }

  const contentType = response.headers.get("content-type") ?? blob.type ?? "image/tiff";

  return {
    jobId,
    downloadUrl,
    filename: `chm_${jobId}.tif`,
    contentType,
    blob,
  };
}

export async function pollChmJob(
  jobId: string,
  options?: ChmPollOptions,
): Promise<ChmJob> {
  const initialIntervalMs = options?.initialIntervalMs ?? DEFAULT_CHM_INITIAL_POLL_INTERVAL_MS;
  const maxIntervalMs = options?.maxIntervalMs ?? DEFAULT_CHM_MAX_POLL_INTERVAL_MS;
  const backoffIntervalMs = options?.backoffIntervalMs ?? DEFAULT_CHM_429_BACKOFF_MS;
  const backoffMaxIntervalMs = options?.backoffMaxIntervalMs ?? DEFAULT_CHM_429_BACKOFF_MAX_MS;
  const wait = options?.wait ?? waitForDelay;
  let currentIntervalMs = initialIntervalMs;
  let currentBackoffMs = backoffIntervalMs;

  while (true) {
    if (options?.signal?.aborted) {
      throw createAbortError();
    }

    try {
      const job = await getChmJob(jobId, {
        baseUrl: options?.baseUrl,
        apiKey: options?.apiKey,
        signal: options?.signal,
      });

      options?.onUpdate?.(job);
      currentBackoffMs = backoffIntervalMs;

      if (job.status === "queued" || job.status === "running") {
        await wait(currentIntervalMs, options?.signal);
        currentIntervalMs = Math.min(maxIntervalMs, Math.round(currentIntervalMs * 1.5));
        continue;
      }

      return job;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      if (error instanceof ChmApiError && error.status === 429) {
        const nextBackoffMs = Math.max(currentBackoffMs, error.retryAfterMs ?? 0);
        await wait(nextBackoffMs, options?.signal);
        currentBackoffMs = Math.min(backoffMaxIntervalMs, currentBackoffMs * 2);
        continue;
      }

      throw error;
    }
  }
}
