"""Local dev server for the web app.

Serves web/ like `python -m http.server`, plus one extra: editor.html can
PUT a new colors.json, which is validated and written to web/colors.json.

Listens on 127.0.0.1 only, since the save endpoint has no authentication.

Usage:
    python -I scripts/dev_server.py [port]      (default 8081)
"""

import http.server
import json
import os
import re
import sys
from functools import partial
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
COLORS_FILE = WEB_DIR / "colors.json"
HEX = re.compile(r"#[0-9A-Fa-f]{6}")
MAX_BYTES = 1_000_000


def validate_palette(palette):
    """Raise ValueError unless palette matches the colors.json layout."""
    if not isinstance(palette, dict) or not {"families", "languages"} <= set(palette) <= {
        "families",
        "languages",
        "composition",
    }:
        raise ValueError('expected an object with "families", "languages" and optionally "composition"')
    composition = palette.get("composition", {})
    if not isinstance(composition, dict):
        raise ValueError('"composition" must be an object')
    for name, color in composition.items():
        if not isinstance(color, str) or not HEX.fullmatch(color):
            raise ValueError(f"composition {name!r}: colour must be #RRGGBB")
    families, languages = palette["families"], palette["languages"]
    if not isinstance(families, dict) or not isinstance(languages, dict):
        raise ValueError('"families" and "languages" must be objects')
    for name, color in families.items():
        if not isinstance(color, str) or not HEX.fullmatch(color):
            raise ValueError(f"family {name!r}: colour must be #RRGGBB")
    for name, lang in languages.items():
        if not isinstance(lang, dict) or not set(lang) <= {"family", "color"}:
            raise ValueError(f"language {name!r}: only \"family\" and \"color\" are allowed")
        if lang.get("family") not in families:
            raise ValueError(f"language {name!r}: unknown family {lang.get('family')!r}")
        if "color" in lang and (not isinstance(lang["color"], str) or not HEX.fullmatch(lang["color"])):
            raise ValueError(f"language {name!r}: colour must be #RRGGBB")


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Always revalidate, so edited files show up on a normal refresh
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_PUT(self):
        if self.path != "/colors.json":
            self.send_error(405, "Only colors.json can be saved")
            return
        length = int(self.headers.get("Content-Length", 0))
        if not 0 < length <= MAX_BYTES:
            self.send_error(413 if length else 411)
            return
        try:
            palette = json.loads(self.rfile.read(length))
            validate_palette(palette)
        except ValueError as err:  # includes JSONDecodeError
            self.send_error(400, str(err))
            return

        # Write to a temp file first so a failed write never truncates colors.json
        tmp = COLORS_FILE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(palette, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(tmp, COLORS_FILE)
        self.send_response(204)
        self.end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8081
    handler = partial(Handler, directory=str(WEB_DIR))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"Serving {WEB_DIR} at http://localhost:{port}  (editor: /editor.html)")
        server.serve_forever()


if __name__ == "__main__":
    main()
