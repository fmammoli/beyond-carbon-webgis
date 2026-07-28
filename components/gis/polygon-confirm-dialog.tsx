"use client";

import { Button } from "@/components/ui/button";

type PolygonDraftMetricsView = {
  areaSquareKilometers: number;
  requiredBufferKilometers: number;
  maxAllowedBufferKilometers: number;
  exceedsBufferLimit: boolean;
};

type PolygonConfirmDialogProps = {
  open: boolean;
  metrics: PolygonDraftMetricsView | null;
  capBufferKilometers: number;
  formatArea: (value: number) => string;
  formatKilometers: (value: number) => string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function PolygonConfirmDialog({
  open,
  metrics,
  capBufferKilometers,
  formatArea,
  formatKilometers,
  onCancel,
  onConfirm,
}: PolygonConfirmDialogProps) {
  if (!open || !metrics) {
    return null;
  }

  return (
    <div className="pointer-events-auto absolute inset-0 z-[70] grid place-items-center bg-black/35 px-4">
      <div className="w-full max-w-md rounded-xl border border-cyan-200/80 bg-white p-4 shadow-2xl">
        <h3 className="text-base font-semibold text-cyan-950">Use this polygon?</h3>
        <p className="mt-2 text-sm text-slate-700">
          This flow uses a simplified square boundary.
        </p>
        <div className="mt-3 rounded-lg border border-cyan-200/90 bg-cyan-50/80 px-3 py-2">
          <p className="text-xs text-slate-700">
            Area: <span className="font-semibold text-slate-900">{formatArea(metrics.areaSquareKilometers)} km²</span>
          </p>
          <p className="mt-1 text-xs text-slate-700">
            Buffer from centroid to farthest vertex: <span className="font-semibold text-slate-900">{formatKilometers(metrics.requiredBufferKilometers)} km</span>
          </p>
          <p className="mt-1 text-xs text-slate-700">
            Maximum allowed buffer: <span className="font-semibold text-slate-900">{formatKilometers(metrics.maxAllowedBufferKilometers)} km</span>
          </p>
        </div>
        {metrics.exceedsBufferLimit ? (
          <p className="mt-2 text-xs font-medium text-rose-700">
            This polygon exceeds the max buffer by {formatKilometers(metrics.requiredBufferKilometers - metrics.maxAllowedBufferKilometers)} km. If you confirm, it will be automatically reduced to the maximum centered square.
          </p>
        ) : (
          <p className="mt-2 text-xs font-medium text-emerald-700">
            This polygon is within the {formatKilometers(metrics.maxAllowedBufferKilometers)} centroid buffer limit.
          </p>
        )}
        <p className="mt-1 text-xs text-slate-600">
          The square is capped at {capBufferKilometers.toFixed(0)} km from the center. Cancel to discard and draw another one.
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-cyan-700 text-white hover:bg-cyan-600"
            onClick={onConfirm}
          >
            Confirm polygon
          </Button>
        </div>
      </div>
    </div>
  );
}
