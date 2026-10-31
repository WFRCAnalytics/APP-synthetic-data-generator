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

  const report = (input: unknown) => {
    try {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : (input as { url?: string })?.url ?? String(input);
      channel.postMessage({ url: new URL(raw, pageOrigin + "/").href });
    } catch {
      // never let reporting break a request
    }
  };

  if (typeof scope.fetch === "function") {
    const originalFetch = scope.fetch.bind(scope);
    scope.fetch = (input: unknown, init?: unknown) => {
      report(input);
      return originalFetch(input, init);
    };
  }

  if (typeof scope.XMLHttpRequest === "function") {
    const originalOpen = scope.XMLHttpRequest.prototype.open;
    scope.XMLHttpRequest.prototype.open = function (this: unknown, method: string, url: unknown, ...rest: unknown[]) {
      report(url);
      return originalOpen.call(this, method, url, ...rest);
    };
  }
}

/**
 * Source text for a classic blob worker that installs the patch and then loads `scriptUrl`
 * (DuckDB's worker). `scriptUrl` must be absolute: a blob worker has no base to resolve against.
 */
export function patchedWorkerSource(scriptUrl: string, channelName: string, pageOrigin: string): string {
  return `(${installNetPatch.toString()})(${JSON.stringify(channelName)}, ${JSON.stringify(pageOrigin)});\nimportScripts(${JSON.stringify(scriptUrl)});`;
}
