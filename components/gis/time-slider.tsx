"use client";

import {
  CalendarRange,
  Loader2,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";

type TimeSliderProps = {
  year: number;
  minYear: number;
  maxYear: number;
  isFrameLoading: boolean;
  onYearChange: (year: number) => void;
};

export function TimeSlider({
  year,
  minYear,
  maxYear,
  isFrameLoading,
  onYearChange,
}: TimeSliderProps) {
  return (
    <Card className="w-[min(95vw,34rem)] rounded-2xl border-white/45 bg-white/72 shadow-xl shadow-black/20 backdrop-blur-md">
      <CardContent className="flex items-center gap-1.5 py-1.5">
        <span className="sr-only">Map layer timeline</span>
        <CalendarRange aria-hidden="true" className="shrink-0 text-muted-foreground" />
        <div className="flex min-w-12 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-xs shadow-sm">
          <span className="sr-only">Current year</span>
          <span className="font-mono tabular-nums text-foreground">{year}</span>
        </div>
        <div className="min-w-0 flex-1">
          <Slider
            className="min-w-0 flex-1"
            indicatorClassName="bg-primary"
            value={[year]}
            min={minYear}
            max={maxYear}
            step={1}
            onValueChange={(value) => {
              const nextValue = Array.isArray(value) ? value[0] : value;
              onYearChange(Math.round(nextValue ?? year));
            }}
            aria-label="Select layer year"
            aria-busy={isFrameLoading}
          />
        </div>
        <div className="flex w-5 shrink-0 items-center justify-center">
          {isFrameLoading ? (
            <span
              className="flex size-5 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary shadow-sm"
              role="status"
              aria-label="Loading"
            >
              <Loader2 aria-hidden="true" className="size-3 animate-spin" />
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}