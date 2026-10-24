"""Update BU / UT boundaries, map labels and MV feeder routes from the IE 2026 KMZ exports.

Usage: python scripts/build_boundaries.py IE_BU_Boundary_2026.kmz IE_UT_Boundary_2026.kmz \
           IE_Feeders_11kV_2026.kmz IE_Feeders_33kV_2026.kmz

Files are recognised by their KML document name, so the order does not matter.
Rewrites data/dashboard.json (polygons, BU / UT tables, feeder table, feeder KPIs),
data/feeders.geojson and data/map_labels.json, then prints what changed.

Polygons keep GeoJSON Polygon semantics in `rings`: the outer ring first, then any holes.
Each polygon also carries the KMZ symbology (outline colour / width, fill colour / opacity)
so every map, legend and export draws BUs and UTs exactly as the KMZ does.
Geometry is thinned with Douglas-Peucker at 0.5 m, which only drops redundant in-line vertices.
"""
from __future__ import annotations

import collections
import json
import math
import os
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
NS = {"k": "http://www.opengis.net/kml/2.2"}
TOLERANCE_M = 0.5
SAMPLE_M = 10.0  # feeder routes are sampled every 10 m to measure the share inside a polygon


# ---------- KML parsing ----------

def read_kml(path: str) -> ET.Element:
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".kml"))
        return ET.fromstring(z.read(name))


def attrs(pm: ET.Element) -> dict:
    desc = pm.findtext("k:description", namespaces=NS) or ""
    cells = [re.sub("<[^>]+>", "", c).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", desc, re.S)]
    return {cells[i]: cells[i + 1] for i in range(0, len(cells) - 1, 2)}


def coords(text: str | None) -> list[tuple[float, float]]:
    pts = []
    for tok in (text or "").split():
        p = tok.split(",")
        if len(p) >= 2:
            pts.append((round(float(p[0]), 6), round(float(p[1]), 6)))
    return pts


def kml_color(c: str | None) -> tuple[str | None, float]:
    """KML aabbggrr -> (#RRGGBB, alpha 0-1)."""
    if not c or len(c) != 8:
        return None, 1.0
    return "#" + (c[6:8] + c[4:6] + c[2:4]).upper(), round(int(c[0:2], 16) / 255, 2)


def styles(doc: ET.Element) -> dict:
    out = {}
    for st in doc.findall("k:Style", NS):
        stroke, _ = kml_color(st.findtext("k:LineStyle/k:color", namespaces=NS))
        fill, alpha = kml_color(st.findtext("k:PolyStyle/k:color", namespaces=NS))
        width = st.findtext("k:LineStyle/k:width", namespaces=NS)
        out["#" + st.get("id")] = {"stroke": stroke, "stroke_width": float(width) if width else None, "fill_hex": fill, "fill_opacity": alpha}
    return out


def parse(path: str) -> dict:
    doc = read_kml(path).find("k:Document", NS)
    style_map = styles(doc)
    shapes, labels = [], {}
    for pm in doc.iter("{%s}Placemark" % NS["k"]):
        name = (pm.findtext("k:name", namespaces=NS) or "").strip()
        polys = pm.findall(".//k:Polygon", NS)
        lines = pm.findall(".//k:LineString/k:coordinates", NS)
        point = pm.find(".//k:Point/k:coordinates", NS)
        if polys:
            if len(polys) != 1:
                raise SystemExit(f"{name}: expected one polygon per boundary, found {len(polys)}")
            outer = polys[0].find("k:outerBoundaryIs/k:LinearRing/k:coordinates", NS)
            holes = polys[0].findall("k:innerBoundaryIs/k:LinearRing/k:coordinates", NS)
            shapes.append({"name": name, "attrs": attrs(pm), "rings": [coords(outer.text)] + [coords(h.text) for h in holes],
                           "style": style_map.get(pm.findtext("k:styleUrl", namespaces=NS) or "", {})})
        elif lines:
            shapes.append({"name": name, "attrs": attrs(pm), "lines": [coords(l.text) for l in lines]})
        elif point is not None:
            labels[name] = coords(point.text)[0]
    return {"title": doc.findtext("k:name", namespaces=NS) or "", "shapes": shapes, "labels": labels}


# ---------- Geometry ----------

def to_m(pts):
    lat0 = math.radians(pts[0][1])
    return 111320.0 * math.cos(lat0), 110574.0


def simplify(pts: list, closed: bool = False) -> list:
    """Douglas-Peucker in metres; closed rings keep their first / last vertex."""
    if len(pts) < 3:
        return pts
    kx, ky = to_m(pts)
    P = [(x * kx, y * ky) for x, y in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = P[a], P[b]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = P[i]
            t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
            d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if d > best:
                best, bi = d, i
        if best > TOLERANCE_M:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    out = [p for p, k in zip(pts, keep) if k]
    return out if not closed or len(out) >= 4 else pts


def ring_area_km2(ring) -> float:
    kx, ky = to_m(ring)
    a = sum((x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky) for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]))
    return abs(a) / 2e6


