"use client";

import { useMemo } from "react";
import { ChevronDown, ListTree } from "lucide-react";

import { MAPBIOMAS_CLASSES } from "@/lib/mapbiomas-colors";
import { CANOPY_COLOR_STOPS } from "@/lib/geotiff-layer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

type ActiveLegendLayer =
  | {
      id: string;
      kind: "landcover";
      title: string;
    }
  | {
      id: string;
      kind: "vector";
      title: string;
      fillOpacity: number;
    }
  | {
      id: string;
      kind: "canopy";
      title: string;
      isLoading: boolean;
    };

type LegendProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeLayers: ActiveLegendLayer[];
};

const TOP_LEVEL_LABELS: Record<string, { en: string; id: string }> = {
  "1": { en: "Forest", id: "Hutan" },
  "2": { en: "Natural Vegetation", id: "Vegetasi Alami" },
  "3": { en: "Agriculture", id: "Pertanian" },
  "4": { en: "Non-Vegetation", id: "Non-Vegetasi" },
  "5": { en: "Water", id: "Perairan" },
  "6": { en: "Not Observed", id: "Tidak Teramati" },
};

const CLASS_LABEL_TRANSLATIONS_ID: Record<string, string> = {
  "Forest Formation": "Formasi Hutan",
  Mangrove: "Mangrove",
  "Peat Swamp Forest": "Hutan Rawa Gambut",
  "Non-Forest Natural Vegetation": "Vegetasi Alami Non-Hutan",
  "Rice Paddy": "Sawah",
  "Oil Palm": "Kelapa Sawit",
  "Pulpwood Plantation": "Hutan Tanaman Industri",
  "Other Agriculture": "Pertanian Lainnya",
  "Mining Pit": "Area Tambang",
  "Urban Area": "Kawasan Perkotaan",
  "Other Non-Vegetation": "Non-Vegetasi Lainnya",
  Aquaculture: "Akuakultur",
  "River, Lake, Ocean": "Sungai, Danau, Laut",
  "Not Observed / Clouds": "Tidak Teramati / Awan",
};

function getTopLevelKey(label: string): string {
  const match = label.match(/^(\d+)\./);
  if (match?.[1]) {
    return match[1];
  }

  return "Other";
}

function getCompactLabel(label: string): string {
  return label.replace(/^\d+\.\d+\s*/, "");
}

function getIndonesianLabel(englishLabel: string): string {
  return CLASS_LABEL_TRANSLATIONS_ID[englishLabel] ?? englishLabel;
}

