// A heads-up before a large file is profiled (FR-034). The file never leaves the device, but the
// browser tab has to hold working memory for it, and some encodings need a second copy.

import type { Encoding } from "../../lib/encoding/detect";
import { sizeWarnings } from "./sizeWarnings";

export function SizeWarning({ fileSize, encoding }: { fileSize: number; encoding: Encoding | undefined }) {
  const warnings = sizeWarnings(fileSize, encoding);
  if (warnings.length === 0) return null;
  return (
    <div className="banner banner-warning" role="status" data-testid="size-warning">
      {warnings.map((w) => (
        <p key={w}>{w}</p>
      ))}
    </div>
  );
}
