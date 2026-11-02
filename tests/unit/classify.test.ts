import { describe, expect, it } from "vitest";
import { classifyColumn, resolveDate, type Classification } from "../../src/lib/classify/classify";
import { detectNa, withExtraTokens } from "../../src/lib/classify/na";
import { detectSentinels } from "../../src/lib/classify/sentinels";
import type { BasicStats } from "../../src/lib/classify/stats";
import { patternKind } from "../../src/lib/datefmt/directives";
import { floats, integers, makeStats, strings, top } from "../helpers/stats";

function classify(stats: BasicStats, threshold = 50): Classification {
  const na = detectNa(stats);
  const sentinels = detectSentinels(stats);
  return classifyColumn(stats, na, sentinels, { threshold });
}

describe("NA tokens", () => {
  it("lists the empty field first, then known tokens by count", () => {
    const na = detectNa({ nullCount: 5, tokenCounts: { "N/A": 2, NA: 9 } });
    expect(na.tokens).toEqual(["", "NA", "N/A"]);
    expect(na.byToken).toEqual({ "": 5, NA: 9, "N/A": 2 });
    expect(na.count).toBe(16);
  });

  it("reports nothing for a clean column", () => {
    expect(detectNa({ nullCount: 0, tokenCounts: {} })).toEqual({ tokens: [], byToken: {}, count: 0 });
  });

  it("adds extra tokens without losing the existing ones", () => {
    const merged = withExtraTokens(detectNa({ nullCount: 3, tokenCounts: {} }), [{ value: "refused", count: 4 }]);
    expect(merged.tokens).toEqual(["", "refused"]);
    expect(merged.count).toBe(7);
  });
});

describe("sentinel candidates", () => {
  it("flags negatives in an otherwise non-negative column", () => {
    const s = integers("trips", {
      topValues: top([["3", 300], ["-9", 40], ["-1", 30], ["5", 200]]),
      negativeCount: 70,
      p99: 12,
    });
    expect(detectSentinels(s)).toEqual({ "-9": 40, "-1": 30 });
  });

  it("flags runs of nines far above the rest of the column", () => {
    const s = integers("minutes", {
      topValues: top([["45", 20], ["998", 20], ["999", 10]]),
      p99: 594,
    });
    expect(detectSentinels(s)).toEqual({ "998": 20, "999": 10 });
  });

  it("does not flag a column where negatives are normal", () => {
    const s = integers("temp", { topValues: top([["-5", 40], ["3", 40]]), negativeCount: 500, p99: 30 });
    expect(detectSentinels(s)).toEqual({});
  });

  it("does not flag a 9-pattern value inside the normal range", () => {
    const s = integers("count", { topValues: top([["99", 50], ["40", 50]]), p99: 98 });
    expect(detectSentinels(s)).toEqual({});
  });

  it("ignores a value that does not repeat", () => {
    const s = integers("x", { topValues: top([["-9", 1]]), negativeCount: 1, p99: 10 });
    expect(detectSentinels(s)).toEqual({});
  });

  it("flags nothing in a text column", () => {
    expect(detectSentinels(makeStats({ name: "t", topValues: top([["-9", 50]]) }))).toEqual({});
  });
});

describe("boolean and empty", () => {
  it("types an all-NA column as empty", () => {
    expect(classify(makeStats({ name: "x", valueCount: 0, nullCount: 1000, distinct: 0 })).type).toBe("empty");
  });

  it.each([
    [["true", "false"]],
    [["Y", "N"]],
    [["Yes", "No"]],
    [["0", "1"]],
  ])("recognizes %j as a boolean pair", (labels) => {
    const s = makeStats({ name: "flag", distinct: 2, topValues: top([[labels[0], 600], [labels[1], 400]]) });
    expect(classify(s).type).toBe("boolean");
  });

  it("does not call two unrelated labels a boolean", () => {
    const s = makeStats({ name: "side", distinct: 2, topValues: top([["left", 600], ["right", 400]]) });
    expect(classify(s).type).toBe("categorical");
  });

  it("types a single repeated value as categorical, not boolean", () => {
    const s = makeStats({ name: "const", distinct: 1, topValues: top([["true", 1000]]), intCount: 0, floatCount: 0 });
    expect(classify(s).type).toBe("categorical");
  });
});

