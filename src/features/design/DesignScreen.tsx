// Design (specs/006): a table made from nothing. The person names the table, says how many rows, and adds
// columns one at a time, each described in plain terms. Continuing turns the design into an ordinary spec
// and opens Review, so everything after this screen works as it does for a file.

import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "../../components/Badge";
import { specFromDesign } from "../../lib/design/build";
import { defaultColumn, KIND_HINTS, KIND_LABELS, KIND_ORDER, newColumnId, uniqueName } from "../../lib/design/defaults";
import { MAX_DESIGN_COLUMNS, type Design, type DesignColumn, type DesignKind, type DesignProblem } from "../../lib/design/types";
import { validateDesign } from "../../lib/design/validate";
import type { SpecFile } from "../../lib/spec/types";
import { ColumnForm } from "./ColumnForm";
import { DesignNav, type DesignView } from "./DesignNav";
import { NumberField, TextField } from "./fields";
import { kindLook } from "./kindLooks";

export interface DesignScreenProps {
  design: Design;
  onChange: (design: Design) => void;
  /** The design is valid: here is its spec. */
  onBuild: (spec: SpecFile) => void;
}

const NAMES_LIMIT = 200;

export function DesignScreen({ design, onChange, onBuild }: DesignScreenProps) {
  const [view, setView] = useState<DesignView>(design.columns.length === 0 ? { view: "add" } : { view: "table" });
  const [names, setNames] = useState("");
  const [bulkKind, setBulkKind] = useState<DesignKind>("integer");

  const problems = useMemo(() => validateDesign(design), [design]);
  const withProblems = useMemo(() => new Set(problems.map((p) => p.columnId).filter((id): id is string => id !== null)), [problems]);
  const tableProblems = problems.filter((p) => p.columnId === null);
  const canContinue = problems.length === 0 && design.columns.length > 0;

  const columnIndex = view.view === "column" ? design.columns.findIndex((c) => c.id === view.id) : -1;
  const column = columnIndex >= 0 ? design.columns[columnIndex] : null;

  const setColumns = (columns: DesignColumn[]) => onChange({ ...design, columns });
  const taken = () => design.columns.map((c) => c.name);

  const add = (kind: DesignKind) => {
    if (design.columns.length >= MAX_DESIGN_COLUMNS) return;
    const c = defaultColumn(kind, taken());
    setColumns([...design.columns, c]);
    setView({ view: "column", id: c.id });
  };

  const addSeveral = () => {
    const wanted = names
      .split("\n")
      .map((n) => n.trim())
      .filter((n) => n !== "")
      .slice(0, NAMES_LIMIT);
    if (wanted.length === 0) return;
    const used = taken();
    const added = wanted.slice(0, Math.max(0, MAX_DESIGN_COLUMNS - design.columns.length)).map((n) => {
      const name = uniqueName(n, used);
      used.push(name);
      return { ...defaultColumn(bulkKind, []), name };
    });
    setColumns([...design.columns, ...added]);
    setNames("");
    if (added.length > 0) setView({ view: "column", id: added[0].id });
  };

  const update = (c: DesignColumn) => setColumns(design.columns.map((x) => (x.id === c.id ? c : x)));

  const duplicate = () => {
    if (!column) return;
    const copy = { ...column, id: newColumnId(), name: uniqueName(`${column.name.trim() || "column"}_copy`, taken()) } as DesignColumn;
    const next = [...design.columns];
    next.splice(columnIndex + 1, 0, copy);
    setColumns(next);
    setView({ view: "column", id: copy.id });
  };

  const remove = () => {
    if (!column) return;
    const next = design.columns.filter((c) => c.id !== column.id);
    setColumns(next);
    const neighbour = next[Math.min(columnIndex, next.length - 1)];
    setView(neighbour ? { view: "column", id: neighbour.id } : { view: "add" });
  };

  const shift = (by: -1 | 1) => {
    const to = columnIndex + by;
    if (!column || to < 0 || to >= design.columns.length) return;
    const next = [...design.columns];
    [next[columnIndex], next[to]] = [next[to], next[columnIndex]];
    setColumns(next);
  };

  const cont = () => {
    const result = specFromDesign(design);
    if (result.ok) onBuild(result.spec);
  };

  const columnProblems = (c: DesignColumn): DesignProblem[] => problems.filter((p) => p.columnId === c.id);

  return (
    <section className="review design" aria-labelledby="design-heading">
      <header className="screen-head">
        <div>
          <h2 id="design-heading">Design a table</h2>
          <p className="page-subtitle">
            {design.tableName.trim() || "Unnamed table"}: {design.rows.toLocaleString("en-US")} rows, {design.columns.length} {design.columns.length === 1 ? "column" : "columns"}.
          </p>
        </div>
        <div className="screen-actions">
          <button type="button" className="button button-primary" disabled={!canContinue} onClick={cont} aria-describedby="design-status">
            Continue to Review
          </button>
        </div>
      </header>
      <p id="design-status" className="design-status" role="status">
        {design.columns.length === 0 ? "Add at least one column to continue." : problems.length > 0 ? `${problems.length} ${problems.length === 1 ? "thing needs" : "things need"} fixing. Columns marked with a warning sign are listed on the left.` : "Ready. Continue to check the table and generate it."}
      </p>

      <div className="review-panes">
        <DesignNav columns={design.columns} withProblems={withProblems} current={view} onView={setView} />

        <div className="review-detail">
          {view.view === "add" && (
            <div className="kind-picker">
              <h3>What kind of column?</h3>
              <ul className="kind-grid">
                {KIND_ORDER.map((k) => {
                  const look = kindLook(k);
                  const Icon = look.icon;
                  return (
                    <li key={k}>
                      <button type="button" className="kind-card" onClick={() => add(k)}>
                        <span className="type-tile" style={{ color: look.color }} aria-hidden="true">
                          <Icon size={22} strokeWidth={1.75} />
                        </span>
                        <span className="kind-card-text">
                          <strong>{KIND_LABELS[k]}</strong>
                          <span>{KIND_HINTS[k]}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="design-bulk">
                <h4>Add several at once</h4>
                <p className="field-hint">One column name per line. They all get the kind below and its default settings; change each afterwards.</p>
                <div className="field">
                  <label htmlFor="bulk-names">Column names</label>
                  <textarea id="bulk-names" rows={5} value={names} onChange={(e) => setNames(e.target.value)} />
                </div>
                <div className="actions-row">
                  <div className="field">
                    <label htmlFor="bulk-kind">Kind</label>
                    <select id="bulk-kind" value={bulkKind} onChange={(e) => setBulkKind(e.target.value as DesignKind)}>
                      {KIND_ORDER.map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="button" className="button button-secondary" disabled={names.trim() === ""} onClick={addSeveral}>
                    Add these columns
                  </button>
                </div>
              </div>
            </div>
          )}

          {view.view === "table" && (
            <div className="overview">
              <h3>Table settings</h3>
              <p className="overview-lead">The table has a name, a number of rows and a seed. The same seed always gives the same fake data.</p>
              <div className="design-row design-row--wide">
                <TextField label="Table name" value={design.tableName} onChange={(tableName) => onChange({ ...design, tableName })} problems={tableProblems.filter((p) => p.field === "tableName")} hint={`The file is called ${design.tableName.trim() || "table"}_fake.csv.`} />
                <NumberField label="Number of rows" value={design.rows} onChange={(rows) => onChange({ ...design, rows })} problems={tableProblems.filter((p) => p.field === "rows")} />
                <NumberField label="Seed" value={design.seed} onChange={(seed) => onChange({ ...design, seed })} problems={tableProblems.filter((p) => p.field === "seed")} />
              </div>
              {tableProblems.filter((p) => p.field === "columns").map((p) => (
                <p key={p.message} className="field-hint field-error">
                  {p.message}
                </p>
              ))}
            </div>
          )}

          {view.view === "column" && column && (
            <article className="column-card design-column" data-design-detail={column.name} aria-labelledby="design-column-name">
              <header className="column-card-header">
                <span className="type-tile" style={{ color: kindLook(column.kind).color }} aria-hidden="true">
                  {(() => {
                    const Icon = kindLook(column.kind).icon;
                    return <Icon size={22} strokeWidth={1.75} />;
                  })()}
                </span>
                <div className="column-card-title">
                  <h3 id="design-column-name" className="column-card-name">
                    {column.name || "(no name)"}
                  </h3>
                  <div className="column-card-badges">
                    <Badge variant="info">{KIND_LABELS[column.kind]}</Badge>
                    {withProblems.has(column.id) && <Badge variant="warning">Needs a fix</Badge>}
                  </div>
                </div>
              </header>

              <div className="detail-nav">
                <button type="button" className="button button-secondary" onClick={duplicate} disabled={design.columns.length >= MAX_DESIGN_COLUMNS}>
                  <Copy size={16} strokeWidth={1.75} aria-hidden="true" /> Duplicate
                </button>
                <button type="button" className="button button-secondary" onClick={() => shift(-1)} disabled={columnIndex === 0} aria-label="Move up">
                  <ArrowUp size={16} strokeWidth={1.75} aria-hidden="true" /> Move up
                </button>
                <button type="button" className="button button-secondary" onClick={() => shift(1)} disabled={columnIndex === design.columns.length - 1} aria-label="Move down">
                  <ArrowDown size={16} strokeWidth={1.75} aria-hidden="true" /> Move down
                </button>
                <button type="button" className="button button-danger" onClick={remove}>
                  <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" /> Remove
                </button>
              </div>

              <ColumnForm key={column.id} column={column} problems={columnProblems(column)} onChange={update} />
            </article>
          )}
        </div>
      </div>
    </section>
  );
}