function colorStopToCssColor(color: [number, number, number, number]): string {
  const [red, green, blue, alpha] = color;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function LandcoverLegendPanel() {
  const groupedClasses = useMemo(() => {
    const grouped = new Map<
      string,
      {
        key: string;
        title: { en: string; id: string };
        items: typeof MAPBIOMAS_CLASSES;
      }
    >();

    MAPBIOMAS_CLASSES.forEach((item) => {
      const key = getTopLevelKey(item.label);
      const existing = grouped.get(key);

      if (existing) {
        existing.items.push(item);
        return;
      }

      grouped.set(key, {
        key,
        title: TOP_LEVEL_LABELS[key] ?? { en: "Other", id: "Lainnya" },
        items: [item],
      });
    });

    return Array.from(grouped.values()).sort((a, b) => {
      const aNum = Number(a.key);
      const bNum = Number(b.key);

      if (Number.isNaN(aNum) && Number.isNaN(bNum)) {
        return 0;
      }
      if (Number.isNaN(aNum)) {
        return 1;
      }
      if (Number.isNaN(bNum)) {
        return -1;
      }
      return aNum - bNum;
    });
  }, []);

  return (
    <div className="rounded-md border border-border/60 p-2">
      <div className="mb-2 text-xs font-semibold">Landcover Legend</div>
      <div className="space-y-1.5">
        {groupedClasses.map((group) => (
          <div key={group.key} className="rounded-md border border-border/60 p-1.5">
            <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
              <span className="leading-tight">
                <span className="block font-semibold text-foreground">
                  {group.key}.x {group.title.en}
                </span>
                <span className="block text-[9px]">{group.title.id}</span>
              </span>
              <span>{group.items.length} classes</span>
            </div>
            <div className="space-y-1.5">
              {group.items.map((item) => (
                <div key={item.id} className="flex items-start gap-1.5 text-[11px] leading-tight">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-xs ring-1 ring-black/20"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="font-mono text-[10px] text-muted-foreground">{item.id}</span>
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate">{getCompactLabel(item.label)}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {getIndonesianLabel(getCompactLabel(item.label))}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VectorLegendPanel({ title, fillOpacity }: { title: string; fillOpacity: number }) {
  return (
    <div className="rounded-md border border-border/60 p-2">
      <div className="mb-2 text-xs font-semibold">{title}</div>
      <div className="space-y-1.5 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="h-0.5 w-5 rounded bg-[#ff3b30]" />
          <span>Boundary stroke</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="h-3 w-5 rounded border border-[#ff3b30]/70"
            style={{ backgroundColor: `rgba(255, 59, 48, ${fillOpacity})` }}
          />
          <span>Polygon fill ({Math.round(fillOpacity * 100)}%)</span>
        </div>
      </div>
    </div>
  );
}

function CanopyLegendPanel({ title, isLoading }: { title: string; isLoading: boolean }) {
  return (
    <div className="rounded-md border border-border/60 p-2">
      <div className="mb-2 text-xs font-semibold">{title}</div>
      {isLoading ? (
        <div className="text-[11px] text-muted-foreground">Canopy tiles are still processing.</div>
      ) : (
        <div className="space-y-1.5 text-[11px]">
          {CANOPY_COLOR_STOPS.filter((stop) => stop.value > 0).map((stop) => (
            <div key={stop.value} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span
                  className="h-2.5 w-4 rounded-xs ring-1 ring-black/20"
                  style={{ backgroundColor: colorStopToCssColor(stop.color) }}
                />
                <span>{stop.value} m</span>
              </span>
              <span className="text-[10px] text-muted-foreground">canopy height</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Legend({ open, onOpenChange, activeLayers }: LegendProps) {
  const activeLayerCount = activeLayers.length;

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <Card className="w-[min(68vw,15rem)] border-white/30 bg-card/90 shadow-lg backdrop-blur-sm">
        <CardHeader className="pb-1.5 pt-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-1.5 text-xs font-semibold">
              <ListTree className="size-3.5" />
              Layer Legends
            </CardTitle>
            <CollapsibleTrigger
              render={
                <Button size="icon" variant="outline" aria-label="Toggle legend" className="size-7" />
              }
            >
              <ChevronDown
                className={`size-3.5 transition-transform ${open ? "rotate-180" : "rotate-0"}`}
              />
            </CollapsibleTrigger>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="max-h-72 space-y-1.5 overflow-y-auto pb-3 pr-2.5">
            <div className="text-[10px] text-muted-foreground">
              Active legend panels: {activeLayerCount}
            </div>

            {activeLayerCount === 0 ? (
              <div className="rounded-md border border-border/60 p-2 text-[11px] text-muted-foreground">
                No visible colorized layers. Turn on a layer to see its legend.
              </div>
            ) : (
              activeLayers.map((layer) => {
                if (layer.kind === "landcover") {
                  return <LandcoverLegendPanel key={layer.id} />;
                }

                if (layer.kind === "vector") {
                  return (
                    <VectorLegendPanel
                      key={layer.id}
                      title={layer.title}
                      fillOpacity={layer.fillOpacity}
                    />
                  );
                }

                return (
                  <CanopyLegendPanel
                    key={layer.id}
                    title={layer.title}
                    isLoading={layer.isLoading}
                  />
                );
              })
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export type { ActiveLegendLayer };