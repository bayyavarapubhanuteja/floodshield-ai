"""FloodShield AI — Technical Approach graphic (4-column blue pattern + tech stack).

    python docs/assets/make_tech_approach.py
Icons: Lucide (ISC licence) from icons.json; tech marks are simplified brand-colour glyphs.
"""
from __future__ import annotations

import json
import os
import re
import subprocess

from make_stack_image import (atom, bars, bolt, cloud_up, cylinder, globe, graph_nodes, grid_icon, layers, leaf,
                              opencv_mark, python_mark, scatter, ts_mark, txt, waves, whale)

HERE = os.path.dirname(os.path.abspath(__file__))
ICONS = json.load(open(os.path.join(HERE, "icons.json")))
W, H = 2200, 1150
NAVY, BLUE, BLUE2, TINT, EDGE, INK, MUTED = "#0b3a8c", "#1d6fd8", "#3b8ff0", "#eef5fd", "#d4e4f7", "#0b1f3a", "#475569"
GREEN, GTINT = "#15803d", "#ecfdf3"
TOP, BOT = 16, 960


def icon(name, x, y, size=30, colour=BLUE, sw=2):
    inner = re.sub(r"^<svg[^>]*>|</svg>$", "", ICONS[name]).replace("COLOR", colour)
    return (f'<g transform="translate({x:.1f} {y:.1f}) scale({size / 24:.3f})" fill="none" stroke="{colour}" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round">{inner}</g>')


def box(x, y, w, h, r=12, fill="#fff", stroke=EDGE, sw=1.5):
    return f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'


def t(x, y, s, size, fill=INK, weight=600, anchor="start"):
    return txt(x, y, s, size=size, fill=fill, weight=weight, anchor=anchor)


def column(x, w, num, title, sub):
    return "".join([
        box(x, TOP, w, BOT - TOP, 18, fill="#ffffff", stroke=EDGE, sw=2),
        f'<path d="M{x + 18} {TOP}h{w - 36}a18 18 0 0 1 18 18v64h-{w}v-64a18 18 0 0 1 18-18z" fill="url(#hdr)"/>',
        f'<circle cx="{x + 54}" cy="{TOP + 41}" r="28" fill="{NAVY}"/>',
        t(x + 54, TOP + 50, num, 25, "#fff", 800, "middle"),
        t(x + 98, TOP + 38, title, 26, "#fff", 800),
        t(x + 98, TOP + 66, sub, 16, "#dbeafe", 500),
    ])


def icon_row(x, y, w, h, ic, title, sub=None, title_col=INK, title_size=17.5):
    out = [box(x, y, w, h, 12, fill=TINT), f'<circle cx="{x + 36}" cy="{y + h / 2}" r="22" fill="#dbeafe"/>',
           icon(ic, x + 21, y + h / 2 - 15, 30)]
    if sub:
        out += [t(x + 72, y + h / 2 - 4, title, title_size, title_col, 800),
                t(x + 72, y + h / 2 + 18, sub, 14, MUTED, 500)]
    else:
        out.append(t(x + 72, y + h / 2 + 6, title, title_size, title_col, 700))
    return "".join(out)