describe("categorical and the threshold", () => {
  it("types coded integers as categorical, not numeric (FR-006)", () => {
    const s = integers("mode", { distinct: 6, topValues: top([["1", 500], ["2", 300], ["97", 20]]) });
    const c = classify(s);
    expect(c.type).toBe("categorical");
    expect(c.storage).toBe("integer");
  });

  it("keeps leading zeros as string storage", () => {
    const s = makeStats({ name: "month", distinct: 12, valueCount: 1000, intCount: 1000, floatCount: 1000, leadingZeroCount: 900 });
    const c = classify(s);
    expect(c.type).toBe("categorical");
    expect(c.storage).toBe("string");
  });

  it("types 50 distinct integers as categorical and flags it as near the threshold", () => {
    const c = classify(integers("code", { distinct: 50 }));
    expect(c.type).toBe("categorical");
    expect(c.reasons).toContain("near_categorical_threshold");
    expect(c.status).toBe("needs_attention");
  });

  it("types 51 distinct integers as integer and flags it too", () => {
    const c = classify(integers("code", { distinct: 51 }));
    expect(c.type).toBe("integer");
    expect(c.reasons).toContain("near_categorical_threshold");
  });

  it("honors a different threshold", () => {
    expect(classify(integers("code", { distinct: 60 }), 100).type).toBe("categorical");
    expect(classify(integers("code", { distinct: 60 }), 20).type).toBe("integer");
  });

  it("does not make decimals categorical, even with few distinct values", () => {
    const c = classify(floats("price", { distinct: 5 }));
    expect(c.type).toBe("float");
  });

  it("types a short string column with few values as categorical", () => {
    const s = strings("region", [{ shape: "AAAAA", count: 1000 }], { distinct: 5 });
    const c = classify(s);
    expect(c.type).toBe("categorical");
    expect(c.storage).toBe("string");
  });

  it("flags sentinel codes in a coded column", () => {
    const s = integers("income", {
      distinct: 7,
      topValues: top([["1", 300], ["2", 300], ["-9", 60]]),
      negativeCount: 60,
      p99: 6,
    });
    const c = classify(s);
    expect(c.type).toBe("categorical");
    expect(c.reasons).toContain("possible_sentinel");
  });
});

describe("integer and float", () => {
  it("types many whole numbers as integer", () => {
    expect(classify(integers("trip_minutes")).type).toBe("integer");
  });

  it("types decimals as float", () => {
    expect(classify(floats("distance")).type).toBe("float");
  });

  it("recognizes thousands separators", () => {
    const s = makeStats({ name: "population", valueCount: 1000, thousandsCount: 600, intCount: 400, floatCount: 400, distinct: 900, plainBigCount: 0 });
    const c = classify(s);
    expect(c.type).toBe("integer");
    expect(c.thousands).toBe(true);
  });

  it("does not claim thousands separators when big numbers appear without them", () => {
    const s = makeStats({ name: "population", valueCount: 1000, thousandsCount: 300, intCount: 700, floatCount: 700, distinct: 900, plainBigCount: 100 });
    expect(classify(s).thousands).toBe(false);
  });

  it("treats a few stray markers in a numeric column as extra NA tokens", () => {
    const s = integers("age", {
      valueCount: 1000,
      intCount: 980,
      floatCount: 980,
      unparsedCount: 20,
      unparsedDistinct: 2,
      unparsedTop: [{ value: "refused", count: 15 }, { value: "dk", count: 5 }],
    });
    const c = classify(s);
    expect(c.type).toBe("integer");
    expect(c.reasons).toContain("possible_na_token");
    expect(c.na.tokens).toEqual(["refused", "dk"]);
  });

  it("does not call a mostly text column numeric", () => {
    const s = makeStats({ name: "notes", valueCount: 1000, intCount: 100, floatCount: 100, unparsedCount: 900, unparsedDistinct: 800, distinct: 850, shapes: [{ shape: "AAAA AAAA", count: 900 }], maxLength: 30 });
    expect(classify(s).type).toBe("free_text"); // mostly text with spaces: described by lengths, not read as numbers
  });
});

