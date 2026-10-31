// Filler text of an exact length (specs/002 FR-006, research R7). Lorem-style words from the generator's
// own word list, grouped into sentences, cut at the length asked for. Nothing here comes from the real
// column: only the length does. A pure function of (key, row, length), so chunk size cannot change it.

import { rowRng } from "../rng/counter";
import { loremWords } from "./wordlists";

const capitalize = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** Text of exactly `length` characters (plain ASCII). With `lineBreaks`, some longer values hold one line break. */
export function loremText(length: number, key: number, row: number, lineBreaks = false): string {
  if (length <= 0) return "";
  const rng = rowRng(key, row);
  const n = loremWords.length;
  let out = "";
  let sentenceLeft = 0;
  while (out.length < length) {
    let word = loremWords[Math.floor(rng() * n)];
    if (sentenceLeft === 0) {
      sentenceLeft = 5 + Math.floor(rng() * 10);
      word = capitalize(word);
    }
    sentenceLeft--;
    out += word;
    out += sentenceLeft === 0 ? ". " : " ";
  }
  let text = out.slice(0, length);
  // A value never ends in a space (some programs trim fields, which would change its length).
  if (text.endsWith(" ")) text = `${text.slice(0, -1)}e`;
  if (lineBreaks && length >= 30 && rng() < 0.1) {
    const at = text.indexOf(" ", Math.floor(length / 2));
    if (at > 0 && at < length - 1) text = `${text.slice(0, at)}\n${text.slice(at + 1)}`;
  }
  return text;
}