def polygon_area_km2(rings) -> float:
    return ring_area_km2(rings[0]) - sum(ring_area_km2(h) for h in rings[1:])


def line_km(pts) -> float:
    s = 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        lat = math.radians((y1 + y2) / 2)
        s += math.hypot((x2 - x1) * 111.320 * math.cos(lat), (y2 - y1) * 110.574)
    return s


def samples(lines):
    """Midpoints and lengths (km) of ~10 m pieces along every line part."""
    xs, ys, ls = [], [], []
    for pts in lines:
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            seg = line_km([(x1, y1), (x2, y2)])
            n = max(1, math.ceil(seg * 1000 / SAMPLE_M))
            t = (np.arange(n) + 0.5) / n
            xs.append(x1 + (x2 - x1) * t)
            ys.append(y1 + (y2 - y1) * t)
            ls.append(np.full(n, seg / n))
    if not xs:
        return np.zeros(0), np.zeros(0), np.zeros(0)
    return np.concatenate(xs), np.concatenate(ys), np.concatenate(ls)


def inside(X, Y, rings) -> np.ndarray:
    """Even-odd point-in-polygon over the outer ring and its holes, vectorised."""
    e = np.array([(x1, y1, x2, y2) for ring in rings for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1])])
    x1, y1, x2, y2 = (e[:, i][None, :] for i in range(4))
    out = np.zeros(len(X), dtype=bool)
    for s in range(0, len(X), 4000):
        px, py = X[s:s + 4000, None], Y[s:s + 4000, None]
        with np.errstate(divide="ignore", invalid="ignore"):
            cross = ((y1 > py) != (y2 > py)) & (px < (x2 - x1) * (py - y1) / (y2 - y1) + x1)
        out[s:s + 4000] = cross.sum(axis=1) % 2 == 1
    return out


def num(v, cast=float, default=None):
    try:
        return cast(float(v)) if v not in (None, "", "nan") else default
    except ValueError:
        return default


# ---------- Build ----------

