// @vitest-environment node
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installNetPatch, patchedWorkerSource } from "../../src/workers/netpatch";

const CHANNEL = "net-patch-test";
const ORIGIN = "http://localhost:4173";
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const realFetch = globalThis.fetch;
let received: string[];
let listener: BroadcastChannel;

beforeEach(() => {
  (globalThis as { self?: unknown }).self = globalThis;
  globalThis.fetch = vi.fn(async () => new Response("ok")) as typeof fetch;
  received = [];
  listener = new BroadcastChannel(CHANNEL);
  listener.onmessage = (e) => received.push((e.data as { url: string }).url);
});

afterEach(() => {
  listener.close();
  globalThis.fetch = realFetch;
});

describe("installNetPatch", () => {
  it("reports every fetch URL and still performs the request", async () => {
    const original = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    installNetPatch(CHANNEL, ORIGIN);

    const response = await fetch("https://example.com/a");
    await fetch("/duckdb/duckdb-eh.wasm");
    await fetch(new URL("https://example.org/b"));
    await wait();

    expect(await response.text()).toBe("ok");
    expect(original).toHaveBeenCalledTimes(3);
    expect(received).toEqual(["https://example.com/a", `${ORIGIN}/duckdb/duckdb-eh.wasm`, "https://example.org/b"]);
  });

  it("accepts a Request-like object", async () => {
    installNetPatch(CHANNEL, ORIGIN);
    await fetch({ url: "https://example.com/req" } as unknown as RequestInfo);
    await wait();
    expect(received).toEqual(["https://example.com/req"]);
  });

  it("passes the init argument through unchanged", async () => {
    const original = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    installNetPatch(CHANNEL, ORIGIN);
    const init = { method: "POST" };
    await fetch("/x", init);
    expect(original).toHaveBeenCalledWith("/x", init);
  });

  it("never lets a reporting problem break the request", async () => {
    installNetPatch(CHANNEL, "not a url");
    await expect(fetch("/still-works")).resolves.toBeInstanceOf(Response);
  });
});

describe("patchedWorkerSource", () => {
  const source = patchedWorkerSource("http://localhost:4173/duckdb/duckdb-browser-eh.worker.js", CHANNEL, ORIGIN);

  it("is valid JavaScript", () => {
    expect(() => new vm.Script(source)).not.toThrow();
  });

  it("installs the patch before loading the script it wraps", () => {
    const patchAt = source.indexOf("BroadcastChannel");
    const importAt = source.indexOf("importScripts(");
    expect(patchAt).toBeGreaterThan(-1);
    expect(importAt).toBeGreaterThan(patchAt);
    expect(source).toContain('importScripts("http://localhost:4173/duckdb/duckdb-browser-eh.worker.js")');
  });

  it("works when run as a standalone script", async () => {
    // Run the generated source in a clean scope, as a blob worker would, with importScripts stubbed.
    const imported: string[] = [];
    const sandbox: Record<string, unknown> = {
      BroadcastChannel,
      URL,
      Response,
      importScripts: (u: string) => imported.push(u),
      fetch: async () => new Response("ok"),
    };
    sandbox.self = sandbox;
    vm.runInNewContext(source, sandbox);
    expect(imported).toEqual(["http://localhost:4173/duckdb/duckdb-browser-eh.worker.js"]);

    await (sandbox.fetch as typeof fetch)("https://example.com/from-sandbox");
    await wait();
    expect(received).toEqual(["https://example.com/from-sandbox"]);
  });
});
