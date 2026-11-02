"""Write web/languages.json: every individual home language, in StatCan's order.

"Individual" means a leaf of the language hierarchy under "Single responses"
(English, French and each non-official language); subtotals such as
"Indigenous languages" and the "Multiple responses" combinations are left out.
The app uses this list to build the language table for a clicked geography,
matching each name to the layer field whose alias is that name.

Usage:
    python -I scripts/export_languages_json.py
"""

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HIERARCHY = ROOT / "data" / "processed" / "98100193_languages_hierarchy.csv"
OUT = ROOT / "web" / "languages.json"

with open(HIERARCHY, newline="", encoding="utf-8-sig") as f:
    languages = [row["column_name"] for row in csv.DictReader(f) if row["Depth 1"] == "Single responses"]

OUT.write_text(json.dumps(languages, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"{OUT}: {len(languages)} languages")