def main(paths: list[str]) -> None:
    files = {}
    for p in paths:
        parsed = parse(p)
        t = parsed["title"].lower()
        kind = "bu" if "bu boundary" in t else "ut" if "ut boundary" in t else "f11" if "11kv" in t else "f33" if "33kv" in t else None
        if not kind:
            raise SystemExit(f"Unrecognised KMZ: {p} ({parsed['title']})")
        files[kind] = parsed
    missing = {"bu", "ut", "f11", "f33"} - set(files)
    if missing:
        raise SystemExit(f"Missing KMZ for: {', '.join(sorted(missing))}")

    dash_path = os.path.join(DATA, "dashboard.json")
    d = json.load(open(dash_path, encoding="utf-8"))
    report = []

    # Business Units
    old_bu_poly = {b["bu_name"]: b for b in d["map"]["bu_polygons"]}
    bu_rows = {b["bu_name"]: b for b in d["business_units"]}
    new_bu_polys = []
    for s in files["bu"]["shapes"]:
        a, name = s["attrs"], s["name"]
        prev = old_bu_poly.get(name) or {}
        rings = [[list(p) for p in simplify(r, closed=True)] for r in s["rings"]]
        new_bu_polys.append({"bu_name": name, "dt_total": num(a.get("dt_total"), int, prev.get("dt_total")),
                             **symbology(s, prev), "rings": rings})
        row = bu_rows.get(name)
        if row:
            for k, cast in (("ut_count", int), ("dt_total", int), ("area_km2", float)):
                v = num(a.get(k), cast)
                if v is not None and row.get(k) != v:
                    report.append(f"BU {name}: {k} {row.get(k)} -> {v}")
                    row[k] = v
            if a.get("ut_list") and row.get("ut_list") != a["ut_list"]:
                report.append(f"BU {name}: ut_list changed")
                row["ut_list"] = a["ut_list"]
            row["dt_per_km2"] = round(row["dt_total"] / row["area_km2"], 1) if row.get("area_km2") else 0
        report.append(f"BU {name}: outline {sum(len(r) for r in prev.get('rings', []))} -> {sum(len(r) for r in rings)} vertices, "
                      f"drawn area {sum(polygon_area_km2([[tuple(p) for p in r]]) for r in prev.get('rings', [])):.2f} -> {polygon_area_km2([[tuple(p) for p in r] for r in rings]):.2f} km²")
    d["map"]["bu_polygons"] = new_bu_polys

    # Undertakings
    old_ut_poly = {u["ut_name"]: u for u in d["map"]["ut_polygons"]}
    ut_rows = {u["ut_name"]: u for u in d["undertakings"]}
    new_ut_polys = []
    for s in files["ut"]["shapes"]:
        a, name = s["attrs"], s["name"]
        prev = old_ut_poly.get(name) or {}
        rings = [[list(p) for p in simplify(r, closed=True)] for r in s["rings"]]
        new_ut_polys.append({"ut_name": name, "bu_name": a.get("bu_name") or prev.get("bu_name"),
                             "agreement_pct": num(a.get("agreement_pct"), float, prev.get("agreement_pct")),
                             "dt_total": num(a.get("dt_total"), int, prev.get("dt_total")), **symbology(s, prev), "rings": rings})
        row = ut_rows.get(name)
        if row:
            for k, cast in (("dt_total", int), ("dt_private", int), ("dt_public", int), ("agreement_pct", float), ("area_km2", float)):
                v = num(a.get(k), cast)
                if v is not None and row.get(k) != v:
                    report.append(f"UT {name}: {k} {row.get(k)} -> {v}")
                    row[k] = v
            for k in ("bu_name", "ut_code", "from_old_uts"):
                if a.get(k) and row.get(k) != a[k]:
                    report.append(f"UT {name}: {k} {row.get(k)} -> {a[k]}")
                    row[k] = a[k]
            row["dt_per_km2"] = round(row["dt_total"] / row["area_km2"], 1) if row.get("area_km2") else 0
    d["map"]["ut_polygons"] = new_ut_polys
    d["kpis"]["total_area_km2"] = round(sum(b["area_km2"] for b in d["business_units"]), 1)

    # Feeders: routes, attributes and the share of each route inside its own BU / UT
    bu_rings = {b["bu_name"]: [[tuple(p) for p in r] for r in b["rings"]] for b in new_bu_polys}
    ut_rings = {u["ut_name"]: [[tuple(p) for p in r] for r in u["rings"]] for u in new_ut_polys}
    old_rows = collections.defaultdict(list)
    for r in d["feeders"]:
        old_rows[(r["feeder"], r["voltage"])].append(r)
    table, features = [], []
    for kind, voltage in (("f11", "11kV"), ("f33", "33kV")):
        for s in files[kind]["shapes"]:
            a, name = s["attrs"], s["name"]
            new_bu = a.get("new_bu") or None
            new_ut = a.get("new_ut") or None
            lines = [simplify(l) for l in s["lines"]]
            X, Y, Lk = samples(s["lines"])
            total = float(Lk.sum()) or 1.0
            in_bu = round(float(Lk[inside(X, Y, bu_rings[new_bu])].sum()) / total, 3) if new_bu in bu_rings and len(X) else 0
            in_ut = round(float(Lk[inside(X, Y, ut_rings[new_ut])].sum()) / total, 3) if new_ut in ut_rings and len(X) else 0
            # Same-named feeders (one live, one unassigned stub) are told apart by their BU
            cands = old_rows.get((name, voltage), [])
            prev = next((r for r in cands if (r.get("new_bu") or None) == new_bu), cands[0] if cands else {})
            if prev in cands:
                cands.remove(prev)
            row = {
                "feeder": name, "voltage": voltage,
                "old_bu": a.get("old_bu") or prev.get("old_bu"),
                "new_ut": new_ut, "new_bu": new_bu,
                "dt_count": num(a.get("dt_count"), int, 0),
                "ut_share": num(a.get("ut_share"), float, 0),
                "ut_mix": prev.get("ut_mix"),
                "len_km": num(a.get("len_km"), float, round(line_km_total(s["lines"]), 2)),
                "in_own_bu": in_bu, "in_own_ut": in_ut,
            }
            if row["ut_share"] == int(row["ut_share"]):
                row["ut_share"] = int(row["ut_share"])
            if prev:
                changed = [f"{k} {prev.get(k)} -> {row[k]}" for k in ("new_bu", "new_ut", "dt_count", "len_km")
                           if (prev.get(k) or None) != (row[k] or None) and not (isinstance(row[k], float) and prev.get(k) is not None and abs(row[k] - prev[k]) < 0.011)]
                if row["dt_count"] != prev.get("dt_count") and row["new_ut"]:
                    row["ut_mix"] = f"{row['new_ut']}:{row['dt_count']}" if row["ut_share"] == 1 else None
                drift = [f"{k} {prev.get(k)} -> {row[k]}" for k in ("in_own_bu", "in_own_ut") if prev.get(k) is not None and abs(prev[k] - row[k]) >= 0.05]
                if changed or drift:
                    report.append(f"Feeder {name} {voltage}: " + "; ".join(changed + drift))
            else:
                report.append(f"Feeder {name} {voltage}: new")
            table.append(row)
            features.append({"type": "Feature",
                             "properties": {"feeder": name, "voltage": voltage, "new_bu": new_bu, "new_ut": new_ut,
                                            "dt_count": row["dt_count"], "len_km": row["len_km"]},
                             "geometry": {"type": "MultiLineString", "coordinates": [[list(p) for p in l] for l in lines]}})
    for (name, voltage), rest in old_rows.items():
        for r in rest:
            report.append(f"Feeder {name} {voltage}: removed (not in the 2026 KMZ; {r.get('len_km')} km, {r.get('dt_count')} DTs)")
    table.sort(key=lambda r: (-r["dt_count"], r["feeder"], r["voltage"]))
    d["feeders"] = table
    k = d["kpis"]
    for key, val in (("feeders_11kv", sum(r["voltage"] == "11kV" for r in table)),
                     ("feeders_33kv", sum(r["voltage"] == "33kV" for r in table)),
                     ("feeders_total", len(table))):
        if k.get(key) != val:
            report.append(f"KPI {key}: {k.get(key)} -> {val}")
            k[key] = val

    groups = collections.defaultdict(list)
    for r in table:
        groups[r["new_bu"] or "Unassigned (no DTs linked)"].append(r)
    d["feeders_by_bu"] = sorted(({
        "bu_name": bu, "feeder_count": len(rows), "len_km": round(sum(r["len_km"] for r in rows), 1),
        "dt_count": sum(r["dt_count"] for r in rows),
        "avg_in_own_bu": round(sum(r["in_own_bu"] for r in rows) / len(rows), 3),
    } for bu, rows in groups.items()), key=lambda g: -g["feeder_count"])

    # Labels
    labels = json.load(open(os.path.join(DATA, "map_labels.json"), encoding="utf-8"))
    for kind in ("bu", "ut"):
        for item in labels[kind]:
            pt = files[kind]["labels"].get(item["name"])
            if pt:
                item["lon"], item["lat"] = round(pt[0], 5), round(pt[1], 5)

    d["meta"]["boundaries_source"] = "IE 2026 KMZ exports: BU / UT boundaries, 11 kV and 33 kV feeders (scripts/build_boundaries.py)"
    with open(dash_path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(DATA, "feeders.geojson"), "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(DATA, "map_labels.json"), "w", encoding="utf-8") as f:
        json.dump(labels, f, ensure_ascii=False, separators=(",", ":"))
    print("\n".join(report))
    print(f"\nWrote {len(new_bu_polys)} BUs, {len(new_ut_polys)} UTs, {len(features)} feeders.")


def symbology(shape: dict, prev: dict) -> dict:
    """KMZ outline / fill for a boundary; colours fall back to the dashboard's when the KMZ has none."""
    st = shape.get("style") or {}
    fill = st.get("fill_hex") or prev.get("fill_hex")
    if prev.get("fill_hex") and fill != prev["fill_hex"]:
        print(f"note: {shape['name']} fill {prev['fill_hex']} -> {fill}")
    return {"fill_hex": fill, "fill_opacity": st.get("fill_opacity", 0.4),
            "stroke": st.get("stroke") or fill, "stroke_width": st.get("stroke_width") or 2}


def line_km_total(lines) -> float:
    return sum(line_km(l) for l in lines)


if __name__ == "__main__":
    if len(sys.argv) != 5:
        raise SystemExit(__doc__)
    main(sys.argv[1:])
