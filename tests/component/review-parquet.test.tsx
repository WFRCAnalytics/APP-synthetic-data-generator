// Review for a Parquet file (specs/005 FR-005, FR-008, acceptance 2.1, 3.1): the card shows the column's type
// in the file, says in fixed words why a nested column is not supported, and refuses a type the file's column
// cannot hold. Only types and fixed texts are shown, never a value.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ColumnCard } from "../../src/features/review/ColumnCard";
import { parquetConflict, summaryLines } from "../../src/features/review/summary";
import { UNSUPPORTED_TEXT, typeConflict } from "../../src/lib/parquet/types";
import type { ColumnProfile } from "../../src/lib/profile/types";
import { categorical, dateColumn, numeric, unsupportedColumn } from "../helpers/fakeWorkers";

afterEach(cleanup);

const withType = (p: ColumnProfile, parquetType: ColumnProfile["parquetType"]): ColumnProfile => ({ ...p, parquetType });
const decimal = { kind: "decimal", precision: 10, scale: 2, nullable: true } as const;

describe("the type in the file", () => {
  it("is a line of facts on the card, with required noted", () => {
    expect(summaryLines(withType(numeric("amount"), decimal))).toContain("File type: decimal(10,2)");
    expect(summaryLines(withType(numeric("k"), { kind: "int", bits: 32, signed: true, nullable: false }))).toContain("File type: int32, required");
  });

  it("is absent for a CSV column", () => {
    expect(summaryLines(numeric("amount")).some((l) => l.startsWith("File type"))).toBe(false);
  });

  it("shows on the card", () => {
    render(<ColumnCard profile={withType(dateColumn("when"), { kind: "timestamp", unit: "us", utc: true, nullable: true })} otherNames={[]} />);
    expect(screen.getByText("File type: timestamp[us, UTC]")).toBeInTheDocument();
  });
});

describe("a type the file's column cannot hold", () => {
  it("is found for a number column over a date type, and a date column over a number type", () => {
    expect(parquetConflict(withType(numeric("a"), { kind: "date", nullable: true }))).toMatch(/number column needs/);
    expect(parquetConflict(withType(dateColumn("d"), { kind: "int", bits: 32, signed: true, nullable: true }))).toMatch(/date column needs/);
    expect(parquetConflict(withType(categorical("c"), { kind: "bool", nullable: true }))).toBeNull();
  });

  it("is not found when the pair fits, or the column is left out, or has no file type", () => {
    expect(parquetConflict(withType(numeric("a"), decimal))).toBeNull();
    expect(parquetConflict(withType(numeric("a"), { kind: "date", nullable: true }) && { ...withType(numeric("a"), { kind: "date", nullable: true }), exclude: "drop" })).toBeNull();
    expect(parquetConflict(numeric("a"))).toBeNull();
  });

  it("is said on the card in an alert", () => {
    render(<ColumnCard profile={withType(numeric("amount"), { kind: "date", nullable: true })} otherNames={[]} />);
    expect(screen.getByTestId("parquet-conflict")).toHaveTextContent("A number column needs an int, float, decimal or string Parquet type. Change the type back, or leave this column out.");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("matches the rule the spec check uses", () => {
    expect(typeConflict("integer", "string")).toBeNull();
    expect(typeConflict("float", "bool")).toMatch(/number column/);
    expect(typeConflict("time", "timestamp")).toBeNull();
    expect(typeConflict("categorical", "date")).toBeNull();
  });
});

describe("an unsupported column", () => {
  it("says why in the fixed words for its kind, not the generic sentence", () => {
    const nested: ColumnProfile = { ...unsupportedColumn("tags"), unsupportedReason: "nested_list", attentionReasons: ["unsupported_type"] };
    render(<ColumnCard profile={nested} otherNames={[]} />);
    expect(screen.getByText(UNSUPPORTED_TEXT.nested_list)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("not supported in this version");
  });

  it("keeps the generic sentence for an unsupported column of a CSV", () => {
    render(<ColumnCard profile={{ ...unsupportedColumn("x"), attentionReasons: ["unsupported_type"] }} otherNames={[]} />);
    expect(document.body.textContent).toContain("not supported in this version");
  });
});
