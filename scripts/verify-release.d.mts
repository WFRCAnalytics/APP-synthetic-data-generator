export interface Allowlist {
  hosts: { host: string; source: string }[];
}

/** Paths a release must hold, relative to its top folder. */
export const REQUIRED_FILES: readonly string[];
export const SITE: string;

/** Every problem found in a release zip; empty when it is good. */
export function verifyRelease(options: { zipName: string; bytes: Uint8Array; allowlist: Allowlist }): string[];
