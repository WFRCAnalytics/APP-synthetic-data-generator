// Name of the BroadcastChannel the workers use to report their network requests to the page
// (contracts/worker-protocol.md section 3). A separate channel keeps these reports out of the
// workers' own message protocols, including DuckDB's.
export const NET_CHANNEL = "synthetic-data-generator:net";
