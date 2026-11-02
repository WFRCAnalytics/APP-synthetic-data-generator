// The settings a user changes on Review that need no data (FR-011 to FR-013): leave a column out,
// numeric mode and decimals, the optional rescale, label protections, and renaming. They are kept
// apart from the engine-side overrides and applied on top of a profile, so changing one never
// touches the database and a re-profile never loses them.

import type { CoordinateAxis } from "../classify/coordinate";
import type { PersonalLocale } from "../textgen/locales";
import { idFit, shortStringFit } from "./idCapacity";
import type {
  ColumnProfile,
  ExcludeMode,
  MaskToken,
  NumericMode,
  PersonalKind,
  ReasonCode,
} from "./types";

/** An ID pattern chosen in the token editor, replacing the detected one. */
export interface IdPattern {
  mask: MaskToken[];
  min?: number;
  max?: number;
  pad?: number;
}

export interface LocalEdits {
  /** A pattern for a survey ID column; undefined means the detected one. */
  idPattern?: IdPattern;
  /** A kind for a personal identifier column, replacing the proposed one. */
  personalKind?: PersonalKind;
  /** Accepts generating invented SSN-style numbers. */
  ssnAcknowledged?: boolean;
  /** A pattern for a short string column; undefined means the detected one. */
  shortPattern?: MaskToken[];
  exclude?: ExcludeMode;
  mode?: NumericMode;
  /** Decimal places for a decimal column. */
  decimals?: number;
  rescale?: boolean;
  /** Merge categories under this many rows into "Other"; null or absent turns it off. */
  mergeUnderK?: number | null;
  labelCodes?: boolean;
  outputName?: string;
  /** The region the invented values of a personal column come from. */
  locale?: PersonalLocale;
  /** Treat a decimal column as a coordinate of this axis; null says it is not one. */
  coordinate?: CoordinateAxis | null;
  /** What the codes of the column mean (a codebook); null removes them. */
  valueLabels?: Record<string, string> | null;
  /** The number format code of the column in an Excel output; "General" means none. */
  cellFormat?: string;
}

export const MAX_DECIMALS = 15;

const isNumericKind = (p: ColumnProfile) =>
  p.summary.kind === "numeric" || p.summary.kind === "datetime";
const isCategorical = (p: ColumnProfile) => p.summary.kind === "categorical";

/**
 * A profile with the user's local edits applied. An edit that does not fit the column's current type
 * (a mode for a text column, say) is ignored rather than raising an error, so edits survive a type
 * change and simply apply again if the column becomes numeric once more.
 */
