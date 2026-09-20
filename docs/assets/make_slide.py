"""Generate the FloodShield AI "Technical Approach" slide (16:9 SVG + PNG).

    python docs/assets/make_slide.py

Icons are simple geometric marks drawn in each technology's brand colour (not official logos).
"""
from __future__ import annotations

import os
import subprocess

from make_stack_image import (atom, bars, bolt, cylinder, doc, g, globe, graph_nodes, grid_icon, key, layers, leaf,
                              opencv_mark, path, polygon_icon, python_mark, rect, scatter, sine, ts_mark, txt, waves,
                              whale, cloud_up, bbox, claude_mark)

W, H = 1920, 1080
INK, MUTED, LINE = "#0f172a", "#475569", "#cbd5e1"
GREEN, BLUE, AMBER, PURPLE, SLATE = "#16a34a", "#2563eb", "#f59e0b", "#7c3aed", "#0f172a"


def box(x, y, w, h, r=12, fill="#ffffff", stroke=LINE, sw=1.4, dash=None, op=1.0):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" '
            f'stroke-width="{sw}" opacity="{op}"{d}/>')


def chip(x, y, w, h, label, fill, text_fill="#0f172a", size=13, weight=600, r=8):
    return g(box(x, y, w, h, r, fill=fill, stroke="none", sw=0),
             txt(x + w / 2, y + h / 2 + size * 0.36, label, size=size, fill=text_fill, weight=weight))


def arrow(x1, y1, x2, y2, c="#94a3b8", sw=2.2):
    return g(path(f"M{x1} {y1}L{x2} {y2}", stroke=c, sw=sw),
             path(f"M{x2} {y2}l-9 -5M{x2} {y2}l-9 5", stroke=c, sw=sw))


def group(x, y, w, h, title, colour):
    return g(box(x, y, w, h, 14, fill="#ffffff", stroke=colour, sw=1.8, dash="7 6"),
             box(x + 16, y - 12, 9 * len(title) + 22, 24, 12, fill=colour, stroke="none"),
             txt(x + 16 + (9 * len(title) + 22) / 2, y + 5, title, size=12.5, fill="#ffffff", weight=800))


STACK = [
    ("React", atom("#61dafb")), ("TypeScript", ts_mark()), ("Vite", bolt("#a855f7")), ("Tailwind", waves("#0ea5e9")),
    ("Leaflet", leaf("#4ade80")), ("Recharts", bars("#0891b2")), ("Python", python_mark()), ("FastAPI", bolt("#059669")),
    ("PostgreSQL", cylinder("#336791")), ("PostGIS", globe("#4f9d5b")), ("Redis", layers("#dc2626")),
    ("NumPy/SciPy", grid_icon("#4d77cf")), ("scikit-learn", scatter("#f7931e")), ("OpenCV", opencv_mark()),
    ("NetworkX", graph_nodes("#0284c7")), ("Docker", whale("#2496ed")), ("Render", cloud_up("#7c3aed")),
]


