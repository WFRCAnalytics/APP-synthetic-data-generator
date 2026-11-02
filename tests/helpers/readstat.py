"""Reads an SPSS or Stata file with pyreadstat and prints its columns and values as JSON (used by tests/unit/stat-write.test.ts)."""
import json
import sys
import pyreadstat

path = sys.argv[1]
reader = pyreadstat.read_sav if path.endswith(".sav") else pyreadstat.read_dta
df, meta = reader(path)
out = {"names": list(df.columns), "rows": len(df), "cells": []}
for _, row in df.iterrows():
    out["cells"].append([None if (v != v) else (v.isoformat() if hasattr(v, "isoformat") else (float(v) if isinstance(v, (int, float)) or hasattr(v, "__float__") and not isinstance(v, str) else str(v))) for v in row])
print(json.dumps(out))
