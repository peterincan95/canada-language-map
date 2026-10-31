"""Pivot StatCan 2021 Census tables 98-10-0193-01 / 98-10-0194-01 to wide format.

Keeps Gender = Total, Age = Total and First official language spoken = Total,
then writes one row per geography and one column per "language spoken most
often at home" category (all 331, including subtotals such as
"Indigenous languages").

Streams the CSV straight out of the downloaded zip, so the 8-11 GB files are
never extracted to disk.

Usage:
    python -I scripts/pivot_home_language.py data/raw/98100193-eng.zip data/processed
"""

import csv
import io
import sys
import zipfile
from collections import Counter
from pathlib import Path

GEO_LEVELS = {
    "A0000": "Canada",
    "A0002": "Province/territory",
    "A0003": "Census division",
    "A0005": "Census subdivision",
    "S0503": "CMA",
    "S0504": "CA",
    "S0507": "Census tract",
}


def read_language_members(zf, table_id):
    """Return [(member_id, name, parent_id)] for the language dimension (ID 4)."""
    with zf.open(f"{table_id}_MetaData.csv") as f:
        text = io.TextIOWrapper(f, encoding="utf-8-sig")
        members = []
        in_members = False
        for row in csv.reader(text):
            if row[:2] == ["Dimension ID", "Member Name"]:
                in_members = True
                continue
            if in_members and not row:
                break
            if in_members and row[0] == "4":
                members.append((int(row[3]), row[1], int(row[4]) if row[4] else None))
    return members


def depth(member_id, parents):
    d = 0
    while parents.get(member_id) is not None:
        member_id = parents[member_id]
        d += 1
    return d


def main(zip_path, out_dir):
    zip_path, out_dir = Path(zip_path), Path(out_dir)
    table_id = zip_path.name.split("-")[0]
    out_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(zip_path) as zf:
        members = read_language_members(zf, table_id)
        parents = {m: p for m, _, p in members}
        has_children = {p for p in parents.values() if p is not None}
        names = [n for _, n, _ in members]
        dupes = {n for n, c in Counter(names).items() if c > 1}
        # Disambiguate any repeated member names with their member ID
        columns = {m: (f"{n} [{m}]" if n in dupes else n) for m, n, _ in members}

        with open(out_dir / f"{table_id}_languages.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["member_id", "column_name", "parent_member_id", "depth", "is_leaf"])
            for m, _, p in members:
                w.writerow([m, columns[m], p or "", depth(m, parents), m not in has_children])

        geos = {}  # DGUID -> {"GEO": ..., member_id: value}
        symbols = Counter()
        with zf.open(f"{table_id}.csv") as f:
            reader = csv.reader(io.TextIOWrapper(f, encoding="utf-8-sig"))
            header = next(reader)
            i_geo, i_dguid = header.index("GEO"), header.index("DGUID")
            i_gender, i_age = header.index("Gender (3)"), header.index("Age (15A)")
            i_coord = header.index("Coordinate")
            i_total = i_coord + 1  # First official language spoken: Total
            short_rows = []
            for row in reader:
                if len(row) < len(header):
                    short_rows.append(row)
                    continue
                if row[i_gender] != "Total - Gender" or row[i_age] != "Total - Age":
                    continue
                lang_id = int(row[i_coord].split(".")[3])
                geo = geos.setdefault(row[i_dguid], {"GEO": row[i_geo]})
                value, symbol = row[i_total], row[i_total + 1]
                if symbol:
                    symbols[symbol] += 1
                geo[lang_id] = value

    member_ids = [m for m, _, _ in members]
    out_csv = out_dir / f"{table_id}_home_language_wide.csv"
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["DGUID", "geo_level", "GEO"] + [columns[m] for m in member_ids])
        for dguid, geo in geos.items():
            level = GEO_LEVELS.get(dguid[4:9], dguid[4:9])
            w.writerow([dguid, level, geo["GEO"]] + [geo.get(m, "") for m in member_ids])

    levels = Counter(GEO_LEVELS.get(d[4:9], d[4:9]) for d in geos)
    print(f"{out_csv}: {len(geos)} geographies x {len(member_ids)} languages")
    print("  geo levels:", dict(levels))
    print("  symbols on kept values:", dict(symbols) or "none")
    print(f"  skipped short rows: {len(short_rows)}", short_rows[:5])


if __name__ == "__main__":
    main(*sys.argv[1:3])
