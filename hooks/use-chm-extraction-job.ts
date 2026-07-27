"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeatureCollection, GeoJsonProperties, Geometry } from "geojson";

import {
  ChmApiError,
  createChmJob,
  downloadChmResult,
  pollChmJob,
  type ChmJobError,
  type ChmDownloadResult,
  type ChmJob,
  type ChmJobResult,
  type ChmJobStatus,
  type ChmPollOptions,
} from "@/lib/chm-extraction";

type UseChmExtractionJobOptions = ChmPollOptions;

type UseChmExtractionJobState = {
  status: "idle" | "submitting" | ChmJobStatus;
  jobId: string | null;
  progress: number | null;
  etaSeconds: number | null;
  message: string | null;
  error: ChmJobError | null;
  result: ChmJobResult | null;
};

type StartJobOptions = {
  signal?: AbortSignal;
};

type UseChmExtractionJobResult = UseChmExtractionJobState & {
  startJob: (
    featureCollection: FeatureCollection<Geometry, GeoJsonProperties>,
    options?: StartJobOptions,
  ) => Promise<ChmJob>;
  download: () => Promise<ChmDownloadResult>;
  isPolling: boolean;
  cancel: () => void;
};

const INITIAL_STATE: UseChmExtractionJobState = {
  status: "idle",
  jobId: null,
  progress: null,
  etaSeconds: null,
  message: null,
  error: null,
  result: null,
};

function createStateFromJob(job: ChmJob, statusOverride?: UseChmExtractionJobState["status"]): UseChmExtractionJobState {
  const error = job.status === "failed"
    ? {
        code: job.error?.code ?? "CHM_JOB_FAILED",
        message: job.error?.message ?? job.message ?? "CHM extraction failed.",
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

export function useChmExtractionJob(options?: UseChmExtractionJobOptions): UseChmExtractionJobResult {
  const [state, setState] = useState<UseChmExtractionJobState>(INITIAL_STATE);
  const controllerRef = useRef<AbortController | null>(null);
  const externalCleanupRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);

  const resetController = useCallback(() => {
    externalCleanupRef.current?.();
    externalCleanupRef.current = null;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    resetController();
    setState(INITIAL_STATE);
  }, [resetController]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      resetController();
    };
  }, [resetController]);

  const startJob = useCallback(async (
    featureCollection: FeatureCollection<Geometry, GeoJsonProperties>,
    startOptions?: StartJobOptions,
  ) => {
    resetController();

    const controller = new AbortController();
    controllerRef.current = controller;
    externalCleanupRef.current = linkAbortSignals(controller, startOptions?.signal);

    setState({
      ...INITIAL_STATE,
      status: "submitting",
    });

    try {
      const createdJob = await createChmJob(featureCollection, {
        baseUrl: options?.baseUrl,
        signal: controller.signal,
      });

      if (!mountedRef.current || controllerRef.current !== controller) {
        return createdJob;
      }

      const createdState = createStateFromJob(createdJob);

      setState({
        ...createdState,
        status: createdJob.status,
      });

      if (createdJob.status !== "queued" && createdJob.status !== "running") {
        return createdJob;
      }

      void pollChmJob(createdJob.jobId, {
        baseUrl: options?.baseUrl,
        signal: controller.signal,
        initialIntervalMs: options?.initialIntervalMs,
        maxIntervalMs: options?.maxIntervalMs,
        backoffIntervalMs: options?.backoffIntervalMs,
        wait: options?.wait,
        onUpdate: (job) => {
          if (!mountedRef.current || controllerRef.current !== controller) {
            return;
          }

          setState({
            ...createStateFromJob(job),
            status: job.status,
          });
        },
      })
        .then((finalJob) => {
          if (!mountedRef.current || controllerRef.current !== controller) {
            return;
          }

          setState({
            ...createStateFromJob(finalJob),
            status: finalJob.status,
          });
        })
        .catch((error) => {
          if (!mountedRef.current || controllerRef.current !== controller) {
            return;
          }

          if (isAbortError(error)) {
            setState(INITIAL_STATE);
            return;
          }

          const message = error instanceof Error ? error.message : "CHM extraction failed.";
          setState({
            ...INITIAL_STATE,
            status: "failed",
            error: {
              code: error instanceof ChmApiError ? error.code ?? `HTTP_${error.status}` : "CHM_JOB_FAILED",
              message,
            },
            message,
          });
        })
        .finally(() => {
          if (controllerRef.current === controller) {
            externalCleanupRef.current?.();
            externalCleanupRef.current = null;
            controllerRef.current = null;
          }
        });

      return createdJob;
    } catch (error) {
      if (!mountedRef.current || controllerRef.current !== controller) {
        throw error;
      }

      if (isAbortError(error)) {
        setState(INITIAL_STATE);
        return Promise.reject(error);
      }

      const message = error instanceof Error ? error.message : "CHM extraction failed.";
      setState({
        ...INITIAL_STATE,
        status: "failed",
        error: {
          code: error instanceof ChmApiError ? error.code ?? `HTTP_${error.status}` : "CHM_JOB_FAILED",
          message,
        },
        message,
      });
      throw error;
    }
  }, [options, resetController]);

  const download = useCallback(async () => {
    if (!state.jobId) {
      throw new Error("No CHM job is available to download.");
    }

    return downloadChmResult(state.result?.downloadUrl ?? state.jobId, {
      baseUrl: options?.baseUrl,
      signal: controllerRef.current?.signal,
    });
  }, [options, state.jobId, state.result?.downloadUrl]);

  return {
    ...state,
    startJob,
    download,
    cancel,
    isPolling: state.status === "queued" || state.status === "running",
  };
}
