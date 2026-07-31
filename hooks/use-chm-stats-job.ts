"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_CHM_STATS_MAX_DURATION_MS,
  formatChmStatsError,
  type ChmStatsApiError,
  type ChmStatsJobCreateRequest,
  type ChmStatsJobStatus,
  type ChmStatsJobStatusResponse,
  type ChmStatsPollOptions,
  startChmStatsAndPoll,
} from "@/lib/chm-stats";

type UseChmStatsJobOptions = Omit<ChmStatsPollOptions, "signal" | "onUpdate" | "wait">;
type ChmStatsJobError = NonNullable<ChmStatsJobStatusResponse["error"]>;

type UseChmStatsJobState = {
  status: "idle" | "submitting" | ChmStatsJobStatus;
  jobId: string | null;
  progress: number | null;
  etaSeconds: number | null;
  message: string | null;
  error: ChmStatsJobError | null;
  result: ChmStatsJobStatusResponse["result"] | null;
};

type StartJobOptions = {
  signal?: AbortSignal;
};

type UseChmStatsJobResult = UseChmStatsJobState & {
  startJob: (
    request: ChmStatsJobCreateRequest,
    options?: StartJobOptions,
  ) => Promise<ChmStatsJobStatusResponse>;
  cancel: () => void;
  reset: () => void;
  isPolling: boolean;
};

const INITIAL_STATE: UseChmStatsJobState = {
  status: "idle",
  jobId: null,
  progress: null,
  etaSeconds: null,
  message: null,
  error: null,
  result: null,
};

const DEFAULT_CHM_STATS_WATCHDOG_BUFFER_MS = 30_000;
const CHM_STATS_DEBUG_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_CHM_STATS_DEBUG === "1";

function logChmStatsHookDebug(event: string, details?: Record<string, unknown>) {
  if (!CHM_STATS_DEBUG_ENABLED || typeof console === "undefined") {
    return;
  }

  const timestamp = new Date().toISOString();
  if (details) {
    console.info(`[chm-stats-hook] ${timestamp} ${event}`, details);
    return;
  }

  console.info(`[chm-stats-hook] ${timestamp} ${event}`);
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
  job: ChmStatsJobStatusResponse,
  statusOverride?: UseChmStatsJobState["status"],
): UseChmStatsJobState {
  const error = job.status === "failed"
    ? {
        code: job.error?.code ?? "CHM_STATS_JOB_FAILED",
        message: job.error?.message ?? job.message ?? "CHM stats job failed.",
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

function createErrorState(error: unknown): UseChmStatsJobState {
  const message = formatChmStatsError(error);

  if (isAbortError(error)) {
    return INITIAL_STATE;
  }

  return {
    ...INITIAL_STATE,
    status: "failed",
    message,
    error: {
      code: (error as ChmStatsApiError | undefined)?.code ?? "CHM_STATS_JOB_FAILED",
      message,
    },
  };
}

export function useChmStatsJob(options?: UseChmStatsJobOptions): UseChmStatsJobResult {
  const [state, setState] = useState<UseChmStatsJobState>(INITIAL_STATE);
  const controllerRef = useRef<AbortController | null>(null);
  const externalCleanupRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const traceCounterRef = useRef(0);

  const resetController = useCallback(() => {
    logChmStatsHookDebug("reset_controller");
    externalCleanupRef.current?.();
    externalCleanupRef.current = null;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    logChmStatsHookDebug("cancel_invoked");
    resetController();
    setState(INITIAL_STATE);
  }, [resetController]);

  const reset = useCallback(() => {
    logChmStatsHookDebug("reset_invoked");
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
    request: ChmStatsJobCreateRequest,
    startOptions?: StartJobOptions,
  ) => {
    resetController();

    traceCounterRef.current += 1;
    const traceId = `chm-stats-${traceCounterRef.current}`;
    const startedAtMs = Date.now();

    logChmStatsHookDebug("start_job_invoked", {
      traceId,
      baseUrl: options?.baseUrl,
      pollIntervalMs: options?.pollIntervalMs,
      maxDurationMs: options?.maxDurationMs,
      hasCustomThresholds: Boolean(request.canopyThresholdsM?.length),
    });

    const controller = new AbortController();
    controllerRef.current = controller;
    externalCleanupRef.current = linkAbortSignals(controller, startOptions?.signal);

    setState({
      ...INITIAL_STATE,
      status: "submitting",
    });

    const configuredMaxDurationMs = options?.maxDurationMs ?? DEFAULT_CHM_STATS_MAX_DURATION_MS;
    const watchdogTimeoutMs = Math.max(30_000, configuredMaxDurationMs + DEFAULT_CHM_STATS_WATCHDOG_BUFFER_MS);
    let didWatchdogTimeout = false;

    const watchdogHandle = setTimeout(() => {
      didWatchdogTimeout = true;
      controller.abort();
      logChmStatsHookDebug("watchdog_abort", {
        traceId,
        watchdogTimeoutMs,
        elapsedMs: Date.now() - startedAtMs,
      });
    }, watchdogTimeoutMs);

    try {
      const finalJob = await startChmStatsAndPoll(request, {
        baseUrl: options?.baseUrl,
        apiKey: options?.apiKey,
        pollIntervalMs: options?.pollIntervalMs,
        maxDurationMs: options?.maxDurationMs,
        maxRetries: options?.maxRetries,
        maxRetryDelayMs: options?.maxRetryDelayMs,
        signal: controller.signal,
        onUpdate: (job) => {
          if (!mountedRef.current || controllerRef.current !== controller) {
            return;
          }

          setState({
            ...createStateFromJob(job),
            status: job.status,
          });
        },
      });

      if (!mountedRef.current || controllerRef.current !== controller) {
        return finalJob;
      }

      setState({
        ...createStateFromJob(finalJob),
        status: finalJob.status,
      });

      return finalJob;
    } catch (error) {
      if (!mountedRef.current || controllerRef.current !== controller) {
        throw error;
      }

      if (didWatchdogTimeout) {
        const timeoutError = new Error(
          `CHM stats job timed out after ${Math.round(watchdogTimeoutMs / 1000)}s while waiting for updates.`,
        );
        setState(createErrorState(timeoutError));
        throw timeoutError;
      }

      if (isAbortError(error)) {
        setState(INITIAL_STATE);
        return Promise.reject(error);
      }

      setState(createErrorState(error));
      throw error;
    } finally {
      clearTimeout(watchdogHandle);

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
    reset,
    isPolling: state.status === "queued" || state.status === "running",
  };
}
