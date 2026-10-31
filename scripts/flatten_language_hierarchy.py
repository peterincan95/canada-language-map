"""Flatten a languages table (from pivot_home_language.py) into one column per depth.

Each row is one leaf language category (is_leaf = True); subtotal categories
appear only as ancestors. Column "Depth 0" holds its depth-0 ancestor,
"Depth 1" its depth-1 ancestor, and so on down to the language itself;
deeper columns are left blank. member_id, column_name and is_leaf are
kept at the end so the table can still be joined or filtered.

Usage:
    python -I scripts/flatten_language_hierarchy.py data/processed/98100193_languages.csv
"""

import csv
import sys
from pathlib import Path


def main(lang_csv):
    lang_csv = Path(lang_csv)
    with open(lang_csv, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    by_id = {r["member_id"]: r for r in rows}

    def path(r):
        names = []
        while r:
            names.append(r["column_name"])
            r = by_id.get(r["parent_member_id"])
        return names[::-1]

    leaves = [r for r in rows if r["is_leaf"] == "True"]
    max_depth = max(int(r["depth"]) for r in leaves)
    depth_cols = [f"Depth {d}" for d in range(max_depth + 1)]

    out_csv = lang_csv.with_name(lang_csv.stem + "_hierarchy.csv")
    with open(out_csv, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(depth_cols + ["member_id", "column_name", "is_leaf"])
        for r in leaves:
            p = path(r)
            w.writerow(p + [""] * (len(depth_cols) - len(p)) + [r["member_id"], r["column_name"], r["is_leaf"]])
    print(f"{out_csv}: {len(leaves)} rows, {len(depth_cols)} depth columns")


if __name__ == "__main__":
    main(sys.argv[1])
