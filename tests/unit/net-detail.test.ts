// What the activity monitor adds to the counter: a log of every request, the bytes that came back, and the bytes sent out in a body.
import { describe, expect, it } from "vitest";
import { bodySize, NetCounter } from "../../src/app/netCounter";
import { formatBytes } from "../../src/app/storageProbe";

const ORIGIN = "http://localhost:4173";

describe("the request log", () => {
  it("lists each request with its size and adds up what came back", () => {
    const c = new NetCounter(ORIGIN);
    c.recordUrl(`${ORIGIN}/a.js`, { initiator: "script", received: 1000, at: 5 });
    c.recordUrl(`${ORIGIN}/b.css`, { initiator: "css", received: 500, at: 6 });
    const d = c.getDetail();
    expect(d.log.map((e) => e.url)).toEqual([`${ORIGIN}/a.js`, `${ORIGIN}/b.css`]);
    expect(d.receivedBytes).toBe(1500);
    expect(d.sentBytes).toBe(0);
    expect(c.getSnapshot()).toEqual({ sameOrigin: 2, crossOrigin: 0, blocked: 0 });
  });

  it("adds data sent out to the sent total without counting it as another request", () => {
    const c = new NetCounter(ORIGIN);
    c.recordSent("https://example.com/x", "POST", 5);
    const d = c.getDetail();
    expect(d.sentBytes).toBe(5);
    expect(d.uploads).toBe(1);
    expect(d.log[0]).toMatchObject({ kind: "cross", method: "POST", sent: 5 });
    expect(c.getSnapshot()).toEqual({ sameOrigin: 0, crossOrigin: 0, blocked: 0 });
  });

  it("keeps a new object only when something changes, and forgets on reset", () => {
    const c = new NetCounter(ORIGIN);
    const first = c.getDetail();
    expect(c.getDetail()).toBe(first);
    c.recordUrl(`${ORIGIN}/a.js`);
    expect(c.getDetail()).not.toBe(first);
    c.reset();
    expect(c.getDetail().log).toEqual([]);
  });

  it("does not list a blob, data or about address, which never leave memory", () => {
    const c = new NetCounter(ORIGIN);
    c.recordUrl("blob:http://localhost:4173/abc");
    c.recordUrl("data:text/plain,hi");
    expect(c.getDetail().log).toEqual([]);
  });
});

describe("bodySize", () => {
  it("measures what a request would carry", () => {
    expect(bodySize(undefined)).toBe(0);
    expect(bodySize("hello")).toBe(5);
    expect(bodySize("é")).toBe(2);
    expect(bodySize(new Uint8Array(10))).toBe(10);
    expect(bodySize(new Blob(["abc"]))).toBe(3);
    expect(bodySize(new URLSearchParams({ a: "1" }))).toBe(3);
    expect(bodySize(new ReadableStream())).toBe(1);
  });
});

describe("formatBytes", () => {
  it("reads as people read sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
