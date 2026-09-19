"""PDF Flood Incident Report (ReportLab, vector map — no external map tiles needed)."""
from __future__ import annotations

import io
from datetime import datetime, timezone

from reportlab.graphics.shapes import Circle, Drawing, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle)

from app.engines.world import get_world

NAVY = colors.HexColor("#0b1f3a")
LEVEL_COL = {"GREEN": "#16a34a", "YELLOW": "#eab308", "ORANGE": "#f97316", "RED": "#dc2626",
             "LOW": "#16a34a", "MODERATE": "#eab308", "HIGH": "#f97316", "VERY_HIGH": "#dc2626", "CRITICAL": "#7f1d1d"}


def _depth_color(d: float):
    if d < 0.1:
        return colors.HexColor("#bfdbfe")
    if d < 0.3:
        return colors.HexColor("#60a5fa")
    if d < 0.5:
        return colors.HexColor("#2563eb")
    if d < 0.8:
        return colors.HexColor("#1e3a8a")
    return colors.HexColor("#581c87")


def _map(snap: dict, route: dict | None, size: float = 170 * mm) -> Drawing:
    w = get_world(snap["city"])
    d = Drawing(size, size)
    s, wl, nl, e = w.bbox

    def xy(lat, lon):
        return (lon - wl) / (e - wl) * size, (lat - s) / (nl - s) * size
    d.add(Rect(0, 0, size, size, fillColor=colors.HexColor("#f1f5f9"), strokeColor=colors.HexColor("#94a3b8")))
    cs = size / w.n
    h = snap["_now"]["h"]
    for r in range(w.n):
        for c in range(w.n):
            if w.river_mask[r, c]:
                d.add(Rect(c * cs, size - (r + 1) * cs, cs, cs, fillColor=colors.HexColor("#7dd3fc"), strokeColor=None))
            elif h[r, c] >= 0.05:
                d.add(Rect(c * cs, size - (r + 1) * cs, cs, cs, fillColor=_depth_color(float(h[r, c])), strokeColor=None))
    for rd in snap["roads"]:
        col = colors.HexColor("#dc2626") if rd["depth_now_m"] >= 0.3 else colors.HexColor("#f97316") if rd["depth_now_m"] >= 0.15 else colors.HexColor("#475569")
        pts = [xy(*p) for p in rd["coords"]]
        for a, b in zip(pts, pts[1:]):
            d.add(Line(a[0], a[1], b[0], b[1], strokeColor=col, strokeWidth=1.6 if rd["road_class"] == "arterial" else 0.8))
    if route and route.get("recommended"):
        pts = [xy(*p) for p in route["recommended"]["coords"]]
        for a, b in zip(pts, pts[1:]):
            d.add(Line(a[0], a[1], b[0], b[1], strokeColor=colors.HexColor("#16a34a"), strokeWidth=3))
    for f in snap["facilities"]:
        x, y = xy(f["lat"], f["lon"])
        col = colors.HexColor(LEVEL_COL.get(f["risk_level"], "#16a34a"))
        d.add(Circle(x, y, 3.2 if f["kind"] == "hospital" else 2.2, fillColor=col, strokeColor=colors.white, strokeWidth=0.5))
        if f["kind"] == "hospital":
            d.add(String(x + 4, y + 2, "H", fontSize=6, fillColor=NAVY))
    d.add(String(4, 4, "DEMO geography · MODEL_PREDICTION overlay · blue = flood depth, red/orange roads = flooded, green = safe route",
                 fontSize=6, fillColor=colors.HexColor("#334155")))
    return d


