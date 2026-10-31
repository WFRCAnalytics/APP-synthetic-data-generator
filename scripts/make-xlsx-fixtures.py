"""Builds the Excel test fixtures (specs/003-excel-input-output).

    python scripts/make-xlsx-fixtures.py            small fixtures into tests/fixtures/xlsx (committed)
    python scripts/make-xlsx-fixtures.py --large    a ~50 MB workbook into .fixtures/ (not committed)

Needs xlsxwriter. All values are made up. Strings that stand for "something private" carry the marker
PRIVATE-MARKER so leak tests can search for them: they appear in other sheets, title rows, comments and
a totals row, and must never reach the page, the spec, the preview, the download or an error.
"""

import datetime
import os
import random
import sys

import xlsxwriter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "fixtures", "xlsx")
BIG = os.path.join(ROOT, ".fixtures")
BASE = datetime.date(2024, 1, 1)


def quirks(path):
    wb = xlsxwriter.Workbook(path)
    notes = wb.add_worksheet("Notes")
    notes.write("A1", "PRIVATE-MARKER notes sheet")
    data = wb.add_worksheet("Survey Data")
    hidden = wb.add_worksheet("Lookup")
    hidden.write("A1", "PRIVATE-MARKER hidden sheet")
    hidden.hide()

    money = wb.add_format({"num_format": "#,##0.00"})
    pct = wb.add_format({"num_format": "0.0%"})
    dt = wb.add_format({"num_format": "mm/dd/yyyy"})
    txt = wb.add_format({"num_format": "@"})
    bold = wb.add_format({"bold": True})

    data.write("A1", "PRIVATE-MARKER title row above the table")
    headers = ["resp_id", "zip", "amount", "share", "when", "score", "flag", "note", "total"]
    for c, h in enumerate(headers):
        data.write(2, c, h, bold)  # the header is on row 3, so two rows are skipped
    for i in range(200):
        r = 3 + i
        data.write_string(r, 0, f"{i:05d}", txt)  # text with leading zeros
        data.write_string(r, 1, f"{84000 + (i * 7) % 900}")  # numbers stored as text
        data.write_number(r, 2, 1000 + i * 12.5, money)  # number, 2 decimals, thousands separator
        data.write_number(r, 3, (i % 100) / 100, pct)  # percent
        data.write_datetime(r, 4, datetime.datetime.combine(BASE + datetime.timedelta(days=i * 3), datetime.time()), dt)
        if i % 10 == 0:
            data.write_blank(r, 5, None, money)  # a blank cell
        else:
            data.write_number(r, 5, i % 7)
        data.write_string(r, 6, "" if i % 15 == 0 else ("Y" if i % 2 else "N"))  # empty text next to values
        data.write_string(r, 7, f"comment number {i} here")
        data.write_formula(r, 8, f"=C{r + 1}*2", money, 2 * (1000 + i * 12.5))  # a formula with its cached value
    data.merge_range("K3:L3", "Merged heading", bold)
    wb.close()


def plain(path):
    rng = random.Random(1)
    wb = xlsxwriter.Workbook(path)
    ws = wb.add_worksheet("Data")
    date = wb.add_format({"num_format": "yyyy-mm-dd"})
    for c, h in enumerate(["id", "name", "score", "visited", "category"]):
        ws.write(0, c, h)
    for i in range(100):
        ws.write_number(i + 1, 0, 1000 + i)
        ws.write_string(i + 1, 1, f"Name{i:03d}x")
        ws.write_number(i + 1, 2, round(rng.uniform(0, 100), 2))
        ws.write_datetime(i + 1, 3, datetime.datetime.combine(BASE + datetime.timedelta(days=rng.randint(0, 365)), datetime.time()), date)
        ws.write_string(i + 1, 4, rng.choice(["North", "South", "East", "West"]))
    wb.close()


