"use client";

import { useMemo } from "react";
import { ChevronDown, ListTree } from "lucide-react";

import { agbLegend } from "@/lib/agb-legend";
import { chmLegend } from "@/lib/chm-legend";
import { MAPBIOMAS_CLASSES } from "@/lib/mapbiomas-colors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export type ActiveLegendLayer =
  | {
      id: string;
      kind: "landcover";
      title: string;
    }
  | {
      id: string;
      kind: "agb";
      title: string;
    }
  | {
      id: string;
      kind: "chm";
      title: string;
    }
  | {
      id: string;
      kind: "vector";
      title: string;
      fillOpacity: number;
      baseColor?: string;
      groupingColumn?: string | null;
      groups?: Array<{ value: string; color: string; count: number }>;
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
    <div className="rounded-md border border-slate-200/80 bg-white p-2.5">
      <div className="mb-2 text-xs font-semibold text-slate-900">Landcover Legend</div>
      <div className="space-y-1.5">
        {groupedClasses.map((group) => (
          <div key={group.key} className="rounded-md border border-slate-200/80 bg-white p-1.5">
            <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-slate-600">
              <span className="leading-tight">
                <span className="block font-semibold text-slate-900">
                  {group.key}.x {group.title.en}
                </span>
                <span className="block text-[9px]">{group.title.id}</span>
              </span>
              <span>{group.items.length} classes</span>
            </div>
            <div className="space-y-1.5">
              {group.items.map((item) => (
                <div key={item.id} className="flex items-start gap-1.5 text-[11px] leading-tight text-slate-800">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-xs ring-1 ring-slate-300"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="font-mono text-[10px] text-slate-600">{item.id}</span>
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate">{getCompactLabel(item.label)}</span>
                    <span className="block truncate text-[10px] text-slate-600">
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

function AgbLegendPanel() {
  const gradientStops = agbLegend.colors.join(", ");

  return (
    <div className="rounded-md border border-slate-200/80 bg-white p-2.5">
      <div className="mb-2 text-sm font-medium tracking-tight text-slate-900">
        Aboveground Biomass Density (AGB) Mg/ha
      </div>
      <div
        className="h-10 rounded-sm border border-slate-200/80"
        style={{ background: `linear-gradient(to right, ${gradientStops})` }}
      />
      <div className="mt-2 flex items-start justify-between gap-1 px-0.5 text-[10px] leading-none text-slate-700">
        <span>0</span>
        <span>50</span>
        <span>100</span>
        <span>150</span>
        <span>200</span>
        <span>250</span>
        <span>&gt; 300</span>
      </div>
    </div>
  );
}

function ChmLegendPanel() {
  const gradientStops = chmLegend.colors.join(", ");
  const chmStopLabels = chmLegend.breaks.map((value) => String(value));

  return (
    <div className="rounded-md border border-slate-200/80 bg-white p-2.5">
      <div className="mb-2 text-sm font-medium tracking-tight text-slate-900">
        Canopy Height Model (m)
      </div>
      <div
        className="h-10 rounded-sm border border-slate-200/80"
        style={{ background: `linear-gradient(to right, ${gradientStops})` }}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-0.5 text-[10px] leading-none text-slate-700">
        {chmStopLabels.map((label, index) => (
          <span key={`${label}:${index}`}>{label}</span>
        ))}
      </div>
    </div>
  );
}

function VectorLegendPanel({
  title,
  fillOpacity,
  baseColor = "#ff3b30",
  groupingColumn,
  groups,
}: {
  title: string;
  fillOpacity: number;
  baseColor?: string;
  groupingColumn?: string | null;
  groups?: Array<{ value: string; color: string; count: number }>;
}) {
  return (
    <div className="rounded-md border border-slate-200/80 bg-white p-2.5">
      <div className="mb-2 text-xs font-semibold text-slate-900">{title}</div>
      <div className="space-y-1.5 text-[11px] text-slate-800">
        {groupingColumn && groups && groups.length > 0 ? (
          <>
            <div className="text-[10px] text-slate-600">
              Grouped by <span className="font-semibold text-slate-900">{groupingColumn}</span>
            </div>
            {groups.map((group) => (
              <div key={`${group.value}:${group.color}`} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-3 w-5 shrink-0 rounded border border-slate-300"
                    style={{ backgroundColor: group.color, opacity: fillOpacity }}
                  />
                  <span className="truncate">{group.value}</span>
                </span>
                <span className="text-[10px] text-slate-600">{group.count}</span>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="h-0.5 w-5 rounded" style={{ backgroundColor: baseColor }} />
              <span>Boundary stroke</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="h-3 w-5 rounded border"
                style={{
                  borderColor: `${baseColor}B3`,
                  backgroundColor: baseColor,
                  opacity: fillOpacity,
                }}
              />
              <span>Polygon fill ({Math.round(fillOpacity * 100)}%)</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Legend({ open, onOpenChange, activeLayers }: LegendProps) {
  const activeLayerCount = activeLayers.length;

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <Card className="flex w-[min(92vw,18rem)] flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-lg shadow-slate-950/10 backdrop-blur-sm">
        <CardHeader className="py-2.5">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ListTree className="size-4" />
              Layer Legends
            </CardTitle>
            <CollapsibleTrigger
              render={
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Toggle legend"
                  className="size-7 border-slate-200 bg-white text-slate-900 hover:bg-slate-100"
                />
              }
            >
              <ChevronDown
                className={`size-3.5 transition-transform ${open ? "rotate-180" : "rotate-0"}`}
              />
            </CollapsibleTrigger>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="max-h-[calc(100dvh-10rem)] space-y-2 overflow-y-auto pb-3 pr-2 pt-0 md:max-h-[calc(100dvh-11rem)]">
            <div className="text-[10px] text-slate-600">
              Active legend panels: {activeLayerCount}
            </div>

            {activeLayerCount === 0 ? (
              <div className="rounded-md border border-slate-200/80 bg-white p-2 text-[11px] text-slate-700">
                No visible colorized layers. Turn on a layer to see its legend.
              </div>
            ) : (
              activeLayers.map((layer) => {
                if (layer.kind === "landcover") {
                  return <LandcoverLegendPanel key={layer.id} />;
                }

                if (layer.kind === "agb") {
                  return <AgbLegendPanel key={layer.id} />;
                }

                if (layer.kind === "chm") {
                  return <ChmLegendPanel key={layer.id} />;
                }

                if (layer.kind === "vector") {
                  return (
                    <VectorLegendPanel
                      key={layer.id}
                      title={layer.title}
                      fillOpacity={layer.fillOpacity}
                      baseColor={layer.baseColor}
                      groupingColumn={layer.groupingColumn}
                      groups={layer.groups}
                    />
                  );
                }

                return null;
              })
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
