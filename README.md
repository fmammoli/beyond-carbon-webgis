## Beyond Carbon WebGIS

Next.js + OpenLayers WebGIS for annual MapBiomas landcover PMTiles (1990-2024), with:

- Esri satellite basemap toggle
- PMTiles landcover layer toggle
- Time slider with play/pause animation
- Collapsible MapBiomas legend
- Drag-and-drop vector overlays (.zip shapefile, .geojson/.json, .kml)

## Environment

Create an environment file and set your public PMTiles base URL:

```bash
cp .env.example .env.local
```

```bash
NEXT_PUBLIC_R2_PMTILES_BASE_URL=https://<your-r2-public-url>
NEXT_PUBLIC_R2_CHM_PMTILES_URL=https://pub-b35b693f4e7a4112af656d6983f8adc2.r2.dev/chm-pmtiles/chm-indonesia.pmtiles
```

The app loads yearly archives using this naming convention:

```txt
${NEXT_PUBLIC_R2_PMTILES_BASE_URL}/<year>_landcover.pmtiles
```

Example:

```txt
https://pub-b35b693f4e7a4112af656d6983f8adc2.r2.dev/landcover-mapbiomas-pmtiles/1990_landcover.pmtiles
```

The CHM layer uses one static PMTiles archive URL and does not animate by year.
If omitted, it defaults to the public Indonesia CHM archive shown above.

## Run

Install dependencies and start dev server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Build Checks

```bash
npm run lint
npm run build
```

## Vector Upload Notes

- Supported formats: `.zip` (containing shapefile components), `.geojson`, `.json`, `.kml`.
- Uploaded features are rendered in an OpenLayers vector layer above the landcover raster.
- The map automatically fits to the dropped feature extent.

## Canopy Extraction API

- Set `CHM_API_KEY` on the Next.js server and `CANOPY_API_URL` if the FastAPI upstream is not `http://178.104.153.106/api/v1/chm/crop`.
- If the upstream returns `Invalid host header`, set `CANOPY_API_HOST_HEADER` to the exact host expected by upstream trusted-host checks (usually the hostname or IP from `CANOPY_API_URL`, for example `178.104.153.106`).
- Optional: set `CANOPY_API_TIMEOUT_MS` (default `30000`) to control how long the proxy waits before reporting upstream timeout.
- Put those values in `.env.local`, then restart `npm run dev` so Next.js reloads them.
- The client sends `geojson` to `/api/canopy/extract`; the route proxies it upstream with `X-API-Key`.
- The browser downloads streamed GeoTIFF responses as `.tif` files.

## Landcover Stats API

- The app now exposes a local proxy at `/api/v1/landcover/stats/jobs` and `/api/v1/landcover/stats/jobs/:jobId`.
- Choose proxy target in `.env.local` with `LANDCOVER_STATS_TARGET=local` or `LANDCOVER_STATS_TARGET=remote`.
- Set `LANDCOVER_STATS_LOCAL_API_URL` and `LANDCOVER_STATS_REMOTE_API_URL` so switching target only requires changing `LANDCOVER_STATS_TARGET`.
- You can still set `LANDCOVER_STATS_API_URL` (or `LANDCOVER_STATS_API_BASE_URL`) for a single explicit upstream override; explicit URL takes precedence over target switching.
- Set `LANDCOVER_STATS_API_KEY` on the Next.js server to send `X-API-Key` upstream without exposing it in the browser.
- If `LANDCOVER_STATS_API_KEY` is unset, the proxy falls back to `CHM_API_KEY` and then `CANOPY_API_KEY`.
- Optional: set `LANDCOVER_STATS_API_HOST_HEADER` if upstream host validation requires a specific host header.
- Optional: set `LANDCOVER_STATS_API_TIMEOUT_MS` (default `300000`) to control proxy timeout.
- You can still set `NEXT_PUBLIC_LANDCOVER_STATS_API_BASE_URL` when pointing the browser directly to another API origin.
- You can still set `NEXT_PUBLIC_LANDCOVER_STATS_API_KEY` for browser-direct requests, but server-side `LANDCOVER_STATS_API_KEY` is preferred.
- The client sends polygon GeoJSON to the stats jobs endpoint and renders JSON metrics only; it does not download binary files.

### Smoke Test Script

- Use `scripts/test_landcover_stats_api.py` to create a sample stats job and poll until completion.
- The script reads `LANDCOVER_STATS_API_KEY`, then `CHM_API_KEY`, then `API_KEY`.
- The script reads `LANDCOVER_API_BASE_URL`, then `LANDCOVER_STATS_LOCAL_API_URL`, with fallback `http://127.0.0.1:8000`.

Run with defaults from environment:

```bash
npm run test:landcover:api
```

Run with explicit options:

```bash
python3 scripts/test_landcover_stats_api.py --base-url http://127.0.0.1:8000 --api-key your-api-key
```

## PMTiles / R2 Requirements

- Ensure CORS allows your app origin.
- Ensure range requests are supported for PMTiles delivery.
- If tiles do not render, inspect network responses in browser devtools for CORS and range header behavior.

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
