// specs/017: the self-hosted stats_duck extension (DuckDB community repository, its read_stat function) loads in the built app under the strict
// content policy and reads SPSS and Stata files, with no policy violation and no request outside the site.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));

for (const name of ["survey.sav", "survey.dta"]) {
  const file = join(HERE, "../fixtures/stat", name);
  test.describe(name, () => {
    test.skip(!existsSync(file), "run scripts/make-stat-fixtures.py first");

    test("stats_duck loads from the site and read_stat reads and reads the file", async ({
      page,
    }) => {
      const requests: string[] = [];
      page.on("request", (r) => requests.push(r.url()));
      await page.goto("/APP-synthetic-data-generator/spike.html");
      await page.setInputFiles("#files", file);
      const result = await page.evaluate(() =>
        (
          window as never as {
            spike: { statSmoke(e: string, r: string, b: boolean): Promise<unknown> };
          }
        ).spike.statSmoke("stats_duck", "read_stat", false),
      );
      expect(result).toMatchObject({ loaded: 1, rows: 120, violations: [] });
      expect((result as { columns: string[] }).columns).toEqual([
        "hh_id:VARCHAR",
        "age:DOUBLE",
        "income:DOUBLE",
        "mode:DOUBLE",
        "has_pass:DOUBLE",
        "trip_date:TIMESTAMP",
      ]);
      const origin = new URL(page.url()).origin;
      expect(
        requests.filter(
          (u) => !u.startsWith(origin) && !u.startsWith("blob:") && !u.startsWith("data:"),
        ),
      ).toEqual([]);
    });
  });
}
