// @vitest-environment node
// The streaming Parquet file writer (specs/005 FR-006, FR-007, FR-010, FR-014, contracts/parquet-output.md):
// the layout of the file, row groups, nulls, determinism, and what the footer does not contain. The schema,
// values and types are checked by independent readers in tests/integration/parquet-readback.test.ts.

import { describe, expect, it } from "vitest";
import { createConverter } from "../../src/lib/parquet/convert";
import { chooseCodec, CREATED_BY_PREFIX, parquetChunks, type ParquetColumn } from "../../src/lib/parquet/writer";
import type { ParquetType } from "../../src/lib/parquet/types";

async function bytesOf(columns: ParquetColumn[], rows: (string | null)[][], options: { rowGroupRows?: number; codec?: "gzip" | "none" } = {}) {
  const converters = columns.map((c) => createConverter(c.type));
  async function* typed() {
    for (const row of rows) yield row.map((text, i) => (text === null ? null : converters[i].convert(text)));
  }
  const parts: Uint8Array[] = [];
  for await (const chunk of parquetChunks(columns, typed(), { createdBy: `${CREATED_BY_PREFIX} 0.0.0-test`, codec: options.codec ?? "none", rowGroupRows: options.rowGroupRows })) parts.push(chunk);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const t = (type: Omit<ParquetType, "nullable"> & { nullable?: boolean }): ParquetType => ({ nullable: true, ...type });
const cols: ParquetColumn[] = [
  { name: "id", type: t({ kind: "int", bits: 64, signed: true, nullable: false }) },
  { name: "name", type: t({ kind: "string" }) },
  { name: "amount", type: t({ kind: "decimal", precision: 10, scale: 2 }) },
];
const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => [String(i), i % 5 === 0 ? null : `person ${i}`, `${i}.25`]);

const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
const magic = (b: Uint8Array, at: number) => text(b.subarray(at, at + 4));

describe("the file layout", () => {
  it("starts and ends with PAR1, with the footer length just before the closing magic", async () => {
    const file = await bytesOf(cols, rowsOf(10));
    expect(magic(file, 0)).toBe("PAR1");
    expect(magic(file, file.length - 4)).toBe("PAR1");
    const footerLength = new DataView(file.buffer, file.byteOffset + file.length - 8, 4).getUint32(0, true);
    expect(footerLength).toBeGreaterThan(20);
    expect(footerLength).toBeLessThan(file.length - 12);
  });

  it("writes a valid file for no rows and for a single row", async () => {
    for (const n of [0, 1]) {
      const file = await bytesOf(cols, rowsOf(n));
      expect(magic(file, 0)).toBe("PAR1");
      expect(magic(file, file.length - 4)).toBe("PAR1");
    }
  });

  it("names this app as the creator in the footer and nothing else of the kind", async () => {
    const file = await bytesOf(cols, rowsOf(20));
    expect(text(file)).toContain(`${CREATED_BY_PREFIX} 0.0.0-test`);
    expect(text(file)).not.toMatch(/parquet-cpp|parquet-mr|pyarrow|duckdb|pandas|spark/i);
  });
});

describe("determinism", () => {
  it("gives the same bytes for the same rows, uncompressed and compressed", async () => {
    for (const codec of ["none", "gzip"] as const) {
      const a = await bytesOf(cols, rowsOf(300), { codec });
      const b = await bytesOf(cols, rowsOf(300), { codec });
      expect(Buffer.from(a).equals(Buffer.from(b)), codec).toBe(true);
    }
  });

  it("does not depend on how the rows are split into row groups for the values, only for the layout", async () => {
    const one = await bytesOf(cols, rowsOf(300), { rowGroupRows: 1000 });
    const many = await bytesOf(cols, rowsOf(300), { rowGroupRows: 64 });
    expect(Buffer.from(one).equals(Buffer.from(many))).toBe(false);
    expect(many.length).toBeGreaterThan(one.length); // more headers
  });

  it("changes when a value changes", async () => {
    const a = await bytesOf(cols, rowsOf(50));
    const rows = rowsOf(50);
    rows[7][2] = "999.99";
    expect(Buffer.from(await bytesOf(cols, rows)).equals(Buffer.from(a))).toBe(false);
  });
});

describe("compression", () => {
  it("makes a repetitive file smaller with gzip, and says which codec it can use", async () => {
    const rows = Array.from({ length: 2000 }, () => ["1", "same name", "1.00"]);
    const plain = await bytesOf(cols, rows, { codec: "none" });
    const packed = await bytesOf(cols, rows, { codec: "gzip" });
    expect(packed.length).toBeLessThan(plain.length / 4);
    expect(chooseCodec()).toBe("gzip");
  });

  it("writes the gzip header with no time and an unknown system, so it does not depend on the machine", async () => {
    const file = await bytesOf([{ name: "n", type: t({ kind: "int", bits: 32, signed: true }) }], rowsOf(100).map((r) => [r[0]]), { codec: "gzip" });
    const at = file.findIndex((b, i) => b === 0x1f && file[i + 1] === 0x8b && file[i + 2] === 0x08); // the gzip magic
    expect(at).toBeGreaterThan(0);
    expect(Array.from(file.subarray(at + 4, at + 8))).toEqual([0, 0, 0, 0]); // mtime
    expect(file[at + 9]).toBe(0xff); // operating system: unknown
  });
});

