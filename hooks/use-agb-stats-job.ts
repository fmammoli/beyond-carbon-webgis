"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_AGB_STATS_MAX_DURATION_MS,
  formatAgbStatsError,
  type AgbStatsApiError,
  type AgbStatsJobCreateRequest,
  type AgbStatsJobStatus,
  type AgbStatsJobStatusResponse,
  type AgbStatsPollOptions,
  startAgbStatsAndPoll,
} from "@/lib/agb-stats";

type UseAgbStatsJobOptions = Omit<AgbStatsPollOptions, "signal" | "onUpdate" | "wait">;
type AgbStatsJobError = NonNullable<AgbStatsJobStatusResponse["error"]>;

type UseAgbStatsJobState = {
  status: "idle" | "submitting" | AgbStatsJobStatus;
  jobId: string | null;
  progress: number | null;
  etaSeconds: number | null;
  message: string | null;
  error: AgbStatsJobError | null;
  result: AgbStatsJobStatusResponse["result"] | null;
};

type StartJobOptions = {
  signal?: AbortSignal;
};

type UseAgbStatsJobResult = UseAgbStatsJobState & {
  startJob: (
    request: AgbStatsJobCreateRequest,
    options?: StartJobOptions,
  ) => Promise<AgbStatsJobStatusResponse>;
  cancel: () => void;
  reset: () => void;
  isPolling: boolean;
};

const INITIAL_STATE: UseAgbStatsJobState = {
  status: "idle",
  jobId: null,
  progress: null,
  etaSeconds: null,
  message: null,
  error: null,
  result: null,
};

const DEFAULT_AGB_STATS_WATCHDOG_BUFFER_MS = 30_000;
const AGB_STATS_DEBUG_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_AGB_STATS_DEBUG === "1";

function logAgbStatsHookDebug(event: string, details?: Record<string, unknown>) {
  if (!AGB_STATS_DEBUG_ENABLED || typeof console === "undefined") {
    return;
  }

  const timestamp = new Date().toISOString();
  if (details) {
    console.info(`[agb-stats-hook] ${timestamp} ${event}`, details);
    return;
  }

  console.info(`[agb-stats-hook] ${timestamp} ${event}`);
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
  job: AgbStatsJobStatusResponse,
  statusOverride?: UseAgbStatsJobState["status"],
): UseAgbStatsJobState {
  const error = job.status === "failed" || job.status === "cancelled"
    ? {
        code: job.error?.code ?? (job.status === "cancelled" ? "AGB_STATS_JOB_CANCELLED" : "AGB_STATS_JOB_FAILED"),
        message: job.error?.message
          ?? job.message
          ?? (job.status === "cancelled" ? "AGB stats job was cancelled." : "AGB stats job failed."),
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

function createErrorState(error: unknown): UseAgbStatsJobState {
  const message = formatAgbStatsError(error);

  if (isAbortError(error)) {
    return INITIAL_STATE;
  }

  return {
    ...INITIAL_STATE,
    status: "failed",
    message,
    error: {
      code: (error as AgbStatsApiError | undefined)?.code ?? "AGB_STATS_JOB_FAILED",
      message,
    },
  };
}

export function useAgbStatsJob(options?: UseAgbStatsJobOptions): UseAgbStatsJobResult {
  const [state, setState] = useState<UseAgbStatsJobState>(INITIAL_STATE);
  const controllerRef = useRef<AbortController | null>(null);
  const externalCleanupRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const traceCounterRef = useRef(0);

  const resetController = useCallback(() => {
    logAgbStatsHookDebug("reset_controller");
    externalCleanupRef.current?.();
    externalCleanupRef.current = null;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    logAgbStatsHookDebug("cancel_invoked");
    resetController();
    setState(INITIAL_STATE);
  }, [resetController]);

  const reset = useCallback(() => {
    logAgbStatsHookDebug("reset_invoked");
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
    request: AgbStatsJobCreateRequest,
    startOptions?: StartJobOptions,
  ) => {
    resetController();

    traceCounterRef.current += 1;
    const traceId = `agb-stats-${traceCounterRef.current}`;
    const startedAtMs = Date.now();

    logAgbStatsHookDebug("start_job_invoked", {
      traceId,
      baseUrl: options?.baseUrl,
      pollIntervalMs: options?.pollIntervalMs,
      maxDurationMs: options?.maxDurationMs,
      hasPolygonPayload: Boolean(request.geojson),
    });

    const controller = new AbortController();
    controllerRef.current = controller;
    externalCleanupRef.current = linkAbortSignals(controller, startOptions?.signal);

    setState({
      ...INITIAL_STATE,
      status: "submitting",
    });

    const configuredMaxDurationMs = options?.maxDurationMs ?? DEFAULT_AGB_STATS_MAX_DURATION_MS;
    const watchdogTimeoutMs = Math.max(30_000, configuredMaxDurationMs + DEFAULT_AGB_STATS_WATCHDOG_BUFFER_MS);
    let didWatchdogTimeout = false;

    const watchdogHandle = setTimeout(() => {
      didWatchdogTimeout = true;
      controller.abort();
      logAgbStatsHookDebug("watchdog_abort", {
        traceId,
        watchdogTimeoutMs,
        elapsedMs: Date.now() - startedAtMs,
      });
    }, watchdogTimeoutMs);

    try {
      const finalJob = await startAgbStatsAndPoll(request, {
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
          `AGB stats job timed out after ${Math.round(watchdogTimeoutMs / 1000)}s while waiting for updates.`,
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
    isPolling: state.status === "queued" || state.status === "running" || state.status === "deferred",
  };
}
