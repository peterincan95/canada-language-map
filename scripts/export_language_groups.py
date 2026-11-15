"""Write web/language-groups.json: the parent language group of each colour family.

The colour editor and the map's legend show the families in colors.json
under their parent group in StatCan's language hierarchy, e.g. "Germanic
languages" and "Slavic languages" under "Indo-European languages", and every
Indigenous family under "Indigenous languages". A family's group is the top
level above it (e.g. Indo-European, not Balto-Slavic), found through its
languages' paths. Families with no larger group of their own (e.g.
"Austronesian languages", "Korean") or whose languages span several groups
("Other languages") are left out, and are shown last. Rerun after adding a
family to colors.json.

Usage:
    python -I scripts/export_language_groups.py
"""

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HIERARCHY = ROOT / "data" / "processed" / "98100193_languages_hierarchy.csv"
COLORS = ROOT / "web" / "colors.json"
OUT = ROOT / "web" / "language-groups.json"

# Hierarchy levels above the language groups themselves
NOT_GROUPS = {"Non-official languages", "Non-Indigenous languages"}
INDIGENOUS = "Indigenous languages"

with open(HIERARCHY, newline="", encoding="utf-8-sig") as f:
    paths = {
        row["column_name"]: [row[f"Depth {i}"] for i in range(2, 9) if row[f"Depth {i}"]]
        for row in csv.DictReader(f)
        if row["Depth 1"] == "Single responses"
    }

palette = json.loads(COLORS.read_text(encoding="utf-8"))


def parent_group(family, path):
    """The top-level group above family on a language's path (the level just
    below "Non-Indigenous languages"), or None if the family is that level."""
    if INDIGENOUS in path:
        return INDIGENOUS
    groups = [level for level in path if level not in NOT_GROUPS]
    # The family is a level on the path (e.g. "Germanic languages"), or is the
    # language itself (e.g. "Greek")
    if family not in groups or groups.index(family) == 0:
        return None
    return groups[0]


groups = {}
for family in palette["families"]:
    found = {
        parent_group(family, paths.get(name, []))
        for name, language in palette["languages"].items()
        if language["family"] == family
    }
    if len(found) == 1 and None not in found:
        groups[family] = found.pop()

OUT.write_text(json.dumps(dict(sorted(groups.items())), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"{OUT}: {len(groups)} of {len(palette['families'])} families grouped")
for family, group in sorted(groups.items(), key=lambda kv: (kv[1], kv[0])):
    print(f"  {group} > {family}")
