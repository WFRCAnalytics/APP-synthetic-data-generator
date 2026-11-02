import { describe, expect, it } from "vitest";
import { createMissingPicker, JsonWriter, type JsonColumn } from "../../src/lib/json/writer";
import { DEFAULT_JSON_LAYOUT, type JsonLayout } from "../../src/lib/json/types";

const col = (name: string, kind: JsonColumn["kind"], over: Partial<JsonColumn> = {}): JsonColumn => ({ name, kind, naText: "", naTotal: 0, missing: 0, key: 12345, ...over });
const layout = (over: Partial<JsonLayout> = {}): JsonLayout => ({ ...DEFAULT_JSON_LAYOUT, ...over });

function write(columns: JsonColumn[], rows: string[][], l: JsonLayout): string {
  const w = new JsonWriter(columns, l);
  let text = w.begin();
  for (const r of rows) text += w.record(r);
  return text + w.end();
}

const columns = [col("id", "string"), col("age", "number"), col("ok", "boolean")];
const rows = [
  ["A1", "34", "true"],
  ["A2", "41", "false"],
];

describe("JsonWriter", () => {
  it("writes an array, compact", () => {
    const text = write(columns, rows, layout({ indent: "compact", trailingNewline: false }));
    expect(text).toBe('[{"id":"A1","age":34,"ok":true},{"id":"A2","age":41,"ok":false}]');
    expect(JSON.parse(text)).toHaveLength(2);
  });

  it("writes an array indented by 2, 4 or a tab, ending with a line break as recorded", () => {
    const two = write(columns, rows, layout({ indent: "2" }));
    expect(two).toBe('[\n  {\n    "id": "A1",\n    "age": 34,\n    "ok": true\n  },\n  {\n    "id": "A2",\n    "age": 41,\n    "ok": false\n  }\n]\n');
    expect(JSON.parse(two)).toEqual([
      { id: "A1", age: 34, ok: true },
      { id: "A2", age: 41, ok: false },
    ]);
    expect(write(columns, rows, layout({ indent: "4", trailingNewline: false }))).toContain('\n    {\n        "id": "A1"');
    expect(write(columns, rows, layout({ indent: "tab", trailingNewline: false }))).toContain('\n\t{\n\t\t"id": "A1"');
  });

  it("writes one record per line, with no brackets and no commas between records", () => {
    const text = write(columns, rows, layout({ form: "lines", trailingNewline: true }));
    expect(text).toBe('{"id":"A1","age":34,"ok":true}\n{"id":"A2","age":41,"ok":false}\n');
    const noTrail = write(columns, rows, layout({ form: "lines", trailingNewline: false }));
    expect(noTrail.endsWith("}")).toBe(true);
  });

  it("uses the recorded line ending", () => {
    const text = write(columns, rows, layout({ form: "lines", lineEnding: "crlf" }));
    expect(text).toBe('{"id":"A1","age":34,"ok":true}\r\n{"id":"A2","age":41,"ok":false}\r\n');
    expect(write(columns, rows, layout({ indent: "2", lineEnding: "crlf" }))).toContain("[\r\n  {\r\n");
  });

  it("keeps the keys in the recorded order", () => {
    const text = write([col("z", "string"), col("a", "string")], [["1", "2"]], layout({ indent: "compact", trailingNewline: false }));
    expect(text).toBe('[{"z":"1","a":"2"}]');
  });

  it("writes null for a missing cell and leaves out exactly the recorded number of records", () => {
    const n = 200;
    const cols = [col("id", "string"), col("note", "string", { naTotal: 60, missing: 25 })];
    const data = Array.from({ length: n }, (_, i) => [`R${i}`, i < 60 ? "" : `t${i}`]);
    const parsed = JSON.parse(write(cols, data, layout({ indent: "compact", trailingNewline: false }))) as Record<string, unknown>[];
    expect(parsed).toHaveLength(n);
    expect(parsed.filter((r) => !("note" in r))).toHaveLength(25);
    expect(parsed.filter((r) => r.note === null)).toHaveLength(35);
  });

  it("chooses the same records to leave out again, and the choice does not depend on another key", () => {
    const n = 100;
    const mk = (other: string) => {
      const cols = [col("a", "string", { naTotal: 30, missing: 10, key: 777 }), col("b", "string", { naTotal: 0, missing: 0, key: 1 })];
      const data = Array.from({ length: n }, (_, i) => [i < 30 ? "" : "x", other]);
      return write(cols, data, layout({ form: "lines", trailingNewline: false }));
    };
    const a = mk("p");
    expect(mk("p")).toBe(a);
    const absent = (text: string) => text.split("\n").map((line) => !line.includes('"a"'));
    expect(absent(mk("q"))).toEqual(absent(a));
  });

  it("is the same text twice", () => {
    const run = () => write(columns, rows, layout());
    expect(run()).toBe(run());
  });

  it("never writes a nested key, and writes null for a key that held only nulls", () => {
    const cols = [col("id", "string"), col("inner", "object"), col("none", "null")];
    expect(write(cols, [["A", "x", "y"]], layout({ form: "lines", trailingNewline: false }))).toBe('{"id":"A","none":null}');
  });

  it("writes an empty record as {}", () => {
    const cols = [col("a", "string", { naTotal: 1, missing: 1 })];
    expect(write(cols, [[""]], layout({ form: "lines", trailingNewline: false }))).toBe("{}");
    expect(write(cols, [[""]], layout({ indent: "2", trailingNewline: false }))).toBe("[\n  {}\n]");
  });

  it("escapes key names", () => {
    const text = write([col('we"ird', "number")], [["1"]], layout({ form: "lines", trailingNewline: false }));
    expect(JSON.parse(text)).toEqual({ 'we"ird': 1 });
  });

  it("counts text that could not be written as its kind", () => {
    const w = new JsonWriter([col("n", "number")], layout({ form: "lines" }));
    w.begin();
    w.record(["oops"]);
    expect(w.unparsed()).toEqual([1]);
  });
});

describe("createMissingPicker", () => {
  it("picks exactly the wanted number among the missing cells", () => {
    for (const [total, missing] of [
      [10, 0],
      [10, 10],
      [1000, 337],
      [5, 3],
    ]) {
      const pick = createMissingPicker(99, total, missing);
      let taken = 0;
      for (let i = 0; i < total; i++) if (pick()) taken++;
      expect(taken).toBe(missing);
    }
  });
});
