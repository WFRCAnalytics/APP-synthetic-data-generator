"""Reads an SPSS or Stata file with pyreadstat and prints its columns, values and labels as JSON (used by tests/unit/stat-write.test.ts)."""
import json
import sys
import pyreadstat

path = sys.argv[1]
reader = pyreadstat.read_sav if path.endswith(".sav") else pyreadstat.read_xport if path.endswith(".xpt") else pyreadstat.read_dta
df, meta = reader(path)
out = {
    "names": list(df.columns),
    "rows": len(df),
    "cells": [],
    "labels": dict(zip(meta.column_names, meta.column_labels)),
    "value_labels": {c: {str(int(k)): v for k, v in m.items()} for c, m in meta.variable_value_labels.items()},
}
for _, row in df.iterrows():
    out["cells"].append([None if (v != v) else (v.isoformat() if hasattr(v, "isoformat") else (float(v) if isinstance(v, (int, float)) or hasattr(v, "__float__") and not isinstance(v, str) else str(v))) for v in row])
print(json.dumps(out))