describe("nulls", () => {
  it("refuses a missing value in a column written as required", async () => {
    await expect(bytesOf(cols, [[null, "x", "1.00"]])).rejects.toThrow(/required column "id"/);
  });

  it("accepts an optional column with only nulls, and with none", async () => {
    const onlyNull = await bytesOf([{ name: "a", type: t({ kind: "string" }) }], [[null], [null], [null]]);
    expect(magic(onlyNull, onlyNull.length - 4)).toBe("PAR1");
    const none = await bytesOf([{ name: "a", type: t({ kind: "string" }) }], [["x"], ["y"]]);
    expect(magic(none, none.length - 4)).toBe("PAR1");
  });
});

describe("what the file does not contain", () => {
  it("holds no key-value metadata, statistics or index of the data, so no value is repeated outside its page", async () => {
    // A name that appears once as data must appear once in the file (not again in a statistic or a dictionary).
    const marker = "ZZZ-UNIQUE-MARKER-VALUE";
    const file = await bytesOf([{ name: "who", type: t({ kind: "string" }) }], [["aaa"], [marker], ["mmm"]]);
    const found = text(file).split(marker).length - 1;
    expect(found).toBe(1);
    // and the smallest and largest values are not repeated either
    expect(text(file).split("aaa").length - 1).toBe(1);
  });
});

describe("a column of every kind", () => {
  it("writes without error", async () => {
    const all: ParquetColumn[] = [
      { name: "i8", type: t({ kind: "int", bits: 8, signed: true }) },
      { name: "u32", type: t({ kind: "int", bits: 32, signed: false }) },
      { name: "u64", type: t({ kind: "int", bits: 64, signed: false }) },
      { name: "f32", type: t({ kind: "float", bits: 32 }) },
      { name: "f64", type: t({ kind: "float", bits: 64 }) },
      { name: "d9", type: t({ kind: "decimal", precision: 9, scale: 2 }) },
      { name: "d18", type: t({ kind: "decimal", precision: 18, scale: 4 }) },
      { name: "d38", type: t({ kind: "decimal", precision: 38, scale: 10 }) },
      { name: "b", type: t({ kind: "bool" }) },
      { name: "s", type: t({ kind: "string" }) },
      { name: "d", type: t({ kind: "date" }) },
      { name: "tm", type: t({ kind: "time", unit: "ms" }) },
      { name: "tu", type: t({ kind: "time", unit: "us" }) },
      { name: "ts", type: t({ kind: "timestamp", unit: "ns", utc: true }) },
    ];
    const row = ["-5", "4000000000", "18446744073709551615", "1.5", "2.5", "12.34", "1.2345", "12345678901234567890.1234567890", "TRUE", "é", "2024-02-29", "01:02:03.004", "01:02:03.000004", "2024-02-29 01:02:03.123456789"];
    for (const codec of ["none", "gzip"] as const) {
      const file = await bytesOf(all, [row, row.map(() => null)], { codec });
      expect(magic(file, file.length - 4)).toBe("PAR1");
    }
  });
});

describe("chunks the caller may transfer", () => {
  it("can be detached one by one without breaking the rest of the file or the next file", async () => {
    // A worker posts each chunk with its buffer transferred, which detaches it. Nothing the writer reuses may be handed out.
    for (let run = 0; run < 2; run++) {
      const converters = cols.map((c) => createConverter(c.type));
      async function* typed() {
        for (const row of rowsOf(30)) yield row.map((text, i) => (text === null ? null : converters[i].convert(text)));
      }
      const copies: Uint8Array[] = [];
      for await (const chunk of parquetChunks(cols, typed(), { createdBy: "x", codec: "gzip", rowGroupRows: 10 })) {
        copies.push(chunk.slice());
        structuredClone(chunk.buffer, { transfer: [chunk.buffer] }); // detaches it, as postMessage does
      }
      const file = new Uint8Array(copies.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of copies) {
        file.set(p, at);
        at += p.length;
      }
      expect(copies[0].length).toBe(4);
      expect(copies.length).toBeGreaterThan(4);
      // The closing eight bytes must hold the real footer length, which starts a Thrift struct (version, field 1).
      const footerLength = new DataView(file.buffer, file.length - 8, 4).getUint32(0, true);
      expect(footerLength).toBeGreaterThan(20);
      expect(file[file.length - 8 - footerLength]).toBe(0x15);
    }
  });
});
