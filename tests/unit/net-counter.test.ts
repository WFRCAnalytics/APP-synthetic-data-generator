// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyUrl, NetCounter, startNetMonitoring } from "../../src/app/netCounter";
import { NET_CHANNEL } from "../../src/lib/netChannel";

const ORIGIN = "http://localhost:4173";
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe("classifyUrl", () => {
  it("calls the page's own files same-origin", () => {
    expect(classifyUrl("http://localhost:4173/app/assets/index.js", ORIGIN)).toBe("same");
    expect(classifyUrl("/duckdb/duckdb-eh.wasm", ORIGIN)).toBe("same");
    expect(classifyUrl("assets/font.woff2", ORIGIN)).toBe("same");
  });

  it("calls any other origin cross-origin, including another port, scheme or subdomain", () => {
    expect(classifyUrl("https://example.com/x", ORIGIN)).toBe("cross");
    expect(classifyUrl("http://localhost:3000/x", ORIGIN)).toBe("cross");
    expect(classifyUrl("https://localhost:4173/x", ORIGIN)).toBe("cross");
    expect(classifyUrl("http://cdn.localhost:4173/x", ORIGIN)).toBe("cross");
    expect(classifyUrl("https://fonts.googleapis.com/css2", ORIGIN)).toBe("cross");
  });

  it("does not count in-memory URLs or nonsense as network requests", () => {
    expect(classifyUrl("blob:http://localhost:4173/1234", ORIGIN)).toBe("local");
    expect(classifyUrl("data:text/plain;base64,AAAA", ORIGIN)).toBe("local");
    expect(classifyUrl("about:blank", ORIGIN)).toBe("local");
  });
});

describe("NetCounter", () => {
  it("starts at zero", () => {
    expect(new NetCounter(ORIGIN).getSnapshot()).toEqual({ sameOrigin: 0, crossOrigin: 0, blocked: 0 });
  });

  it("counts same-origin, cross-origin and blocked separately", () => {
    const c = new NetCounter(ORIGIN);
    c.recordUrl("/a.js");
    c.recordUrl(`${ORIGIN}/b.css`);
    c.recordUrl("https://example.com/");
    c.recordBlocked();
    c.recordBlocked();
    expect(c.getSnapshot()).toEqual({ sameOrigin: 2, crossOrigin: 1, blocked: 2 });
  });

  it("ignores URLs that are not network requests", () => {
    const c = new NetCounter(ORIGIN);
    c.recordUrl("blob:http://localhost:4173/x");
    c.recordUrl("data:,hello");
    expect(c.getSnapshot()).toEqual({ sameOrigin: 0, crossOrigin: 0, blocked: 0 });
  });

  it("returns the same snapshot object until something changes", () => {
    const c = new NetCounter(ORIGIN);
    const first = c.getSnapshot();
    expect(c.getSnapshot()).toBe(first);
    c.recordUrl("/a");
    expect(c.getSnapshot()).not.toBe(first);
  });

  it("tells subscribers about every change and stops after unsubscribe", () => {
    const c = new NetCounter(ORIGIN);
    let calls = 0;
    const off = c.subscribe(() => calls++);
    c.recordUrl("/a");
    c.recordBlocked();
    expect(calls).toBe(2);
    off();
    c.recordUrl("/b");
    expect(calls).toBe(2);
  });

  it("resets to zero", () => {
    const c = new NetCounter(ORIGIN);
    c.recordUrl("https://example.com/");
    c.reset();
    expect(c.getSnapshot()).toEqual({ sameOrigin: 0, crossOrigin: 0, blocked: 0 });
  });
});

describe("monitoring worker reports", () => {
  it("counts requests that workers report over the channel, until stopped", async () => {
    const counter = new NetCounter(ORIGIN);
    const stop = startNetMonitoring(counter);
    const worker = new BroadcastChannel(NET_CHANNEL);

    worker.postMessage({ url: `${ORIGIN}/duckdb/duckdb-eh.wasm` });
    worker.postMessage({ url: "https://example.com/leak" });
    await wait();
    expect(counter.getSnapshot()).toMatchObject({ sameOrigin: 1, crossOrigin: 1 });

    stop();
    worker.postMessage({ url: "https://example.com/after-stop" });
    await wait();
    expect(counter.getSnapshot().crossOrigin).toBe(1);
    worker.close();
  });

  it("ignores malformed reports", async () => {
    const counter = new NetCounter(ORIGIN);
    const stop = startNetMonitoring(counter);
    const worker = new BroadcastChannel(NET_CHANNEL);
    worker.postMessage({ nothing: true });
    worker.postMessage("text");
    worker.postMessage({ url: 42 });
    await wait();
    expect(counter.getSnapshot()).toEqual({ sameOrigin: 0, crossOrigin: 0, blocked: 0 });
    stop();
    worker.close();
  });
});
