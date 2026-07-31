import { readdir } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type JkppHcsCarbonResponse = {
  files: string[];
};

export async function GET(): Promise<Response> {
  const directoryPath = path.join(process.cwd(), "public", "jkpp-hcs-carbon");
  const entries = await readdir(directoryPath, { withFileTypes: true });

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".geojson"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Response.json({ files } satisfies JkppHcsCarbonResponse, {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}
