export const MIN_YEAR = 1990;
export const MAX_YEAR = 2024;
export const PLAY_INTERVAL_MS = 1500;
export const DEFAULT_YEAR = MAX_YEAR;

export const INDONESIA_CENTER_LON_LAT: [number, number] = [117.89, -0.78];
export const INDONESIA_DEFAULT_ZOOM = 5;

export const DEFAULT_R2_PMTILES_BASE_URL =
	"https://pub-b35b693f4e7a4112af656d6983f8adc2.r2.dev/landcover-mapbiomas-pmtiles";

export const LANDCOVER_FILE_PREFIX = "";
export const LANDCOVER_FILE_SUFFIX = "_landcover.pmtiles";
export const DEFAULT_LANDCOVER_OPACITY = 0.75;

export const AGB_MIN_YEAR = 2000;
export const AGB_MAX_YEAR = 2025;
export const AGB_FILE_PREFIX = "";
export const AGB_FILE_SUFFIX = "_agb-ctrees.pmtiles";
export const DEFAULT_AGB_OPACITY = 0.75;
export const DEFAULT_R2_AGB_PMTILES_BASE_URL =
	"https://pub-b35b693f4e7a4112af656d6983f8adc2.r2.dev/agb-ctrees-pmtiles";

export const DEFAULT_CHM_OPACITY = 0.75;
export const DEFAULT_R2_CHM_PMTILES_URL =
	"https://pub-b35b693f4e7a4112af656d6983f8adc2.r2.dev/chm-pmtiles/chm-indonesia.pmtiles";
export const DEFAULT_R2_CHM_KETAPANG_PMTILES_URL =
	"https://pub-b35b693f4e7a4112af656d6983f8adc2.r2.dev/chm_pmtiles/ketapang_chm.pmtiles";

export const CHM_MAX_OVERZOOM_DELTA = 16;

// Playback warmup controls: prefetch current viewport tiles for nearby years.
export const PLAY_PREFETCH_YEAR_WINDOW = 3;
export const PLAY_PREFETCH_MAX_VISIBLE_TILES = 48;
export const PLAY_PREFETCH_TILE_CONCURRENCY = 8;

// Some PMTiles archives are indexed using TMS-style Y ordering.
export const LANDCOVER_FLIP_Y = false;

// Allow a limited number of overzoom levels before hiding landcover tiles.
export const LANDCOVER_MAX_OVERZOOM_DELTA = 10;

// Threat Map export settings.
export const THREAT_MAP_SQUARE_SIDE_KM = 20;
export const THREAT_MAP_FRAME_DURATION_SECONDS = 1.5;
export const THREAT_MAP_EXPORT_SIZE_PX = 1024;

export const THREAT_MAP_EXPORT_PRESETS = {
	balanced: {
		label: "Balanced",
		sizePx: THREAT_MAP_EXPORT_SIZE_PX,
	},
	high: {
		label: "High",
		sizePx: 1536,
	},
	ultra: {
		label: "Ultra",
		sizePx: 2048,
	},
} as const;

export type ThreatMapExportPreset = keyof typeof THREAT_MAP_EXPORT_PRESETS;