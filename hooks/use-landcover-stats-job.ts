"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_LANDCOVER_STATS_MAX_DURATION_MS,
  formatLandcoverStatsError,
  type LandcoverStatsApiError,
  type LandcoverStatsJobCreateRequest,
  type LandcoverStatsJobStatus,
  type LandcoverStatsJobStatusResponse,
  type LandcoverStatsPollOptions,
  startLandcoverStatsAndPoll,
} from "@/lib/landcover-stats";

type UseLandcoverStatsJobOptions = Omit<LandcoverStatsPollOptions, "signal" | "onUpdate" | "wait">;
type LandcoverStatsJobError = NonNullable<LandcoverStatsJobStatusResponse["error"]>;

type UseLandcoverStatsJobState = {
  status: "idle" | "submitting" | LandcoverStatsJobStatus;
  jobId: string | null;
  progress: number | null;
  etaSeconds: number | null;
  message: string | null;
  error: LandcoverStatsJobError | null;
  result: LandcoverStatsJobStatusResponse["result"] | null;
};

type StartJobOptions = {
  signal?: AbortSignal;
};

type UseLandcoverStatsJobResult = UseLandcoverStatsJobState & {
  startJob: (
    request: LandcoverStatsJobCreateRequest,
    options?: StartJobOptions,
  ) => Promise<LandcoverStatsJobStatusResponse>;
  cancel: () => void;
  isPolling: boolean;
};

const INITIAL_STATE: UseLandcoverStatsJobState = {
  status: "idle",
  jobId: null,
  progress: null,
  etaSeconds: null,
  message: null,
  error: null,
  result: null,
};

const DEFAULT_LANDCOVER_STATS_WATCHDOG_BUFFER_MS = 30_000;
const LANDCOVER_STATS_DEBUG_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_LANDCOVER_STATS_DEBUG === "1";

function logLandcoverStatsHookDebug(event: string, details?: Record<string, unknown>) {
  if (!LANDCOVER_STATS_DEBUG_ENABLED || typeof console === "undefined") {
    return;
  }

  const timestamp = new Date().toISOString();
  if (details) {
    console.info(`[landcover-stats-hook] ${timestamp} ${event}`, details);
    return;
  }

  console.info(`[landcover-stats-hook] ${timestamp} ${event}`);
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) ||
    (error instanceof Error && error.name === "AbortError");
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

function createStateFromJob(
  job: LandcoverStatsJobStatusResponse,
  statusOverride?: UseLandcoverStatsJobState["status"],
): UseLandcoverStatsJobState {
  const error = job.status === "failed"
    ? {
        code: job.error?.code ?? "LANDCOVER_STATS_JOB_FAILED",
        message: job.error?.message ?? job.message ?? "Landcover stats job failed.",
      }
    : null;

  return {
    status: statusOverride ?? job.status,
    jobId: job.jobId,
    progress: job.progress ?? null,
    etaSeconds: job.etaSeconds ?? null,
    message: job.message ?? null,
    error,
    result: job.result ?? null,
  };
}

function createErrorState(error: unknown): UseLandcoverStatsJobState {
  const message = formatLandcoverStatsError(error);

  if (isAbortError(error)) {
    return INITIAL_STATE;
  }

  return {
    ...INITIAL_STATE,
    status: "failed",
    message,
    error: {
      code: (error as LandcoverStatsApiError | undefined)?.code ?? "LANDCOVER_STATS_JOB_FAILED",
      message,
    },
  };
}

