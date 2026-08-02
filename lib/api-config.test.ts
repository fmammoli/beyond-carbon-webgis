import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAgbStatsJobsUpstreamUrl, getAgbStatsApiKey } from "@/lib/agb-stats-proxy";
import { resolveChmStatsJobsUpstreamUrl, getChmStatsApiKey } from "@/lib/chm-stats-proxy";
import { resolveLandcoverStatsJobsUpstreamUrl, getLandcoverStatsApiKey } from "@/lib/landcover-stats-proxy";
import { resolveThreatMapJobsUpstreamUrl, getThreatMapApiKey } from "@/lib/threat-map-proxy";

describe("simple API mode config", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("selects the local key and local base URL when API mode is local", () => {
    vi.stubEnv("API_MODE", "local");
    vi.stubEnv("LOCAL_API_KEY", "local-secret");
    vi.stubEnv("REMOTE_API_KEY", "remote-secret");
    vi.stubEnv("API_BASE_URL_LOCAL", "http://127.0.0.1:8000");
    vi.stubEnv("API_BASE_URL_REMOTE", "http://178.104.154.106");
    vi.stubEnv("AGB_STATS_ENDPOINT", "/api/v1/ctrees/agb/stats");
    vi.stubEnv("LANDCOVER_STATS_ENDPOINT", "/api/v1/landcover/stats");
    vi.stubEnv("CHM_STATS_ENDPOINT", "/api/v1/chm/stats");

    expect(getAgbStatsApiKey()).toBe("local-secret");
    expect(getLandcoverStatsApiKey()).toBe("local-secret");
    expect(getChmStatsApiKey()).toBe("local-secret");
    expect(getThreatMapApiKey()).toBe("local-secret");
    expect(resolveAgbStatsJobsUpstreamUrl().toString()).toBe("http://127.0.0.1:8000/api/v1/ctrees/agb/stats/jobs");
    expect(resolveLandcoverStatsJobsUpstreamUrl().toString()).toBe("http://127.0.0.1:8000/api/v1/landcover/stats/jobs");
    expect(resolveChmStatsJobsUpstreamUrl().toString()).toBe("http://127.0.0.1:8000/api/v1/chm/stats/jobs");
    expect(resolveThreatMapJobsUpstreamUrl()).toBe("http://127.0.0.1:8000/api/v1/threat-map/jobs");
  });

  it("selects the remote key and remote base URL when API mode is remote", () => {
    vi.stubEnv("API_MODE", "remote");
    vi.stubEnv("LOCAL_API_KEY", "local-secret");
    vi.stubEnv("REMOTE_API_KEY", "remote-secret");
    vi.stubEnv("API_BASE_URL_LOCAL", "http://127.0.0.1:8000");
    vi.stubEnv("API_BASE_URL_REMOTE", "http://178.104.154.106");
    vi.stubEnv("AGB_STATS_ENDPOINT", "/api/v1/ctrees/agb/stats");
    vi.stubEnv("LANDCOVER_STATS_ENDPOINT", "/api/v1/landcover/stats");
    vi.stubEnv("CHM_STATS_ENDPOINT", "/api/v1/chm/stats");

    expect(getAgbStatsApiKey()).toBe("remote-secret");
    expect(getLandcoverStatsApiKey()).toBe("remote-secret");
    expect(getChmStatsApiKey()).toBe("remote-secret");
    expect(getThreatMapApiKey()).toBe("remote-secret");
    expect(resolveAgbStatsJobsUpstreamUrl().toString()).toBe("http://178.104.154.106/api/v1/ctrees/agb/stats/jobs");
    expect(resolveLandcoverStatsJobsUpstreamUrl().toString()).toBe("http://178.104.154.106/api/v1/landcover/stats/jobs");
    expect(resolveChmStatsJobsUpstreamUrl().toString()).toBe("http://178.104.154.106/api/v1/chm/stats/jobs");
    expect(resolveThreatMapJobsUpstreamUrl()).toBe("http://178.104.154.106/api/v1/threat-map/jobs");
  });
});