def dates1904(path):
    wb = xlsxwriter.Workbook(path, {"date_1904": True})
    ws = wb.add_worksheet("Dates")
    date = wb.add_format({"num_format": "dd/mm/yyyy"})
    stamp = wb.add_format({"num_format": "yyyy-mm-dd hh:mm"})
    ws.write(0, 0, "day")
    ws.write(0, 1, "moment")
    for i in range(60):
        ws.write_datetime(i + 1, 0, datetime.datetime(2020, 3, 1) + datetime.timedelta(days=i * 5), date)
        ws.write_datetime(i + 1, 1, datetime.datetime(2020, 3, 1, 8, 30) + datetime.timedelta(hours=i * 7), stamp)
    wb.close()


def wide(path):
    wb = xlsxwriter.Workbook(path)
    ws = wb.add_worksheet("Wide")
    for c in range(300):
        ws.write(0, c, f"q{c + 1:03d}")
    for r in range(20):
        for c in range(300):
            ws.write_number(r + 1, c, (r * 7 + c) % 5)
    wb.close()


def titles(path):
    wb = xlsxwriter.Workbook(path)
    summary = wb.add_worksheet("Summary")
    summary.write("A1", "PRIVATE-MARKER summary sheet")
    summary.write("B2", "PRIVATE-MARKER-2")
    ws = wb.add_worksheet("Responses")
    private = wb.add_worksheet("Private")
    private.write("A1", "PRIVATE-MARKER private sheet")
    private.hide()
    ws.write("A1", "PRIVATE-MARKER survey title")
    ws.write("A2", "PRIVATE-MARKER prepared for the county")
    ws.write("A3", "")
    for c, h in enumerate(["id", "answer", "count"]):
        ws.write(3, c, h)
    for i in range(100):
        ws.write_number(i + 4, 0, 5000 + i)
        ws.write_string(i + 4, 1, ["agree", "disagree", "unsure"][i % 3])
        ws.write_number(i + 4, 2, i % 9)
    ws.write(104, 0, "PRIVATE-MARKER total row")
    ws.write_number(104, 2, 400)
    ws.write_comment("B6", "PRIVATE-MARKER comment on a cell")
    wb.close()


def formats(path):
    wb = xlsxwriter.Workbook(path)
    ws = wb.add_worksheet("Formats")
    f = {
        "pct": wb.add_format({"num_format": "0.00%"}),
        "cur": wb.add_format({"num_format": "$#,##0.00"}),
        "sci": wb.add_format({"num_format": "0.00E+00"}),
        "txt": wb.add_format({"num_format": "@"}),
        "thou": wb.add_format({"num_format": "#,##0"}),
        "b2": wb.add_format({"num_format": 2}),  # built-in 0.00
        "b9": wb.add_format({"num_format": 9}),  # built-in 0%
        "b14": wb.add_format({"num_format": 14}),  # built-in short date
        "time": wb.add_format({"num_format": "hh:mm:ss"}),
    }
    cols = ["pct", "cur", "sci", "txt", "thou", "b2", "b9", "b14", "time"]
    for c, name in enumerate(cols):
        ws.write(0, c, name)
    for i in range(60):
        r = i + 1
        ws.write_number(r, 0, (i % 100) / 100, f["pct"])
        ws.write_number(r, 1, 1234.5 + i, f["cur"])
        ws.write_number(r, 2, 0.000123 * (i + 1), f["sci"])
        ws.write_string(r, 3, f"{i:04d}", f["txt"])
        ws.write_number(r, 4, 1000 * (i + 1), f["thou"])
        ws.write_number(r, 5, 3.14159 * (i + 1), f["b2"])
        ws.write_number(r, 6, (i % 100) / 100, f["b9"])
        ws.write_datetime(r, 7, datetime.datetime.combine(BASE + datetime.timedelta(days=i), datetime.time()), f["b14"])
        ws.write_datetime(r, 8, datetime.datetime(1900, 1, 1, 8, 0, 0) + datetime.timedelta(minutes=i * 11), f["time"])
    wb.close()


