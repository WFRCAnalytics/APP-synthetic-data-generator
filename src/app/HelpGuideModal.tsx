// Help and guide (FR-032, FR-037): what happens to the data, what the spec holds, what the optional protections do, how tables link,
// and the limits of independent columns, so a user and their AI agent both know what the fake table can and cannot be trusted for.
// Laid out as pictures first: the four steps, where the data goes, the file types, what the spec holds, how tables link. Plain
// text only; no links leave the site.

import {
  ArrowRight,
  Braces,
  Check,
  CloudOff,
  Cpu,
  Database,
  Download,
  FileBarChart,
  FileSpreadsheet,
  FileText,
  FileUp,
  HardDrive,
  Link2,
  ListChecks,
  Sparkles,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Modal } from "../components/Modal";
import { versionLabel } from "./version";
import "./HelpGuide.css";

export interface HelpGuideModalProps {
  open: boolean;
  onClose: () => void;
}

type Tab = "start" | "files" | "privacy" | "linking" | "limits";
const TABS: [Tab, string][] = [
  ["start", "How it works"],
  ["files", "File types"],
  ["privacy", "Privacy and the spec"],
  ["linking", "Linking tables"],
  ["limits", "Limits"],
];

function Step({ n, icon, title, children }: { n: number; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="hg-step">
      <span className="hg-step-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="hg-step-body">
        <strong>
          {n}. {title}
        </strong>
        <span>{children}</span>
      </span>
    </li>
  );
}

function FileCard({ icon, name, ext, mode, children }: { icon: ReactNode; name: string; ext: string; mode: "both" | "read"; children: ReactNode }) {
  return (
    <li className="hg-file">
      <span className="hg-file-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="hg-file-body">
        <strong>{name}</strong>
        <code>{ext}</code>
        <span>{children}</span>
      </span>
      <span className={`hg-mode hg-mode--${mode}`}>{mode === "both" ? "Open and save" : "Open only"}</span>
    </li>
  );
}

