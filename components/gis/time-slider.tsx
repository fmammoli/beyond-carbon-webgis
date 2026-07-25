"use client";

import { useEffect } from "react";
import { Loader2, Pause, Play } from "lucide-react";

import { PLAY_INTERVAL_MS } from "@/lib/gis-constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";

type TimeSliderProps = {
  year: number;
  minYear: number;
  maxYear: number;
  isPlaying: boolean;
  canAdvance: boolean;
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
  isPreloadingYears,
  onYearChange,
  onPlayingChange,
}: TimeSliderProps) {
  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const timer = window.setInterval(() => {
      if (!canAdvance) {
        return;
      }

      const nextYear = year >= maxYear ? minYear : year + 1;
      onYearChange(nextYear);
    }, PLAY_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [canAdvance, isPlaying, maxYear, minYear, onYearChange, year]);

  return (
    <Card className="w-[min(92vw,32rem)] border-white/30 bg-card/88 shadow-xl backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-semibold">Landcover Timeline</CardTitle>
          <Badge variant="secondary" className="text-sm tabular-nums">
            {year}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Button
            size="icon"
            variant={isPlaying ? "destructive" : "default"}
            onClick={() => onPlayingChange(!isPlaying)}
            aria-label={isPlaying ? "Pause animation" : "Play animation"}
          >
            {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <Slider
            value={[year]}
            min={minYear}
            max={maxYear}
            step={1}
            onValueChange={(value) => {
              const nextValue = Array.isArray(value) ? value[0] : value;
              onYearChange(Math.round(nextValue ?? year));
            }}
            aria-label="Select landcover year"
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{minYear}</span>
          <span>{maxYear}</span>
        </div>
        {isPlaying && (!canAdvance || isPreloadingYears) ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            <span>
              {isPreloadingYears ? "Warming yearly archives for smoother playback..." : "Loading next year..."}
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}