describe("survey IDs come before categorical", () => {
  it.each(["hh_id", "person_id", "HH_ID", "hhId", "HOUSEID", "case_num", "id"])("recognizes %s", (name) => {
    const s = integers(name, { distinct: 40, shapes: [{ shape: "99999", count: 1000 }] });
    expect(classify(s).type).toBe("survey_id");
  });

  it("never types an ID with few distinct values as categorical", () => {
    const c = classify(integers("hh_id", { distinct: 5, shapes: [{ shape: "99999", count: 1000 }] }));
    expect(c.type).toBe("survey_id");
  });

  it("recognizes letter-and-digit codes", () => {
    const s = strings("site_id", [{ shape: "AA-999-999", count: 1000 }], { maxLength: 10, intCount: 0, floatCount: 0 });
    expect(classify(s).type).toBe("survey_id");
  });

  it("flags mixed patterns", () => {
    const s = strings("mixed_id", [{ shape: "A999", count: 500 }, { shape: "99999", count: 500 }], { maxLength: 6, intCount: 0, floatCount: 0 });
    const c = classify(s);
    expect(c.type).toBe("survey_id");
    expect(c.reasons).toContain("id_mixed_masks");
  });

  it("does not take words that merely end in id", () => {
    const s = integers("paid", { distinct: 500 });
    expect(classify(s).type).toBe("integer");
    expect(classify(integers("valid", { distinct: 500 })).type).toBe("integer");
  });

  it("does not call a decimal column an ID", () => {
    expect(classify(floats("hh_id")).type).not.toBe("survey_id");
  });
});

describe("personal data is described by kind, never by value (specs/002 FR-001)", () => {
  it("proposes email by shape, and flags a mixed column", () => {
    const clean = classify(strings("contact", [{ shape: "AAAA.AAAA@AAAAAAA.AAA", count: 700 }, { shape: "AAAAAA99@AAAAAAA.AAA", count: 300 }]));
    expect(clean.type).toBe("personal");
    expect(clean.personalKind).toBe("email");
    expect(clean.status).toBe("ok");
    expect(clean.reasons).toEqual([]);
    const mixed = classify(strings("contact", [{ shape: "AAAA.AAAA@AAAAAAA.AAA", count: 650 }, { shape: "AAAA AAAA", count: 350 }]));
    expect(mixed.type).toBe("personal");
    expect(mixed.status).toBe("needs_attention");
    expect(mixed.reasons).toContain("kind_mixed");
  });

  it.each([["(999) 999-9999"], ["999-999-9999"], ["999.999.9999"], ["9999999999"], ["999-999-9999 A9999"], ["1-999-999-9999".replace("1", "9")]])(
    "proposes phone for US shape %s",
    (shape) => {
      const c = classify(strings("number", [{ shape, count: 1000 }]));
      expect(c.type).toBe("personal");
      expect(c.personalKind).toBe("phone");
    },
  );

  it("leaves international phone numbers to short strings (US only in this version)", () => {
    expect(classify(strings("number", [{ shape: "+99 99 9999 9999", count: 1000 }], { distinct: 900 })).type).toBe("short_string");
  });

  it("proposes url and ip by shape", () => {
    expect(classify(strings("link", [{ shape: "AAAAA://AAA.AAAAAAA.AAA/AAAA", count: 1000 }], { distinct: 900 })).personalKind).toBe("url");
    expect(classify(strings("host", [{ shape: "999.999.9.99", count: 1000 }], { distinct: 900 })).personalKind).toBe("ip");
  });

  it.each([
    ["email", "email"],
    ["respondent_email", "email"],
    ["full_name", "full_name"],
    ["person_name", "full_name"],
    ["first_name", "first_name"],
    ["given_name", "first_name"],
    ["last_name", "last_name"],
    ["surname", "last_name"],
    ["street_address", "address"],
    ["Phone", "phone"],
    ["mobile", "phone"],
  ])("proposes the kind of the column name %s", (name, kind) => {
    const c = classify(strings(name, [{ shape: "AAAA AAAA", count: 1000 }]));
    expect(c.type).toBe("personal");
    expect(c.personalKind).toBe(kind);
  });

  it("leaves social-security-like numbers unsupported until the user acknowledges them", () => {
    for (const shape of ["999-99-9999", "999999999"]) {
      const c = classify(strings("code", [{ shape, count: 1000 }]));
      expect(c.type).toBe("unsupported");
      expect(c.status).toBe("unsupported");
      expect(c.personalKind).toBe("ssn");
      expect(c.reasons).toEqual(expect.arrayContaining(["possible_identifier", "ssn_needs_acknowledgement"]));
    }
  });

  it("does not treat a numeric column named like a name as personal", () => {
    expect(classify(floats("name_length")).type).toBe("float");
  });
});

