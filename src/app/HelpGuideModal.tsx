// Help and guide (FR-032, FR-037): what happens to the data, what the spec holds, what the optional
// protections do, and the limits of independent columns, so a user and their AI agent both know
// what the fake table can and cannot be trusted for. Plain text only; no links leave the site.

import { Modal } from "../components/Modal";
import { versionLabel } from "./version";

export interface HelpGuideModalProps {
  open: boolean;
  onClose: () => void;
}

export function HelpGuideModal({ open, onClose }: HelpGuideModalProps) {
  return (
    <Modal open={open} onClose={onClose} ariaLabelledBy="help-title" size="lg">
      <div className="help-guide">
        <h2 id="help-title">Help &amp; guide</h2>
        <p className="field-hint">{versionLabel()}</p>

        <h3>Offline copy</h3>
        <p>
          Every release has a zip that runs from a folder with no internet: unzip it and run{" "}
          <code>start.cmd</code> (Windows) or <code>./start.sh</code>. A small launcher shows the
          app to your browser from that folder, on this computer only. Its <code>README.txt</code>{" "}
          explains it on one page.
        </p>

        <h3>How it works</h3>
        <ol>
          <li>
            <strong>Ingest.</strong> Choose a CSV, Excel (.xlsx), Parquet (.parquet), JSON (.json,
            .ndjson, .jsonl), SPSS (.sav), Stata (.dta) or SAS (.sas7bdat, .xpt) file. An SPSS,
            Stata or SAS file is read as a table: the app shows its row count and each
            variable&rsquo;s name and kind, never a value; the labels of its codes and its variable
            labels are kept beside the columns, and codes an SPSS file declares as missing are read
            as blanks. For a JSON file the app shows its record count, key names and the
            kind of each key, never a value; a list of records and one record per line both work,
            and the fake file comes out in the same form and layout. Keys that hold objects or lists
            are not read and are left out. For a Parquet file the app shows its row count, row
            groups, and each column's name and type, never a value or any of the file's own notes;
            list, struct, map and binary columns are not read and are left out. For a CSV the app
            shows its delimiter, encoding, row count and column names; for a workbook it lists the
            sheet names, and you choose one sheet and where its table starts. Rows and cell values
            are never shown. Old .xls files are not read: save them as .xlsx or CSV first. The fake
            workbook holds only the sheet you chose and no macros.
          </li>
          <li>
            <strong>Start from scratch.</strong> No real file? Choose &ldquo;Design a table&rdquo;,
            name it, say how many rows, and add columns one at a time: a number between two limits,
            a category with weights, a date range, an ID, a person&rsquo;s name. In the table
            settings you also choose the file type: CSV, an Excel workbook, Parquet, JSON or JSON
            Lines. Nothing is read from anywhere; the columns are described by you.
          </li>
          <li>
            <strong>Review.</strong> The columns are listed on the left; search them, filter by type
            (each type has its own icon) or show only those that need attention. Pick one to see how
            it will be faked and to change what the app decided: its type, missing-value markers,
            codes such as 999 for &ldquo;refused&rdquo;, and more.
          </li>
          <li>
            <strong>Generate.</strong> Choose a seed, generate, read the check table, then download
            the fake file, the spec, and a README for agents that says what the file is and what
            each column holds. The file type is the same as the file you opened unless you pick
            another (CSV, Excel, Parquet, JSON or JSON Lines; SAS files come out as CSV because they
            are read only). &ldquo;Download all (zip)&rdquo; gives the three files together, and
            in Chrome and Edge &ldquo;Save to a folder&rdquo; writes them into a folder you choose.
          </li>
        </ol>

        <h3>What stays on this device</h3>
        <p>
          Everything. Your file is read and profiled in this browser tab; nothing is uploaded, and
          the app makes no requests to other sites. The counter in the header shows requests since
          the page loaded. Reloading or closing the page clears your data from memory. Nothing is
          saved in the browser.
        </p>

        <h3>What the spec file holds</h3>
        <p>
          The spec is the only thing derived from your data. It is small and readable, and it holds:
        </p>
        <ul>
          <li>
            category labels with how many rows have each, sentinel codes and missing-value counts;
          </li>
          <li>the minimum and maximum of numeric, date and time columns, with percentiles;</li>
          <li>
            for survey IDs, a pattern such as UT-999-999, optional minimum and maximum, and how
            often IDs repeat;
          </li>
          <li>
            for names, emails, phone numbers and addresses, only the kind of data, how many distinct
            values there are and how often they repeat;
          </li>
          <li>for free text and short codes, only the lengths and the pattern of characters;</li>
          <li>
            for coordinates, only the bounding box and the number of decimals, never a point;
          </li>
          <li>
            what the columns and codes mean, if you add a codebook or open an SPSS, Stata or SAS
            file: short labels, which are notes about the data, not values from it;
          </li>
          <li>
            the rules you state between columns, and, for an ID column that uses another
            table&rsquo;s IDs, that table&rsquo;s pattern, seed and column name.
          </li>
        </ul>
        <p>
          It never holds lists of IDs, a name, an email, a phone number, an address, a word of free
          text or the location of a point. The fake file holds invented values of the same kind.
        </p>

        <h3>Optional protections</h3>
        <p>All off by default, because analysis code filters on exact labels and column names:</p>
        <ul>
          <li>
            merge categories with fewer than a chosen number of rows into &ldquo;Other&rdquo;;
          </li>
          <li>replace category labels with neutral codes;</li>
          <li>write columns under new names.</li>
        </ul>

        <h3>Known limits</h3>
        <ul>
          <li>
            <strong>No cross-column logic.</strong> Each column is generated on its own, so arrival
            can precede departure and a child can hold a driver&apos;s licence. Code runs; combined
            conditions return plausible counts, not realistic ones.
          </li>
          <li>
            <strong>Tables are made one at a time.</strong> IDs are invented for each table, so keys in
            separately generated tables will not match, unless you link an ID column to the other
            table&apos;s saved spec (Review, the column&apos;s &ldquo;IDs from another table&rdquo;).
            Other columns are not linked, and there is no cascade between tables.
          </li>
          <li>
            <strong>Mean and spread can shift slightly after rounding.</strong> The optional
            &ldquo;restore the exact mean and spread&rdquo; setting fixes this, at the cost of a few
            values moving.
          </li>
          <li>
            <strong>Invented values can coincide.</strong> Invented names and addresses come from
            word lists, never from your data, but a common name may match a real one by chance. A
            name column does not match the email in the same row.
          </li>
          <li>
            <strong>Labels are real.</strong> Category labels, sentinel codes and min and max values
            come from your data. Rare categories stay visible unless you merge them.
          </li>
          <li>
            <strong>Memory limits table size.</strong> Tables up to about 500 MB are supported.
            Files in some encodings need twice their size in memory.
          </li>
          <li>
            <strong>Not in this version.</strong> Nested JSON, GeoJSON, coordinate shapes and routes,
            relations between more than two columns, and writing SAS files.
          </li>
          <li>
            <strong>Browsers.</strong> Chrome and Edge are fully supported, and can save everything
            into a folder. Firefox and Safari work too; there you download the files one at a time
            or all together as a zip.
          </li>
        </ul>
        <p>
          Tell your AI agent about these limits so it does not &ldquo;fix&rdquo; code that is
          correct.
        </p>

        <div className="actions-row">
          <button type="button" className="button button-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
