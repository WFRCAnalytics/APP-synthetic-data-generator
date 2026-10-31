// Principle VII, FR-037: the text and control colours of the theme meet WCAG AA (4.5:1 for text,
// 3:1 for focus indicators and graphics) in the light and the dark theme. The pairs are the ones the
// stylesheets actually use; the values come from src/theme/tokens.css, not from copies here.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../../src/theme/tokens.css"), "utf8");

/** The declarations of the block that starts at `selector`, with comments removed. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no block ${selector}`);
  let depth = 0;
  let i = css.indexOf("{", start);
  const open = i;
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) break;
  }
  const body = css.slice(open + 1, i).replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const light = block(":root {");
const dark = { ...light, ...block(':root[data-theme="dark"]') };

function resolve(theme: Record<string, string>, name: string): string {
  let value = theme[name];
  for (let n = 0; n < 10 && value?.startsWith("var("); n++) value = theme[value.slice(4, -1).trim()];
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} does not resolve to a hex colour: ${value}`);
  return value;
}

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
export const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Foreground token, background token, minimum ratio.
const TEXT_PAIRS: [string, string, number][] = [
  ["--color-foreground", "--color-background", 4.5], // body text
  ["--color-heading", "--color-background", 4.5], // headings
  ["--color-link", "--color-background", 4.5], // links
  ["--color-wfrc-gray", "--color-background", 4.5], // hints under fields
  ["--color-primary", "--color-background", 4.5], // text in the primary colour
  ["--color-primary-foreground", "--color-primary", 4.5], // primary buttons
  ["--color-accent-foreground", "--color-accent-background", 4.5], // warning badges
  ["--color-danger-foreground", "--color-danger", 4.5], // danger badges
  ["--color-danger-text", "--color-background", 4.5], // error text and danger buttons
  ["--color-code-text", "--color-code-background", 4.5], // inline code
];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme", (_name, theme) => {
  it.each(TEXT_PAIRS)("%s on %s is at least %f:1", (fg, bg, min) => {
    expect(ratio(resolve(theme, fg), resolve(theme, bg))).toBeGreaterThanOrEqual(min);
  });

  it("the focus ring colour (the primary colour) is at least 3:1 against the page", () => {
    expect(ratio(resolve(theme, "--color-primary"), resolve(theme, "--color-background"))).toBeGreaterThanOrEqual(3);
  });
});

describe("the contrast calculation", () => {
  it("gives 21:1 for black on white and 1:1 for a colour on itself", () => {
    expect(ratio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(ratio("#76716e", "#76716e")).toBeCloseTo(1, 5);
  });
});
