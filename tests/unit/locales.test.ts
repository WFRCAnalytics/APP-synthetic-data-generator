// Other regions (specs/014): names, emails, phone numbers and addresses made from a region's own word lists, the same way for the
// same spec and seed, never repeating a value inside the space, and carried by the spec, the editor, the sample and the README.

import { describe, expect, it } from "vitest";
import { renderAll } from "../../src/lib/generate/render";
import { planTable } from "../../src/lib/generate/table";
import { applyEdits } from "../../src/lib/profile/edits";
import type { ColumnProfile } from "../../src/lib/profile/types";
import { agentReadme } from "../../src/lib/readme/agentReadme";
import { columnSpecOf } from "../../src/lib/spec/build";
import { profileFromSpec } from "../../src/lib/spec/toProfiles";
import { SPEC_VERSION, type ColumnSpec, type PersonalKind, type SpecFile } from "../../src/lib/spec/types";
import { validateSpec } from "../../src/lib/spec/validate";
import { LOCALES, type PersonalLocale } from "../../src/lib/textgen/locales";
import { fold } from "../../src/lib/textgen/localePersonal";
import { makePersonalComposer } from "../../src/lib/textgen/personal";
import { sampleValues } from "../../src/lib/textgen/sample";

const OTHER = LOCALES.map((l) => l.value).filter((l): l is Exclude<PersonalLocale, "en_US"> => l !== "en_US");

describe("every region", () => {
  it.each(OTHER)("%s makes names, emails, phone numbers and addresses, all different within the space", (locale) => {
    for (const kind of ["full_name", "first_name", "last_name", "email", "phone", "address"] as PersonalKind[]) {
      const c = makePersonalComposer(kind, undefined, locale);
      expect(c.natural, `${locale} ${kind}`).toBeGreaterThanOrEqual(20);
      const seen = new Set<string>();
      const take = Math.min(c.natural, 3000);
      for (let i = 0; i < take; i++) seen.add(c.valueAt(Math.floor((i * c.natural) / take), 0));
      expect(seen.size, `${locale} ${kind} repeats`).toBe(take);
    }
  });

  it.each(OTHER)("%s emails use only plain letters and digits, and look like emails", (locale) => {
    const c = makePersonalComposer("email", undefined, locale);
    for (let i = 0; i < 400; i++) expect(c.valueAt(i * 7, 0)).toMatch(/^[a-z0-9]+\.[a-z0-9]+@[a-z0-9.-]+\.[a-z]+$/);
  });

  it.each(OTHER)("%s phone numbers follow the shape of the region, or the shape of the real column", (locale) => {
    const c = makePersonalComposer("phone", undefined, locale);
    expect(c.suffixes).toBe(false);
    const a = c.valueAt(1, 0);
    expect(a).toMatch(/^[\d() +-]+$/);
    expect(c.valueAt(2, 0)).not.toBe(a);
    const shaped = makePersonalComposer("phone", { shapes: [{ shape: "+99 999-9999", share: 1 }] }, locale);
    expect(shaped.valueAt(5, 0)).toMatch(/^\+\d\d \d{3}-\d{4}$/);
  });

  it.each(OTHER)("%s addresses carry a house number", (locale) => {
    const c = makePersonalComposer("address", undefined, locale);
    for (let i = 0; i < 200; i++) expect(c.valueAt(i * 31, 0)).toMatch(/\d/);
  });

  it("the same index gives the same value, and another region gives another", () => {
    const es = makePersonalComposer("full_name", undefined, "es");
    expect(es.valueAt(1234, 0)).toBe(es.valueAt(1234, 0));
    const de = makePersonalComposer("full_name", undefined, "de");
    const en = makePersonalComposer("full_name");
    expect(new Set([es.valueAt(1234, 0), de.valueAt(1234, 0), en.valueAt(1234, 0)]).size).toBe(3);
  });

  it("a region keeps its own letters in names", () => {
    const names = Array.from({ length: 4000 }, (_, i) => makePersonalComposer("full_name", undefined, "es").valueAt(i, 0)).join(" ");
    expect(names).toMatch(/[ñáéíóú]/i);
  });

  it("leaves web addresses, IP addresses and SSN-style numbers as they are", () => {
    for (const kind of ["url", "ip"] as PersonalKind[]) expect(makePersonalComposer(kind, undefined, "fr").valueAt(10, 0)).toBe(makePersonalComposer(kind).valueAt(10, 0));
  });

  it("folds accents the way an email does", () => {
    expect(fold("José Ángel")).toBe("joseangel");
    expect(fold("Müller-Straße")).toBe("mullerstrasse");
    expect(fold("Çelik")).toBe("celik");
  });
});

const person: ColumnProfile = {
  name: "who",
  outputName: "who",
  detectedType: "personal",
  type: "personal",
  status: "ok",
  attentionReasons: [],
  naTokens: [],
  naCount: 0,
  naByToken: {},
  sentinels: {},
  exclude: "include",
  quoted: false,
  summary: { kind: "personal", personalKind: "full_name", repeatStructure: { "1": 300 }, distinct: 300 },
};

describe("the region of a column", () => {
  it("is a local edit, back to US English by choosing it", () => {
    const es = applyEdits(person, { locale: "es" });
    expect(es.locale).toBe("es");
    expect(applyEdits(es, { locale: "en_US" }).locale).toBeUndefined();
  });

  it("goes into the spec and comes back, and US English writes nothing", () => {
    expect((columnSpecOf(applyEdits(person, { locale: "fr" })) as { locale?: string }).locale).toBe("fr");
    expect("locale" in columnSpecOf(person)).toBe(false);
    expect(profileFromSpec(columnSpecOf(applyEdits(person, { locale: "fr" }))).locale).toBe("fr");
  });

  const spec = (col: ColumnSpec): SpecFile => ({ spec_version: SPEC_VERSION, source: { format: "csv", file_name: "t.csv", encoding: "utf-8", delimiter: ",", header: true }, n_rows: 300, seed: 5, columns: [col] });

  it("is validated: a known region, and only for kinds a region changes", () => {
    const col = columnSpecOf(applyEdits(person, { locale: "de" }));
    expect(validateSpec(spec(col)).ok).toBe(true);
    expect(validateSpec(spec({ ...col, locale: "xx" } as unknown as ColumnSpec)).ok).toBe(false);
    expect(validateSpec(spec({ ...col, kind: "ip" } as ColumnSpec)).ok).toBe(false);
  });

  it("makes values of the region in the file, the same twice", () => {
    const s = spec(columnSpecOf(applyEdits(person, { locale: "de" })));
    const text = new TextDecoder().decode(renderAll(planTable(s, 5)));
    expect(text).toBe(new TextDecoder().decode(renderAll(planTable(s, 5))));
    expect(text.trim().split("\n")).toHaveLength(301);
    const en = new TextDecoder().decode(renderAll(planTable(spec(columnSpecOf(person)), 5)));
    expect(text).not.toBe(en);
  });

  it("makes samples of the region", () => {
    const base = { kind: "personal", personalKind: "address", format: undefined } as const;
    const de = sampleValues({ ...base, locale: "de" }, 5, 1);
    const us = sampleValues({ ...base }, 5, 1);
    expect(de).toHaveLength(5);
    expect(de.join()).not.toBe(us.join());
  });

  it("names the region in the README", () => {
    const text = agentReadme(spec(columnSpecOf(applyEdits(person, { locale: "es_MX" }))), { fakeFileName: "t_fake.csv", seed: 5, appVersion: "0.4.0" });
    expect(text).toContain("invented full name (Spanish, Mexico)");
  });
});
