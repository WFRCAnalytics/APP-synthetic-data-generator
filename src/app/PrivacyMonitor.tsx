// The activity monitor behind the header's privacy button: what this page has sent and received since it loaded, live, what the
// browser has saved for this site, and the rules the browser itself enforces. Everything here is read from the browser while the
// dialog is open, so a person can check the promise instead of taking it on trust. It never shows a value from a file.

import { ArrowDown, ArrowUp, Database, Globe, HardDrive, ShieldAlert, ShieldCheck, Upload, Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { offlineState, subscribeOffline } from "./offline";
import type { NetCounts, NetDetail, NetEntry } from "./netCounter";
import { formatBytes, inspectStorage, readPolicy, type StorageReport } from "./storageProbe";
import "./PrivacyMonitor.css";

export interface PrivacyMonitorProps {
  counts: NetCounts;
  detail: NetDetail;
  /** What the tab holds in memory right now: shown as a size and a row count, never as content. */
  held: { fileName: string; bytes: number; rows: number };
}

type Tab = "requests" | "stored" | "safeguards";
const WINDOW_SECONDS = 60;

/** The address as a person reads it: a path on this site, or the whole address of anything else. */
function shown(entry: NetEntry, origin: string, base: string): string {
  try {
    const u = new URL(entry.url);
    if (entry.kind === "cross") return u.href;
    const path = u.pathname.startsWith(base) ? `/${u.pathname.slice(base.length)}` : u.pathname;
    return `${path}${u.search}`;
  } catch {
    return entry.url.startsWith(origin) ? entry.url.slice(origin.length) : entry.url;
  }
}

const KIND_LABEL: Record<string, string> = {
  script: "script",
  css: "style",
  link: "file",
  img: "image",
  fetch: "data file",
  xmlhttprequest: "data file",
  worker: "background task",
  upload: "data sent out",
  other: "file",
  request: "file",
};

/** Bytes received in each of the last `WINDOW_SECONDS` seconds, and the bytes sent. */
function buckets(log: readonly NetEntry[], now: number): { received: number[]; sent: number[] } {
  const received = Array<number>(WINDOW_SECONDS).fill(0);
  const sent = Array<number>(WINDOW_SECONDS).fill(0);
  for (const e of log) {
    const age = Math.floor((now - e.at) / 1000);
    if (age < 0 || age >= WINDOW_SECONDS) continue;
    const slot = WINDOW_SECONDS - 1 - age;
    received[slot] += e.received;
    sent[slot] += e.sent;
  }
  return { received, sent };
}

function Chart({ log, now }: { log: readonly NetEntry[]; now: number }) {
  const { received, sent } = useMemo(() => buckets(log, now), [log, now]);
  const top = Math.max(1024, ...received);
  const bar = 100 / WINDOW_SECONDS;
  const lane = (values: number[], scale: number, tone: string) =>
    values.map((v, i) => (v > 0 ? <rect key={i} x={i * bar + 0.15} width={bar - 0.3} y={30 - Math.max(1.5, (v / scale) * 30)} height={Math.max(1.5, (v / scale) * 30)} className={tone} /> : null));
  const sentTop = Math.max(1024, ...sent);
  return (
    <figure className="pm-chart" data-testid="pm-chart">
      <figcaption className="visually-hidden">Data received and data sent in the last minute</figcaption>
      <div className="pm-lane">
        <span className="pm-lane-label">
          <ArrowDown size={14} strokeWidth={2} aria-hidden="true" /> Received
        </span>
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={`Received ${formatBytes(received.reduce((a, b) => a + b, 0))} in the last minute`}>
          <line x1="0" x2="100" y1="29.5" y2="29.5" className="pm-axis" />
          {lane(received, top, "pm-bar-in")}
        </svg>
      </div>
      <div className="pm-lane">
        <span className="pm-lane-label">
          <ArrowUp size={14} strokeWidth={2} aria-hidden="true" /> Sent
        </span>
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={`Sent ${formatBytes(sent.reduce((a, b) => a + b, 0))} in the last minute`}>
          <line x1="0" x2="100" y1="29.5" y2="29.5" className={sent.some((v) => v > 0) ? "pm-axis pm-axis--out" : "pm-axis pm-axis--zero"} />
          {lane(sent, sentTop, "pm-bar-out")}
        </svg>
      </div>
      <div className="pm-chart-scale" aria-hidden="true">
        <span>60 s ago</span>
        <span>now</span>
      </div>
    </figure>
  );
}

function Tile({ icon, title, value, note, tone, testId }: { icon: React.ReactNode; title: string; value: string; note: string; tone: "ok" | "alert" | "plain"; testId: string }) {
  return (
    <div className={`pm-tile pm-tile--${tone}`}>
      <span className="pm-tile-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="pm-tile-title">{title}</span>
      <strong className="pm-tile-value" data-testid={testId}>
        {value}
      </strong>
      <span className="pm-tile-note">{note}</span>
    </div>
  );
}

const GLOSS: Record<string, string> = {
  "default-src": "Everything the page loads must come from this site.",
  "connect-src": "The page may only connect to this site. A connection to any other address is refused by the browser, whatever the code tries.",
  "script-src": "Only this site's own scripts run. No outside or injected script can.",
  "worker-src": "Background tasks come from this site only.",
  "form-action": "No form on the page can submit anywhere.",
  "img-src": "Images come from this site or from memory, not from other sites.",
  "font-src": "Fonts come from this site only.",
  "style-src": "Styles come from this site only.",
  "object-src": "No plug-ins or embedded objects.",
  "base-uri": "Relative addresses cannot be redirected elsewhere.",
};

export function PrivacyMonitor({ counts, detail, held }: PrivacyMonitorProps) {
  const [tab, setTab] = useState<Tab>("requests");
  const [now, setNow] = useState(() => performance.now());
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [storage, setStorage] = useState<StorageReport | null>(null);
  const clean = counts.crossOrigin === 0 && counts.blocked === 0 && detail.sentBytes === 0;

  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    // The browser's own flag only says whether a network adapter is up, and a VPN or virtual adapter keeps it true with no internet. So
    // while this dialog is open the page asks this site for a tiny file: any answer, even "not found", means the network works.
    let live = true;
    const check = () =>
      void fetch(`${import.meta.env.BASE_URL}connection-check?${Date.now()}`, { method: "HEAD", cache: "no-store" })
        .then(() => live && setOnline(true))
        .catch(() => live && setOnline(false));
    const on = () => check();
    const off = () => setOnline(false);
    check();
    const timer = setInterval(check, 4000);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  useEffect(() => {
    let live = true;
    const read = () => void inspectStorage().then((r) => live && setStorage(r));
    read();
    const timer = setInterval(read, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  const origin = typeof location === "undefined" ? "" : location.origin;
  const base = typeof location === "undefined" ? "/" : location.pathname.replace(/[^/]*$/, "");
  const policy = useMemo(() => readPolicy(), []);
  const KEY_RULES = ["connect-src", "default-src", "script-src", "form-action"];
  const keyRules = policy.filter((d) => KEY_RULES.includes(d.name)).sort((a, b) => KEY_RULES.indexOf(a.name) - KEY_RULES.indexOf(b.name));
  const otherRules = policy.filter((d) => !KEY_RULES.includes(d.name));
  const recent = [...detail.log].reverse().slice(0, 120);
  const memory = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize;
  // Cookies, storage and databases would hold your data or your settings, so they count against the page. The cached files are the app's own code.
  const stored = storage ? storage.cookies + storage.localItems + storage.sessionItems + (storage.databases ?? 0) : null;
  const offline = useSyncExternalStore(subscribeOffline, offlineState);

  return (
    <div className={`pm ${clean ? "pm--clean" : "pm--alert"}`} data-testid="privacy-monitor">
      <header className="pm-head">
        <span className="pm-head-icon" aria-hidden="true">
          {clean ? <ShieldCheck size={26} strokeWidth={1.75} /> : <ShieldAlert size={26} strokeWidth={1.75} />}
        </span>
        <div className="pm-head-text">
          <h2 id="net-title">{clean ? "Your data stays on this device" : "Something tried to reach another address"}</h2>
          <p>
            {clean
              ? `Nothing has been sent anywhere since this page loaded. The ${counts.sameOrigin} requests it made were this site's own files.`
              : `${counts.crossOrigin + counts.blocked} request(s) tried to reach another address${detail.sentBytes > 0 ? ` and ${formatBytes(detail.sentBytes)} of data was in requests` : ""}. Your data was not sent, but close this tab and tell the maintainers.`}
          </p>
        </div>
        <span className={`pm-online ${online ? "" : "pm-online--off"}`} data-testid="pm-online" title={online ? "Your computer is connected to the internet" : "Your computer is offline"}>
          {online ? <Wifi size={15} strokeWidth={1.75} aria-hidden="true" /> : <WifiOff size={15} strokeWidth={1.75} aria-hidden="true" />}
          {online ? "Online" : "Offline: still working"}
        </span>
      </header>

      <div className="pm-tiles">
        <Tile icon={<Upload size={16} strokeWidth={1.75} />} title="Sent out" value={formatBytes(detail.sentBytes)} note={`${detail.uploads} uploads, to anywhere`} tone={detail.sentBytes === 0 ? "ok" : "alert"} testId="pm-sent" />
        <Tile icon={<Globe size={16} strokeWidth={1.75} />} title="To other websites" value={`${counts.crossOrigin}`} note={`${counts.blocked} blocked by the browser`} tone={counts.crossOrigin === 0 && counts.blocked === 0 ? "ok" : "alert"} testId="pm-cross" />
        <Tile icon={<ArrowDown size={16} strokeWidth={1.75} />} title="From this site" value={formatBytes(detail.receivedBytes)} note={`${counts.sameOrigin} files, the app itself`} tone="plain" testId="pm-received" />
        <Tile icon={<HardDrive size={16} strokeWidth={1.75} />} title="Saved in browser" value={storage ? (storage.bytes === null ? `${stored ?? 0} items` : formatBytes(storage.bytes)) : "..."} note={stored === 0 ? (storage?.caches ? "your data: none. The app's own files only" : "cookies, storage, databases: none") : `${stored ?? 0} items stored`} tone={stored === 0 || stored === null ? "ok" : "plain"} testId="pm-saved" />
      </div>

      <Chart log={detail.log} now={now} />

      <div className="pm-tabs" role="tablist" aria-label="Details">
        {(
          [
            ["requests", "Requests"],
            ["stored", "Stored and held"],
            ["safeguards", "Safeguards"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`pm-tab-${id}`} aria-selected={tab === id} aria-controls={`pm-panel-${id}`} className="pm-tab" onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="pm-panel-requests" aria-labelledby="pm-tab-requests" hidden={tab !== "requests"} className="pm-panel">
        <p className="field-hint">Every request this page and its background tasks have made since it loaded, newest first. A file you open is never in a request.</p>
        {recent.length === 0 ? (
          <p className="pm-empty">No requests yet.</p>
        ) : (
          <div className="pm-log-wrap" role="region" aria-label="Requests made by this page" tabIndex={0}>
            <table className="pm-log" data-testid="pm-log">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Direction</th>
                  <th scope="col">What</th>
                  <th scope="col">Address</th>
                  <th scope="col">Size</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((e) => (
                  <tr key={e.id} className={e.kind === "cross" || e.sent > 0 ? "pm-row--alert" : undefined}>
                    <td>{`${((now - e.at) / 1000 < 1 ? 0 : Math.round((now - e.at) / 1000)).toLocaleString("en-US")} s ago`}</td>
                    <td>
                      {e.sent > 0 ? (
                        <span className="pm-dir pm-dir--out">
                          <ArrowUp size={13} strokeWidth={2} aria-hidden="true" /> Sent
                        </span>
                      ) : (
                        <span className="pm-dir">
                          <ArrowDown size={13} strokeWidth={2} aria-hidden="true" /> Received
                        </span>
                      )}
                    </td>
                    <td>{e.url.includes("connection-check") ? "connection check" : (KIND_LABEL[e.initiator] ?? e.initiator)}</td>
                    <td className="pm-address" title={shown(e, origin, base)}>
                      {e.kind === "cross" ? <strong>{shown(e, origin, base)}</strong> : shown(e, origin, base)}
                    </td>
                    <td>{e.sent > 0 ? formatBytes(e.sent) : e.received > 0 ? formatBytes(e.received) : "cached"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div role="tabpanel" id="pm-panel-stored" aria-labelledby="pm-tab-stored" hidden={tab !== "stored"} className="pm-panel">
        <h3>
          <Database size={16} strokeWidth={1.75} aria-hidden="true" /> Saved by this site in your browser
        </h3>
        <p className="field-hint">Read from the browser just now. The app saves none of your data, so cookies, storage and databases should be 0. The hosted page keeps its own files (the app itself) so it works without internet.</p>
        <dl className="pm-facts" data-testid="pm-storage">
          <dt>Cookies</dt>
          <dd>{storage?.cookies ?? "..."}</dd>
          <dt>Local storage items</dt>
          <dd>{storage?.localItems ?? "..."}</dd>
          <dt>Session storage items</dt>
          <dd>{storage?.sessionItems ?? "..."}</dd>
          <dt>Databases</dt>
          <dd>{storage ? (storage.databases ?? "not reported") : "..."}</dd>
          <dt>Cached app files</dt>
          <dd>{storage ? (storage.caches ?? "not reported") : "..."}</dd>
          <dt>Offline helper</dt>
          <dd>{storage ? (storage.serviceWorkers ?? "not reported") : "..."}</dd>
          <dt>Disk used by this site</dt>
          <dd>{storage ? (storage.bytes === null ? "not reported" : formatBytes(storage.bytes)) : "..."}</dd>
        </dl>
        <h3>
          <Wifi size={16} strokeWidth={1.75} aria-hidden="true" /> Works without internet
        </h3>
        <p className="field-hint" data-testid="pm-offline">
          {offline.phase === "ready"
            ? `The app's own files are saved (${formatBytes(offline.total)}), so it keeps working if your internet goes away. Your data is never part of them.`
            : offline.phase === "preparing"
              ? `Saving the app's own files so it works without internet${offline.total > 0 ? `: ${formatBytes(offline.done)} of ${formatBytes(offline.total)}` : ""}.`
              : offline.phase === "failed"
                ? "Some of the app's files could not be saved, so offline use may not work. Reload while connected to try again."
                : "Not kept here: this copy is loaded fresh each time, or your browser does not keep files for the page."}
        </p>
        <h3>
          <HardDrive size={16} strokeWidth={1.75} aria-hidden="true" /> Held in this tab&apos;s memory
        </h3>
        <p className="field-hint">Memory is cleared when you reload or close the tab.</p>
        <dl className="pm-facts" data-testid="pm-memory">
          <dt>Your file</dt>
          <dd>{held.fileName ? `${held.fileName}, ${formatBytes(held.bytes)}${held.rows > 0 ? `, ${held.rows.toLocaleString("en-US")} rows` : ""}` : "none opened"}</dd>
          <dt>This tab&apos;s memory</dt>
          <dd>{memory === undefined ? "not reported by this browser" : formatBytes(memory)}</dd>
        </dl>
      </div>

      <div role="tabpanel" id="pm-panel-safeguards" aria-labelledby="pm-tab-safeguards" hidden={tab !== "safeguards"} className="pm-panel">
        <h3>The browser enforces these rules for this page</h3>
        <p className="field-hint">Read from the page itself. The browser, not the app, refuses anything that breaks them.</p>
        {policy.length === 0 ? (
          <p className="pm-empty">No policy was found on this page.</p>
        ) : (
          <>
            <ul className="pm-policy" data-testid="pm-policy">
              {keyRules.map((d) => (
                <li key={d.name} className="pm-policy--key">
                  <code>{`${d.name} ${d.value}`}</code>
                  {GLOSS[d.name] && <span>{GLOSS[d.name]}</span>}
                </li>
              ))}
            </ul>
            {otherRules.length > 0 && (
              <details className="pm-policy-more">
                <summary>{otherRules.length} more rules</summary>
                <ul className="pm-policy">
                  {otherRules.map((d) => (
                    <li key={d.name}>
                      <code>{`${d.name} ${d.value}`}</code>
                      {GLOSS[d.name] && <span>{GLOSS[d.name]}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
        <h3>Check it yourself</h3>
        <ol className="pm-steps">
          <li>
            <strong>Turn your internet off</strong> (Wi-Fi or the network cable), then open a file. It still works, because nothing is waiting on a server.
          </li>
          <li>
            <strong>Watch the browser&apos;s own view.</strong> Press F12 and open the Network tab. Opening and generating add no requests.
          </li>
          <li>
            <strong>Use the offline copy.</strong> Every release has a zip that runs from a folder with no internet at all.
          </li>
        </ol>
        <p className="field-hint">The numbers above count requests from the page and its background tasks, and every fetch, form, beacon or message that carries data. A file you open is read by the browser on your computer and is never part of one.</p>
      </div>
    </div>
  );
}