export function HelpGuideModal({ open, onClose }: HelpGuideModalProps) {
  const [tab, setTab] = useState<Tab>("start");
  return (
    <Modal open={open} onClose={onClose} ariaLabelledBy="help-title" size="lg">
      <div className="help-guide">
        <h2 id="help-title">Help &amp; guide</h2>
        <p className="field-hint">{versionLabel()}</p>

        <div className="hg-tabs" role="tablist" aria-label="Help topics">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" id={`hg-tab-${id}`} aria-selected={tab === id} aria-controls={`hg-panel-${id}`} className="hg-tab" onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        <section role="tabpanel" id="hg-panel-start" aria-labelledby="hg-tab-start" hidden={tab !== "start"} className="hg-panel">
          <h3>How it works</h3>
          <ol className="hg-steps">
            <Step n={1} icon={<FileUp size={20} strokeWidth={1.75} />} title="Ingest">
              Choose a file, or start from scratch with &ldquo;Design a table&rdquo;. The app shows only what the table looks like: row count, column names and kinds, never a value.
            </Step>
            <Step n={2} icon={<ListChecks size={20} strokeWidth={1.75} />} title="Review">
              First choose how closely the fake table follows your data: Match closely, Balanced (the start) or Most private. Then pick any column to change what it keeps, such as how often each label appears, the lowest and highest value, or missing values. A column's settings are in four groups you can open and close: how the app read it, what the fake column keeps, how it is written in the fake file, and, when you make several tables, how it connects to another.
            </Step>
            <Step n={3} icon={<Sparkles size={20} strokeWidth={1.75} />} title="Generate">
              Choose a seed, generate, and read the check table, which says whether each column matches what was asked for.
            </Step>
            <Step n={4} icon={<Download size={20} strokeWidth={1.75} />} title="Download">
              Take the fake file, the spec, and a README for AI agents. &ldquo;Download all (zip)&rdquo; gives the three together; in Chrome and Edge &ldquo;Save to a folder&rdquo; writes them into a folder you choose.
            </Step>
          </ol>

          <h3>Where your data goes</h3>
          <figure className="hg-flow" aria-label="Your file is read in this browser tab and a fake file comes back to your computer; nothing goes to the internet">
            <div className="hg-flow-row">
              <span className="hg-node">
                <HardDrive size={22} strokeWidth={1.75} aria-hidden="true" />
                <strong>Your computer</strong>
                <span>your file</span>
              </span>
              <ArrowRight className="hg-arrow" size={20} strokeWidth={1.75} aria-hidden="true" />
              <span className="hg-node hg-node--tab">
                <Cpu size={22} strokeWidth={1.75} aria-hidden="true" />
                <strong>This browser tab</strong>
                <span>reads it, summarises it, makes the fake table</span>
              </span>
              <ArrowRight className="hg-arrow" size={20} strokeWidth={1.75} aria-hidden="true" />
              <span className="hg-node">
                <HardDrive size={22} strokeWidth={1.75} aria-hidden="true" />
                <strong>Your computer</strong>
                <span>the fake file</span>
              </span>
            </div>
            <div className="hg-wall">
              <CloudOff size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>Nothing goes to the internet, to this website or to any other.</span>
            </div>
          </figure>
          <p>
            Everything stays here. Your file is read and profiled in this browser tab; nothing is uploaded, and the app makes no requests to other sites. The shield in the header opens a live monitor of every request, what the browser has saved for this site, and the rules the browser enforces. Reloading or closing the page clears your data from memory. Nothing is saved in the browser.
          </p>

          <h3>No file? Design a table</h3>
          <p>
            Name it, say how many rows, and add columns one at a time: a number between two limits, a category with weights, a date range, an ID, a person&rsquo;s name. In the table settings you also choose the file type. Nothing is read from anywhere; the columns are described by you.
          </p>

          <h3>Offline copy</h3>
          <p>
            Every release has a zip that runs from a folder with no internet: unzip it and run <code>start.cmd</code> (Windows) or <code>./start.sh</code>. A small launcher shows the app to your browser from that folder, on this computer only. Its <code>README.txt</code> explains it on one page.
          </p>
        </section>

        <section role="tabpanel" id="hg-panel-files" aria-labelledby="hg-tab-files" hidden={tab !== "files"} className="hg-panel">
          <h3>File types</h3>
          <p>The fake file comes out as the same type you opened unless you choose another. Rows and cell values are never shown.</p>
          <ul className="hg-files">
            <FileCard icon={<FileText size={22} strokeWidth={1.75} />} name="CSV" ext=".csv" mode="both">
              The app shows its delimiter, encoding, row count and column names.
            </FileCard>
            <FileCard icon={<FileSpreadsheet size={22} strokeWidth={1.75} />} name="Excel" ext=".xlsx" mode="both">
              It lists the sheet names and you choose one sheet and where its table starts. The fake workbook holds only that sheet and no macros. Old .xls files: save them as .xlsx or CSV first.
            </FileCard>
            <FileCard icon={<Database size={22} strokeWidth={1.75} />} name="Parquet" ext=".parquet" mode="both">
              Row count, row groups, and each column&rsquo;s name and type, never a value or the file&rsquo;s own notes. List, struct, map and binary columns are left out.
            </FileCard>
            <FileCard icon={<Braces size={22} strokeWidth={1.75} />} name="JSON" ext=".json .ndjson .jsonl" mode="both">
              Record count, key names and the kind of each key. A list of records and one record per line both work, and the fake file comes out in the same form and layout. Keys that hold objects or lists are left out.
            </FileCard>
            <FileCard icon={<FileBarChart size={22} strokeWidth={1.75} />} name="SPSS and Stata" ext=".sav .dta" mode="both">
              Read as a table: row count and each variable&rsquo;s name and kind. Variable labels and value labels are kept beside the columns, and codes SPSS declares as missing are read as blanks.
            </FileCard>
            <FileCard icon={<FileBarChart size={22} strokeWidth={1.75} />} name="SAS" ext=".xpt .sas7bdat" mode="both">
              A SAS transport file (.xpt) opens and saves. A .sas7bdat opens only; its table comes out as CSV or another type, because that format cannot be written reliably.
            </FileCard>
          </ul>
          <p>Choose &ldquo;File type&rdquo; on the Generate screen to write the table as any of these, whichever you opened.</p>
        </section>

        <section role="tabpanel" id="hg-panel-privacy" aria-labelledby="hg-tab-privacy" hidden={tab !== "privacy"} className="hg-panel">
          <h3>What the spec file holds</h3>
          <p>The spec is the only thing derived from your data. It is small and readable.</p>
          <div className="hg-holds">
            <div className="hg-holds-col hg-holds-col--yes">
              <h4>
                <Check size={16} strokeWidth={2} aria-hidden="true" /> It holds
              </h4>
              <ul>
                <li>category labels with how many rows have each, sentinel codes and missing-value counts;</li>
                <li>the minimum and maximum of numeric, date and time columns, with percentiles;</li>
                <li>for survey IDs, a pattern such as UT-999-999, optional limits, and how often IDs repeat;</li>
                <li>for names, emails, phone numbers and addresses, only the kind of data, how many distinct values there are and how often they repeat;</li>
                <li>for free text and short codes, only the lengths and the pattern of characters;</li>
                <li>for coordinates, only the bounding box and the number of decimals, never a point;</li>
                <li>what the columns and codes mean, if you add a codebook or open an SPSS, Stata or SAS file: short labels, which are notes about the data, not values from it;</li>
                <li>the rules you state between columns, and, for a column that uses another table&rsquo;s IDs or values, that table&rsquo;s seed, column name and summary.</li>
              </ul>
            </div>
            <div className="hg-holds-col hg-holds-col--no">
              <h4>
                <X size={16} strokeWidth={2} aria-hidden="true" /> It never holds
              </h4>
              <ul>
                <li>lists of IDs</li>
                <li>a name, an email, a phone number or an address</li>
                <li>a word of free text</li>
                <li>the location of a point</li>
                <li>a row of your data</li>
              </ul>
              <p className="field-hint">The fake file holds invented values of the same kind.</p>
            </div>
          </div>
          <p>
            It never holds lists of IDs, a name, an email, a phone number, an address, a word of free text or the location of a point.
          </p>

          <h3>Optional protections</h3>
          <p>All off by default, because analysis code filters on exact labels and column names:</p>
          <ul>
            <li>merge categories with fewer than a chosen number of rows into &ldquo;Other&rdquo;;</li>
            <li>replace category labels with neutral codes;</li>
            <li>write columns under new names.</li>
          </ul>
        </section>

        <section role="tabpanel" id="hg-panel-linking" aria-labelledby="hg-tab-linking" hidden={tab !== "linking"} className="hg-panel">
          <h3>Linking tables</h3>
          <p>IDs are invented for each table, so keys in separately generated tables will not match, unless you link them. Link a table to the other table&rsquo;s saved spec in Review, on the column&rsquo;s own card.</p>
          <figure className="hg-link" aria-label="Households, persons and trips, joined by IDs">
            <div className="hg-link-tables">
              <span className="hg-table">
                <strong>Households</strong>
                <span>hh_id, size, income, county</span>
              </span>
              <span className="hg-join">
                <Link2 size={16} strokeWidth={1.75} aria-hidden="true" />
                <span>same IDs</span>
              </span>
              <span className="hg-table">
                <strong>Persons</strong>
                <span>person_id, hh_id, county</span>
              </span>
              <span className="hg-join">
                <Link2 size={16} strokeWidth={1.75} aria-hidden="true" />
                <span>same IDs</span>
              </span>
              <span className="hg-table">
                <strong>Trips</strong>
                <span>trip_id, person_id, county</span>
              </span>
            </div>
          </figure>
          <ul className="hg-cards">
            <li>
              <strong>IDs from another table.</strong> An ID column can use the IDs another table makes, so every row of the second table finds its row in the first.
            </li>
            <li>
              <strong>Number of rows in another table.</strong> A whole-number column can count the other table&rsquo;s rows for each ID, so a household&rsquo;s size matches its persons.
            </li>
            <li>
              <strong>Value from another table.</strong> A category, number or date column, such as a zone or an income, can take its value from the other table&rsquo;s row with the same ID, even through a chain of tables.
            </li>
            <li>
              <strong>Several tables at once.</strong> Under &ldquo;Make several tables at once&rdquo; on the first screen, choose their saved specs and download them in one zip, as their own file types or all as one type you choose.
            </li>
            <li>
              <strong>Designed tables.</strong> A designed table can link an ID column the same way, with a range of rows per ID.
            </li>
          </ul>
        </section>

        <section role="tabpanel" id="hg-panel-limits" aria-labelledby="hg-tab-limits" hidden={tab !== "limits"} className="hg-panel">
          <h3>Known limits</h3>
          <ul className="hg-cards">
            <li>
              <strong>No cross-column logic.</strong> Each column is generated on its own, so arrival can precede departure and a child can hold a driver&apos;s licence. Code runs; combined conditions return plausible counts, not realistic ones.
            </li>
            <li>
              <strong>Tables are made one at a time, or together from their specs.</strong> Columns other than IDs, counts and followed values are not linked between tables.
            </li>
            <li>
              <strong>Mean and spread can shift slightly after rounding.</strong> The optional &ldquo;restore the exact mean and spread&rdquo; setting fixes this, at the cost of a few values moving.
            </li>
            <li>
              <strong>Invented values can coincide.</strong> Invented names and addresses come from word lists, never from your data, but a common name may match a real one by chance. A name column does not match the email in the same row.
            </li>
            <li>
              <strong>Labels are real.</strong> Category labels, sentinel codes and min and max values come from your data. Rare categories stay visible unless you merge them.
            </li>
            <li>
              <strong>Memory limits table size.</strong> Tables up to about 500 MB are supported. Files in some encodings need twice their size in memory.
            </li>
            <li>
              <strong>Not in this version.</strong> Nested JSON, GeoJSON, coordinate shapes and routes, relations between more than two columns, and writing .sas7bdat files.
            </li>
            <li>
              <strong>Browsers.</strong> Chrome and Edge are fully supported, and can save everything into a folder. Firefox and Safari work too; there you download the files one at a time or all together as a zip.
            </li>
          </ul>
          <p>Tell your AI agent about these limits so it does not &ldquo;fix&rdquo; code that is correct.</p>
        </section>

        <div className="actions-row">
          <button type="button" className="button button-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
