"use client";

import { MapPlus, PencilLine, Trash2, Upload } from "lucide-react";

import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

type CommunityPolygonItem = {
  fileName: string;
  isVisible: boolean;
  opacity: number;
  groupingColumn: string | null;
  availableGroupingColumns: string[];
  groupCount: number;
  groupingPreview: Array<{ value: string; color: string; count: number }>;
};

type CommunityMapPanelProps = {
  items: CommunityPolygonItem[];
  isDrawingPolygon: boolean;
  drawnVertexCount: number;
  onUploadClick: () => void;
  onStartDrawing: () => void;
  onCancelDrawing: () => void;
  onPolygonFocus: (fileName: string) => void;
  onPolygonVisibilityChange: (fileName: string, visible: boolean) => void;
  onPolygonOpacityChange: (fileName: string, opacity: number) => void;
  onPolygonGroupingColumnChange: (fileName: string, groupingColumn: string | null) => void;
  onPolygonDelete: (fileName: string) => void;
  embedded?: boolean;
};

export function CommunityMapPanel({
  items,
  isDrawingPolygon,
  drawnVertexCount,
  onUploadClick,
  onStartDrawing,
  onCancelDrawing,
  onPolygonFocus,
  onPolygonVisibilityChange,
  onPolygonOpacityChange,
  onPolygonGroupingColumnChange,
  onPolygonDelete,
  embedded = false,
}: CommunityMapPanelProps) {
  const { locale, t } = useI18n();

  const panelContent = (
    <div className="space-y-2.5">
      <div className="sticky top-0 z-20 space-y-2 bg-cyan-50/95 pb-2 backdrop-blur-sm">
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="justify-start"
            onClick={onUploadClick}
          >
            <Upload className="size-4" />
            {t("community.uploadShapefile", "Upload vector")}
          </Button>

          {isDrawingPolygon ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="justify-start"
              onClick={onCancelDrawing}
            >
              <PencilLine className="size-4" />
              {t("common.cancel", "Cancel")}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="default"
              className="justify-start bg-cyan-700 text-white hover:bg-cyan-600"
              onClick={onStartDrawing}
            >
              <PencilLine className="size-4" />
              {t("community.draw", "Draw")}
            </Button>
          )}
        </div>

        {isDrawingPolygon ? (
          <div className="rounded-md border border-cyan-200/80 bg-white/85 px-2 py-1.5 text-xs text-cyan-900/80">
            {t("community.verticesPlaced", "Vertices placed")}: <span className="font-semibold text-cyan-950">{drawnVertexCount}</span>
          </div>
        ) : null}
      </div>

        {items.length > 0 ? (
          <div className="space-y-1.5 border-t border-cyan-200/70 pt-2.5">
            
            <div className="space-y-1.5">
              {items.map((item) => (
                <div
                  key={item.fileName}
                  className="rounded-md border border-cyan-200/80 bg-white/85 px-2 py-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="truncate text-left text-sm text-cyan-950 underline-offset-2 hover:underline focus:outline-none focus-visible:underline"
                          onClick={() => onPolygonFocus(item.fileName)}
                          title={`${t("community.zoomTo", "Zoom to")} ${item.fileName}`}
                        >
                          {item.fileName}
                        </button>
                      </div>
                     
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={item.isVisible}
                        onCheckedChange={(checked) =>
                          onPolygonVisibilityChange(item.fileName, checked)
                        }
                        aria-label={`${t("community.toggleLayer", "Toggle")} ${item.fileName}`}
                      />
                      <Button type="button" variant="ghost" size="icon-xs" aria-label={`${t("community.deleteLayer", "Delete")} ${item.fileName}`} onClick={() => onPolygonDelete(item.fileName)}>
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {item.isVisible ? (
                    <div className="mt-1.5 space-y-1">
                      {item.availableGroupingColumns.length > 0 ? (
                        <div className="space-y-1">
                          <label
                            htmlFor={`group-by-${item.fileName}`}
                            className="text-xs text-cyan-900/70"
                          >
                            {t("community.groupByColumn", "Group By Column")}
                          </label>
                          <select
                            id={`group-by-${item.fileName}`}
                            value={item.groupingColumn ?? "__none__"}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              onPolygonGroupingColumnChange(
                                item.fileName,
                                nextValue === "__none__" ? null : nextValue,
                              );
                            }}
                            className="h-8 w-full rounded-md border border-cyan-200/80 bg-white px-2 text-xs text-cyan-950 outline-none ring-cyan-400 transition focus:ring-2"
                            aria-label={`${t("community.groupPolygonsByColumn", "Group polygons by column")}: ${item.fileName}`}
                          >
                            <option value="__none__">{t("community.noneSingleColor", "None (single color)")}</option>
                            {item.availableGroupingColumns.map((column) => (
                              <option key={column} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                          {item.groupingColumn ? (
                            <>
                              <div className="text-[11px] text-cyan-900/70">
                                {locale === "id"
                                  ? `${item.groupCount} grup berdasarkan ${item.groupingColumn}`
                                  : `${item.groupCount} group${item.groupCount === 1 ? "" : "s"} by ${item.groupingColumn}`}
                              </div>
                              {item.groupingPreview.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {item.groupingPreview.map((group) => (
                                    <div
                                      key={`${item.fileName}:${group.value}`}
                                      className="inline-flex max-w-full items-center gap-1 rounded-full border border-cyan-200/80 bg-white/85 px-2 py-0.5 text-[10px] text-cyan-900"
                                      title={`${group.value}: ${group.count}`}
                                    >
                                      <span
                                        className="h-2 w-2 shrink-0 rounded-full ring-1 ring-cyan-900/15"
                                        style={{ backgroundColor: group.color }}
                                      />
                                      <span className="max-w-24 truncate">{group.value}</span>
                                      <span className="text-cyan-800/70">{group.count}</span>
                                    </div>
                                  ))}
                                  {item.groupCount > item.groupingPreview.length ? (
                                    <div className="inline-flex items-center rounded-full border border-cyan-200/80 bg-white/70 px-2 py-0.5 text-[10px] text-cyan-900/80">
                                      +{item.groupCount - item.groupingPreview.length} {t("community.more", "more")}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="flex items-center justify-between gap-3 text-xs text-cyan-900/70">
                        <span>{t("community.fillOpacity", "Fill Opacity")}</span>
                        <span className="tabular-nums">{Math.round(item.opacity * 100)}%</span>
                      </div>
                      <Slider
                        value={[Math.round(item.opacity * 100)]}
                        min={0}
                        max={100}
                        step={1}
                        onValueChange={(value) => {
                          const nextValue = Array.isArray(value) ? value[0] : value;
                          onPolygonOpacityChange(
                            item.fileName,
                            (nextValue ?? Math.round(item.opacity * 100)) / 100,
                          );
                        }}
                        aria-label={`${t("community.setOpacityFor", "Set opacity for")} ${item.fileName}`}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
    </div>
  );

  if (embedded) {
    return (
      <div className="h-full min-h-0 space-y-2.5 overflow-y-auto pr-1 [-webkit-overflow-scrolling:touch]">
        {panelContent}
      </div>
    );
  }

  return (
    <Card className="flex h-full min-h-0 w-[min(92vw,18rem)] flex-col border-cyan-200/65 bg-cyan-50/90 shadow-lg shadow-cyan-950/10 backdrop-blur-sm">
      <CardHeader className="py-1">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-cyan-950">
          <MapPlus className="size-4" />
          {t("community.panelTitle", "Community Map")}
        </CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pb-3 pr-2 pt-0">
        {panelContent}
      </CardContent>
    </Card>
  );
}

export type { CommunityPolygonItem };