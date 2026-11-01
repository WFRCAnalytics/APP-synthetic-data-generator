import datetime as dt
import decimal
import pyarrow as pa
import pyarrow.parquet as pq

n = 5000
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
    metadata={b"PRIVATE-MARKER": b"key value metadata with a secret note"},
)
rows = {
    "id16": [i % 300 if i % 7 else None for i in range(n)],
    "id64": list(range(1000, 1000 + n)),
    "u8": [i % 250 for i in range(n)],
    "f32": [i * 0.5 for i in range(n)],
    "f64": [i * 1.25 + 0.001 for i in range(n)],
    "amount": [decimal.Decimal(i) / 100 for i in range(n)],
    "flag": [i % 3 == 0 for i in range(n)],
    "name": [f"PRIVATE-MARKER person {i}" if i % 11 else None for i in range(n)],
    "day": [dt.date(2020, 1, 1) + dt.timedelta(days=i % 900) for i in range(n)],
    "ts": [dt.datetime(2021, 5, 1, 8, 30) + dt.timedelta(minutes=i) for i in range(n)],
    "tsz": [dt.datetime(2022, 5, 1, tzinfo=dt.timezone.utc) + dt.timedelta(minutes=i) for i in range(n)],
    "tags": [[f"PRIVATE-MARKER tag {i}"] for i in range(n)],
    "pt": [{"x": i, "y": -i} for i in range(n)],
    "kv": [[("PRIVATE-MARKER k", i)] for i in range(n)],
}
table = pa.table(rows, schema=schema)
import sys

out = sys.argv[1]
for codec in ("snappy", "gzip", "zstd", "none"):
    pq.write_table(table, f"{out}/types_{codec}.parquet", compression=codec, row_group_size=2000, write_statistics=True)
pq.write_table(table.select(["id16", "id64", "f64", "name", "day"]), f"{out}/plain.parquet", row_group_size=1000)
open(f"{out}/not_parquet.parquet", "wb").write(b"this is not a parquet file")
data = open(f"{out}/types_snappy.parquet", "rb").read()
open(f"{out}/truncated.parquet", "wb").write(data[: len(data) // 2])
print("ok", pa.__version__)
