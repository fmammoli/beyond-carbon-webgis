"use client";

import { Loader2, MapPlus, PencilLine, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

type CommunityPolygonItem = {
  fileName: string;
  isVisible: boolean;
  opacity: number;
  isCanopyLoading: boolean;
};

type CommunityMapPanelProps = {
  items: CommunityPolygonItem[];
  isDrawingPolygon: boolean;
  drawnVertexCount: number;
  onUploadClick: () => void;
  onStartDrawing: () => void;
  onCancelDrawing: () => void;
  onPolygonVisibilityChange: (fileName: string, visible: boolean) => void;
  onPolygonOpacityChange: (fileName: string, opacity: number) => void;
  onPolygonDelete: (fileName: string) => void;
};

export function CommunityMapPanel({
  items,
  isDrawingPolygon,
  drawnVertexCount,
  onUploadClick,
  onStartDrawing,
  onCancelDrawing,
  onPolygonVisibilityChange,
  onPolygonOpacityChange,
  onPolygonDelete,
}: CommunityMapPanelProps) {
  return (
    <Card className="flex h-full min-h-0 w-[min(92vw,18rem)] flex-col border-cyan-200/65 bg-cyan-50/90 shadow-lg shadow-cyan-950/10 backdrop-blur-sm">
      <CardHeader className="py-1">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-cyan-950">
          <MapPlus className="size-4" />
          Community Map
        </CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pb-3 pr-2 pt-0">
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="justify-start"
            onClick={onUploadClick}
          >
            <Upload className="size-4" />
            Upload shapefile
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
              Cancel
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
              Draw
            </Button>
          )}
        </div>

        {isDrawingPolygon ? (
          <div className="rounded-md border border-cyan-200/80 bg-white/85 px-2 py-1.5 text-xs text-cyan-900/80">
            Vertices placed: <span className="font-semibold text-cyan-950">{drawnVertexCount}</span>
          </div>
        ) : null}

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
                        {item.isCanopyLoading ? (
                          <Loader2 className="size-3.5 shrink-0 animate-spin text-cyan-800/80" />
                        ) : null}
                        <span className="truncate text-sm text-cyan-950">{item.fileName}</span>
                      </div>
                     
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={item.isVisible}
                        onCheckedChange={(checked) =>
                          onPolygonVisibilityChange(item.fileName, checked)
                        }
                        aria-label={`Toggle ${item.fileName}`}
                      />
                      <Button type="button" variant="ghost" size="icon-xs" aria-label={`Delete ${item.fileName}`} onClick={() => onPolygonDelete(item.fileName)}>
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {item.isVisible ? (
                    <div className="mt-1.5 space-y-1">
                      <div className="flex items-center justify-between gap-3 text-xs text-cyan-900/70">
                        <span>Fill Opacity</span>
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
                        aria-label={`Set opacity for ${item.fileName}`}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export type { CommunityPolygonItem };