// A persistent notice on Review (FR-038): what the spec file will contain. The privacy model allows
// real category labels, exact min and max, and sentinel codes in it, and the user should know that
// before saving or sharing one.

import { FileText } from "lucide-react";

export function SpecContentsNotice() {
  return (
    <aside className="local-notice spec-notice" role="note" aria-label="What the spec contains">
      <FileText size={18} strokeWidth={1.75} aria-hidden="true" />
      <details>
        <summary>What a saved spec contains</summary>
        <p>
        The spec you can save will contain real category labels, exact minimum and maximum values, and the sentinel codes you confirm here. For IDs, names,
        emails, addresses, phone numbers, free text and short codes it holds only counts, lengths, patterns and the kind of data, never a value. Nothing
        else is taken from your data: no rows, no ID lists, no words. For a JSON file it holds the file name, whether it is a list of records or one record per line, its layout, and for each key its kind and how often it is null or missing, but no value and no key name from inside a nested value. For a Parquet file it holds the file name, the number of row groups and each column's type (such as int16 or decimal(10,2)), but no value, statistic, key-value note or creator text from the file. For an Excel file it also holds the sheet name, the cell range, the number format of each column and the date system, but no cell value, formula or content of other sheets. Use neutral codes or merging below if a label itself is sensitive.
        </p>
      </details>
    </aside>
  );
}
