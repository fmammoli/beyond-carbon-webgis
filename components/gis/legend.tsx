"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ListTree } from "lucide-react";

import { MAPBIOMAS_CLASSES } from "@/lib/mapbiomas-colors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

type LegendProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const TOP_LEVEL_LABELS: Record<string, string> = {
  "1": "Forest",
  "2": "Natural Vegetation",
  "3": "Agriculture",
  "4": "Non-Vegetation",
  "5": "Water",
  "6": "Not Observed",
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

export function Legend({ open, onOpenChange }: LegendProps) {
  const [compactMode, setCompactMode] = useState(true);

  const groupedClasses = useMemo(() => {
    const grouped = new Map<
      string,
      {
        key: string;
        title: string;
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
        title: TOP_LEVEL_LABELS[key] ?? "Other",
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
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <Card className="w-[min(92vw,22rem)] border-white/30 bg-card/90 shadow-lg backdrop-blur-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <ListTree className="size-4" />
              Landcover Legend
            </CardTitle>
            <CollapsibleTrigger
              render={
                <Button size="icon" variant="outline" aria-label="Toggle legend" />
              }
            >
              <ChevronDown
                className={`size-4 transition-transform ${open ? "rotate-180" : "rotate-0"}`}
              />
            </CollapsibleTrigger>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="xs"
              variant={compactMode ? "default" : "outline"}
              onClick={() => setCompactMode(true)}
            >
              Compact
            </Button>
            <Button
              size="xs"
              variant={compactMode ? "outline" : "default"}
              onClick={() => setCompactMode(false)}
            >
              Full
            </Button>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="max-h-72 space-y-2 overflow-y-auto pr-3">
            {compactMode
              ? groupedClasses.map((group) => (
                  <div key={group.key} className="rounded-lg border border-border/60 p-2">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {group.key}.x {group.title}
                      </span>
                      <span>{group.items.length} classes</span>
                    </div>
                    <div className="space-y-1">
                      {group.items.map((item) => (
                        <div key={item.id} className="flex items-center gap-2 text-xs">
                          <span
                            className="h-3 w-3 shrink-0 rounded-xs ring-1 ring-black/20"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {item.id}
                          </span>
                          <span className="truncate">{getCompactLabel(item.label)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              : MAPBIOMAS_CLASSES.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 text-xs">
                    <span
                      className="h-3 w-3 shrink-0 rounded-xs ring-1 ring-black/20"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="font-mono text-[11px] text-muted-foreground">{item.id}</span>
                    <span className="truncate">{item.label}</span>
                  </div>
                ))}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}