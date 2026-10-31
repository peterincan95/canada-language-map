"""ArcGIS Pro Field Calculator code block: predominant non-official home language.

Rather than reading the ~300 joined language fields (whose names ArcGIS
rewrites, e.g. "Cree, n.o.s." -> "Cree__n_o_s_"), this looks each feature up
by DGUID in the wide CSV produced by pivot_home_language.py.

How to use (Calculate Field):
    Field name:   PredomLang   (new Text field, length 100)
    Expression type: Python 3
    Expression:   predominant(!DGUID!)
    Code block:   paste everything below the line "# --- code block ---"
                  and set WIDE_CSV / LANG_CSV to the table that matches the layer

Speaker count of the predominant language (same code block):
    Field name:   PredomCnt    (new Long field)
    Expression:   predominant_count(!DGUID!)
    For a tie this is the count shared by the tied languages.

Rules:
  * Only languages with is_leaf = True in the languages table.
  * English and French are excluded.
  * The "Multiple responses" categories (e.g. "English and non-official
    language(s)") are also leaves but are not single languages, so they are
    excluded too; set EXCLUDE_MULTIPLE = False to keep them.
  * Ties pick one of the tied languages at random, seeded by DGUID so the
    same language comes back every time the field is recalculated.
  * Suppressed geographies (no data), or no non-official speakers at all,
    return None (null).
"""

# --- code block ---
import csv
import random

WIDE_CSV = r"C:\Users\pet14110\ClaudeProjects\canada-language-map\data\processed\98100193_home_language_wide.csv"
LANG_CSV = r"C:\Users\pet14110\ClaudeProjects\canada-language-map\data\processed\98100193_languages.csv"
EXCLUDE = {"English", "French"}
EXCLUDE_MULTIPLE = True
MULTIPLE_RESPONSES_ID = "326"

_lookup = None


def _load():
    with open(LANG_CSV, newline="", encoding="utf-8") as f:
        langs = [
            r["column_name"]
            for r in csv.DictReader(f)
            if r["is_leaf"] == "True"
            and r["column_name"] not in EXCLUDE
            and not (EXCLUDE_MULTIPLE and r["parent_member_id"] == MULTIPLE_RESPONSES_ID)
        ]
    lookup = {}
    with open(WIDE_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            counts = {lang: float(row[lang]) for lang in langs if row[lang] != ""}
            top = max(counts.values(), default=0)
            if top > 0:
                tied = [l for l, c in counts.items() if c == top]
                # Seeded by DGUID so a rerun picks the same language
                name = random.Random(row["DGUID"]).choice(tied)
                lookup[row["DGUID"]] = (name, int(top))
    return lookup


def _get(dguid):
    global _lookup
    if _lookup is None:
        _lookup = _load()
    return _lookup.get(dguid, (None, None))


def predominant(dguid):
    return _get(dguid)[0]


def predominant_count(dguid):
    return _get(dguid)[1]
