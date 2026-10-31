// The page's one network counter, started when the app mounts (see NetworkCounter).
import { NetCounter } from "./netCounter";

export const netCounter = new NetCounter(typeof location !== "undefined" ? location.origin : "http://localhost");
