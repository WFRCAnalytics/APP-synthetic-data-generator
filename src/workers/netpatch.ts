// Reports every network request a worker makes (FR-033, contracts/worker-protocol.md section 3).
//
// `installNetPatch` wraps fetch and XMLHttpRequest and posts each URL to a BroadcastChannel the
// page listens on. It must stay self-contained (no outside references), because for DuckDB's worker
// it is turned into source text with toString() and run before DuckDB's own script, so the WebAssembly
// download inside DuckDB's nested worker is counted too. The page's CSP forbids eval, so the text
// is loaded as a blob worker script, which the policy allows (worker-src 'self' blob:).

/* eslint-disable @typescript-eslint/no-explicit-any */
export function installNetPatch(channelName: string, pageOrigin: string): void {
  const scope: any = self;
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(channelName);

  // How many bytes a request body holds (0 when there is none, 1 when it cannot be measured, such as a stream).
  const sizeOf = (body: any): number => {
    if (body === undefined || body === null) return 0;
    if (typeof body === "string") return new TextEncoder().encode(body).length;
    if (typeof body.size === "number") return body.size;
    if (typeof body.byteLength === "number") return body.byteLength;
    if (body instanceof URLSearchParams) return body.toString().length;
    return 1;
  };

  const report = (input: unknown, method?: unknown, body?: unknown) => {
    try {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : (input as { url?: string })?.url ?? String(input);
      channel.postMessage({ url: new URL(raw, pageOrigin + "/").href, method: String(method ?? (input as { method?: string })?.method ?? "GET").toUpperCase(), sent: sizeOf(body) });
    } catch {
      // never let reporting break a request
    }
  };

  if (typeof scope.fetch === "function") {
    const originalFetch = scope.fetch.bind(scope);
    scope.fetch = (input: unknown, init?: any) => {
      report(input, init?.method, init?.body);
      return originalFetch(input, init);
    };
  }

  if (typeof scope.XMLHttpRequest === "function") {
    const originalOpen = scope.XMLHttpRequest.prototype.open;
    scope.XMLHttpRequest.prototype.open = function (this: any, method: string, url: unknown, ...rest: unknown[]) {
      this.__netMethod = method;
      report(url, method);
      return originalOpen.call(this, method, url, ...rest);
    };
    const originalSend = scope.XMLHttpRequest.prototype.send;
    scope.XMLHttpRequest.prototype.send = function (this: any, body?: unknown) {
      const sent = sizeOf(body);
      if (sent > 0) {
        try {
          channel.postMessage({ url: pageOrigin + "/", method: String(this.__netMethod ?? "POST").toUpperCase(), sent, upload: true });
        } catch {
          // never let reporting break a request
        }
      }
      return originalSend.call(this, body);
    };
  }
}

/**
 * Source text for a classic blob worker that installs the patch and then loads `scriptUrl`
 * (DuckDB's worker). `scriptUrl` must be absolute: a blob worker has no base to resolve against.
 */
export function patchedWorkerSource(scriptUrl: string, channelName: string, pageOrigin: string): string {
  // The engine's worker logs the errors it raises, and for some files (JSON) such a line can name a position in the
  // file; none of it may reach the console, so its console is silenced before its own script runs.
  const silence = `for (const k of ["log", "info", "warn", "error", "debug", "trace"]) console[k] = function () {};`;
  return `${silence}\n(${installNetPatch.toString()})(${JSON.stringify(channelName)}, ${JSON.stringify(pageOrigin)});\nimportScripts(${JSON.stringify(scriptUrl)});`;
}
