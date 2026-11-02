"""Builds the JSON fixtures under tests/fixtures/json (specs/007 T002).

    python scripts/make-json-fixtures.py [out_dir]
    python scripts/make-json-fixtures.py --large     # also writes ~500 MB of expanded data to .fixtures/json/

Plain Python, no packages. The small outputs are committed. Real-looking values all carry the marker
PRIVATE-MARKER, and nested values and nested key names carry NESTED-MARKER, so tests can prove none of
them reaches the page, the spec or the output.
"""

import json
import os
import random
import sys

HERE = os.path.dirname(__file__)
args = [a for a in sys.argv[1:] if not a.startswith("--")]
OUT = args[0] if args else os.path.join(HERE, "..", "tests", "fixtures", "json")
os.makedirs(OUT, exist_ok=True)
N = 400
MARK = "PRIVATE-MARKER"
NESTED = "NESTED-MARKER"
modes = ["car", "bus", "walk", "bike", "rail"]
rng = random.Random(7)


def survey_rows(n=N):
    rows = []
    for i in range(n):
        rows.append(
            {
                "hh_id": f"HH-{1000 + (i % 80)}",
                "person_no": 1 + (i % 5),
                "age": 18 + ((i * 7) % 70),
                "income": round(20000 + rng.random() * 90000, 2),
                "mode": modes[i % 5],
                "has_pass": i % 4 == 0,
                "trip_date": f"2023-05-{1 + (i % 28):02d}",
                "name": f"{MARK} Person {i}",
            }
        )
    return rows


def write(name, text, binary=None):
    path = os.path.join(OUT, name)
    with open(path, "wb") as f:
        f.write(binary if binary is not None else text.encode("utf-8"))


def array_text(rows, indent=None, newline="\n", trailing=True):
    text = json.dumps(rows, indent=indent, ensure_ascii=False)
    if newline != "\n":
        text = text.replace("\n", newline)
    return text + (newline if trailing else "")


def lines_text(rows, newline="\n", trailing=True):
    text = newline.join(json.dumps(r, ensure_ascii=False) for r in rows)
    return text + (newline if trailing else "")


rows = survey_rows()
write("survey.json", array_text(rows, indent=2))
write("survey.ndjson", lines_text(rows))
write("survey.jsonl", lines_text(rows[:50]))
write("pretty2.json", array_text(rows[:60], indent=2))
write("pretty4.json", array_text(rows[:60], indent=4))
write("tab.json", array_text(rows[:60], indent="\t"))
write("compact.json", array_text(rows[:60], trailing=False))
write("survey_crlf_bom.json", None, binary=b"\xef\xbb\xbf" + array_text(rows[:60], indent=2, newline="\r\n").encode("utf-8"))

# One key null in some records, one absent from some, one both.
nm = []
for i in range(300):
    r = {"id": f"R{i}", "score": i % 17, "nick": f"{MARK} nick {i}"}
    if i % 5 == 0:
        r["score"] = None
    if i % 7 == 0:
        del r["nick"]
    elif i % 11 == 0:
        r["nick"] = None
    if i % 3 == 0:
        r["extra"] = i
    nm.append(r)
write("nulls_missing.json", array_text(nm, indent=2))

# Numbers and text in one key.
mixed = [{"id": i, "code": (i if i % 2 else f"{MARK}-{i}"), "ok": i % 2 == 0} for i in range(100)]
write("mixed.json", array_text(mixed, indent=2))

# Nested keys and markers in values and nested key names.
nested = [
    {
        "id": i,
        "label": f"{MARK} label {i}",
        "detail": {f"{NESTED}-key": f"{NESTED} value {i}", "n": i},
        "tags": [f"{NESTED} tag {i}", "x"],
    }
    for i in range(80)
]
write("nested.json", array_text(nested, indent=2))
write("markers.json", array_text([{"id": f"{MARK}-{i}", "n": i, "note": f"{MARK} note {i}", "inner": {f"{NESTED}-k": f"{NESTED}-v"}, "list": [f"{NESTED}-l"]} for i in range(120)], indent=2))

# Numbers written several ways.
write("numbers.json", '[{"a": 1.50, "b": 1e5, "c": 12345678901234567890, "d": -0.25, "e": 7}, {"a": 2.25, "b": 2.5E-3, "c": 1, "d": 3, "e": 8}]\n')

# Files that must be refused.
write("damaged.json", '[{"id": "SECRET-DAMAGED", "x": }]')
write("scalar.json", '{"id": "SECRET-SCALAR"}')
write("items.json", '[1, 2, {"a": "SECRET-ITEM"}]')
write("dup.json", '[{"a": 1, "a": "SECRET-DUP"}]')
write("empty.json", "[]")
write("blank.json", "")
write("geojson.json", '{"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"n": "SECRET-GEO"}}]}')
write("comments.json", '[\n  // SECRET-COMMENT\n  {"a": 1}\n]')
write("not_json.json", "id,name\n1,SECRET-CSV\n")

if "--large" in sys.argv:
    big_dir = os.path.join(HERE, "..", ".fixtures", "json")
    os.makedirs(big_dir, exist_ok=True)
    path = os.path.join(big_dir, "large.ndjson")
    target = 500 * 1024 * 1024
    written = 0
    i = 0
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        while written < target:
            line = json.dumps({"id": f"H{i}", "v": i % 997, "x": round(rng.random() * 1000, 3), "t": f"text {i % 5000}", "ok": i % 3 == 0}) + "\n"
            f.write(line)
            written += len(line)
            i += 1
    print(f"wrote {path}: {i} records")

print("wrote fixtures to", os.path.abspath(OUT))
