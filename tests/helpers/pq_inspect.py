"""Reads a Parquet file with pyarrow and prints what an independent reader sees, as JSON (used by tests)."""
import json
import sys

import pyarrow.parquet as pq

path = sys.argv[1]
f = pq.ParquetFile(path)
schema = f.schema_arrow
meta = f.metadata
table = f.read()
rows = table.to_pylist()
stats = []
for g in range(meta.num_row_groups):
    for c in range(meta.num_columns):
        col = meta.row_group(g).column(c)
        stats.append(bool(col.is_stats_set))
out = {
    "fields": [[fld.name, str(fld.type), fld.nullable] for fld in schema],
    "num_rows": meta.num_rows,
    "row_groups": meta.num_row_groups,
    "created_by": meta.created_by,
    "kv": {k.decode(): v.decode() for k, v in (schema.metadata or {}).items()} if schema.metadata else {},
    "file_kv": {k.decode(): v.decode() for k, v in (meta.metadata or {}).items()} if meta.metadata else {},
    "any_stats": any(stats),
    "compression": sorted({meta.row_group(0).column(c).compression for c in range(meta.num_columns)}) if meta.num_row_groups else [],
    "first": [str(v) for v in (rows[0].values() if rows else [])],
    "nulls": {name: sum(1 for r in rows if r[name] is None) for name in table.column_names},
}
print(json.dumps(out))
