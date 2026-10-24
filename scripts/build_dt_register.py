"""Build data/dt_register.json (every DT with its register attributes) from the IE DT KMZ exports.

Usage: python scripts/build_dt_register.py IE_DT_Public.kmz IE_DT_Private.kmz
"""
from __future__ import annotations

import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "dt_register.json")

ROW_RE = re.compile(
    r"<td style='padding:2px 6px;color:#555'>(.*?)</td><td style='padding:2px 6px'><b>(.*?)</b></td>"
)
COORD_RE = re.compile(r"<coordinates>\s*([-\d.]+),([-\d.]+)")
# Dictionary-encoded columns keep the file small; numeric columns are stored as-is
CATEGORICAL = ["feeder", "bu", "ut", "old_bu", "own", "conn", "meter"]
FIELDS = ["name", "feeder", "bu", "ut", "old_bu", "own", "cap", "conn", "meter", "lon", "lat"]


def unescape(s: str) -> str:
    return s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').strip()


def read_kml(path: str) -> str:
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".kml"))
        return z.read(name).decode("utf-8")


def parse(path: str) -> list[dict]:
    rows = []
    for pm in re.finditer(r"<Placemark>(.*?)</Placemark>", read_kml(path), re.S):
        body = pm.group(1)
        attrs = {unescape(k): unescape(v) for k, v in ROW_RE.findall(body)}
        coords = COORD_RE.search(body)
        cap = attrs.get("Capacity (kVA)") or attrs.get("Capacity") or ""
        try:
            cap_num = float(cap)
            cap_val = int(cap_num) if cap_num.is_integer() else cap_num
        except ValueError:
            cap_val = None
        rows.append({
            "name": attrs.get("New Unique DT Nomenclature", ""),
            "feeder": attrs.get("Feeder Name", ""),
            "bu": attrs.get("NEW_BU_2026", ""),
            "ut": attrs.get("NEW_UT_2026", ""),
            "old_bu": attrs.get("BU", ""),
            "own": attrs.get("Ownership", "").upper(),
            "cap": cap_val,
            "conn": attrs.get("Connection Status", "").upper(),
            "meter": attrs.get("Metering Status", "").upper(),
            "lon": round(float(coords.group(1)), 6) if coords else None,
            "lat": round(float(coords.group(2)), 6) if coords else None,
        })
    return rows


def feeder_key(name: str) -> str:
    return re.sub(r"\s+", " ", name).strip().lower()


def canonical_feeders(rows: list[dict]) -> dict[str, str]:
    """The register spells some feeders several ways (AGBOWA / Agbowa): map each to its most used spelling."""
    counts: dict[str, dict[str, int]] = {}
    for r in rows:
        spellings = counts.setdefault(feeder_key(r["feeder"]), {})
        spellings[r["feeder"]] = spellings.get(r["feeder"], 0) + 1
    return {
        spelling: max(spellings, key=lambda s: (spellings[s], s))
        for spellings in counts.values()
        for spelling in spellings
    }


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    rows = [r for path in sys.argv[1:] for r in parse(path)]
    canon = canonical_feeders(rows)
    for r in rows:
        r["feeder"] = canon[r["feeder"]]
    dicts = {c: sorted({r[c] for r in rows}) for c in CATEGORICAL}
    index = {c: {v: i for i, v in enumerate(vals)} for c, vals in dicts.items()}
    encoded = [[index[f][r[f]] if f in index else r[f] for f in FIELDS] for r in rows]
    out = {
        "source": [os.path.basename(p) for p in sys.argv[1:]],
        "count": len(rows),
        "fields": FIELDS,
        "dict": dicts,
        "rows": encoded,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {len(rows)} DTs to {OUT} ({os.path.getsize(OUT) / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
