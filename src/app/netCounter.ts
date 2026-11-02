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

/** One request, as the activity monitor lists it. */
export interface NetEntry {
  id: number;
  /** Milliseconds since the page started, from the same clock as the browser's resource timeline. */
  at: number;
  url: string;
  kind: "same" | "cross";
  method: string;
  /** What asked for it: script, css, fetch, worker and so on. */
  initiator: string;
  /** Bytes that came back (0 when the browser does not say). */
  received: number;
  /** Bytes of data in the request itself (a body). Always 0 for this app. */
  sent: number;
}

/** What the activity monitor shows beyond the three counts. */
export interface NetDetail {
  log: readonly NetEntry[];
  receivedBytes: number;
  /** Bytes of request bodies sent anywhere, and how many requests carried one. */
  sentBytes: number;
  uploads: number;
}

const MAX_LOG = 400;
const NO_DETAIL: NetDetail = { log: [], receivedBytes: 0, sentBytes: 0, uploads: 0 };

export interface RequestDetail {
  initiator?: string;
  received?: number;
  method?: string;
  sent?: number;
  at?: number;
}

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
  private detail: NetDetail = NO_DETAIL;
  private nextId = 1;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly pageOrigin: string) {}

  /** A stable object, replaced only when a count changes (for useSyncExternalStore). */
  getSnapshot = (): NetCounts => this.counts;

  /** The request log and the byte totals; a new object whenever either changes. */
  getDetail = (): NetDetail => this.detail;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private bump(key: keyof NetCounts): void {
    this.counts = { ...this.counts, [key]: this.counts[key] + 1 };
    this.listeners.forEach((l) => l());
  }

  private note(url: string, kind: "same" | "cross", info: RequestDetail): void {
    const sent = info.sent ?? 0;
    const entry: NetEntry = {
      id: this.nextId++,
      at: info.at ?? (typeof performance !== "undefined" ? performance.now() : 0),
      url,
      kind,
      method: info.method ?? "GET",
      initiator: info.initiator ?? "request",
      received: info.received ?? 0,
      sent,
    };
    const log = [...this.detail.log, entry];
    this.detail = {
      log: log.length > MAX_LOG ? log.slice(log.length - MAX_LOG) : log,
      receivedBytes: this.detail.receivedBytes + entry.received,
      sentBytes: this.detail.sentBytes + sent,
      uploads: this.detail.uploads + (sent > 0 ? 1 : 0),
    };
  }

  /** Records a request URL seen by the page or reported by a worker. */
  recordUrl(url: string, info: RequestDetail = {}): void {
    const kind = classifyUrl(url, this.pageOrigin);
    if (kind === "local") return;
    this.note(url, kind, info);
    this.bump(kind === "same" ? "sameOrigin" : "crossOrigin");
  }

  /** Records data sent out in a request body, whatever the address. It adds to the sent total and is listed; it is not a second request. */
  recordSent(url: string, method: string, bytes: number): void {
    const kind = classifyUrl(url, this.pageOrigin);
    this.note(url, kind === "cross" ? "cross" : "same", { method, sent: Math.max(1, bytes), initiator: "upload" });
    this.listeners.forEach((l) => l());
  }

  /** Records a request the Content-Security-Policy refused. */
  recordBlocked(): void {
    this.bump("blocked");
  }

  reset(): void {
    this.counts = { sameOrigin: 0, crossOrigin: 0, blocked: 0 };
    this.detail = NO_DETAIL;
    this.listeners.forEach((l) => l());
  }
}

/** Starts feeding a counter from the page and the workers. Returns a function that stops it. */
export function startNetMonitoring(counter: NetCounter): () => void {
  const stops: (() => void)[] = [];

  if (typeof PerformanceObserver !== "undefined") {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const timing = entry as PerformanceResourceTiming;
          counter.recordUrl(entry.name, { initiator: timing.initiatorType, received: timing.transferSize || timing.encodedBodySize || 0, at: entry.startTime });
        }
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
    channel.onmessage = (e: MessageEvent<{ url?: unknown; method?: unknown; sent?: unknown; upload?: unknown }>) => {
      const d = e.data;
      if (typeof d?.url !== "string") return;
      const sent = typeof d.sent === "number" ? d.sent : 0;
      const method = typeof d.method === "string" ? d.method : "GET";
      if (d.upload === true) counter.recordSent(d.url, method, sent);
      else counter.recordUrl(d.url, { initiator: "worker", method, sent });
    };
    stops.push(() => channel.close());
  }

  stops.push(watchUploads(counter));

  return () => stops.forEach((stop) => stop());
}

