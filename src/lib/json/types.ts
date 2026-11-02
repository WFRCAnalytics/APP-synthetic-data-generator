// What a JSON source records (specs/007 data-model.md): the form, the layout and, for each key, a kind. Never a
// value, a range, a statistic or a name from inside a nested value.

/** The JSON kind of a top-level key. `null` is a key that held only nulls; `object` and `array` are unsupported. */
export type JsonKind = "number" | "string" | "boolean" | "null" | "object" | "array";

export const JSON_KINDS: readonly JsonKind[] = ["number", "string", "boolean", "null", "object", "array"];

/** A whole file: one array of records, or one record per line. */
export type JsonForm = "array" | "lines";

export type JsonIndent = "compact" | "2" | "4" | "tab";

export type JsonLineEnding = "lf" | "crlf";

export interface JsonLayout {
  form: JsonForm;
  /** Arrays only. */
  indent: JsonIndent;
  lineEnding: JsonLineEnding;
  trailingNewline: boolean;
  bom: boolean;
}

export const DEFAULT_JSON_LAYOUT: JsonLayout = { form: "array", indent: "2", lineEnding: "lf", trailingNewline: true, bom: false };

/** Why a key cannot be faked. The texts are fixed and name only the kind. */
export type JsonUnsupportedReason = "nested_object" | "nested_array";

export const JSON_UNSUPPORTED_REASONS: readonly JsonUnsupportedReason[] = ["nested_object", "nested_array"];

export const JSON_UNSUPPORTED_TEXT: Record<JsonUnsupportedReason, string> = {
  nested_object: "An object key. Objects hold real values of unknown shape, so the key is not read or faked.",
  nested_array: "A list key. Lists hold real values of unknown shape, so the key is not read or faked.",
};

export const unsupportedReasonOfKind = (kind: JsonKind): JsonUnsupportedReason | null => (kind === "object" ? "nested_object" : kind === "array" ? "nested_array" : null);