describe("unsupported columns (nothing may leak)", () => {
  it("reads latitude and longitude columns as decimals, which the profiler then marks as coordinates", () => {
    expect(classify(floats("o_lat")).type).toBe("float");
    expect(classify(floats("longitude")).type).toBe("float");
    expect(classify(floats("lon")).type).toBe("float");
  });

  it("does not mistake words that contain lat or long", () => {
    expect(classify(floats("plate_value")).type).toBe("float");
    expect(classify(floats("belong")).type).toBe("float");
  });

  it("catches combined coordinates and WKT", () => {
    expect(classify(strings("origin", [{ shape: "(99.999999, -999.999999)", count: 1000 }])).type).toBe("unsupported");
    expect(classify(strings("geom", [{ shape: "POINT (-999.999999 99.999999)", count: 1000 }])).type).toBe("unsupported");
  });

  it("flags a time zone offset as unsupported", () => {
    const s = strings("when", [{ shape: "9999-99-99A99:99:99-99:99", count: 1000 }]);
    expect(classify(s).type).toBe("unsupported");
  });
});

describe("free text and short strings (specs/002 FR-006, FR-007)", () => {
  it("calls long text free text", () => {
    const text = strings("answer", [{ shape: "AAAA AAAA AAAA AAAA", count: 1000 }], { maxLength: 200, meanLength: 80, distinct: 900 });
    expect(classify(text).type).toBe("free_text");
    expect(classify(text).status).toBe("ok");
  });

  it("calls a very long value free text whatever its mean", () => {
    expect(classify(strings("answer", [{ shape: "AAAA", count: 1000 }], { maxLength: 500, meanLength: 12, distinct: 900 })).type).toBe("free_text");
  });

  it("calls a comment-like name with spaces free text even when short", () => {
    const s = strings("comments", [{ shape: "AAAA AAAA", count: 1000 }], { maxLength: 40, meanLength: 20, distinct: 900, spaceCount: 1000 });
    expect(classify(s).type).toBe("free_text");
  });

  it("calls many-valued short codes short strings", () => {
    const codes = strings("code", [{ shape: "AA9999", count: 1000 }], { distinct: 900 });
    expect(classify(codes).type).toBe("short_string");
    expect(classify(codes).status).toBe("ok");
  });

  it("calls 51 distinct labels a short string, 50 a category", () => {
    expect(classify(strings("label", [{ shape: "AAAAA_99", count: 1000 }], { distinct: 51 })).type).toBe("short_string");
    expect(classify(strings("label", [{ shape: "AAAAA_99", count: 1000 }], { distinct: 50 })).type).toBe("categorical");
  });

  it("keeps zip-like codes with leading zeros as short strings instead of losing the zero", () => {
    const s = makeStats({ name: "zip", valueCount: 1000, intCount: 1000, floatCount: 1000, leadingZeroCount: 90, distinct: 300 });
    expect(classify(s).type).toBe("short_string");
  });

  it("survey IDs still win over short strings", () => {
    expect(classify(integers("hh_id", { distinct: 900, shapes: [{ shape: "99999", count: 1000 }] })).type).toBe("survey_id");
  });
});

