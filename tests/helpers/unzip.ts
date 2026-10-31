// Unpacks a zip into a folder, for tests that need the real files of a release on disk. Uses the app's
// own zip reader, so no archive tool is needed on the machine. The mode of a script is restored.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { openEntry, readZipDirectory } from "../../src/lib/xlsx/zip";

export async function unzipTo(zipPath: string, dest: string): Promise<string[]> {
  const bytes = readFileSync(zipPath);
  const blob = new Blob([bytes as BlobPart]);
  const names: string[] = [];
  for (const entry of await readZipDirectory(blob)) {
    const target = join(dest, ...entry.name.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    const data = new Uint8Array(await new Response(await openEntry(blob, entry)).arrayBuffer());
    writeFileSync(target, data);
    if (entry.name.endsWith(".sh")) chmodSync(target, 0o755);
    names.push(entry.name);
  }
  return names;
}