def build() -> str:
    p = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
         f'font-family="Inter, Helvetica, Arial, sans-serif">', rect(0, 0, W, H, 0, fill="#ffffff")]

    # ---------------- header
    p.append(g(
        f'<g transform="translate(44 26) scale(0.85)"><path fill="#0ea5e9" d="M32 4 8 12v18c0 15 10 26 24 30 14-4 24-15 24-30V12L32 4z"/>'
        f'<path fill="#fff" d="M32 18c-5 7-10 13-10 19a10 10 0 0 0 20 0c0-6-5-12-10-19z"/></g>',
        txt(108, 58, "FLOODSHIELD AI", size=23, fill=INK, weight=800, anchor="start"),
        txt(108, 78, "Predict the Flood · Protect the City · Respond Before Impact", size=11.5, fill=MUTED, weight=500, anchor="start"),
        txt(W / 2, 66, "TECHNICAL APPROACH", size=42, fill=INK, weight=800),
        box(W - 350, 26, 306, 62, 12, fill="#f1f5f9", stroke=LINE),
        txt(W - 197, 50, "SMART INDIA HACKATHON 2026", size=14, fill=INK, weight=800),
        txt(W - 197, 72, "SIH26085 · Urban Flood Nowcasting · 100% software", size=10.5, fill=MUTED, weight=600),
        path(f"M44 100H{W - 44}", stroke=LINE, sw=1.4)))

    top, bot = 132, 866
    # ---------------- column 1: data sources
    x1, w1 = 44, 388
    p.append(group(x1, top, w1, bot - top, "SOFTWARE DATA SOURCES (no sensors)", GREEN))
    items = [("Doppler radar / rainfall datasets", "#dcfce7"), ("Weather APIs (Open-Meteo reference)", "#dcfce7"),
             ("High-resolution DEM (SRTM / Cartosat)", "#dbeafe"), ("GIS road network (OSM-compatible)", "#dbeafe"),
             ("Municipal drainage network GIS", "#dbeafe"), ("Land use / land cover & imperviousness", "#fef3c7"),
             ("Historical rainfall & flood records", "#fef3c7"), ("Uploaded CCTV images & recorded video", "#ede9fe"),
             ("Citizen flood reports (photo + depth)", "#ede9fe"), ("Deterministic simulated storm (demo)", "#fee2e2")]
    for i, (label, fill) in enumerate(items):
        p.append(chip(x1 + 18, top + 34 + i * 62, w1 - 36, 46, label, fill, size=12.5))
    p.append(txt(x1 + w1 / 2, bot - 16, "Every value labelled: LIVE · HISTORICAL · SIMULATED · DEMO", size=10.5, fill=MUTED, weight=600))

    # ---------------- column 2: engine chain
    x2, w2 = 470, 404
    p.append(group(x2, top, w2, bot - top, "COUPLED PREDICTION ENGINE", BLUE))
    engine = [("AI RAINFALL NOWCAST", "Phase-correlation motion + advection +\ndamped trend + gradient-boosted model\n16-member ensemble → +15…+180 min", "#2563eb"),
              ("TERRAIN ANALYSIS", "Priority-flood sink filling · D8 flow direction\nflow accumulation · catchments · low-lying pockets", "#0891b2"),
              ("RAINFALL → RUNOFF", "SCS Curve Number on cumulative rainfall\nadjusted for imperviousness & slope", "#059669"),
              ("DRAINAGE DIGITAL TWIN", "Directed graph: manholes/inlets/outfalls + pipes\nManning capacity · inlet capture · backwater\nsurcharge storage · overflow to street", "#f59e0b"),
              ("COUPLED 1D–2D FLOOD MODEL", "Surface CA routing + pipe network, 5-min steps\ndepth · extent · probability · time-to-flood", "#dc2626"),
              ("RISK & EXPLAINABILITY", "12-factor weighted score + ML susceptibility\nUFVI per ward · factor contributions", "#7c3aed")]
    y = top + 34
    for i, (t, sub, c) in enumerate(engine):
        lines = sub.split("\n")
        h = 34 + 15 * len(lines)
        p.append(box(x2 + 18, y, w2 - 36, h, 10, fill="#f8fafc", stroke=c, sw=1.5))
        p.append(rect(x2 + 18, y, 5, h, 2, fill=c))
        p.append(txt(x2 + 34, y + 21, t, size=13, fill=c, weight=800, anchor="start"))
        for j, ln in enumerate(lines):
            p.append(txt(x2 + 34, y + 38 + j * 15, ln, size=11, fill=MUTED, weight=500, anchor="start"))
        if i < len(engine) - 1:
            p.append(arrow(x2 + w2 / 2, y + h + 2, x2 + w2 / 2, y + h + 16))
        y += h + 20

    # ---------------- column 3: outputs
    x3, w3 = 912, 250
    p.append(group(x3, top, w3, bot - top, "DECISION OUTPUTS", SLATE))
    outs = ["Street-level flood map", "Depth now & +15…+180 min", "Time-to-flooding & duration",
            "Flood propagation animation", "GREEN/YELLOW/ORANGE/RED alerts", "Flood-safe emergency routes",
            "Hospital & infrastructure impact", "What-If scenario comparison", "Drain maintenance priorities",
            "PDF incident report", "Grounded AI Copilot answers"]
    for i, o in enumerate(outs):
        p.append(g(box(x3 + 16, top + 34 + i * 56, w3 - 32, 44, 9, fill=SLATE, stroke="none"),
                   txt(x3 + w3 / 2, top + 34 + i * 56 + 27, o, size=11.5, fill="#e2e8f0", weight=600)))

    # ---------------- column 4: platform
    x4, w4 = 1200, W - 44 - 1200
    p.append(group(x4, top, w4, bot - top, "PLATFORM & DELIVERY", PURPLE))
    # roles
    p.append(box(x4 + 18, top + 30, w4 - 36, 150, 12, fill="#f8fafc", stroke=LINE))
    p.append(txt(x4 + 34, top + 54, "ROLE-BASED COMMAND CENTER (JWT + RBAC)", size=13, fill=INK, weight=800, anchor="start"))
    roles = [("ADMIN", "#0f172a"), ("MUNICIPAL OFFICER", "#2563eb"), ("EMERGENCY RESPONDER", "#dc2626"), ("ANALYST", "#7c3aed"), ("CITIZEN", "#16a34a")]
    rx = x4 + 34
    for name, c in roles:
        w_ = 8.0 * len(name) + 22
        p.append(chip(rx, top + 66, w_, 26, name, c + "1f", text_fill=c, size=11, weight=800))
        rx += w_ + 8
    mods = ["Dashboard", "Live Flood Map", "Rainfall Nowcast", "Terrain & Runoff", "Drainage", "Prediction", "Risk",
            "What-If", "Routing", "Infrastructure", "CCTV", "Citizen Reports", "Historical", "Maintenance",
            "Emergency & Helplines", "Copilot", "Incidents", "Reports", "Settings"]
    mx, my = x4 + 34, top + 108
    for m in mods:
        w_ = 6.6 * len(m) + 16
        if mx + w_ > x4 + w4 - 34:
            mx, my = x4 + 34, my + 26
        p.append(chip(mx, my, w_, 22, m, "#e2e8f0", size=10.5, weight=600, r=6))
        mx += w_ + 6

    # architecture row
    ay = top + 196
    cards = [("FRONTEND", "React 18 · TypeScript · Vite\nTailwind · Leaflet · Recharts\nFramer Motion · 5 languages", BLUE),
             ("BACKEND API", "FastAPI · Uvicorn · Pydantic\nSQLAlchemy · WebSockets\nJWT · RBAC · rate limiting · audit", GREEN),
             ("DATA LAYER", "PostgreSQL + PostGIS\nRedis cache & rate limits\nGeoJSON geometry · 25 tables", AMBER),
             ("DEPLOY", "Docker Compose (4 services)\nNginx · Render cloud\n65 automated tests", PURPLE)]
    cw = (w4 - 36 - 3 * 14) / 4
    for i, (t, sub, c) in enumerate(cards):
        cx = x4 + 18 + i * (cw + 14)
        p.append(box(cx, ay, cw, 118, 10, fill="#ffffff", stroke=c, sw=1.5))
        p.append(rect(cx, ay, cw, 5, 2, fill=c))
        p.append(txt(cx + cw / 2, ay + 30, t, size=12.5, fill=c, weight=800))
        for j, ln in enumerate(sub.split("\n")):
            p.append(txt(cx + cw / 2, ay + 50 + j * 16, ln, size=10.5, fill=MUTED, weight=500))

    # real-time + labels row
    ry = ay + 134
    p.append(box(x4 + 18, ry, w4 - 36, 140, 12, fill="#f8fafc", stroke=LINE))
    p.append(txt(x4 + 34, ry + 26, "REAL-TIME & RESILIENCE", size=13, fill=INK, weight=800, anchor="start"))
    feats = ["WebSocket push every 5-min step", "Event clock: START / PAUSE / RESET / FAST DEMO (3 h → 2.5 min)",
             "Offline cache: maps, rainfall, predictions, drainage, helplines", "ONLINE / DEGRADED / OFFLINE status"]
    fx, fy = x4 + 34, ry + 44
    for f_ in feats:
        w_ = 6.4 * len(f_) + 18
        if fx + w_ > x4 + w4 - 34:
            fx, fy = x4 + 34, fy + 26
        p.append(chip(fx, fy, w_, 22, f_, "#dbeafe", text_fill="#1d4ed8", size=10.5, weight=600, r=6))
        fx += w_ + 6

    # five questions
    qy = ry + 156
    p.append(box(x4 + 18, qy, w4 - 36, 96, 12, fill="#ecfdf5", stroke="#86efac"))
    p.append(txt(x4 + 34, qy + 26, "ANSWERS THE FIVE QUESTIONS", size=13, fill="#15803d", weight=800, anchor="start"))
    qs = [("WHERE", "flood extent & roads"), ("WHEN", "time-to-flooding"), ("HOW DEEP", "water depth"),
          ("WHY", "explainable factors"), ("WHAT ACTION", "alerts & routes")]
    qx = x4 + 34
    for name, sub in qs:
        w_ = max(8.2 * len(name) + 20, 6.2 * len(sub) + 20)
        p.append(g(box(qx, qy + 38, w_, 44, 8, fill="#ffffff", stroke="#86efac"),
                   txt(qx + w_ / 2, qy + 56, name, size=12, fill="#15803d", weight=800),
                   txt(qx + w_ / 2, qy + 72, sub, size=10, fill=MUTED, weight=500)))
        qx += w_ + 10

    # ---------------- connecting arrows between columns
    for (xa, xb) in ((x1 + w1, x2), (x2 + w2, x3), (x3 + w3, x4)):
        p.append(arrow(xa + 6, (top + bot) / 2, xb - 6, (top + bot) / 2, c="#94a3b8", sw=2.6))

    # ---------------- tech stack strip
    sy = bot + 16
    p.append(box(44, sy, W - 88, 158, 14, fill="#f8fafc", stroke=LINE))
    p.append(g(txt(96, sy + 66, "Tech", size=25, fill=INK, weight=800, anchor="start"),
               txt(96, sy + 96, "Stack", size=25, fill=INK, weight=800, anchor="start")))
    x0, x1_ = 210, W - 70
    step = (x1_ - x0) / len(STACK)
    for i, (label, glyph) in enumerate(STACK):
        cx = x0 + step * i + step / 2
        p.append(g(box(cx - 28, sy + 26, 56, 56, 14, fill="#ffffff", stroke=LINE),
                   f'<g transform="translate({cx - 18:.1f} {sy + 36}) scale(1.5)">{glyph}</g>',
                   txt(cx, sy + 104, label, size=11, fill=INK, weight=600)))
    p.append("</svg>")
    return "\n".join(p)


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    svg = os.path.join(here, "technical_approach_slide.svg")
    png = os.path.join(here, "technical_approach_slide.png")
    with open(svg, "w") as f:
        f.write(build())
    print("wrote", svg)
    chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if os.path.exists(chrome):
        subprocess.run([chrome, "--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
                        f"--screenshot={png}", f"--window-size={W},{H}", f"file://{svg}"], check=False, capture_output=True)
        print("wrote" if os.path.exists(png) else "PNG failed", png)


if __name__ == "__main__":
    main()
