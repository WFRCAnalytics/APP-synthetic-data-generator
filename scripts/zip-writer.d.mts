export interface ZipFile {
  path: string;
  data: Uint8Array;
  /** Unix permission bits, 0o644 unless given (0o755 for a script that must run). */
  mode?: number;
}

export function createZip(entries: readonly ZipFile[], options: { mtime: Date }): Uint8Array;
