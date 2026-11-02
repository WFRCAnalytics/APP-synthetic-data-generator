"""Writes small SPSS and Stata fixtures (made-up values, no real data) into tests/fixtures/stat."""
import os
import pandas as pd
import pyreadstat

out = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "stat")
os.makedirs(out, exist_ok=True)
rows = 120
df = pd.DataFrame({
    "hh_id": [f"H{1000 + i}" for i in range(rows)],
    "age": [18 + (i * 7) % 70 for i in range(rows)],
    "income": [round(20000 + (i * 977) % 90000 + 0.5, 2) for i in range(rows)],
    "mode": [1 + i % 4 for i in range(rows)],
    "has_pass": [i % 2 for i in range(rows)],
    "trip_date": pd.to_datetime("2024-01-01") + pd.to_timedelta([i % 200 for i in range(rows)], unit="D"),
})
df.loc[5, "income"] = None
labels = {"mode": {1: "Car", 2: "Bus", 3: "Walk", 4: "Bike"}}
pyreadstat.write_sav(df, os.path.join(out, "survey.sav"), column_labels=["Household", "Age", "Income", "Mode", "Pass", "Date"], variable_value_labels=labels)
pyreadstat.write_dta(df, os.path.join(out, "survey.dta"), column_labels=["Household", "Age", "Income", "Mode", "Pass", "Date"], variable_value_labels=labels)
# SAS transport (XPT version 8, which allows names longer than eight characters). The .sas7bdat fixture is made from the .sav in a
# browser with the stats_duck writer (no Python library writes that format); see tests/e2e/make-sas-fixture.md.
pyreadstat.write_xport(df, os.path.join(out, "survey.xpt"), file_format_version=8, column_labels=["Household", "Age", "Income", "Mode", "Pass", "Date"])
print("ok")