export function applyEdits(p: ColumnProfile, e: LocalEdits | undefined): ColumnProfile {
  if (!e) return p;
  const out: ColumnProfile = { ...p };

  if (e.exclude !== undefined) {
    // A column that cannot be generated can only be left out or kept as all-missing.
    out.exclude = p.type === "unsupported" && e.exclude === "include" ? "drop" : e.exclude;
  }

  if (e.outputName !== undefined && e.outputName.trim() !== "") out.outputName = e.outputName;

  if (e.valueLabels !== undefined) {
    if (e.valueLabels === null || Object.keys(e.valueLabels).length === 0) delete out.valueLabels;
    else out.valueLabels = { ...e.valueLabels };
  }

  if (e.cellFormat !== undefined) {
    if (/^general$/i.test(e.cellFormat.trim())) delete out.cellFormat;
    else out.cellFormat = e.cellFormat.trim();
  }

  if (
    p.summary.kind === "numeric" &&
    (p.type === "float" || p.type === "integer") &&
    e.coordinate !== undefined
  ) {
    if (e.coordinate === null) delete out.coordinate;
    else out.coordinate = e.coordinate;
  }

  if (isNumericKind(p)) {
    if (e.mode !== undefined) out.mode = e.mode;
    if (e.rescale !== undefined) out.rescale = e.rescale && (e.mode ?? p.mode) === "match_mean_sd";
    if (e.decimals !== undefined && p.type === "float" && p.summary.kind === "numeric") {
      const decimals = Math.min(MAX_DECIMALS, Math.max(0, Math.round(e.decimals)));
      out.summary = { ...p.summary, decimals };
    }
  }

  if (isCategorical(p)) {
    if (e.mergeUnderK !== undefined) out.mergeUnderK = e.mergeUnderK;
    if (e.labelCodes !== undefined) out.labelCodes = e.labelCodes;
  }

  if (p.summary.kind === "personal") {
    const kind = e.personalKind ?? p.summary.personalKind;
    if (kind !== p.summary.personalKind)
      out.summary = { ...p.summary, personalKind: kind, format: undefined };
    if (e.locale !== undefined) {
      if (e.locale === "en_US") delete out.locale;
      else out.locale = e.locale;
    }
    const ack = e.ssnAcknowledged ?? p.acknowledged ?? false;
    if (kind === "ssn") {
      out.acknowledged = ack;
      // Until acknowledged, an SSN-style column stays unsupported and left out.
      if (!ack) {
        out.type = "unsupported";
        out.status = "unsupported";
        out.attentionReasons = [
          ...new Set<ReasonCode>([
            ...p.attentionReasons.filter((r) => r !== "kind_mixed"),
            "unsupported_type",
            "ssn_needs_acknowledgement",
          ]),
        ];
        out.exclude = e.exclude === "keep_as_na" ? "keep_as_na" : "drop";
      } else {
        out.type = "personal";
        out.status = "ok";
        out.attentionReasons = p.attentionReasons.filter(
          (r) => r !== "unsupported_type" && r !== "ssn_needs_acknowledgement",
        );
        out.exclude =
          e.exclude ?? (p.exclude === "drop" && p.type === "unsupported" ? "include" : p.exclude);
      }
    } else {
      out.acknowledged = undefined;
      if (p.type === "unsupported") {
        // An SSN-style column switched to another kind becomes an ordinary personal column.
        out.type = "personal";
        out.status = "ok";
        out.attentionReasons = p.attentionReasons.filter(
          (r) => r !== "unsupported_type" && r !== "ssn_needs_acknowledgement",
        );
        out.exclude = e.exclude ?? "include";
      }
    }
  }

  if (p.summary.kind === "short_string" && e.shortPattern !== undefined) {
    const longest = Math.max(0, ...Object.keys(p.summary.lengthGroups).map(Number));
    const pattern = e.shortPattern;
    out.summary = { ...p.summary, pattern };
    const reasons: ReasonCode[] = p.attentionReasons.filter((r) => r !== "id_mask_too_narrow");
    const fit = shortStringFit({ ...p, summary: { ...p.summary, pattern } });
    if (fit?.short || pattern.length !== longest) reasons.push("id_mask_too_narrow");
    out.attentionReasons = reasons;
    out.status = reasons.length > 0 ? "needs_attention" : "ok";
  }

  if (p.summary.kind === "survey_id" && e.idPattern !== undefined) {
    const { mask, min, max, pad } = e.idPattern;
    out.summary = { ...p.summary, mask, min, max, padWidth: pad ?? 0 };
    // The edited pattern may be too narrow for the column; say so, and clear the note once it fits.
    const reasons: ReasonCode[] = p.attentionReasons.filter(
      (r) => r !== "id_mask_too_narrow" && r !== "id_mixed_masks",
    );
    if (idFit(out)?.short) reasons.push("id_mask_too_narrow");
    out.attentionReasons = reasons;
    out.status = reasons.length > 0 ? "needs_attention" : "ok";
  }

  return out;
}

/** Applies every column's edits, in column order. */
export function applyAllEdits(
  profiles: readonly ColumnProfile[],
  edits: Readonly<Record<string, LocalEdits>>,
): ColumnProfile[] {
  return profiles.map((p) => applyEdits(p, edits[p.name]));
}

/** "-9, 998 ,, 999" becomes ["-9", "998", "999"]: trimmed, no blanks, no repeats. */
export function parseList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t !== ""),
    ),
  ];
}
