"use client";

import { useEffect } from "react";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  Pause,
  Play,
} from "lucide-react";

import { PLAY_INTERVAL_MS } from "@/lib/gis-constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";

type TimeSliderProps = {
  year: number;
  minYear: number;
  maxYear: number;
  isPlaying: boolean;
  canAdvance: boolean;
  isFrameLoading: boolean;
  isPreloadingYears: boolean;
  onYearChange: (year: number) => void;
  onPlayingChange: (playing: boolean) => void;
};

export function TimeSlider({
  year,
  minYear,
  maxYear,
  isPlaying,
  canAdvance,
  isFrameLoading,
  isPreloadingYears,
  onYearChange,
  onPlayingChange,
}: TimeSliderProps) {
  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    if (year >= maxYear) {
      onPlayingChange(false);
      return;
    }

    const timer = window.setInterval(() => {
      if (!canAdvance) {
        return;
      }

      const nextYear = year + 1;
      onYearChange(nextYear);
    }, PLAY_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [canAdvance, isPlaying, maxYear, onPlayingChange, onYearChange, year]);

  return (
    <Card className="w-[min(96vw,36rem)] border-white/25 bg-card/85 shadow-lg backdrop-blur-sm">
      <CardContent className="flex items-center gap-1.5 py-2">
        <span className="sr-only">Landcover timeline</span>
        <CalendarRange aria-hidden="true" className="shrink-0 text-muted-foreground" />
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => onYearChange(minYear)}
          aria-label="First year"
        >
          <ChevronsLeft aria-hidden="true" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => onYearChange(Math.max(minYear, year - 1))}
          aria-label="Previous year"
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          size="icon-xs"
          variant={isPlaying ? "secondary" : "default"}
          onClick={() => {
            if (isPlaying) {
              onPlayingChange(false);
              return;
            }

            if (year >= maxYear) {
              onYearChange(minYear);
            }

            onPlayingChange(true);
          }}
          aria-label={isPlaying ? "Pause animation" : "Play animation"}
          aria-pressed={isPlaying}
        >
          {isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => onYearChange(Math.min(maxYear, year + 1))}
          aria-label="Next year"
        >
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => onYearChange(maxYear)}
          aria-label="Last year"
        >
          <ChevronsRight aria-hidden="true" />
        </Button>
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
            aria-label="Select landcover year"
            aria-busy={isFrameLoading || (isPlaying && !canAdvance) || isPreloadingYears}
          />
        </div>
        <div className="flex w-5 shrink-0 items-center justify-center">
          {isFrameLoading || (isPlaying && !canAdvance) || isPreloadingYears ? (
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