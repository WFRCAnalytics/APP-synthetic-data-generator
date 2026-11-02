// Saving everything a run makes in one go (specs/016): the fake file, the spec and the README for agents, either into a folder the
// person picks (browsers that can write to a chosen folder: Chrome and Edge) or as one zip file that every browser can download.
// The files are the ones already made in the page; nothing is sent anywhere.

import { createZipWriter } from "../lib/xlsx/zip";

export interface NamedBlob {
  name: string;
  blob: Blob;
}

/** The minimal parts of the File System Access API used here, so the code can be tested without a browser. */
export interface DirectoryHandleLike {
  name: string;
  getFileHandle(
    name: string,
    options: { create: boolean },
  ): Promise<{
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  }>;
}

export interface SaveWindow {
  showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<DirectoryHandleLike>;
}

/** Whether this browser can write into a folder the person chooses. */
export const canSaveToFolder = (win: SaveWindow = window as unknown as SaveWindow): boolean =>
  typeof win.showDirectoryPicker === "function";

/** Files that are already compressed: they are stored in a zip, not compressed again. */
const ALREADY_COMPRESSED = /\.(xlsx|parquet|zip)$/i;

/** One zip of the files, with a fixed time stamp so the same files give the same zip. */
export async function zipOf(files: readonly NamedBlob[]): Promise<Blob> {
  const parts: Uint8Array[] = [];
  const zip = createZipWriter((chunk) => {
    parts.push(chunk.slice());
  });
  for (const f of files) {
    const bytes = new Uint8Array(await f.blob.arrayBuffer());
    await zip.addEntry(f.name, [bytes], { store: ALREADY_COMPRESSED.test(f.name) });
  }
  await zip.finish();
  return new Blob(parts as BlobPart[], { type: "application/zip" });
}

/** Asks for a folder and writes the files into it; the name of the folder is returned. Files with the same names are replaced. */
export async function saveToFolder(
  files: readonly NamedBlob[],
  win: SaveWindow = window as unknown as SaveWindow,
): Promise<string> {
  if (!win.showDirectoryPicker) throw new Error("This browser cannot write to a folder.");
  const dir = await win.showDirectoryPicker({ mode: "readwrite" });
  for (const f of files) {
    const handle = await dir.getFileHandle(f.name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(f.blob);
    await writable.close();
  }
  return dir.name;
}

/** "trips_fake.csv" becomes "trips_fake_files.zip". */
export function zipFileNameFor(fakeFileName: string): string {
  const base = fakeFileName.replace(/\.[^.]*$/, "") || "table";
  return `${base}_files.zip`;
}
