import { describe, expect, it } from "vitest";

import {
  shouldUseAgbStatsResultForSelection,
  shouldUseStatsResultForSelection,
} from "@/lib/agb-stats-selection";

describe("selection-aware stats result guards", () => {
  it("returns false when the active request belongs to a different polygon selection", () => {
    expect(shouldUseAgbStatsResultForSelection("selection-a", "selection-b")).toBe(false);
  });

  it("returns true when the active request matches the current polygon selection", () => {
    expect(shouldUseAgbStatsResultForSelection("selection-a", "selection-a")).toBe(true);
  });

  it("returns false when no active selection is tracking a request", () => {
    expect(shouldUseAgbStatsResultForSelection(null, "selection-a")).toBe(false);
  });

  it("blocks a cached result when the active selection has been cleared", () => {
    expect(shouldUseStatsResultForSelection("selection-a", null)).toBe(false);
  });
});
