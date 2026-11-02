// The page's one network counter, started when the app mounts (see NetworkCounter).
import { NetCounter, watchUploads } from "./netCounter";

export const netCounter = new NetCounter(typeof location !== "undefined" ? location.origin : "http://localhost");

// Watch for anything sent out from the moment the page's scripts run, before the first render, so there is no gap.
if (typeof window !== "undefined") watchUploads(netCounter);
