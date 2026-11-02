// The load dialog for a workbook (specs/003 FR-001 to FR-003, FR-009, FR-015): the sheet names in a
// dropdown (hidden sheets marked) and nothing from inside the sheets, plus what is needed to read the
// chosen sheet correctly: rows to skip above the header, whether the first row is a header, and an
// optional cell range. The hints come from the workbook's packaging, never from cell values.

import { useEffect, useId, useMemo, useState } from "react";
import { InfoTip } from "../../components/InfoTip";
import type { WorkbookChoice, WorkbookState } from "../../app/session";
import { formatRange, parseRange, columnLetters } from "../../lib/xlsx/names";
import { workbookSizeWarnings, workbookTooLarge } from "./sizeWarnings";

export interface WorkbookDialogProps {
  workbook: WorkbookState;
  fileName: string;
  /** Asks the worker for the hints of a sheet. */
  onInspect: (sheet: string) => void;
  onConfirm: (choice: WorkbookChoice) => void;
}

export function WorkbookDialog({ workbook, fileName, onInspect, onConfirm }: WorkbookDialogProps) {
  const id = useId();
  const { info } = workbook;
  const [sheet, setSheet] = useState(info.defaultSheet);
  const hints = workbook.hints[sheet];

  // What the user has typed overrides what the hints suggest.
  const [skipText, setSkipText] = useState<string | null>(null);
  const [header, setHeader] = useState(true);
  const [rangeText, setRangeText] = useState<string | null>(null);

  useEffect(() => {
    onInspect(sheet);
    setSkipText(null);
    setRangeText(null);
    // onInspect comes from the session and does not change; ask again only when the sheet does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);

  const skipRows = skipText !== null ? Number(skipText) : (hints?.suggestedSkipRows ?? 0);
  const skipValid =
    skipText === null ||
    (skipText.trim() !== "" && Number.isInteger(skipRows) && skipRows >= 0 && skipRows < 1_048_576);

  // The range the hints suggest: the table's columns from the header row to the end of the used range.
  const suggestedRange = useMemo(() => {
    if (!hints || !skipValid) return "";
    return formatRange({
      firstCol: hints.firstCol,
      firstRow: skipRows,
      lastCol: Math.max(hints.firstCol, hints.lastCol),
      lastRow: Math.max(skipRows, hints.lastRow),
    });
  }, [hints, skipRows, skipValid]);

  const range = rangeText ?? suggestedRange;
  const parsed = range.trim() === "" ? null : parseRange(range);
  const rangeError =
    range.trim() === ""
      ? null
      : !parsed
        ? "Enter a range such as A3:I203."
        : parsed.firstRow !== skipRows
          ? `The range must start at row ${skipRows + 1}, the row after the skipped rows.`
          : null;

  const selected = info.sheets.find((s) => s.name === sheet);
  const warnings = selected ? workbookSizeWarnings(selected.expandedBytes) : [];
  const tooLarge = selected ? workbookTooLarge(selected.expandedBytes) : false;
  const canConfirm = Boolean(hints) && skipValid && !rangeError && !tooLarge;

  return (
    <div className="card workbook-dialog" role="group" aria-labelledby={`${id}-title`}>
      <div className="dialog-title">
        <h3 id={`${id}-title`}>Choose a sheet</h3>
        <InfoTip label="More information">
          {fileName} holds {info.sheets.length} {info.sheets.length === 1 ? "sheet" : "sheets"}.
          Only the sheet you choose is read; nothing from the others is kept.
        </InfoTip>
        {hints?.mergedCells === true && (
          <InfoTip label="Merged cells in this sheet" tone="warning" testId="merged-note">
            This sheet has merged cells. A merged value is read once, in its top-left cell, and the
            other cells of the merge are blank.
          </InfoTip>
        )}
        {hints?.mergedCells === "not_checked" && (
          <InfoTip label="Merged cells were not checked" tone="warning">
            This sheet is large, so merged cells were not checked for.
          </InfoTip>
        )}
        {hints && hints.mixedFormats.length > 0 && (
          <InfoTip label="Mixed number formats" tone="warning" testId="mixed-note">
            {hints.mixedFormats.length === 1
              ? "One column mixes"
              : `${hints.mixedFormats.length} columns mix`}{" "}
            different kinds of number format (
            {hints.mixedFormats.map((i) => columnLetters(hints.firstCol + i)).join(", ")}); the
            format of the first cells is used.
          </InfoTip>
        )}
      </div>

      <div className="inline-row">
        <div className="field inline-field inline-field--grow">
          <label htmlFor={`${id}-sheet`}>Sheet</label>
          <select id={`${id}-sheet`} value={sheet} onChange={(e) => setSheet(e.target.value)}>
            {info.sheets.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
                {s.hidden ? " (hidden)" : ""}
              </option>
            ))}
          </select>
          {selected?.hidden && (
            <InfoTip label="This sheet is hidden" tone="warning" testId="sheet-hidden-note">
              This sheet is hidden in the workbook.
            </InfoTip>
          )}
        </div>
        {hints && (
          <div className="field inline-field">
            <label htmlFor={`${id}-range`}>Cell range</label>
            <input
              id={`${id}-range`}
              className="inline-input--range"
              value={range}
              aria-invalid={Boolean(rangeError)}
              onChange={(e) => setRangeText(e.target.value)}
              placeholder="A1:H500"
            />
            <InfoTip label="More information" align="end">
              Optional. The table from its header row, such as{" "}
              {formatRange({
                firstCol: 0,
                firstRow: skipRows,
                lastCol: 8,
                lastRow: skipRows + 200,
              })}
              . Clear it to read everything from the skipped rows.
            </InfoTip>
          </div>
        )}
      </div>
      {rangeError && (
        <span className="field-error" role="alert">
          {rangeError}
        </span>
      )}

      {!hints && (
        <p className="field-hint" role="status">
          Looking at the sheet&hellip;
        </p>
      )}

      {hints && (
        <>
          <div className="inline-row">
            <div className="field inline-field">
              <label htmlFor={`${id}-skip`}>Rows to skip</label>
              <input
                id={`${id}-skip`}
                className="inline-input--number"
                inputMode="numeric"
                value={skipText ?? String(hints.suggestedSkipRows)}
                aria-invalid={!skipValid}
                onChange={(e) => setSkipText(e.target.value)}
              />
              <InfoTip label="More information">
                Rows above the header, such as titles.
                {hints.suggestedSkipRows > 0 && skipText === null && (
                  <span data-testid="skip-suggestion">
                    {" "}
                    Suggested: {hints.suggestedSkipRows}, because the table seems to start on row{" "}
                    {hints.suggestedSkipRows + 1}.
                  </span>
                )}
              </InfoTip>
            </div>
            <label htmlFor={`${id}-header`} className="inline-check">
              <input
                id={`${id}-header`}
                type="checkbox"
                checked={header}
                onChange={(e) => setHeader(e.target.checked)}
              />{" "}
              First row is a header
            </label>
          </div>
          {!skipValid && <span className="field-error">Enter a whole number, 0 or more.</span>}

          {warnings.map((w) => (
            <div key={w} className="banner banner-warning" role="status" data-testid="size-warning">
              {w}
            </div>
          ))}
        </>
      )}

      <div className="actions-row">
        <button
          type="button"
          className="button button-primary"
          disabled={!canConfirm}
          onClick={() =>
            onConfirm({
              sheet,
              range: range.trim() === "" ? undefined : range.trim(),
              skipRows,
              header,
            })
          }
        >
          Use this sheet
        </button>
      </div>
    </div>
  );
}
