# Renders pages of a PDF as JPEGs for the model that reads results filings
# (lib/valuation/read-filing.ts): whole pages, turned the right way up, the
# long side 1600 px. One JSON line a page on stdout.
#   python -I scripts/render-pages.py FILE.pdf 1,3,4
import base64
import json
import sys

import pymupdf

LONG_SIDE = 1600

path, pages = sys.argv[1], [int(p) for p in sys.argv[2].split(",") if p]
doc = pymupdf.open(path)
for n in pages:
    if n < 1 or n > doc.page_count:
        continue
    page = doc[n - 1]
    zoom = LONG_SIDE / max(page.rect.width, page.rect.height)
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), colorspace=pymupdf.csRGB, alpha=False)
    jpg = pix.tobytes("jpg", jpg_quality=85)
    sys.stdout.write(json.dumps({"page": n, "jpg": base64.b64encode(jpg).decode()}) + "\n")
