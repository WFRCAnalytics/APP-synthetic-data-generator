export interface ZipFileRead {
  name: string;
  data: Uint8Array;
  /** Unix permission bits (0o644 when the zip was not made on Unix). */
  mode: number;
}

export function readZip(bytes: Uint8Array): ZipFileRead[];
