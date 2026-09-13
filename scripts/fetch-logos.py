"""Company logos and the symbol list, from public sources.

Does: pulls the PSX symbol list from dps.psx.com.pk/symbols, reads each
company's website off its DPS profile page, fetches that site's icon from
DuckDuckGo's icon service (Google's as the fallback), and writes
public/logos/<SYMBOL>.png (64 px) plus lib/psx-symbols.json (symbol, name,
sector, website, logo flag).

Run: python scripts/fetch-logos.py [--only SYM,SYM] [--limit N]
DPS drops callers that burst, so the profile fetches are spaced out.
"""
import io, json, os, re, sys, time, hashlib
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "logos")
META = os.path.join(ROOT, "lib", "psx-symbols.json")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36"
PAUSE = 0.6
SIZE = 64

def get(url, timeout=20):
    req = Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urlopen(req, timeout=timeout) as r:
        return r.read(), r.headers.get("Content-Type", "")

def symbols():
    raw, _ = get("https://dps.psx.com.pk/symbols")
    rows = json.loads(raw)
    out = []
    for r in rows:
        if r.get("isDebt"):
            continue
        sym = r["symbol"].strip().upper()
        if not re.fullmatch(r"[A-Z0-9]{2,10}", sym):
            continue
        out.append({"symbol": sym, "name": r.get("name", "").strip(), "sector": r.get("sectorName", "").strip(), "etf": bool(r.get("isETF"))})
    return out

SITE_RE = re.compile(r'WEBSITE</div><p>\s*<a href="([^"]+)"', re.I)

def website(sym):
    try:
        html, _ = get(f"https://dps.psx.com.pk/company/{sym}")
    except (HTTPError, URLError, OSError):
        return None
    m = SITE_RE.search(html.decode("utf-8", "ignore"))
    if not m:
        return None
    url = m.group(1).strip()
    host = re.sub(r"^https?://", "", url).split("/")[0].lower()
    host = host.split("?")[0].strip(".")
    return host or None

def icon_bytes(host):
    for url in (f"https://icons.duckduckgo.com/ip3/{host}.ico", f"https://www.google.com/s2/favicons?domain={host}&sz=128"):
        try:
            data, ctype = get(url, timeout=15)
        except (HTTPError, URLError, OSError):
            continue
        if not data or len(data) < 200:
            continue
        try:
            im = Image.open(io.BytesIO(data))
            im.load()
        except Exception:
            continue
        if min(im.size) < 24:
            continue
        # DuckDuckGo hands back a plain globe for unknown sites; skip anything
        # that is a single flat colour.
        small = im.convert("RGBA").resize((16, 16))
        colours = {px for px in list(small.getdata()) if px[3] > 0}
        if len(colours) < 4:
            continue
        return im
    return None

LINK_RE = re.compile(r'<link[^>]+rel="([^"]*icon[^"]*)"[^>]*href="([^"]+)"', re.I)
LINK_RE2 = re.compile(r'<link[^>]+href="([^"]+)"[^>]*rel="([^"]*icon[^"]*)"', re.I)
OG_RE = re.compile(r'property="og:image" content="([^"]+)"', re.I)

def open_image(data):
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
        return im if min(im.size) >= 24 else None
    except Exception:
        return None

def site_icon(host):
    """The site's own apple-touch-icon or favicon, largest first."""
    for scheme in ("https", "http"):
        try:
            html, _ = get(f"{scheme}://{host}/", timeout=15)
        except (HTTPError, URLError, OSError, ValueError):
            continue
        text = html.decode("utf-8", "ignore")
        links = [(rel, href) for rel, href in LINK_RE.findall(text)] + [(rel, href) for href, rel in LINK_RE2.findall(text)]
        links.sort(key=lambda t: (0 if "apple" in t[0].lower() else 1))
        best = None
        for _rel, href in links[:4] + [("icon", "/apple-touch-icon.png"), ("icon", "/favicon.ico")]:
            if href.startswith("//"):
                url = "https:" + href
            elif href.startswith("http"):
                url = href
            else:
                url = f"{scheme}://{host}/" + href.lstrip("/")
            try:
                data, _ = get(url, timeout=15)
            except (HTTPError, URLError, OSError, ValueError):
                continue
            im = open_image(data)
            if im is not None and (best is None or min(im.size) > min(best.size)):
                best = im
                if min(im.size) >= 96:
                    break
        if best is not None:
            return best
    return None

