"""Builds the Parquet fixtures under tests/fixtures/parquet (specs/005 T002).

    python scripts/make-parquet-fixtures.py [out_dir]

Needs pyarrow. The small outputs are committed. Real-looking values all carry the marker
PRIVATE-MARKER so tests can prove none of them reaches the page, the spec or the output.
"""

import datetime as dt
import decimal
import os
import sys

import pyarrow as pa
import pyarrow.parquet as pq

OUT = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "parquet")
os.makedirs(OUT, exist_ok=True)
N = 5000
MARK = "PRIVATE-MARKER"


def types_table() -> pa.Table:
    schema = pa.schema(
        [
            pa.field("id16", pa.int16()),
            pa.field("id64", pa.int64(), nullable=False),
            pa.field("u8", pa.uint8()),
            pa.field("f32", pa.float32()),
            pa.field("f64", pa.float64()),
            pa.field("amount", pa.decimal128(10, 2)),
            pa.field("flag", pa.bool_()),
            pa.field("name", pa.string()),
            pa.field("day", pa.date32()),
            pa.field("ts", pa.timestamp("us")),
            pa.field("tsz", pa.timestamp("ms", tz="UTC")),
            pa.field("tags", pa.list_(pa.string())),
            pa.field("pt", pa.struct([("x", pa.int32()), ("y", pa.int32())])),
            pa.field("kv", pa.map_(pa.string(), pa.int32())),
        ],
        metadata={MARK.encode(): b"key value metadata with a secret note"},
    )
    rows = {
        "id16": [i % 300 if i % 7 else None for i in range(N)],
        "id64": list(range(1000, 1000 + N)),
        "u8": [i % 250 for i in range(N)],
        "f32": [i * 0.5 for i in range(N)],
        "f64": [i * 1.25 + 0.001 for i in range(N)],
        "amount": [decimal.Decimal(i) / 100 for i in range(N)],
        "flag": [i % 3 == 0 for i in range(N)],
        "name": [f"{MARK} person {i}" if i % 11 else None for i in range(N)],
        "day": [dt.date(2020, 1, 1) + dt.timedelta(days=i % 900) for i in range(N)],
        "ts": [dt.datetime(2021, 5, 1, 8, 30) + dt.timedelta(minutes=i) for i in range(N)],
        "tsz": [dt.datetime(2022, 5, 1, tzinfo=dt.timezone.utc) + dt.timedelta(minutes=i) for i in range(N)],
        "tags": [[f"{MARK} tag {i}"] for i in range(N)],
        "pt": [{"x": i, "y": -i} for i in range(N)],
        "kv": [[(f"{MARK} k", i)] for i in range(N)],
    }
    return pa.table(rows, schema=schema)


table = types_table()
for codec in ("snappy", "gzip", "zstd", "none"):
    pq.write_table(table, os.path.join(OUT, f"types_{codec}.parquet"), compression=codec, row_group_size=2000, write_statistics=True)

# Scalar columns only, small.
pq.write_table(table.select(["id16", "id64", "f64", "name", "day"]), os.path.join(OUT, "plain.parquet"), row_group_size=1000)

# Required (non-null) columns of several kinds.
required = pa.schema([pa.field("k", pa.int32(), nullable=False), pa.field("v", pa.float64(), nullable=False), pa.field("s", pa.string(), nullable=False)])
pq.write_table(
    pa.table({"k": list(range(N)), "v": [i / 4 for i in range(N)], "s": [f"s{i % 7}" for i in range(N)]}, schema=required),
    os.path.join(OUT, "required.parquet"),
    row_group_size=2500,
)

# Wide.
wide = {f"c{i:03d}": [(i * 7 + r) % 1000 for r in range(400)] for i in range(300)}
pq.write_table(pa.table(wide), os.path.join(OUT, "wide.parquet"), row_group_size=200)

# Zero rows.
pq.write_table(pa.table({"a": pa.array([], pa.int32()), "b": pa.array([], pa.string())}), os.path.join(OUT, "empty.parquet"))

# Everything that can hold a real value, planted: data, key-value metadata, statistics (min and max of
# the string column are marker strings).
marker_schema = pa.schema(
    [pa.field("who", pa.string()), pa.field("score", pa.int32()), pa.field("note", pa.string())],
    metadata={f"{MARK}-key".encode(): f"{MARK} value".encode(), b"pandas": f'{{"note": "{MARK} pandas metadata"}}'.encode()},
)
pq.write_table(
    pa.table(
        {
            "who": [f"{MARK} person {i:04d}" for i in range(2000)],
            "score": [123456 + i for i in range(2000)],
            "note": [f"{MARK} free text note number {i} with several words in it" for i in range(2000)],
        },
        schema=marker_schema,
    ),
    os.path.join(OUT, "markers.parquet"),
    row_group_size=700,
    write_statistics=True,
)

# Unsupported scalar types: raw binary and a 16-byte fixed binary (what a uuid is stored as).
pq.write_table(
    pa.table({"id": list(range(100)), "raw": [bytes([i % 256, 1, 2]) for i in range(100)], "fixed": [bytes([i % 256]) * 16 for i in range(100)]}, schema=pa.schema([pa.field("id", pa.int32()), pa.field("raw", pa.binary()), pa.field("fixed", pa.binary(16))])),
    os.path.join(OUT, "unsupported_scalars.parquet"),
)

# Empty and duplicated column names.
dup = pa.Table.from_arrays([pa.array([1, 2, 3]), pa.array([4, 5, 6]), pa.array(["x", "y", "z"])], names=["a", "a", ""])
pq.write_table(dup, os.path.join(OUT, "names.parquet"))

# Not Parquet, truncated, and a file with the encrypted-footer magic.
with open(os.path.join(OUT, "not_parquet.parquet"), "wb") as f:
    f.write(b"this is not a parquet file")
data = open(os.path.join(OUT, "types_snappy.parquet"), "rb").read()
with open(os.path.join(OUT, "truncated.parquet"), "wb") as f:
    f.write(data[: len(data) // 2])
with open(os.path.join(OUT, "encrypted.parquet"), "wb") as f:
    f.write(b"PARE" + bytes(range(256)) * 4 + b"\x10\x00\x00\x00" + b"PARE")

print("fixtures written to", os.path.abspath(OUT), "with pyarrow", pa.__version__)
