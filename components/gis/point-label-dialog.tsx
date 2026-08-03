"use client";

import { useRef } from "react";

import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";

type PointLabelDialogProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: (label: string) => void;
};

export function PointLabelDialog({
  open,
  onCancel,
  onConfirm,
}: PointLabelDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { t } = useI18n();

  if (!open) {
    return null;
  }

  return (
    <div className="pointer-events-auto absolute inset-0 z-[70] grid place-items-center bg-black/35 px-4">
      <div className="w-full max-w-md rounded-xl border border-cyan-200/80 bg-white p-4 shadow-2xl">
        <h3 className="text-base font-semibold text-cyan-950">{t("pointDialog.title", "Save this point marker?")}</h3>
        <p className="mt-2 text-sm text-slate-700">
          {t("pointDialog.description", "Add an optional name to display on the map and include in Threat Map export.")}
        </p>
        <div className="mt-3">
          <label htmlFor="community-point-label" className="mb-1 block text-xs font-medium text-slate-700">
            {t("pointDialog.label", "Point label (optional)")}
          </label>
          <input
            id="community-point-label"
            type="text"
            ref={inputRef}
            placeholder={t("pointDialog.placeholder", "e.g. Mekar Raya")}
            className="h-9 w-full rounded-md border border-cyan-200 bg-white px-3 text-sm text-cyan-950 outline-none ring-offset-cyan-50 placeholder:text-slate-400 focus:ring-2 focus:ring-cyan-300"
            autoFocus
          />
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            type="button"
            className="bg-cyan-700 text-white hover:bg-cyan-600"
            onClick={() => {
              onConfirm(inputRef.current?.value ?? "");
            }}
          >
            {t("pointDialog.savePoint", "Save point")}
          </Button>
        </div>
      </div>
    </div>
  );
}