def build() -> str:
    p = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Inter, Helvetica, Arial, sans-serif">',
         f'<defs><linearGradient id="hdr" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{BLUE}"/><stop offset="1" stop-color="{BLUE2}"/></linearGradient></defs>',
         f'<rect width="{W}" height="{H}" fill="#ffffff"/>']
    y0 = TOP + 108

    # ---------------------------------------------------------------- 01 data sources
    x, w = 24, 470
    p.append(column(x, w, "01", "DATA SOURCES", "Software feeds · no physical sensors"))
    src = [("Radar", "Radar & rainfall datasets", "IMD Doppler radar · GPM IMERG · INSAT"),
           ("Satellite", "Weather APIs", "Open-Meteo · IMD forecasts"),
           ("Mountain", "High-resolution DEM", "SRTM 30 m · CartoDEM"),
           ("Route", "GIS road network", "OpenStreetMap · municipal GIS"),
           ("Network", "Drainage network GIS", "Manholes, pipes, outfalls"),
           ("Layers", "Land use / land cover", "Imperviousness & runoff class"),
           ("History", "Historical rainfall & floods", "Event records & hotspots"),
           ("Cctv", "CCTV images & videos", "Uploaded clips (no live hardware)"),
           ("Megaphone", "Citizen flood reports", "Photo + location + depth")]
    rh, gap = 80, 12
    for i, (ic, a, b) in enumerate(src):
        p.append(icon_row(x + 16, y0 + i * (rh + gap), w - 32, rh, ic, a, b))

    # ---------------------------------------------------------------- 02 prediction engine
    x, w = 512, 520
    p.append(column(x, w, "02", "PREDICTION ENGINE", "AI + hydraulic physics, coupled"))
    eng = [("CloudRain", "AI RAINFALL NOWCAST", ["Phase-correlation storm motion + advection", "Gradient-boosted growth · 16-member ensemble"], "+15 → +180 min"),
           ("Mountain", "TERRAIN ANALYSIS", ["Priority-flood sink filling · D8 flow direction", "Flow accumulation · catchments · low spots"], None),
           ("Droplets", "RAINFALL → RUNOFF", ["SCS Curve Number on cumulative rainfall", "Adjusted for land cover & imperviousness"], None),
           ("Network", "DRAINAGE DIGITAL TWIN", ["Directed graph · Manning pipe capacity", "Inlet capture · backwater · surcharge · overflow"], None),
           ("Waves", "COUPLED 1D–2D FLOOD MODEL", ["Pipe network + surface flow routing, 5-min steps", "Depth · extent · probability · time-to-flood"], None),
           ("BrainCircuit", "RISK & EXPLAINABILITY", ["12-factor weighted score + ML susceptibility", "Per-factor contributions · vulnerability index"], None)]
    eh, eg = 118, 22
    for i, (ic, a, lines, tag) in enumerate(eng):
        y = y0 + i * (eh + eg)
        p.append(box(x + 16, y, w - 32, eh, 12, fill=TINT))
        p.append(f'<circle cx="{x + 60}" cy="{y + eh / 2}" r="28" fill="#dbeafe"/>')
        p.append(icon(ic, x + 42, y + eh / 2 - 18, 36))
        p.append(t(x + 104, y + 34, a, 19, BLUE, 800))
        for j, ln in enumerate(lines):
            p.append(t(x + 104, y + 62 + j * 22, ln, 14.5, MUTED, 500))
        if tag:
            tw = 8.6 * len(tag) + 22
            p.append(box(x + w - 32 - tw, y + 14, tw, 28, 14, fill=BLUE, stroke=BLUE))
            p.append(t(x + w - 32 - tw / 2, y + 33, tag, 13.5, "#fff", 800, "middle"))
        if i < len(eng) - 1:
            cx = x + w / 2
            p.append(f'<path d="M{cx} {y + eh + 2}v{eg - 4}M{cx - 7} {y + eh + eg - 9}l7 7 7-7" fill="none" stroke="{BLUE}" '
                     f'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>')

    # ---------------------------------------------------------------- 03 decision outputs
    x, w = 1050, 440
    p.append(column(x, w, "03", "DECISION OUTPUTS", "From prediction to action"))
    outs = [("MapPin", "Street-level flood map", "Depth, extent & risk zones"),
            ("Timer", "Time-to-flooding & duration", "Per road, +15 → +180 min"),
            ("PlayCircle", "Flood propagation animation", "NOW → +180 min timeline"),
            ("TriangleAlert", "Early-warning alerts", "Green · Yellow · Orange · Red"),
            ("Ambulance", "Flood-safe emergency routes", "7 modes, depth-aware"),
            ("Hospital", "Infrastructure impact", "Hospitals, substations, shelters"),
            ("SlidersHorizontal", "What-if scenarios", "Baseline vs scenario"),
            ("Wrench", "Drain maintenance priorities", "Inspect · Clean · Repair"),
            ("FileText", "PDF incident report", "Maps, timeline, actions"),
            ("Bot", "Grounded AI Copilot", "Answers only from live data")]
    oh, og = 72, 11.5
    for i, (ic, a, b) in enumerate(outs):
        p.append(icon_row(x + 16, y0 + i * (oh + og), w - 32, oh, ic, a, b, title_size=16.5))

    # ---------------------------------------------------------------- 04 platform & delivery
    x, w = 1508, W - 24 - 1508
    p.append(column(x, w, "04", "PLATFORM & DELIVERY", "For authorities, responders & citizens"))
    # roles
    p.append(box(x + 16, y0, w - 32, 128, 12, fill=TINT))
    p.append(t(x + 34, y0 + 32, "ROLE-BASED COMMAND CENTER  (JWT + RBAC)", 16, INK, 800))
    roles = [("Shield", "Admin", NAVY), ("Building2", "Officer", BLUE), ("Siren", "Responder", "#dc2626"),
             ("BarChart3", "Analyst", "#7c3aed"), ("Users", "Citizen", GREEN)]
    rw = (w - 32 - 36 - 4 * 8) / 5
    for i, (ic, name, c) in enumerate(roles):
        rx = x + 34 + i * (rw + 8)
        p.append(box(rx, y0 + 50, rw, 60, 10, fill="#ffffff", stroke=EDGE))
        p.append(icon(ic, rx + rw / 2 - 12, y0 + 57, 24, c))
        p.append(t(rx + rw / 2, y0 + 100, name, 13.5, c, 800, "middle"))
    # modules
    my = y0 + 144
    p.append(box(x + 16, my, w - 32, 184, 12, fill=TINT))
    p.append(t(x + 34, my + 30, "19 INTEGRATED MODULES", 16, INK, 800))
    mods = ["Dashboard", "Live Flood Map", "Rainfall Nowcast", "Terrain & Runoff", "Drainage", "Prediction", "Risk", "What-If",
            "Routing", "Infrastructure", "CCTV", "Citizen Reports", "Historical", "Maintenance", "Helplines", "Copilot",
            "Incidents", "Reports", "Settings"]
    mx, mrow = x + 34, my + 46
    for m in mods:
        mw_ = 7.3 * len(m) + 20
        if mx + mw_ > x + w - 34:
            mx, mrow = x + 34, mrow + 32
        p.append(box(mx, mrow, mw_, 25, 7, fill="#ffffff", stroke=EDGE, sw=1))
        p.append(t(mx + mw_ / 2, mrow + 17, m, 12.5, INK, 600, "middle"))
        mx += mw_ + 7
    # architecture
    ay = my + 200
    p.append(t(x + 22, ay + 18, "SYSTEM ARCHITECTURE", 16, INK, 800))
    arch = [("Monitor", "Frontend", ["React · TypeScript", "Leaflet · Recharts"], BLUE),
            ("Code", "Backend API", ["FastAPI · WebSockets", "JWT · RBAC · audit"], "#059669"),
            ("Database", "Data layer", ["PostgreSQL · PostGIS", "Redis · GeoJSON"], "#d97706"),
            ("Container", "Deploy", ["Docker Compose", "Nginx · Render"], "#7c3aed")]
    aw = (w - 32 - 3 * 10) / 4
    for i, (ic, a, lines, c) in enumerate(arch):
        axx = x + 16 + i * (aw + 10)
        p.append(box(axx, ay + 30, aw, 132, 12, fill="#ffffff", stroke=c, sw=1.8))
        p.append(icon(ic, axx + aw / 2 - 15, ay + 42, 30, c))
        p.append(t(axx + aw / 2, ay + 96, a, 15.5, c, 800, "middle"))
        for j, ln in enumerate(lines):
            p.append(t(axx + aw / 2, ay + 118 + j * 19, ln, 12.5, MUTED, 500, "middle"))
    # real-time
    ry = ay + 178
    p.append(box(x + 16, ry, w - 32, 130, 12, fill=TINT))
    p.append(icon("Zap", x + 32, ry + 14, 26, BLUE))
    p.append(t(x + 66, ry + 34, "REAL-TIME & RESILIENCE", 16, BLUE, 800))
    feats = ["WebSocket updates every 5 min", "Multi-city ready (6 cities)", "Start / Pause / Fast-Demo clock",
             "Online / degraded / offline mode", "Offline cache of maps & alerts", "5 languages · mobile-ready"]
    for i, f in enumerate(feats):
        fx = x + 36 + (i % 2) * ((w - 56) / 2)
        fy = ry + 66 + (i // 2) * 24
        p.append(f'<circle cx="{fx + 8}" cy="{fy - 5}" r="8" fill="{BLUE}"/>')
        p.append(f'<path d="M{fx + 4.2} {fy - 5}l2.6 2.6 5-5.2" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>')
        p.append(t(fx + 24, fy, f, 13.5, INK, 600))
    # five questions
    qy = ry + 144
    qh = BOT - 16 - qy
    p.append(box(x + 16, qy, w - 32, qh, 12, fill=GTINT, stroke="#bbf7d0"))
    p.append(f'<circle cx="{x + 44}" cy="{qy + 28}" r="14" fill="{GREEN}"/>')
    p.append(t(x + 44, qy + 34, "?", 16, "#fff", 800, "middle"))
    p.append(t(x + 68, qy + 34, "ANSWERS THE FIVE QUESTIONS", 16, GREEN, 800))
    qs = [("WHERE", "extent & roads"), ("WHEN", "time-to-flood"), ("HOW DEEP", "water depth"), ("WHY", "factors"), ("WHAT", "alerts & routes")]
    qw = (w - 32 - 24 - 4 * 8) / 5
    for i, (a, b) in enumerate(qs):
        bx = x + 28 + i * (qw + 8)
        p.append(box(bx, qy + 52, qw, qh - 66, 10, fill="#ffffff", stroke="#bbf7d0"))
        p.append(t(bx + qw / 2, qy + 52 + (qh - 66) / 2 - 2, a, 14.5, GREEN, 800, "middle"))
        p.append(t(bx + qw / 2, qy + 52 + (qh - 66) / 2 + 18, b, 11.5, MUTED, 500, "middle"))

    # ---------------------------------------------------------------- tech stack
    sy = BOT + 20
    p.append(box(24, sy, W - 48, H - sy - 20, 18, fill="#ffffff", stroke=EDGE, sw=2))
    p.append(t(64, sy + 76, "TECH", 30, INK, 800))
    p.append(t(64, sy + 112, "STACK", 30, INK, 800))
    stack = [("React", atom("#61dafb")), ("TypeScript", ts_mark()), ("Vite", bolt("#a855f7")), ("Tailwind CSS", waves("#0ea5e9")),
             ("Leaflet", leaf("#16a34a")), ("Recharts", bars("#0891b2")), ("Python", python_mark()), ("FastAPI", bolt("#059669")),
             ("PostgreSQL", cylinder("#336791")), ("PostGIS", globe("#4f9d5b")), ("Redis", layers("#dc2626")),
             ("NumPy", grid_icon("#4d77cf")), ("scikit-learn", scatter("#f7931e")), ("OpenCV", opencv_mark()),
             ("NetworkX", graph_nodes("#0284c7")), ("Docker", whale("#2496ed")), ("Render", cloud_up("#7c3aed"))]
    x0, x1 = 230, W - 50
    step = (x1 - x0) / len(stack)
    for i, (label, glyph) in enumerate(stack):
        cx = x0 + step * i + step / 2
        p.append(box(cx - 34, sy + 26, 68, 68, 14, fill=TINT, stroke=EDGE))
        p.append(f'<g transform="translate({cx - 22:.1f} {sy + 38}) scale(1.85)">{glyph}</g>')
        p.append(t(cx, sy + 124, label, 14, INK, 600, "middle"))
    p.append("</svg>")
    return "\n".join(p)


def main():
    svg, png = os.path.join(HERE, "technical_approach.svg"), os.path.join(HERE, "technical_approach.png")
    open(svg, "w").write(build())
    chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    subprocess.run([chrome, "--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
                    f"--screenshot={png}", f"--window-size={W},{H}", f"file://{svg}"], check=False, capture_output=True)
    print("wrote", png if os.path.exists(png) else "(png failed)")


if __name__ == "__main__":
    main()