export function useLandcoverStatsJob(options?: UseLandcoverStatsJobOptions): UseLandcoverStatsJobResult {
  const [state, setState] = useState<UseLandcoverStatsJobState>(INITIAL_STATE);
  const controllerRef = useRef<AbortController | null>(null);
  const externalCleanupRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const traceCounterRef = useRef(0);

  const resetController = useCallback(() => {
    logLandcoverStatsHookDebug("reset_controller");
    externalCleanupRef.current?.();
    externalCleanupRef.current = null;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    logLandcoverStatsHookDebug("cancel_invoked");
    resetController();
    setState(INITIAL_STATE);
  }, [resetController]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      resetController();
    };
  }, [resetController]);

  const startJob = useCallback(async (
    request: LandcoverStatsJobCreateRequest,
    startOptions?: StartJobOptions,
  ) => {
    resetController();

    traceCounterRef.current += 1;
    const traceId = `lc-${traceCounterRef.current}`;
    const startedAtMs = Date.now();

    logLandcoverStatsHookDebug("start_job_invoked", {
      traceId,
      baselineYear: request.baselineYear,
      comparisonYear: request.comparisonYear,
      baseUrl: options?.baseUrl,
      pollIntervalMs: options?.pollIntervalMs,
      maxDurationMs: options?.maxDurationMs,
    });

    const controller = new AbortController();
    controllerRef.current = controller;
    externalCleanupRef.current = linkAbortSignals(controller, startOptions?.signal);

    setState({
      ...INITIAL_STATE,
      status: "submitting",
    });

    logLandcoverStatsHookDebug("state_submitting", {
      traceId,
      elapsedMs: Date.now() - startedAtMs,
    });

    const configuredMaxDurationMs = options?.maxDurationMs ?? DEFAULT_LANDCOVER_STATS_MAX_DURATION_MS;
    const watchdogTimeoutMs = Math.max(30_000, configuredMaxDurationMs + DEFAULT_LANDCOVER_STATS_WATCHDOG_BUFFER_MS);
    let didWatchdogTimeout = false;

    const watchdogHandle = setTimeout(() => {
      didWatchdogTimeout = true;
      controller.abort();
      logLandcoverStatsHookDebug("watchdog_abort", {
        traceId,
        watchdogTimeoutMs,
        elapsedMs: Date.now() - startedAtMs,
      });
    }, watchdogTimeoutMs);

    try {
      const finalJob = await startLandcoverStatsAndPoll(request, {
        baseUrl: options?.baseUrl,
        apiKey: options?.apiKey,
        pollIntervalMs: options?.pollIntervalMs,
        maxDurationMs: options?.maxDurationMs,
        maxRetries: options?.maxRetries,
        maxRetryDelayMs: options?.maxRetryDelayMs,
        signal: controller.signal,
        onUpdate: (job) => {
          if (!mountedRef.current || controllerRef.current !== controller) {
            logLandcoverStatsHookDebug("on_update_ignored", {
              traceId,
              elapsedMs: Date.now() - startedAtMs,
            });
            return;
          }

          logLandcoverStatsHookDebug("on_update", {
            traceId,
            status: job.status,
            jobId: job.jobId,
            progress: job.progress ?? null,
            etaSeconds: job.etaSeconds ?? null,
            message: job.message ?? null,
            elapsedMs: Date.now() - startedAtMs,
          });

          setState({
            ...createStateFromJob(job),
            status: job.status,
          });
        },
      });

      if (!mountedRef.current || controllerRef.current !== controller) {
        logLandcoverStatsHookDebug("final_job_ignored", {
          traceId,
          status: finalJob.status,
          jobId: finalJob.jobId,
          elapsedMs: Date.now() - startedAtMs,
        });
        return finalJob;
      }

      logLandcoverStatsHookDebug("final_job", {
        traceId,
        status: finalJob.status,
        jobId: finalJob.jobId,
        elapsedMs: Date.now() - startedAtMs,
      });

      setState({
        ...createStateFromJob(finalJob),
        status: finalJob.status,
      });

      return finalJob;
    } catch (error) {
      if (!mountedRef.current || controllerRef.current !== controller) {
        logLandcoverStatsHookDebug("error_ignored", {
          traceId,
          elapsedMs: Date.now() - startedAtMs,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      if (didWatchdogTimeout) {
        const timeoutError = new Error(
          `Landcover stats job timed out after ${Math.round(watchdogTimeoutMs / 1000)}s while waiting for updates.`,
        );
        logLandcoverStatsHookDebug("watchdog_timeout_error", {
          traceId,
          elapsedMs: Date.now() - startedAtMs,
          message: timeoutError.message,
        });
        setState(createErrorState(timeoutError));
        throw timeoutError;
      }

      if (isAbortError(error)) {
        logLandcoverStatsHookDebug("abort_error", {
          traceId,
          elapsedMs: Date.now() - startedAtMs,
          error: error instanceof Error ? error.message : String(error),
        });
        setState(INITIAL_STATE);
        return Promise.reject(error);
      }

      logLandcoverStatsHookDebug("job_error", {
        traceId,
        elapsedMs: Date.now() - startedAtMs,
        error: error instanceof Error ? error.message : String(error),
      });

      setState(createErrorState(error));
      throw error;
    } finally {
      clearTimeout(watchdogHandle);

      logLandcoverStatsHookDebug("start_job_finally", {
        traceId,
        elapsedMs: Date.now() - startedAtMs,
      });

      if (controllerRef.current === controller) {
        externalCleanupRef.current?.();
        externalCleanupRef.current = null;
        controllerRef.current = null;
      }
    }
  }, [options, resetController]);

  return {
    ...state,
    startJob,
    cancel,
    isPolling: state.status === "queued" || state.status === "running",
  };
}