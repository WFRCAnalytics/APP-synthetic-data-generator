// @vitest-environment node
// Saving everything (specs/016): one zip of the files that any zip reader opens, or the files written into a folder the person picks.

import { describe, expect, it } from "vitest";
import {
  canSaveToFolder,
  saveToFolder,
  zipFileNameFor,
  zipOf,
  type DirectoryHandleLike,
} from "../../src/app/saveAll";
import { readEntryText, readZipDirectory } from "../../src/lib/xlsx/zip";

const files = [
  { name: "trips_fake.csv", blob: new Blob(["a,b\n1,2\n".repeat(500)]) },
  { name: "trips_spec.json", blob: new Blob(['{"spec_version": 5}\n']) },
  { name: "trips_fake_README.md", blob: new Blob(["# trips\n"]) },
];

describe("zipOf", () => {
  it("holds every file under its name, with its exact content", async () => {
    const zip = await zipOf(files);
    const entries = await readZipDirectory(zip);
    expect(entries.map((e) => e.name)).toEqual([
      "trips_fake.csv",
      "trips_spec.json",
      "trips_fake_README.md",
    ]);
    expect(await readEntryText(zip, entries[0])).toBe("a,b\n1,2\n".repeat(500));
    expect(await readEntryText(zip, entries[1])).toBe('{"spec_version": 5}\n');
    expect(await readEntryText(zip, entries[2])).toBe("# trips\n");
  });

  it("compresses text, and stores a file that is already compressed", async () => {
    const book = { name: "t.xlsx", blob: new Blob([new Uint8Array(2000).fill(7)]) };
    const zip = await zipOf([files[0], book]);
    const entries = await readZipDirectory(zip);
    expect(entries[0].compressedSize).toBeLessThan(entries[0].uncompressedSize);
    expect(entries[1].compressedSize).toBe(entries[1].uncompressedSize);
  });

  it("is the same bytes twice", async () => {
    const a = new Uint8Array(await (await zipOf(files)).arrayBuffer());
    const b = new Uint8Array(await (await zipOf(files)).arrayBuffer());
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe("saveToFolder", () => {
  function folder() {
    const written = new Map<string, string>();
    const handle: DirectoryHandleLike = {
      name: "Fake data",
      getFileHandle: async (name) => ({
        createWritable: async () => ({
          write: async (data: Blob) => void written.set(name, await data.text()),
          close: async () => {},
        }),
      }),
    };
    return { written, handle };
  }

  it("asks for a folder and writes each file into it", async () => {
    const { written, handle } = folder();
    let asked: unknown;
    const name = await saveToFolder(files, {
      showDirectoryPicker: async (options) => {
        asked = options;
        return handle;
      },
    });
    expect(name).toBe("Fake data");
    expect(asked).toEqual({ mode: "readwrite" });
    expect([...written.keys()]).toEqual([
      "trips_fake.csv",
      "trips_spec.json",
      "trips_fake_README.md",
    ]);
    expect(written.get("trips_spec.json")).toBe('{"spec_version": 5}\n');
  });

  it("writes nothing when the person closes the picker", async () => {
    const { written } = folder();
    await expect(
      saveToFolder(files, {
        showDirectoryPicker: async () => {
          throw new DOMException("closed", "AbortError");
        },
      }),
    ).rejects.toThrow();
    expect(written.size).toBe(0);
  });

  it("knows whether the browser can do it", () => {
    expect(canSaveToFolder({})).toBe(false);
    expect(canSaveToFolder({ showDirectoryPicker: async () => ({}) as DirectoryHandleLike })).toBe(
      true,
    );
  });
});

describe("names", () => {
  it("names the zip after the fake file", () => {
    expect(zipFileNameFor("trips_fake.csv")).toBe("trips_fake_files.zip");
    expect(zipFileNameFor("data")).toBe("data_files.zip");
  });
});
