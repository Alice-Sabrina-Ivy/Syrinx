# fetch_fstrain.py — custom voice detector, data step (2026-10-06): the
# `fstrain` negatives (splits.json negatives.fstrain). Freesound HQ previews of
# machine / room recordings found by search-page queries (no API key): the
# benchmark 279-set's 38 query topics + 8 more, never held-out B's topics.
#
# Per query: result pages 1-3 (duration 5-900 s), in result order; skipped:
#   - licence not CC0 / Attribution (NC, Sampling+);
#   - a benchmark Freesound id, an ESC-50 source id, or an FSD50K clip (FSD50K
#     already covers it, or excluded it for a reason that applies here too);
#   - an uploader of a benchmark Freesound preview;
#   - the voice / music keyword rule on title, description and tags (read
#     from the sound page, which also gives the exact licence URL);
# at most 20 kept per query, each sound once. Split by uploader (splits.json).
# Writes build/vad-train/dl/fstrain/index.json; audio in dl/fstrain/audio/.
#
#   NOTCHVD_ROOT=<checkout>/build/notchvd python scripts/voice-detector/custom/fetch_fstrain.py [--per=20] [--pages=3]
import html
import json
import os
import re
import time

import requests

from common import DL, META, SPLITS, KEYWORDS, args, benchmark_freesound, fnv1a, norm_cc

A = args()
PER = int(A.get("per", "20"))
PAGES = int(A.get("pages", "3"))
OUT = os.path.join(DL, "fstrain")
UA = {"User-Agent": "Mozilla/5.0 (research data fetch; Syrinx voice-detector)"}
S = requests.Session()
S.headers.update(UA)


def get(url, dest, min_bytes=1000, pause=1.5):
    if os.path.exists(dest) and os.path.getsize(dest) >= min_bytes:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    for k in range(8):
        try:
            r = S.get(url, timeout=120)
            if r.status_code == 200 and len(r.content) >= min_bytes:
                open(dest + ".tmp", "wb").write(r.content)
                os.replace(dest + ".tmp", dest)
                time.sleep(pause)
                return dest
            if r.status_code == 404:
                raise FileNotFoundError(url)
            time.sleep(20 * (k + 1))
        except requests.RequestException:
            time.sleep(20 * (k + 1))
    raise IOError(f"{url}: retries exhausted")


def search(q, page):
    url = "https://freesound.org/search/?" + requests.compat.urlencode({"q": q, "f": "duration:[5 TO 900]", "page": page})
    p = get(url, os.path.join(OUT, "search", re.sub(r"\W+", "_", q) + f"__p{page}.html"))
    h = open(p, encoding="utf8").read()
    out = []
    for blk in h.split('class="bw-search__result"')[1:]:
        g = lambda pat: (re.search(pat, blk) or [None, None])[1]  # noqa: E731
        sid = g(r'data-sound-id="(\d+)"')
        if not sid:
            continue
        out.append(dict(id=int(sid), user=html.unescape(g(r'data-username="([^"]*)"') or ""),
                        title=html.unescape(g(r'data-title="([^"]*)"') or ""), dur=float(g(r'data-duration="([^"]*)"') or 0),
                        ogg=g(r'data-ogg="([^"]*)"'), license_label=g(r'title="License: ([^"]*)"') or "unknown"))
    return out


def sound_page(r):
    p = get(f"https://freesound.org/people/{r['user']}/sounds/{r['id']}/", os.path.join(OUT, "pages", f"{r['id']}.html"))
    h = open(p, encoding="utf8").read()
    lic = sorted(set(re.findall(r"creativecommons\.org/(?:licenses|publicdomain)/[a-z\-+]+/[\d.]+", h)))
    tags = re.findall(r'href="/browse/tags/([^/"]+)/?"', h)
    m = re.search(r'<div id="soundDescriptionSection">(.*?)</div>', h, re.S)
    desc = html.unescape(re.sub(r"<[^>]+>", " ", m.group(1))).strip() if m else ""
    return lic, tags, desc


