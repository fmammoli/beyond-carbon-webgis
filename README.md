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
```

The app loads yearly archives using this naming convention:

```txt
${NEXT_PUBLIC_R2_PMTILES_BASE_URL}/<year>_landcover.pmtiles
```

Example:

```txt
https://pub-b35b693f4e7a4112af656d6983f8adc2.r2.dev/landcover-mapbiomas-pmtiles/1990_landcover.pmtiles
```

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