/** How many bytes a request body holds (1 when it cannot be measured, such as a stream). */
export function bodySize(body: unknown): number {
  if (body === undefined || body === null) return 0;
  if (typeof body === "string") return new TextEncoder().encode(body).length;
  if (body instanceof URLSearchParams) return body.toString().length;
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    let n = 0;
    body.forEach((v) => {
      n += typeof v === "string" ? v.length : v.size;
    });
    return Math.max(1, n);
  }
  return 1;
}

/**
 * Watches the page for anything that sends data out: fetch and XMLHttpRequest with a body, a beacon, a web-socket message, a form
 * submission. It only looks and passes everything on unchanged; the Content-Security-Policy is what refuses the connection.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const watched = new WeakSet<NetCounter>();

export function watchUploads(counter: NetCounter): () => void {
  // Once per counter: the app starts it as the page loads, and the counter's own start finds it already in place.
  if (watched.has(counter)) return () => {};
  watched.add(counter);
  const restore: (() => void)[] = [];
  const g = globalThis as unknown as Record<string, any>;
  const urlOf = (input: unknown): string => {
    try {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : (input as { url?: string })?.url ?? String(input);
      return new URL(raw, typeof location !== "undefined" ? location.href : undefined).href;
    } catch {
      return String(input);
    }
  };

  if (typeof g.fetch === "function") {
    const original = g.fetch;
    const wrapped = function (this: unknown, input: unknown, init?: { method?: string; body?: unknown }) {
      try {
        const method = String(init?.method ?? (input as { method?: string })?.method ?? "GET").toUpperCase();
        const size = bodySize(init?.body);
        if (size > 0 || (method !== "GET" && method !== "HEAD")) counter.recordSent(urlOf(input), method, size);
      } catch {
        // never let watching break a request
      }
      return original.call(this, input, init);
    };
    g.fetch = wrapped;
    restore.push(() => {
      if (g.fetch === wrapped) g.fetch = original;
    });
  }

  if (typeof XMLHttpRequest !== "undefined") {
    const proto = XMLHttpRequest.prototype as any;
    const open = proto.open;
    const send = proto.send;
    proto.open = function (this: any, method: string, url: unknown, ...rest: unknown[]) {
      this.__netMethod = method;
      this.__netUrl = url;
      return open.call(this, method, url, ...rest);
    };
    proto.send = function (this: any, body?: unknown) {
      try {
        const size = bodySize(body);
        if (size > 0) counter.recordSent(urlOf(this.__netUrl), String(this.__netMethod ?? "POST").toUpperCase(), size);
      } catch {
        // never let watching break a request
      }
      return send.call(this, body);
    };
    restore.push(() => {
      proto.open = open;
      proto.send = send;
    });
  }

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const original = navigator.sendBeacon.bind(navigator);
    const wrapped = (url: string | URL, data?: BodyInit | null) => {
      try {
        counter.recordSent(urlOf(url), "POST", bodySize(data));
      } catch {
        // never let watching break a request
      }
      return original(url, data);
    };
    navigator.sendBeacon = wrapped;
    restore.push(() => {
      if (navigator.sendBeacon === wrapped) navigator.sendBeacon = original;
    });
  }

  if (typeof WebSocket !== "undefined") {
    const proto = WebSocket.prototype as any;
    const send = proto.send;
    proto.send = function (this: any, data: unknown) {
      try {
        counter.recordSent(urlOf(this.url), "WS", bodySize(data));
      } catch {
        // never let watching break a request
      }
      return send.call(this, data);
    };
    restore.push(() => {
      proto.send = send;
    });
  }

  if (typeof document !== "undefined") {
    const onSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement | null;
      counter.recordSent(urlOf(form?.action ?? location.href), String(form?.method ?? "GET").toUpperCase(), 1);
    };
    document.addEventListener("submit", onSubmit, true);
    restore.push(() => document.removeEventListener("submit", onSubmit, true));
  }

  return () => {
    watched.delete(counter);
    restore.forEach((r) => r());
  };
}
