// The offline copy of the app (specs/034): registers the service worker that keeps the app's own files, and asks it to fetch the data engine
// it will use while there is still a network, so the page keeps working if the network goes away after it has loaded. Only the app's own
// files are kept; nothing you open is ever part of it.

export type OfflineState =
  /** Not used here (a local copy, an unsupported browser, or the person's browser refuses). */
  | { phase: "off" }
  | { phase: "preparing"; done: number; total: number }
  | { phase: "ready"; total: number }
  | { phase: "failed" };

type Listener = () => void;
let state: OfflineState = { phase: "off" };
const listeners = new Set<Listener>();
const set = (next: OfflineState): void => {
  state = next;
  listeners.forEach((l) => l());
};

export const offlineState = (): OfflineState => state;
export const subscribeOffline = (l: Listener): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Whether this page should keep an offline copy: the hosted site, not a copy running from a folder, unless asked with ?cache (tests). */
export function offlineWanted(loc: Pick<Location, "protocol" | "hostname" | "search"> = location): boolean {
  if (new URLSearchParams(loc.search).has("cache")) return true;
  const local = loc.hostname === "localhost" || loc.hostname === "127.0.0.1" || loc.hostname === "[::1]";
  return loc.protocol === "https:" && !local;
}

/** WebAssembly exception handling decides which build of the engine a browser runs (the same check the engine itself makes). */
export function engineVariant(): "eh" | "mvp" {
  const probe = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 8, 1, 6, 0, 6, 64, 25, 11, 11);
  try {
    return typeof WebAssembly !== "undefined" && WebAssembly.validate(probe) ? "eh" : "mvp";
  } catch {
    return "mvp";
  }
}

/**
 * What to say when a background worker stops. With no network and no saved copy of the app, that is the likely cause, and the fix is to
 * reload while connected and wait for the header to say "Works offline"; otherwise the plain message stands.
 */
export function workerStoppedMessage(worker: "profiling" | "generating"): string {
  const base = `The ${worker} worker stopped unexpectedly.`;
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (!offline || state.phase === "ready") return base;
  return `${base} You are offline, and the app's files were not saved yet. Reload this page while connected, wait until the header says "Works offline", then try again.`;
}

let started = false;

/** Registers the worker and, once it is active, asks it to fetch the engine now. Safe to call more than once. */
export function startOffline(base: string = import.meta.env.BASE_URL): void {
  if (started || typeof navigator === "undefined" || !("serviceWorker" in navigator) || !offlineWanted()) return;
  started = true;
  navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
    const d = e.data as { type?: string; done?: number; total?: number; finished?: boolean; failed?: boolean } | null;
    if (d?.type !== "warm-progress") return;
    if (d.finished) set(d.failed ? { phase: "failed" } : { phase: "ready", total: d.total ?? 0 });
    else set({ phase: "preparing", done: d.done ?? 0, total: d.total ?? 0 });
  });
  const go = async () => {
    try {
      const registration = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
      const ready = await navigator.serviceWorker.ready;
      const worker = ready.active ?? registration.active;
      set({ phase: "preparing", done: 0, total: 0 });
      worker?.postMessage({ type: "warm", variant: engineVariant() });
    } catch {
      set({ phase: "off" });
    }
  };
  // After the page is up, so the files it needs first are not slowed down by the ones it may need later.
  if (document.readyState === "complete") void go();
  else window.addEventListener("load", () => void go(), { once: true });
}
