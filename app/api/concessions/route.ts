import { readdir } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type ConcessionsResponse = {
  concessions: string[];
};

export async function GET(): Promise<Response> {
  const concessionsPath = path.join(process.cwd(), "public", "concessions");
  const entries = await readdir(concessionsPath, { withFileTypes: true });

  const concessions = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".geojson"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Response.json({ concessions } satisfies ConcessionsResponse, {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}