def main():
    ids, ups, esc = benchmark_freesound()
    fsd = set()
    for s in ("dev", "eval"):
        fsd |= {int(k) for k in json.load(open(os.path.join(DL, "fsd50k", "FSD50K.metadata", f"{s}_clips_info_FSD50K.json"), encoding="utf8"))}
    fsd_up = {}
    for s in ("dev", "eval"):
        for k, v in json.load(open(os.path.join(DL, "fsd50k", "FSD50K.metadata", f"{s}_clips_info_FSD50K.json"), encoding="utf8")).items():
            fsd_up.setdefault(v["uploader"], set()).add(s)
    idx_path = os.path.join(OUT, "index.json")
    index = json.load(open(idx_path, encoding="utf8")) if os.path.exists(idx_path) else {"kept": [], "skipped": []}
    kept_ids = {r["id"] for r in index["kept"]}
    done_q = {r.get("query") for r in index["skipped"] if r.get("why") == "query done"}
    from concurrent.futures import ThreadPoolExecutor
    pool = ThreadPoolExecutor(3)  # preview downloads (cdn) in the background; page requests stay sequential
    pending = []
    skipped = {(r["id"], r.get("why")) for r in index["skipped"] if "id" in r}
    for q in SPLITS["negatives"]["fstrain"]["queries"]:
        if q in done_q:
            continue
        n = sum(1 for r in index["kept"] if r["query"] == q)
        for page in range(1, PAGES + 1):
            if n >= PER:
                break
            try:
                res = search(q, page)
            except (IOError, FileNotFoundError) as e:
                print("search", q, page, e, flush=True)
                break
            for r in res:
                if n >= PER:
                    break
                why = None
                if r["id"] in kept_ids:
                    continue
                elif r["id"] in ids:
                    why = "benchmark freesound id"
                elif r["id"] in esc:
                    why = "ESC-50 source id"
                elif r["id"] in fsd:
                    why = "in FSD50K"
                elif r["user"] in ups:
                    why = "benchmark uploader"
                elif not r["ogg"]:
                    why = "no preview"
                elif not re.search(r"(?i)creative commons 0|^attribution$|attribution \d", r["license_label"]) or "noncommercial" in r["license_label"].lower():
                    why = f"licence {r['license_label']}"
                elif KEYWORDS.search(r["title"]):
                    why = "keyword (title)"
                if why is None:
                    try:
                        lic, tags, desc = sound_page(r)
                    except (IOError, FileNotFoundError) as e:
                        why = f"sound page: {e}"
                    else:
                        L = [norm_cc(u) for u in lic]
                        if len(L) != 1 or L[0] not in ("CC0 1.0", "CC BY 3.0", "CC BY 4.0"):
                            why = f"licence page {L}"
                        elif KEYWORDS.search(" ".join([desc] + tags)):
                            why = "keyword (description / tags)"
                if why:
                    if (r["id"], why) not in skipped:
                        index["skipped"].append(dict(id=r["id"], user=r["user"], query=q, why=why))
                        skipped.add((r["id"], why))
                    continue
                hq = r["ogg"].replace("-lq.ogg", "-hq.ogg")
                dest = os.path.join(OUT, "audio", os.path.basename(hq))
                pending.append(pool.submit(get, hq, dest, 1000, 0.0))
                up = r["user"]
                split = "val" if "eval" in fsd_up.get(up, ()) else "train" if "dev" in fsd_up.get(up, ()) else ("val" if fnv1a(up) % 10 == 0 else "train")
                index["kept"].append(dict(id=r["id"], user=up, query=q, title=r["title"], dur=r["dur"], licence=L[0],
                                          licence_url="https://" + lic[0] + "/", tags=tags, description=desc[:2000],
                                          url=f"https://freesound.org/people/{up}/sounds/{r['id']}/", preview=hq,
                                          path=os.path.relpath(dest, DL).replace("\\", "/"), split=split))
                kept_ids.add(r["id"])
                n += 1
            json.dump(index, open(idx_path, "w", encoding="utf8"), indent=1, ensure_ascii=False)
        index["skipped"].append(dict(query=q, why="query done", kept=n))
        json.dump(index, open(idx_path, "w", encoding="utf8"), indent=1, ensure_ascii=False)
        print(f"{q}: {n} kept (total {len(index['kept'])})", flush=True)
    for f in pending:
        try:
            f.result()
        except (IOError, FileNotFoundError) as e:
            print("preview download", e, flush=True)
    missing = [r for r in index["kept"] if not os.path.exists(os.path.join(DL, r["path"]))]
    for r in missing:
        index["kept"].remove(r)
        index["skipped"].append(dict(id=r["id"], user=r["user"], query=r["query"], why="preview download failed"))
    json.dump(index, open(idx_path, "w", encoding="utf8"), indent=1, ensure_ascii=False)
    print(f"fstrain: {len(index['kept'])} kept, {sum(r['dur'] for r in index['kept']) / 3600:.1f} h; "
          f"val {sum(r['split'] == 'val' for r in index['kept'])}", flush=True)


if __name__ == "__main__":
    os.makedirs(META, exist_ok=True)
    main()
