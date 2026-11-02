# Feature Specification: SAS input

**Status**: Complete

An analyst can choose a SAS data set (.sas7bdat) or a SAS transport file (.xpt). It is read with the same `read_stat` function of the
`stats_duck` extension as SPSS and Stata (specs/017), shown by structure only, profiled like a CSV, and written as a CSV by default
(any other file type the app writes is the choice on Generate).

- **FR-001**: Recognised by the file's own first bytes: the 16-byte data set signature after twelve zero bytes, or "HEADER RECORD*******" for a transport file (versions 5 and 8).
- **FR-002**: Real values are never shown; errors are fixed messages; nothing leaves the device.
- **FR-003**: SAS files are read only. `stats_duck` (ReadStat) can write .sas7bdat, but SAS has never published that format, so ReadStat's writer is a reverse-engineered one: its files open in ReadStat-based readers (pyreadstat, R's haven) but not in real SAS, SAS Universal Viewer or SAS OnDemand. The default output of a SAS file is therefore a CSV, and "same as the file you opened" is not offered.
- **FR-004**: Value labels are not read: SAS keeps them in a separate format catalog, not in the data file.

## Limits of the tests

The .xpt fixture is made by pyreadstat. The .sas7bdat fixture is made by the extension's own writer (no Python library writes that
format), so it proves the reading path but not that every real SAS-made file reads; that rests on ReadStat's reader, which is widely used.

## Assumptions

- Out of scope: writing SAS files (an .xpt writer would be possible, since that format is documented), SAS format catalogs, SAS7BCAT.
