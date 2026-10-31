export interface ChecksumEntry {
  path: string;
  sha256: string;
}

export function stem(app: string, spec: number): string;
export function zipName(app: string, spec: number): string;
export function releaseName(app: string, spec: number): string;
export function sha256Hex(bytes: Uint8Array): string;
export function formatChecksums(entries: readonly ChecksumEntry[]): string;
export function parseChecksums(text: string): ChecksumEntry[];
export function checkTag(tag: string, version: string, options?: { dryRun?: boolean }): { ok: true } | { ok: false; reason: string };
export function collectFiles(root: string): Promise<string[]>;
export function safeJoin(root: string, rel: string): string;