describe("date candidates", () => {
  it.each([
    ["9999-99-99", ["%Y-%m-%d"]],
    ["99/99/9999", ["%m/%d/%Y", "%d/%m/%Y"]],
    ["99-AAA-9999", ["%d-%b-%Y"]],
    ["9999-99-99A99:99:99", ["%Y-%m-%dT%H:%M:%S"]],
    ["99:99", ["%H:%M"]],
  ])("offers patterns for the shape %s", (shape, patterns) => {
    const c = classify(strings("when", [{ shape, count: 1000 }], { distinct: 900 }));
    expect(c.type).toBe("date");
    expect(c.datePatterns).toEqual(patterns);
  });

  it("reads four digits as a clock time only when the name says so", () => {
    const digits = [{ shape: "9999", count: 1000 }];
    const named = classify(integers("start_time", { shapes: digits, distinct: 600 }));
    expect(named.datePatterns).toEqual(["%H%M"]);
    const plain = classify(integers("year_code", { shapes: digits, distinct: 600 }));
    expect(plain.datePatterns).toBeUndefined();
  });
});

describe("resolving dates after the patterns were tried", () => {
  const kind = (p: string) => patternKind(p) as "date" | "datetime" | "time";

  it("accepts the one pattern that parses everything", () => {
    const r = resolveDate([{ pattern: "%m/%d/%Y", parsed: 1000 }, { pattern: "%d/%m/%Y", parsed: 420 }], 1000, [], kind);
    expect(r).toMatchObject({ pattern: "%m/%d/%Y", type: "date", status: "ok", reasons: [] });
  });

  it("flags ambiguity when two patterns both parse everything", () => {
    const r = resolveDate([{ pattern: "%m/%d/%Y", parsed: 1000 }, { pattern: "%d/%m/%Y", parsed: 1000 }], 1000, [], kind);
    expect(r.status).toBe("needs_attention");
    expect(r.reasons).toEqual(["date_format_ambiguous"]);
    expect(r.pattern).toBe("%m/%d/%Y");
  });

  it("reports the kind from the pattern", () => {
    expect(resolveDate([{ pattern: "%H:%M", parsed: 10 }], 10, [], kind).type).toBe("time");
    expect(resolveDate([{ pattern: "%Y-%m-%d %H:%M:%S", parsed: 10 }], 10, [], kind).type).toBe("datetime");
  });

  it("treats a few repeated markers as extra NA tokens", () => {
    const r = resolveDate(
      [{ pattern: "%m/%d/%Y", parsed: 980 }],
      1000,
      top([["00/00/0000", 20], ["03/04/2024", 5]]),
      kind,
    );
    expect(r.status).toBe("needs_attention");
    expect(r.reasons).toEqual(["date_format_unrecognized"]);
    expect(r.extraNa).toEqual([{ value: "00/00/0000", count: 20 }]);
  });

  it("flags two formats in one column", () => {
    const r = resolveDate([{ pattern: "%Y-%m-%d", parsed: 500 }, { pattern: "%m/%d/%Y", parsed: 500 }], 1000, [], kind);
    expect(r).toMatchObject({ type: "unsupported", status: "needs_attention", reasons: ["date_format_mixed"] });
  });

  it("falls back to unsupported when almost nothing parses", () => {
    const r = resolveDate([{ pattern: "%Y-%m-%d", parsed: 100 }], 1000, [], kind);
    expect(r).toMatchObject({ type: "unsupported", status: "unsupported" });
    expect(r.reasons).toContain("date_format_unrecognized");
  });
});
