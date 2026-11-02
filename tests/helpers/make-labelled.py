"""Writes a .sav and a .dta with several labelled variables (several sets, a long name, a label shared by two variables) and
prints where they are and the labels pyreadstat reads back from the .sav (used by tests/unit/stat-labels.test.ts)."""
import json
import os
import sys
import pandas as pd
import pyreadstat

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
n = 30
df = pd.DataFrame({
    "mode_of_travel_to_work": [1 + i % 3 for i in range(n)],
    "purpose": [10 * (1 + i % 4) for i in range(n)],
    "licence": [i % 2 for i in range(n)],
    "has_car": [(i + 1) % 2 for i in range(n)],
    "region": [["N", "S", "E"][i % 3] for i in range(n)],
    "age": [20 + i for i in range(n)],
})
yes_no = {0: "No", 1: "Yes"}
labels = {
    "mode_of_travel_to_work": {1: "Car", 2: "Bus", 3: "Café é"},
    "purpose": {10: "Work", 20: "School", 30: "Shop", 40: "Other"},
    "licence": yes_no,
    "has_car": yes_no,
}
sav = os.path.join(out, "labelled.sav")
dta = os.path.join(out, "labelled.dta")
pyreadstat.write_sav(df, sav, variable_value_labels=labels)
pyreadstat.write_dta(df, dta, variable_value_labels=labels)
_, meta = pyreadstat.read_sav(sav)
truth = {c: {str(int(k)): v for k, v in m.items()} for c, m in meta.variable_value_labels.items()}
print(json.dumps({"sav": sav, "dta": dta, "labels": truth}))
