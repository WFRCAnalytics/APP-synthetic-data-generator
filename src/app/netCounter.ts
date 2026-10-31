// The visible network-request counter (FR-033, constitution Principle I). It counts every request
// since page load, split into same-origin, cross-origin and blocked, from three sources:
//  - the page's own resource timeline (PerformanceObserver),
//  - Content-Security-Policy violation events (a blocked cross-origin attempt),
//  - reports from the workers over a BroadcastChannel (workers are invisible to the page's timeline,
//    and DuckDB fetches its WebAssembly module from inside its own worker).
// The page's Content-Security-Policy is what actually stops a cross-origin request; this counter
// makes the result visible without opening developer tools.

import { NET_CHANNEL } from "../lib/netChannel";

export interface NetCounts {
  sameOrigin: number;
  crossOrigin: number;
  blocked: number;
}

export type NetKind = "same" | "cross" | "local";

/** Whether a URL is a same-origin request, a cross-origin one, or not a network request at all. */
export function classifyUrl(url: string, pageOrigin: string): NetKind {
  // blob:, data: and about: URLs point at memory, not the network.
  if (/^(blob|data|about):/i.test(url)) return "local";
  try {
    return new URL(url, pageOrigin).origin === pageOrigin ? "same" : "cross";
  } catch {
    return "local";
  }
}

type Listener = () => void;

export class NetCounter {
  private counts: NetCounts = { sameOrigin: 0, crossOrigin: 0, blocked: 0 };
  private readonly listeners = new Set<Listener>();

  constructor(private readonly pageOrigin: string) {}

  /** A stable object, replaced only when a count changes (for useSyncExternalStore). */
  getSnapshot = (): NetCounts => this.counts;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private bump(key: keyof NetCounts): void {
    this.counts = { ...this.counts, [key]: this.counts[key] + 1 };
    this.listeners.forEach((l) => l());
  }

  /** Records a request URL seen by the page or reported by a worker. */
  recordUrl(url: string): void {
    const kind = classifyUrl(url, this.pageOrigin);
    if (kind === "same") this.bump("sameOrigin");
    else if (kind === "cross") this.bump("crossOrigin");
  }

  /** Records a request the Content-Security-Policy refused. */
  recordBlocked(): void {
    this.bump("blocked");
  }

  reset(): void {
    this.counts = { sameOrigin: 0, crossOrigin: 0, blocked: 0 };
    this.listeners.forEach((l) => l());
  }
}

/** Starts feeding a counter from the page and the workers. Returns a function that stops it. */
export function startNetMonitoring(counter: NetCounter): () => void {
  const stops: (() => void)[] = [];

  if (typeof PerformanceObserver !== "undefined") {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) counter.recordUrl(entry.name);
      });
      // buffered: also count what loaded before this ran (the page's own scripts, styles, fonts).
      observer.observe({ type: "resource", buffered: true });
      stops.push(() => observer.disconnect());
    } catch {
      // Older browsers: the other two sources still work.
    }
  }

  if (typeof document !== "undefined") {
    const onViolation = () => counter.recordBlocked();
    document.addEventListener("securitypolicyviolation", onViolation);
    stops.push(() => document.removeEventListener("securitypolicyviolation", onViolation));
  }

  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(NET_CHANNEL);
    channel.onmessage = (e: MessageEvent<{ url?: unknown }>) => {
      if (typeof e.data?.url === "string") counter.recordUrl(e.data.url);
    };
    stops.push(() => channel.close());
  }

  return () => stops.forEach((stop) => stop());
}
