// What this site has saved in the browser, read live so the activity monitor can show it instead of claiming it. Every part is
// optional: a browser that hides one (a private window, an old version) simply reports null for it. Counts only, never contents.

export interface StorageReport {
  cookies: number;
  localItems: number;
  sessionItems: number;
  /** IndexedDB databases; null when the browser cannot list them. */
  databases: number | null;
  /** Cache Storage caches; null when unavailable. */
  caches: number | null;
  /** Registered service workers; null when unavailable. */
  serviceWorkers: number | null;
  /** Bytes the browser says this site stores on disk; null when it does not say. */
  bytes: number | null;
}

const safely = async <T>(read: () => Promise<T> | T): Promise<T | null> => {
  try {
    return await read();
  } catch {
    return null;
  }
};

export async function inspectStorage(): Promise<StorageReport> {
  const cookies = (await safely(() => (document.cookie ? document.cookie.split(";").filter((c) => c.trim() !== "").length : 0))) ?? 0;
  const localItems = (await safely(() => localStorage.length)) ?? 0;
  const sessionItems = (await safely(() => sessionStorage.length)) ?? 0;
  const databases = await safely(async () => (typeof indexedDB !== "undefined" && "databases" in indexedDB ? (await indexedDB.databases()).length : null));
  const caches = await safely(async () => (typeof globalThis.caches !== "undefined" ? (await globalThis.caches.keys()).length : null));
  const serviceWorkers = await safely(async () => (navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : null));
  const bytes = await safely(async () => (navigator.storage?.estimate ? ((await navigator.storage.estimate()).usage ?? null) : null));
  return { cookies, localItems, sessionItems, databases, caches, serviceWorkers, bytes };
}

/** The directives of the page's Content-Security-Policy, read from the page itself; empty when there is none. */
export function readPolicy(doc: Document = document): { name: string; value: string }[] {
  const meta = doc.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]');
  return (meta?.content ?? "")
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d !== "")
    .map((d) => {
      const [name, ...rest] = d.split(/\s+/);
      return { name, value: rest.join(" ") };
    });
}

/** Bytes as people read them. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