def sarmaaya_logo(sym):
    """The og:image on Sarmaaya's stock page, which is the company logo."""
    try:
        html, _ = get(f"https://sarmaaya.pk/stocks/{sym}", timeout=25)
    except (HTTPError, URLError, OSError, ValueError):
        return None
    m = OG_RE.search(html.decode("utf-8", "ignore"))
    if not m or "company_logos" not in m.group(1):
        return None
    url = m.group(1)
    try:
        data, ctype = get(url, timeout=15)
    except (HTTPError, URLError, OSError, ValueError):
        return None
    if url.lower().endswith(".svg") or "svg" in ctype:
        return ("svg", data) if b"<svg" in data[:400].lower() else None
    return open_image(data)

def save(sym, im):
    if isinstance(im, tuple):
        open(os.path.join(OUT, f"{sym}.svg"), "wb").write(im[1])
        return
    im = im.convert("RGBA")
    if hasattr(im, "n_frames") and im.n_frames > 1:
        pass
    w, h = im.size
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - w) // 2, (side - h) // 2))
    canvas = canvas.resize((SIZE, SIZE), Image.LANCZOS)
    canvas.save(os.path.join(OUT, f"{sym}.png"), optimize=True)

def write_list():
    """lib/logo-list.ts: the symbols that have a logo file, for the mark."""
    files = sorted(f for f in os.listdir(OUT) if f.endswith((".png", ".svg")))
    table = {}
    for f in files:
        sym, ext = f.rsplit(".", 1)
        if sym not in table or ext == "png":
            table[sym] = ext
    header = "// Generated by scripts/fetch-logos.py. Symbols with a file in public/logos, and its extension."
    body = header + chr(10) + "export const LOGOS: Record<string, string> = " + json.dumps(table, sort_keys=True) + ";" + chr(10)
    open(os.path.join(ROOT, "lib", "logo-list.ts"), "w", encoding="utf-8").write(body)

def main():
    only = None
    limit = None
    args = sys.argv[1:]
    if "--only" in args:
        only = set(args[args.index("--only") + 1].upper().split(","))
    if "--limit" in args:
        limit = int(args[args.index("--limit") + 1])
    os.makedirs(OUT, exist_ok=True)
    rows = symbols()
    print(f"{len(rows)} symbols from DPS", flush=True)
    existing = {}
    if os.path.exists(META):
        existing = {r["symbol"]: r for r in json.load(open(META, encoding="utf-8"))}
    from concurrent.futures import ThreadPoolExecutor
    import threading
    dps_lock = threading.Lock()
    todo = []
    for r in rows:
        sym = r["symbol"]
        prev = existing.get(sym)
        have_logo = os.path.exists(os.path.join(OUT, f"{sym}.png")) or os.path.exists(os.path.join(OUT, f"{sym}.svg"))
        r["website"] = prev.get("website", "") if prev else ""
        r["logo"] = have_logo
        if only and sym not in only:
            continue
        if prev and prev.get("website") and have_logo and not only:
            continue
        todo.append(r)
    if limit is not None:
        todo = todo[:limit]
    print(f"{len(todo)} to fetch", flush=True)

    def work(r):
        sym = r["symbol"]
        host = r.get("website") or None
        if not host:
            with dps_lock:
                host = website(sym)
                time.sleep(PAUSE)
        r["website"] = host or ""
        im = icon_bytes(host) if host else None
        if im is None and host:
            im = site_icon(host)
        if im is None:
            im = sarmaaya_logo(sym)
        if im is not None:
            try:
                save(sym, im)
                r["logo"] = True
            except Exception as e:
                print(f"  {sym}: save failed {e}", flush=True)
        print(f"  {sym:8} {host or '-':40} {'logo' if r['logo'] else '-'}", flush=True)
        return r

    done = 0
    with ThreadPoolExecutor(max_workers=6) as pool:
        for _ in pool.map(work, todo):
            done += 1
            if done % 25 == 0:
                json.dump(rows, open(META, "w", encoding="utf-8"), ensure_ascii=False)
                write_list()
    json.dump(rows, open(META, "w", encoding="utf-8"), ensure_ascii=False)
    write_list()
    n = sum(1 for r in rows if r.get("logo"))
    print(f"done: {n} logos of {len(rows)} symbols", flush=True)

if __name__ == "__main__":
    main()
