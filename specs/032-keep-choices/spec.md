# Slice 32: What the fake table keeps

The Review screen asks one question: how closely should the fake table follow the real data? A preset answers it for the whole table,
and each column then has plain-language choices for what it keeps. Rarely needed settings sit under "Advanced settings".

- **Presets.** Match closely (every figure as it is), Balanced (the default: counts and ranges rounded a little, averages and spreads
  kept), Most private (equal shares, evenly spread numbers, rounded ranges, no missing values). A column changed on its own makes the
  bar read "Custom".
- **Categories and yes/no.** How often each label appears: exactly, roughly (rounded to about 1% of the rows, never less than 5 rows)
  or equally. Rows with no value: the same number, about the same, or none. Every label is kept.
- **Numbers.** The lowest and highest value: exact, or widened to two significant digits. The shape: the same shape (percentiles), the
  same average and spread, or evenly spread. Rows with no value, and the decimal places.
- **Dates and times.** The range widened to whole months (dates), days (date-times) or hours (times, up to 23:59). Shape and missing
  values as for numbers.
- **IDs, names, text, short codes.** Nothing real is kept beyond the kind, the lengths or the pattern, and how often values repeat; the
  panel says so.
- **The spec holds only what was chosen.** In a coarser mode the real counts, extremes and percentile ends are never written. Each
  column records its choices (`keep`), and a saved spec is not coarsened a second time when it is opened again.
- A spec opened from a file, and a designed table, start as "Match closely" because their figures are already the ones they hold.
