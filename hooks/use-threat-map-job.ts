"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  cancelThreatMapJob,
  createThreatMapJob,
  DEFAULT_THREAT_MAP_POLL_INTERVAL_MS,
  downloadThreatMapArtifact,
  getThreatMapJob,
  isThreatMapDownloadReadyStatus,
  isThreatMapTerminalStatus,
  ThreatMapApiError,
  type CreateThreatMapJobRequest,
  type ThreatMapArtifactDownloadResult,
  type ThreatMapClientOptions,
  type ThreatMapJob,
  type ThreatMapJobError,
  type ThreatMapJobResult,
  type ThreatMapJobStatus,
} from "@/lib/threat-map";
import {
  processThreatMapDownloadedArtifact,
  type ThreatMapBoundaryFrame,
  type ThreatMapEncodingProgress,
} from "@/lib/threat-map-client-encoding";

type UseThreatMapJobState = {
  status: "idle" | "submitting" | ThreatMapJobStatus;
  jobId: string | null;
  progress: number | null;
  etaSeconds: number | null;
  currentYear: number | null;
  message: string | null;
  warnings: string[];
  error: ThreatMapJobError | null;
  result: ThreatMapJobResult | null;
  downloadedArtifact: ThreatMapArtifactDownloadResult | null;
  encodedMp4Blob: Blob | null;
  boundaryFrames: {
    first: ThreatMapBoundaryFrame;
    last: ThreatMapBoundaryFrame;
  } | null;
  encodingError: string | null;
  encodingProgress: ThreatMapEncodingProgress | null;
};

type StartThreatMapJobOptions = {
  signal?: AbortSignal;
};

type UseThreatMapJobOptions = ThreatMapClientOptions & {
  pollIntervalMs?: number;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  autoDownloadOnTerminal?: boolean;
  enableClientEncoding?: boolean;
};

type UseThreatMapJobResult = UseThreatMapJobState & {
  submit: (
    payload: CreateThreatMapJobRequest,
    options?: StartThreatMapJobOptions,
  ) => Promise<ThreatMapJob>;
  cancel: () => Promise<void>;
  reset: () => void;
  retryEncoding: () => Promise<void>;
  downloadLatestArtifact: () => Promise<void>;
  isPolling: boolean;
  isEncoding: boolean;
};

const INITIAL_STATE: UseThreatMapJobState = {
  status: "idle",
  jobId: null,
  progress: null,
  etaSeconds: null,
  currentYear: null,
  message: null,
  warnings: [],
  error: null,
  result: null,
  downloadedArtifact: null,
  encodedMp4Blob: null,
  boundaryFrames: null,
  encodingError: null,
  encodingProgress: null,
};

function createAbortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (error instanceof Error && error.name === "AbortError");
}

function createStateFromJob(
  job: ThreatMapJob,
  statusOverride?: UseThreatMapJobState["status"],
): UseThreatMapJobState {
  const normalizedError =
    job.status === "failed" || job.status === "cancelled"
      ? {
          code: job.error?.code ?? (job.status === "cancelled" ? "THREAT_MAP_JOB_CANCELLED" : "THREAT_MAP_JOB_FAILED"),
          message: job.error?.message ?? job.message ?? "Threat map job failed.",
        }
      : null;

  return {
    ...INITIAL_STATE,
    status: statusOverride ?? job.status,
    jobId: job.jobId,
    progress: job.progress,
    etaSeconds: job.etaSeconds,
    currentYear: job.currentYear,
    message: job.message,
    warnings: job.warnings,
    error: normalizedError,
    result: job.result,
  };
}

function linkAbortSignals(controller: AbortController, externalSignal?: AbortSignal): () => void {
  if (!externalSignal) {
    return () => undefined;
  }

  if (externalSignal.aborted) {
    controller.abort();
    return () => undefined;
  }

  const onAbort = () => {
    controller.abort();
  };

  externalSignal.addEventListener("abort", onAbort, { once: true });
  return () => {
    externalSignal.removeEventListener("abort", onAbort);
  };
}