def mixed(path):
    wb = xlsxwriter.Workbook(path)
    ws = wb.add_worksheet("Mixed")
    date = wb.add_format({"num_format": "yyyy-mm-dd"})
    ws.write(0, 0, "when")
    ws.write(0, 1, "value")
    for i in range(40):
        if i % 2:
            ws.write_datetime(i + 1, 0, datetime.datetime.combine(BASE + datetime.timedelta(days=i), datetime.time()), date)
        else:
            ws.write_number(i + 1, 0, 1000 + i)
        ws.write_string(i + 1, 1, "x" if i % 3 == 0 else str(i))
    wb.close()


def damaged(src, path):
    data = open(src, "rb").read()
    open(path, "wb").write(data[: int(len(data) * 0.6)])


def legacy(path):
    # The signature of the old binary format (OLE compound document), then filler.
    open(path, "wb").write(bytes.fromhex("D0CF11E0A1B11AE1") + b"\x00" * 504 + "Workbook".encode("utf-16le") + b"\x00" * 512)


def encrypted(path):
    # An OLE compound document that holds an EncryptedPackage stream, which is how Excel stores a password.
    open(path, "wb").write(bytes.fromhex("D0CF11E0A1B11AE1") + b"\x00" * 504 + "EncryptedPackage".encode("utf-16le") + b"\x00" * 512 + "EncryptionInfo".encode("utf-16le"))


def large(path, rows=600_000, cols=20):
    rng = random.Random(7)
    wb = xlsxwriter.Workbook(path, {"constant_memory": True})
    ws = wb.add_worksheet("Big")
    money = wb.add_format({"num_format": "#,##0.00"})
    date = wb.add_format({"num_format": "yyyy-mm-dd"})
    for c in range(cols):
        ws.write(0, c, f"col{c + 1:02d}")
    cats = ["North", "South", "East", "West", "Central"]
    for r in range(1, rows + 1):
        ws.write_number(r, 0, r)
        ws.write_string(r, 1, rng.choice(cats))
        ws.write_number(r, 2, round(rng.uniform(0, 5000), 2), money)
        ws.write_datetime(r, 3, datetime.datetime.combine(BASE + datetime.timedelta(days=rng.randint(0, 900)), datetime.time()), date)
        ws.write_string(r, 4, f"{rng.randint(0, 99999):05d}")
        for c in range(5, cols):
            if c % 3 == 0:
                ws.write_string(r, c, f"text{rng.randint(0, 9999)}")
            else:
                ws.write_number(r, c, rng.randint(0, 1000))
    wb.close()


if __name__ == "__main__":
    if "--large" in sys.argv:
        os.makedirs(BIG, exist_ok=True)
        target = os.path.join(BIG, "big.xlsx")
        large(target)
        print(f"{target}: {os.path.getsize(target) / 1e6:.1f} MB")
    else:
        os.makedirs(OUT, exist_ok=True)
        quirks(os.path.join(OUT, "quirks.xlsx"))
        plain(os.path.join(OUT, "plain.xlsx"))
        dates1904(os.path.join(OUT, "dates1904.xlsx"))
        wide(os.path.join(OUT, "wide.xlsx"))
        titles(os.path.join(OUT, "titles.xlsx"))
        formats(os.path.join(OUT, "formats.xlsx"))
        mixed(os.path.join(OUT, "mixed.xlsx"))
        damaged(os.path.join(OUT, "quirks.xlsx"), os.path.join(OUT, "damaged.xlsx"))
        legacy(os.path.join(OUT, "legacy.xls"))
        encrypted(os.path.join(OUT, "encrypted.xlsx"))
        for name in sorted(os.listdir(OUT)):
            print(f"{name}: {os.path.getsize(os.path.join(OUT, name))} bytes")
