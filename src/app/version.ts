// The version of the app and of the spec file it writes. A release, its zip, its README and this page
// all carry the same pair (specs/004), so a saved spec can be matched to the release that wrote it.

import { SPEC_VERSION } from "../lib/spec/types";

export const APP_VERSION: string = __APP_VERSION__;

export { SPEC_VERSION };

/** For example `v0.2.0 · writes spec v4`. */
export function versionLabel(app: string = APP_VERSION, spec: number = SPEC_VERSION): string {
  return `v${app} · writes spec v${spec}`;
}