async function defaultWait(delayMs: number, signal?: AbortSignal): Promise<void> {
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

function toFailedState(error: unknown): UseThreatMapJobState {
  if (isAbortError(error)) {
    return INITIAL_STATE;
  }

  if (error instanceof ThreatMapApiError) {
    return {
      ...INITIAL_STATE,
      status: "failed",
      message: error.message,
      error: {
        code: error.code ?? `HTTP_${error.status}`,
        message: error.message,
      },
    };
  }

  return {
    ...INITIAL_STATE,
    status: "failed",
    message: error instanceof Error ? error.message : "Threat map request failed.",
    error: {
      code: "THREAT_MAP_JOB_FAILED",
      message: error instanceof Error ? error.message : "Threat map request failed.",
    },
  };
}

export function useThreatMapJob(options?: UseThreatMapJobOptions): UseThreatMapJobResult {
  const [state, setState] = useState<UseThreatMapJobState>(INITIAL_STATE);
  const controllerRef = useRef<AbortController | null>(null);
  const externalCleanupRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);

  const latestArtifactRef = useRef<ThreatMapArtifactDownloadResult | null>(null);

  const resetController = useCallback(() => {
    externalCleanupRef.current?.();
    externalCleanupRef.current = null;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const reset = useCallback(() => {
    resetController();
    latestArtifactRef.current = null;
    setState(INITIAL_STATE);
  }, [resetController]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      resetController();
    };
  }, [resetController]);

  const applyDownloadedArtifact = useCallback(async (
    job: ThreatMapJob,
    controller: AbortController,
  ) => {
    const downloaded = await downloadThreatMapArtifact(job.jobId, {
      baseUrl: options?.baseUrl,
      apiKey: options?.apiKey,
      signal: controller.signal,
      expectedArtifactType: job.result?.artifactType ?? undefined,
    });

    latestArtifactRef.current = downloaded;

    if (!mountedRef.current || controllerRef.current !== controller) {
      return;
    }

    setState((previous) => ({
      ...previous,
      downloadedArtifact: downloaded,
      boundaryFrames: null,
      encodingError: null,
      encodingProgress: null,
      warnings: Array.from(new Set([
        ...previous.warnings,
        ...(downloaded.artifactType === "zip"
          ? ["Server produced ZIP fallback output; client-side encoding will use extracted frames."]
          : []),
      ])),
    }));

    if (downloaded.artifactType === "mp4" || options?.enableClientEncoding === false) {
      return;
    }

    const processed = await processThreatMapDownloadedArtifact(downloaded, {
      useWorker: true,
      onProgress: (progress) => {
        if (!mountedRef.current || controllerRef.current !== controller) {
          return;
        }

        setState((previous) => ({
          ...previous,
          encodingProgress: progress,
          encodingError: null,
        }));
      },
    });

    if (!mountedRef.current || controllerRef.current !== controller) {
      return;
    }

    setState((previous) => ({
      ...previous,
      encodedMp4Blob: processed.encodedMp4Blob,
      boundaryFrames: processed.boundaryFrames,
      warnings: Array.from(new Set([...previous.warnings, ...processed.warnings])),
      encodingProgress: {
        stage: "encoding",
        completed: processed.frames.length,
        total: processed.frames.length,
        message: `Encoded ${processed.frames.length} frames to MP4`,
      },
      encodingError: null,
    }));
  }, [options?.apiKey, options?.baseUrl, options?.enableClientEncoding]);

  const runPollLoop = useCallback(async (jobId: string, controller: AbortController) => {
    const wait = options?.wait ?? defaultWait;
    const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_THREAT_MAP_POLL_INTERVAL_MS;

    while (true) {
      await wait(pollIntervalMs, controller.signal);

      const nextJob = await getThreatMapJob(jobId, {
        baseUrl: options?.baseUrl,
        apiKey: options?.apiKey,
        signal: controller.signal,
      });

      if (!mountedRef.current || controllerRef.current !== controller) {
        return;
      }

      setState((previous) => ({
        ...previous,
        ...createStateFromJob(nextJob, nextJob.status),
        downloadedArtifact: previous.downloadedArtifact,
        encodedMp4Blob: previous.encodedMp4Blob,
        boundaryFrames: previous.boundaryFrames,
        encodingError: previous.encodingError,
        encodingProgress: previous.encodingProgress,
      }));

      if (!isThreatMapTerminalStatus(nextJob.status)) {
        continue;
      }

      if (isThreatMapDownloadReadyStatus(nextJob.status) && options?.autoDownloadOnTerminal !== false) {
        try {
          await applyDownloadedArtifact(nextJob, controller);
        } catch (error) {
          if (!mountedRef.current || controllerRef.current !== controller) {
            return;
          }

          if (!isAbortError(error)) {
            setState((previous) => ({
              ...previous,
              encodingError: error instanceof Error ? error.message : "Failed to process threat map artifact.",
            }));
          }
        }
      }

      return;
    }
  }, [applyDownloadedArtifact, options?.apiKey, options?.autoDownloadOnTerminal, options?.baseUrl, options?.pollIntervalMs, options?.wait]);

  const submit = useCallback(async (
    payload: CreateThreatMapJobRequest,
    startOptions?: StartThreatMapJobOptions,
  ) => {
    resetController();
    latestArtifactRef.current = null;

    const controller = new AbortController();
    controllerRef.current = controller;
    externalCleanupRef.current = linkAbortSignals(controller, startOptions?.signal);

    setState({
      ...INITIAL_STATE,
      status: "submitting",
    });

    try {
      const created = await createThreatMapJob(payload, {
        baseUrl: options?.baseUrl,
        apiKey: options?.apiKey,
        signal: controller.signal,
      });

      const initialJob: ThreatMapJob = {
        jobId: created.jobId,
        status: created.status,
        createdAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
        progress: null,
        etaSeconds: null,
        currentYear: null,
        message: created.message,
        warnings: [],
        result: null,
        error: null,
      };

      if (!mountedRef.current || controllerRef.current !== controller) {
        return initialJob;
      }

      setState((previous) => ({
        ...previous,
        ...createStateFromJob(initialJob, initialJob.status),
      }));

      if (isThreatMapTerminalStatus(initialJob.status)) {
        if (isThreatMapDownloadReadyStatus(initialJob.status) && options?.autoDownloadOnTerminal !== false) {
          await applyDownloadedArtifact(initialJob, controller);
        }
        return initialJob;
      }

      void runPollLoop(initialJob.jobId, controller)
        .catch((error) => {
          if (!mountedRef.current || controllerRef.current !== controller) {
            return;
          }

          if (isAbortError(error)) {
            setState(INITIAL_STATE);
            return;
          }

          setState(toFailedState(error));
        })
        .finally(() => {
          if (controllerRef.current === controller) {
            externalCleanupRef.current?.();
            externalCleanupRef.current = null;
            controllerRef.current = null;
          }
        });

      return initialJob;
    } catch (error) {
      if (!mountedRef.current || controllerRef.current !== controller) {
        throw error;
      }

      if (isAbortError(error)) {
        setState(INITIAL_STATE);
        throw error;
      }

      setState(toFailedState(error));
      throw error;
    }
  }, [applyDownloadedArtifact, options?.apiKey, options?.autoDownloadOnTerminal, options?.baseUrl, resetController, runPollLoop]);

  const cancel = useCallback(async () => {
    const activeJobId = state.jobId;
    resetController();

    if (!activeJobId) {
      setState(INITIAL_STATE);
      return;
    }

    try {
      const cancelledJob = await cancelThreatMapJob(activeJobId, {
        baseUrl: options?.baseUrl,
        apiKey: options?.apiKey,
      });

      if (!mountedRef.current) {
        return;
      }

      setState((previous) => ({
        ...previous,
        ...createStateFromJob(cancelledJob, cancelledJob.status),
      }));
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }

      setState(toFailedState(error));
    }
  }, [options?.apiKey, options?.baseUrl, resetController, state.jobId]);

  const retryEncoding = useCallback(async () => {
    const downloaded = latestArtifactRef.current;
    if (!downloaded) {
      throw new Error("No threat map artifact is available for encoding retry.");
    }

    if (downloaded.artifactType === "mp4") {
      throw new Error("The downloaded artifact is already an MP4 file.");
    }

    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const processed = await processThreatMapDownloadedArtifact(downloaded, {
        useWorker: true,
        onProgress: (progress) => {
          setState((previous) => ({
            ...previous,
            encodingProgress: progress,
            encodingError: null,
          }));
        },
      });

      setState((previous) => ({
        ...previous,
        encodedMp4Blob: processed.encodedMp4Blob,
        boundaryFrames: processed.boundaryFrames,
        warnings: Array.from(new Set([...previous.warnings, ...processed.warnings])),
        encodingError: null,
      }));
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      setState((previous) => ({
        ...previous,
        encodingError: error instanceof Error ? error.message : "Failed to encode frames to MP4.",
      }));
      throw error;
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, []);

  const downloadLatestArtifact = useCallback(async () => {
    if (!state.jobId) {
      throw new Error("No threat map job is available to download.");
    }

    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const jobSnapshot = await getThreatMapJob(state.jobId, {
        baseUrl: options?.baseUrl,
        apiKey: options?.apiKey,
        signal: controller.signal,
      });

      await applyDownloadedArtifact(jobSnapshot, controller);
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, [applyDownloadedArtifact, options?.apiKey, options?.baseUrl, state.jobId]);

  return {
    ...state,
    submit,
    cancel,
    reset,
    retryEncoding,
    downloadLatestArtifact,
    isPolling: state.status === "deferred" || state.status === "queued" || state.status === "running",
    isEncoding: state.encodingProgress?.stage === "encoding"
      && state.encodingProgress.completed < state.encodingProgress.total,
  };
}
