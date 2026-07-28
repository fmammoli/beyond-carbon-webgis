import { readdir } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type WorkshopRegionsResponse = {
  regions: string[];
};

export async function GET(): Promise<Response> {
  const workshopRegionsPath = path.join(process.cwd(), "public", "workshop-regions");
  const entries = await readdir(workshopRegionsPath, { withFileTypes: true });

  const regions = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".geojson"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Response.json({ regions } satisfies WorkshopRegionsResponse, {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}