def build_pdf(snap: dict, route: dict | None, timeline: list[dict], validation: dict | None, author: str = "") -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=15 * mm,
                            title=f"FloodShield AI Incident Report — {snap['city_name']}", author="FloodShield AI")
    ss = getSampleStyleSheet()
    H1 = ParagraphStyle("h1", parent=ss["Title"], textColor=NAVY, fontSize=18)
    H2 = ParagraphStyle("h2", parent=ss["Heading2"], textColor=NAVY, spaceBefore=8)
    B = ParagraphStyle("b", parent=ss["BodyText"], fontSize=9, leading=12)
    S = ParagraphStyle("s", parent=B, fontSize=7.5, textColor=colors.HexColor("#475569"))
    k = snap["kpis"]
    story = []
    story.append(Paragraph("FLOODSHIELD AI — Flood Incident Report", H1))
    story.append(Paragraph("<i>Predict the Flood. Protect the City. Respond Before Impact.</i>", B))
    story.append(Paragraph(f"City: <b>{snap['city_name']}</b> · Event minute {snap['event_minute']} · Issued {snap['issued_at']} · "
                           f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}" + (f" · Prepared by {author}" if author else ""), S))
    story.append(Paragraph("DATA NOTICE: Rainfall is SIMULATED (no radar feed configured); geography, drainage and facilities are DEMO data; "
                           "all forecasts are MODEL PREDICTIONS. Not real measurements.", ParagraphStyle("warn", parent=S, textColor=colors.HexColor("#b91c1c"))))
    story.append(Spacer(1, 6))

    def table(rows, widths, header=True, zebra=True):
        t = Table(rows, colWidths=widths, repeatRows=1 if header else 0)
        st = [("FONT", (0, 0), (-1, -1), "Helvetica", 8), ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cbd5e1")),
              ("VALIGN", (0, 0), (-1, -1), "TOP")]
        if header:
            st += [("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8)]
        if zebra:
            for i in range(1, len(rows)):
                if i % 2 == 0:
                    st.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#f1f5f9")))
        t.setStyle(TableStyle(st))
        return t

    story.append(Paragraph("1. Situation summary", H2))
    rows = [["Indicator", "Value"],
            ["Rainfall now (city mean / max cell)", f"{k['rain_now_mm_hr']} / {k['rain_now_max_mm_hr']} mm/hr — {k['rain_category']}"],
            ["Cumulative rainfall", f"{k['rain_cum_mm']} mm"],
            ["3-hour forecast accumulation / peak", f"{k['rain_3h_forecast_mm']} mm / {k['rain_peak_forecast_mm_hr']} mm/hr"],
            ["City flood risk", k["city_risk_level"]],
            ["Flood extent / max depth now", f"{k['flooded_area_km2']} km² / {k['max_depth_m']} m (+60 min: {k['max_depth_60_m']} m)"],
            ["Flooded roads now / +60 min / impassable", f"{k['flooded_roads_now']} / {k['flooded_roads_60']} / {k['impassable_roads']} of {k['total_roads']}"],
            ["Drainage overloaded or overflowing", f"{k['drainage_overloaded']} nodes (mean utilisation {k['drainage_utilization_mean']*100:.0f}%)"],
            ["Active alerts", f"RED {k['alert_counts']['RED']} · ORANGE {k['alert_counts']['ORANGE']} · YELLOW {k['alert_counts']['YELLOW']}"],
            ["Affected critical facilities", f"{k['affected_facilities']} of {k['total_facilities']}"]]
    story.append(table(rows, [70 * mm, 110 * mm]))

    story.append(Paragraph("2. Flood map (current)", H2))
    story.append(_map(snap, route))

    story.append(PageBreak())
    story.append(Paragraph("3. Rainfall nowcast", H2))
    rows = [["Horizon", "Intensity (mm/hr)", "P10–P90", "Accum. (mm)", "P(heavy)", "Confidence"]]
    for h in snap["nowcast"]["horizons"]:
        rows.append([f"+{h['horizon_min']} min", h["intensity_mm_hr"], f"{h['p10_mm_hr']}–{h['p90_mm_hr']}", h["accumulation_mm"],
                     f"{h['heavy_rain_probability']*100:.0f}%", f"{h['confidence']*100:.0f}%"])
    story.append(table(rows, [25 * mm, 32 * mm, 32 * mm, 28 * mm, 28 * mm, 30 * mm]))
    story.append(Paragraph(f"Model: {snap['nowcast']['model']}. Storm motion {snap['nowcast']['storm_motion']['speed_kmh']} km/h "
                           f"towards {snap['nowcast']['storm_motion']['direction_deg']:.0f}°.", S))

    story.append(Paragraph("4. Flood propagation timeline (MODEL PREDICTION)", H2))
    rows = [["Time", "Rain (mm/hr)", "Flood extent (km²)", "Max depth (m)", "Overloaded drains"]]
    for f in timeline:
        rows.append([f["label"], f["rain_mm_hr"], f["flooded_area_km2"], f["max_depth_m"], f["overloaded_nodes"]])
    story.append(table(rows, [30 * mm, 30 * mm, 40 * mm, 35 * mm, 40 * mm]))

    story.append(Paragraph("5. Most affected roads", H2))
    roads = sorted(snap["roads"], key=lambda r: -max(r["depth_now_m"], r["depth_forecast_m"][60]))[:15]
    rows = [["Road", "Now (m)", "+60 (m)", "+120 (m)", "TTF (min)", "Passability", "Risk"]]
    for r in roads:
        rows.append([Paragraph(r["name"], S), r["depth_now_m"], r["depth_forecast_m"][60], r["depth_forecast_m"][120],
                     "now" if r["time_to_flood_min"] == 0 else (r["time_to_flood_min"] if r["time_to_flood_min"] is not None else "—"),
                     r["passability"].replace("_", " ").title(), r["risk_level"]])
    story.append(table(rows, [52 * mm, 16 * mm, 16 * mm, 16 * mm, 18 * mm, 40 * mm, 22 * mm]))

    story.append(Paragraph("6. Critical infrastructure", H2))
    rows = [["Facility", "Type", "Status", "Site depth (m)", "Ambulance reach", "Alternative"]]
    for f in sorted(snap["facilities"], key=lambda f: f["status"] == "OPERATIONAL"):
        if f["status"] == "OPERATIONAL":
            continue
        rows.append([Paragraph(f["name"], S), f["kind"].replace("_", " "), f["status"].replace("_", " "), f["site_depth_now_m"],
                     f"{f['reachable_network_pct']}%", Paragraph(f["alternative"]["name"] if f.get("alternative") else "—", S)])
    if len(rows) == 1:
        rows.append(["All facilities operational", "", "", "", "", ""])
    story.append(table(rows, [45 * mm, 25 * mm, 30 * mm, 22 * mm, 22 * mm, 38 * mm]))

    story.append(Paragraph("7. Drainage failures", H2))
    ds = sorted([d for d in snap["drains"] if d["status"] in ("OVERLOADED", "OVERFLOW") and d["kind"] != "outfall"], key=lambda d: -d["utilization"])[:12]
    rows = [["Node", "Ward", "Status", "Utilisation", "Overflow (m³)", "Assumed blockage"]]
    for d in ds:
        rows.append([d["id"], d["ward"], d["status"], f"{d['utilization']*100:.0f}%", d["overflow_m3"], f"{d['blockage']*100:.0f}%"])
    story.append(table(rows, [22 * mm, 38 * mm, 30 * mm, 25 * mm, 28 * mm, 37 * mm]))

    story.append(Paragraph("8. Active alerts & recommended actions", H2))
    for a in snap["alerts"][:8]:
        story.append(KeepTogether([Paragraph(f"<font color='{LEVEL_COL[a['level']]}'><b>[{a['level']}]</b></font> <b>{a['location']}</b> — "
                                             f"depth up to {a['expected_depth_m']} m, expected {'now' if not a['expected_time_min'] else 'in ~'+str(a['expected_time_min'])+' min'}; "
                                             f"{len(a['affected_roads'])} roads, {len(a['affected_infrastructure'])} facilities affected.", B),
                                   Paragraph("Authority: " + " ".join(a["recommended_actions"]["authority"]), S),
                                   Paragraph("Citizens: " + " ".join(a["recommended_actions"]["citizen"]), S), Spacer(1, 3)]))
    if route and route.get("recommended"):
        story.append(Paragraph("9. Emergency route", H2))
        rec = route["recommended"]
        story.append(Paragraph(f"Mode {route['mode']}: {rec['distance_km']} km, {rec['time_min']} min, max depth on route {rec['max_depth_m']} m, "
                               f"risk {rec['risk_level']}. {route.get('message', '')}", B))
    if validation:
        story.append(Paragraph("10. Model validation (DEMO_VALIDATION — twin experiment, not real-world)", H2))
        fe = validation["flood_extent"]["overall"]
        story.append(Paragraph(f"Flood extent precision {fe['precision']}, recall {fe['recall']}, F1 {fe['f1']}, IoU {fe['iou']}; "
                               f"depth MAE {validation['depth']['mae_m']} m, RMSE {validation['depth']['rmse_m']} m; rainfall MAE at +60 min "
                               f"{next((r['mae_mm_hr'] for r in validation['rainfall'] if r['horizon_min'] == 60), '—')} mm/hr.", B))
    story.append(Spacer(1, 8))
    story.append(Paragraph("Emergency: 112 (National Emergency) · 1070 State EOC · 1077 District EOC · 108 Ambulance · 101 Fire · 100 Police. "
                           "Verify local numbers with the district administration.", S))
    doc.build(story)
    return buf.getvalue()
