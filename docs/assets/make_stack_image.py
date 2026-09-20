"""Generate the FloodShield AI technology-stack graphic (SVG, and PNG via headless Chrome).

All icons are drawn as simple geometric marks in each technology's brand colour — they are
stylised representations, not official logo files.

    python docs/assets/make_stack_image.py
"""
from __future__ import annotations

import html
import os
import subprocess
import sys

W, H = 1640, 900
BG, PANEL, LINE, INK, MUTED, BRAND = "#080d18", "#0f1726", "#24324a", "#e2e8f0", "#94a3b8", "#38bdf8"


def esc(s: str) -> str:
    return html.escape(s, quote=True)


# ---------------------------------------------------------------- icon glyphs (24x24 viewport)
def g(*parts: str) -> str:
    return "".join(parts)


def circle(cx, cy, r, fill="none", stroke="none", sw=2, op=1.0):
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" opacity="{op}"/>'


def path(d, fill="none", stroke="none", sw=2, cap="round", join="round", op=1.0):
    return (f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="{cap}" '
            f'stroke-linejoin="{join}" opacity="{op}"/>')


def rect(x, y, w, h, r=2, fill="none", stroke="none", sw=2, op=1.0):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" opacity="{op}"/>'


def txt(x, y, s, size=9, fill="#fff", weight=700, anchor="middle", family="Inter, Helvetica, Arial, sans-serif"):
    return (f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill}" text-anchor="{anchor}">{esc(s)}</text>')


def atom(c):  # React
    out = [circle(12, 12, 2.2, fill=c)]
    for rot in (0, 60, 120):
        out.append(f'<ellipse cx="12" cy="12" rx="10" ry="4" fill="none" stroke="{c}" stroke-width="1.5" transform="rotate({rot} 12 12)"/>')
    return g(*out)


def label_icon(c, s, size=9.5):  # coloured square with letters
    return g(txt(12, 15.5, s, size=size, fill=c))


def bolt(c):
    return path("M13 2 5 13h6l-1 9 9-12h-6l1-8z", fill=c)


def waves(c):
    return g(path("M3 10c2.5-4 5-4 7.5 0S16 14 18.5 10", stroke=c, sw=2.2),
             path("M3 16c2.5-4 5-4 7.5 0S16 20 18.5 16", stroke=c, sw=2.2, op=0.55))


def leaf(c):
    return g(path("M20 4C9 4 4 9 4 17c0 2 1 3 3 3 8 0 13-5 13-16z", fill=c, op=0.9),
             path("M6 19C10 14 14 11 18 9", stroke="#0b1220", sw=1.4))


def bars(c):
    return g(rect(4, 12, 3.6, 8, 1, fill=c), rect(10, 7, 3.6, 13, 1, fill=c, op=0.8), rect(16, 4, 3.6, 16, 1, fill=c, op=0.6))


def python_mark(a="#3776ab", b="#ffd43b"):
    return g(path("M12 2.5c-3.6 0-3.3 1.6-3.3 1.6V8h3.4v1H6.8S4 8.6 4 12.2s2.4 3.5 2.4 3.5h1.4v-2.3s-.1-2.4 2.3-2.4h3.4s2.3.1 2.3-2.2V4.6S16.2 2.5 12 2.5zM9.9 4.4a.85.85 0 1 1 0 1.7.85.85 0 0 1 0-1.7z", fill=a),
             path("M12 21.5c3.6 0 3.3-1.6 3.3-1.6V16h-3.4v-1h5.3S21 15.4 21 11.8s-2.4-3.5-2.4-3.5h-1.4v2.3s.1 2.4-2.3 2.4h-3.4s-2.3-.1-2.3 2.2v3.2s-.4 2.1 3.8 2.1zm2.1-1.9a.85.85 0 1 1 0-1.7.85.85 0 0 1 0 1.7z", fill=b))


def cylinder(c):
    return g(f'<ellipse cx="12" cy="6.5" rx="7.5" ry="3" fill="{c}"/>',
             path("M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11", fill=c, op=0.55),
             f'<ellipse cx="12" cy="12.5" rx="7.5" ry="3" fill="none" stroke="{c}" stroke-width="1.2" opacity="0.9"/>')


def layers(c):
    return g(path("M12 3 3 7.5 12 12l9-4.5L12 3z", fill=c),
             path("M3 12.5 12 17l9-4.5", stroke=c, sw=1.8, op=0.75),
             path("M3 17 12 21.5 21 17", stroke=c, sw=1.8, op=0.5))


def globe(c):
    return g(circle(12, 12, 9, stroke=c, sw=1.8),
             f'<ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="{c}" stroke-width="1.4"/>',
             path("M3 12h18", stroke=c, sw=1.4), path("M4.5 7.5h15M4.5 16.5h15", stroke=c, sw=1.1, op=0.7))


def graph_nodes(c):
    return g(path("M6 17 12 6l6 11M6 17h12", stroke=c, sw=1.5, op=0.85),
             circle(12, 6, 2.6, fill=c), circle(6, 17, 2.6, fill=c), circle(18, 17, 2.6, fill=c))


def grid_icon(c):
    out = []
    for i in range(3):
        for j in range(3):
            out.append(rect(4 + j * 5.6, 4 + i * 5.6, 4.4, 4.4, 1, fill=c, op=0.45 + 0.18 * ((i + j) % 3)))
    return g(*out)


def sine(c):
    return g(path("M3 12c3-8 6-8 9 0s6 8 9 0", stroke=c, sw=2.2), path("M3 20h18", stroke=c, sw=1.2, op=0.5))


def scatter(c):
    return g(path("M4 20V4M4 20h16", stroke=c, sw=1.4, op=0.7),
             circle(9, 15, 2, fill=c), circle(13, 10, 2, fill=c, op=0.8), circle(17, 7, 2, fill=c, op=0.6), circle(10, 8, 1.6, fill=c, op=0.5))


def tree(c):
    return g(path("M12 4v4M12 8 7 12M12 8l5 4M7 12v3M7 15l-2 3M7 15l2 3M17 12v3M17 15l-2 3M17 15l2 3", stroke=c, sw=1.5),
             circle(12, 4, 1.8, fill=c), circle(5, 19, 1.6, fill=c), circle(9, 19, 1.6, fill=c), circle(15, 19, 1.6, fill=c), circle(19, 19, 1.6, fill=c))


def opencv_mark():
    return g(path("M8.5 5.2a5 5 0 1 0 0 8.6", stroke="#dc2626", sw=3.4),
             path("M15.5 5.2a5 5 0 1 1 0 8.6", stroke="#16a34a", sw=3.4),
             path("M8.2 15.6a5 5 0 1 0 7.6 0", stroke="#2563eb", sw=3.4))


def bbox(c):
    return g(rect(4, 6, 16, 12, 1.5, stroke=c, sw=1.6),
             path("M4 6h3M17 6h3M4 18h3M17 18h3", stroke=c, sw=3),
             circle(12, 12, 2.4, fill=c, op=0.8))


def doc(c):
    return g(path("M6 3h8l4 4v14H6z", fill=c, op=0.85), path("M14 3v4h4", stroke="#0b1220", sw=1.3),
             path("M9 12h6M9 15h6M9 18h4", stroke="#0b1220", sw=1.3))


def whale(c):
    out = [rect(5 + i * 3.3, 11 - (i == 3) * 0, 2.8, 2.8, 0.5, fill=c) for i in range(4)]
    out += [rect(8.3, 7.8, 2.8, 2.8, 0.5, fill=c), rect(11.6, 7.8, 2.8, 2.8, 0.5, fill=c)]
    out.append(path("M3 16c3 3 7 4 10 4 5 0 8-2 9.5-6-2-.6-3.6-.3-4.6.5", fill=c, op=0.75))
    return g(*out)


def cloud_up(c):
    return g(path("M7 17a4 4 0 0 1 .6-8 5.5 5.5 0 0 1 10.3 1.6A3.6 3.6 0 0 1 17.5 17z", fill=c, op=0.85),
             path("M12 20v-6M9.5 16.5 12 14l2.5 2.5", stroke="#0b1220", sw=1.6))


def git_branch(c):
    return g(path("M7 6v12M7 12h6a4 4 0 0 0 4-4", stroke=c, sw=1.8),
             circle(7, 5, 2.4, fill=c), circle(7, 19, 2.4, fill=c), circle(17, 7, 2.4, fill=c))


def github_mark(c):
    return g(circle(12, 12, 9.5, fill=c),
             path("M12 5.6c-3.4 0-6.2 2.8-6.2 6.2 0 2.8 1.8 5.1 4.2 5.9.3.1.4-.1.4-.3v-1.2c-1.7.4-2.1-.7-2.1-.7-.3-.8-.7-1-.7-1-.6-.4 0-.4 0-.4.6 0 1 .7 1 .7.6 1 1.6.7 2 .6 0-.4.2-.7.4-.9-1.4-.2-2.8-.7-2.8-3.1 0-.7.2-1.2.6-1.7-.1-.2-.3-.8.1-1.7 0 0 .5-.2 1.7.6a5.8 5.8 0 0 1 3.1 0c1.2-.8 1.7-.6 1.7-.6.3.9.1 1.5.1 1.7.4.5.6 1 .6 1.7 0 2.4-1.5 2.9-2.8 3.1.2.2.4.6.4 1.2v1.8c0 .2.1.4.5.3a6.2 6.2 0 0 0 4.1-5.9c0-3.4-2.8-6.2-6.2-6.2z", fill="#0b1220"))


def flask(c):
    return g(path("M10 3v6L5 19a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 19l-5-10V3", stroke=c, sw=1.7),
             path("M9 3h6", stroke=c, sw=2), path("M7.5 15h9", stroke=c, sw=1.4, op=0.7))


def terminal(c):
    return g(rect(3, 5, 18, 14, 2, stroke=c, sw=1.6), path("M7 10l3 2.5-3 2.5M12.5 15h4", stroke=c, sw=1.6))


def key(c):
    return g(circle(8, 12, 3.6, stroke=c, sw=1.9), path("M11.5 12H21M18 12v3M15 12v2.4", stroke=c, sw=1.9))


def shield_check(c):
    return g(path("M12 3 5 6v6c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V6z", fill=c, op=0.85), path("M8.6 12.2l2.4 2.3 4.4-4.6", stroke="#0b1220", sw=1.8))


def arrows(c):
    return g(path("M4 9h12l-3-3M20 15H8l3 3", stroke=c, sw=1.9))


def polygon_icon(c):
    return g(path("M12 3 21 9.5 17.5 20h-11L3 9.5z", fill=c, op=0.5, stroke=c, sw=1.6),
             *[circle(x, y, 1.6, fill=c) for x, y in ((12, 3), (21, 9.5), (17.5, 20), (6.5, 20), (3, 9.5))])


def motion(c):
    return g(path("M6 3h12v6H6zM6 9h12l-6 6zM6 15h6v6H6z", fill=c, op=0.9))


def claude_mark(c="#D97757"):
    rays = []
    import math
    for k in range(8):
        a = k * math.pi / 4
        x1, y1 = 12 + 2.4 * math.cos(a), 12 + 2.4 * math.sin(a)
        x2, y2 = 12 + 9.2 * math.cos(a), 12 + 9.2 * math.sin(a)
        rays.append(path(f"M{x1:.1f} {y1:.1f}L{x2:.1f} {y2:.1f}", stroke=c, sw=3.0 if k % 2 == 0 else 2.0))
    return g(*rays, circle(12, 12, 2.2, fill=c))


def chatgpt_mark(c="#10a37f"):
    return g(path("M12 3.4 18.1 7v7L12 17.6 5.9 14V7z", fill="none", stroke=c, sw=2),
             path("M12 3.4v6.9l6.1 3.7M12 10.3 5.9 14M12 10.3v7.3", stroke=c, sw=1.6, op=0.9),
             circle(12, 10.3, 1.8, fill=c))


def cursor_mark(c):
    return g(path("M6 3l13 7.5-5.6 1.6L10.5 18z", fill=c, op=0.9), path("M6 3v15", stroke=c, sw=1.2, op=0.5))


def html_mark(c="#e34f26"):
    return g(path("M4 3h16l-1.5 16L12 21l-6.5-2z", fill=c, op=0.9), txt(12, 15.5, "5", size=9, fill="#0b1220"))


def css_mark(c="#1572b6"):
    return g(path("M4 3h16l-1.5 16L12 21l-6.5-2z", fill=c, op=0.9), txt(12, 15.5, "3", size=9, fill="#fff"))


def sql_mark(c):
    return g(cylinder(c))


def md_mark(c):
    return g(rect(3, 6, 18, 12, 2, stroke=c, sw=1.6), path("M6.5 15V9l2.5 3 2.5-3v6M16 9v6M13.8 12.6 16 15l2.2-2.4", stroke=c, sw=1.5))


def js_mark(c="#f7df1e"):
    return g(rect(3, 3, 18, 18, 3, fill=c), txt(12, 16.5, "JS", size=9.5, fill="#0b1220"))


def ts_mark(c="#3178c6"):
    return g(rect(3, 3, 18, 18, 3, fill=c), txt(12, 16.5, "TS", size=9.5, fill="#fff"))


# ---------------------------------------------------------------- content
PANELS = [
    ("Frontend", "#38bdf8", [
        ("React 18", atom("#61dafb")), ("TypeScript", ts_mark()), ("Vite", bolt("#a855f7")),
        ("Tailwind CSS", waves("#38bdf8")), ("Framer Motion", motion("#e879f9")), ("Leaflet", leaf("#4ade80")),
        ("Recharts", bars("#22d3ee")), ("Lucide icons", shield_check("#94a3b8")),
    ]),
    ("Backend & API", "#22c55e", [
        ("Python 3.11", python_mark()), ("FastAPI", bolt("#059669")), ("Uvicorn", arrows("#6366f1")),
        ("Pydantic v2", shield_check("#e11d48")), ("SQLAlchemy 2", cylinder("#b45309")),
        ("WebSockets", arrows("#38bdf8")), ("JWT + bcrypt", key("#eab308")), ("ReportLab PDF", doc("#0ea5e9")),
    ]),
    ("Data & GIS", "#a78bfa", [
        ("PostgreSQL", cylinder("#336791")), ("PostGIS", globe("#4f9d5b")), ("Redis", layers("#dc2626")),
        ("GeoJSON", polygon_icon("#38bdf8")), ("Shapely", polygon_icon("#f97316")), ("PyProj", globe("#0ea5e9")),
        ("NetworkX", graph_nodes("#7dd3fc")), ("SRTM / DEM grid", grid_icon("#84cc16")),
    ]),
    ("AI, ML & Vision", "#f472b6", [
        ("NumPy", grid_icon("#4d77cf")), ("SciPy", sine("#0f4c81")), ("scikit-learn", scatter("#f7931e")),
        ("Gradient boosting", tree("#22c55e")), ("LightGBM / XGBoost", tree("#84cc16")), ("OpenCV", opencv_mark()),
        ("YOLOv8 (optional)", bbox("#a855f7")), ("SCS-CN + Manning", sine("#38bdf8")),
    ]),
    ("DevOps & Deployment", "#fbbf24", [
        ("Docker", whale("#2496ed")), ("Docker Compose", layers("#2496ed")), ("Nginx", leaf("#009639")),
        ("Render", cloud_up("#8b5cf6")), ("GitHub", github_mark("#e2e8f0")), ("Git", git_branch("#f05032")),
        ("pytest (65 tests)", flask("#22c55e")), ("Make / Bash", terminal("#94a3b8")),
    ]),
    ("Languages", "#38bdf8", [
        ("Python", python_mark()), ("TypeScript", ts_mark()), ("JavaScript", js_mark()), ("SQL", sql_mark("#336791")),
        ("HTML5", html_mark()), ("CSS3", css_mark()), ("Bash", terminal("#a3e635")), ("Markdown", md_mark("#94a3b8")),
    ]),
]

ASSISTANTS = [
    ("Claude (Claude Code)", claude_mark(), "Architecture, engines, APIs, UI, docs"),
    ("ChatGPT", chatgpt_mark(), "Research & idea refinement"),
]


def icon_tile(x, y, label, glyph, size=46):
    s = size / 24
    return g(
        rect(x, y, size, size, 12, fill="#16203400", stroke=LINE, sw=1),
        rect(x, y, size, size, 12, fill="#ffffff", sw=0, op=0.04),
        f'<g transform="translate({x + size * 0.17:.1f} {y + size * 0.17:.1f}) scale({s * 0.66:.3f})">{glyph}</g>',
        txt(x + size / 2, y + size + 15, label, size=11, fill=MUTED, weight=600),
    )


def panel(x, y, w, h, title, colour, items):
    out = [rect(x, y, w, h, 16, fill=PANEL, stroke=LINE, sw=1.2),
           rect(x, y, 4, h, 2, fill=colour),
           txt(x + 22, y + 30, title.upper(), size=13.5, fill=colour, weight=800, anchor="start")]
    cols = 4
    gapx = (w - 44) / cols
    for i, (label, glyph) in enumerate(items):
        cx = x + 22 + (i % cols) * gapx + gapx / 2 - 23
        cy = y + 52 + (i // cols) * 86
        out.append(icon_tile(cx, cy, label, glyph))
    return g(*out)


def build_svg() -> str:
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Inter, Helvetica, Arial, sans-serif">',
             f'<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#070c16"/><stop offset="0.55" stop-color="#0b1524"/><stop offset="1" stop-color="#0a1a2a"/></linearGradient>'
             f'<linearGradient id="hl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#22c55e"/></linearGradient></defs>',
             rect(0, 0, W, H, 0, fill="url(#bg)")]
    # header
    parts.append(g(
        f'<g transform="translate(56 40) scale(1.7)"><path fill="#0ea5e9" d="M32 4 8 12v18c0 15 10 26 24 30 14-4 24-15 24-30V12L32 4z" transform="scale(0.55)"/>'
        f'<path fill="#fff" d="M32 18c-5 7-10 13-10 19a10 10 0 0 0 20 0c0-6-5-12-10-19z" transform="scale(0.55)"/></g>',
        txt(122, 68, "FLOODSHIELD AI", size=34, fill=INK, weight=800, anchor="start"),
        txt(408, 68, "· TECHNOLOGY STACK", size=20, fill=BRAND, weight=700, anchor="start"),
        txt(122, 94, "Urban Flood Nowcasting System (SIH26085) — Predict the Flood. Protect the City. Respond Before Impact.", size=14, fill=MUTED, weight=500, anchor="start"),
        rect(W - 372, 44, 316, 54, 12, fill="#0ea5e91a", stroke="#0ea5e955", sw=1.2),
        txt(W - 214, 70, "100% SOFTWARE PLATFORM", size=14, fill="#38bdf8", weight=800),
        txt(W - 214, 88, "No IoT · No sensors · No hardware", size=11.5, fill=MUTED, weight=600),
    ))
    # panels 3 x 2
    px, py, pw, ph, gap = 56, 130, (W - 112 - 2 * 28) / 3, 236, 26
    for i, (title, colour, items) in enumerate(PANELS):
        x = px + (i % 3) * (pw + gap)
        y = py + (i // 3) * (ph + gap)
        parts.append(panel(x, y, pw, ph, title, colour, items))
    # assistants + pipeline strip
    ay = py + 2 * (ph + gap)
    aw = W - 112
    ah = 176
    parts.append(rect(px, ay, aw, ah, 16, fill=PANEL, stroke=LINE, sw=1.2))
    parts.append(rect(px, ay, 4, ah, 2, fill="#D97757"))
    parts.append(txt(px + 22, ay + 30, "BUILT WITH AI ASSISTANCE", size=13.5, fill="#D97757", weight=800, anchor="start"))
    for i, (name, glyph, role) in enumerate(ASSISTANTS):
        bx = px + 26
        by = ay + 46 + i * 62
        parts.append(g(rect(bx, by, 386, 54, 12, fill="#ffffff", sw=0, op=0.04),
                       rect(bx, by, 386, 54, 12, fill="none", stroke=LINE, sw=1),
                       f'<g transform="translate({bx + 14} {by + 13}) scale(1.2)">{glyph}</g>',
                       txt(bx + 62, by + 25, name, size=14, fill=INK, weight=700, anchor="start"),
                       txt(bx + 62, by + 43, role, size=11.5, fill=MUTED, weight=500, anchor="start")))
    # pipeline chips, wrapped to the panel width
    steps = ["Weather / radar", "AI nowcast", "DEM & terrain", "Runoff", "Surface flow", "Drainage hydraulics",
             "Coupled flood", "Street-level risk", "Early warning", "Emergency routing", "Municipal response"]
    ox = px + 452
    right = px + aw - 26
    parts.append(txt(ox, ay + 30, "END-TO-END PIPELINE", size=13.5, fill=BRAND, weight=800, anchor="start"))
    cx_, cy_ = ox, ay + 48
    for i, stp in enumerate(steps):
        cw = 8.4 * len(stp) + 26
        if cx_ + cw > right:
            cx_, cy_ = ox, cy_ + 40
        parts.append(g(rect(cx_, cy_, cw, 30, 9, fill="#38bdf81a", stroke="#38bdf855", sw=1),
                       txt(cx_ + cw / 2, cy_ + 20, stp, size=11.5, fill="#7dd3fc", weight=700)))
        cx_ += cw + 10
        if i < len(steps) - 1 and cx_ + 16 < right:
            parts.append(txt(cx_ - 5, cy_ + 20, "\u203a", size=13, fill="#475569", weight=700))
    parts.append(txt(W / 2, H - 22, "Deterministic demo datasets are clearly labelled in-product: LIVE · HISTORICAL · SIMULATED · DEMO · MODEL PREDICTION · USER-REPORTED",
                     size=11.5, fill="#64748b", weight=500))
    parts.append("</svg>")
    return "\n".join(parts)


# ---------------------------------------------------------------- compact strip (7 icons)
TW, TH = 1800, 300
CORE = [
    ("React + TypeScript", g(atom("#61dafb"))),
    ("Python 3.11", python_mark()),
    ("FastAPI", bolt("#059669")),
    ("PostgreSQL + PostGIS", cylinder("#336791")),
    ("Leaflet GIS", leaf("#4ade80")),
    ("scikit-learn + OpenCV", scatter("#f7931e")),
    ("Docker", whale("#2496ed")),
]


def build_thin_svg() -> str:
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{TW}" height="{TH}" viewBox="0 0 {TW} {TH}" font-family="Inter, Helvetica, Arial, sans-serif">',
             '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#070c16"/><stop offset="1" stop-color="#0a1a2a"/></linearGradient></defs>',
             rect(0, 0, TW, TH, 0, fill="url(#bg)"),
             rect(28, 28, TW - 56, TH - 56, 20, fill=PANEL, stroke=LINE, sw=1.4),
             rect(28, 28, 5, TH - 56, 3, fill=BRAND)]
    parts.append(g(
        f'<g transform="translate(64 60) scale(1.15)"><path fill="#0ea5e9" d="M32 4 8 12v18c0 15 10 26 24 30 14-4 24-15 24-30V12L32 4z" transform="scale(0.55)"/>'
        f'<path fill="#fff" d="M32 18c-5 7-10 13-10 19a10 10 0 0 0 20 0c0-6-5-12-10-19z" transform="scale(0.55)"/></g>',
        txt(112, 88, "FLOODSHIELD AI", size=26, fill=INK, weight=800, anchor="start"),
        txt(112, 112, "Technology stack · software-only (no IoT / sensors)", size=13, fill=MUTED, weight=500, anchor="start")))
    n = len(CORE)
    x0, x1 = 64, TW - 64
    step = (x1 - x0) / n
    for i, (label, glyph) in enumerate(CORE):
        cx = x0 + step * i + step / 2
        y = 150
        parts.append(g(rect(cx - 34, y, 68, 68, 18, fill="#ffffff", sw=0, op=0.05),
                       rect(cx - 34, y, 68, 68, 18, fill="none", stroke=LINE, sw=1.1),
                       f'<g transform="translate({cx - 21:.1f} {y + 13}) scale(1.75)">{glyph}</g>',
                       txt(cx, y + 92, label, size=12.5, fill=MUTED, weight=600)))
    parts.append("</svg>")
    return "\n".join(parts)


# ---------------------------------------------------------------- AI tools strip
AW, AH = 1800, 330
AI_TOOLS = [
    ("Claude (Claude Code)", claude_mark(), "Architecture, engines, APIs, UI, tests, docs"),
    ("ChatGPT", chatgpt_mark(), "Research and idea refinement"),
]
AI_IN_PRODUCT = ["Gradient-boosted rainfall nowcast", "16-member ensemble uncertainty", "Flood-susceptibility classifier",
                 "OpenCV flood-image analysis", "Grounded retrieval Copilot"]


def build_ai_svg() -> str:
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{AW}" height="{AH}" viewBox="0 0 {AW} {AH}" font-family="Inter, Helvetica, Arial, sans-serif">',
             '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#070c16"/><stop offset="1" stop-color="#160f14"/></linearGradient></defs>',
             rect(0, 0, AW, AH, 0, fill="url(#bg)"),
             rect(28, 28, AW - 56, AH - 56, 20, fill=PANEL, stroke=LINE, sw=1.4),
             rect(28, 28, 5, AH - 56, 3, fill="#D97757"),
             txt(64, 78, "AI TOOLS USED TO BUILD FLOODSHIELD AI", size=20, fill="#D97757", weight=800, anchor="start"),
             txt(64, 104, "SIH26085 · Urban Flood Nowcasting System", size=13, fill=MUTED, weight=500, anchor="start")]
    for i, (name, glyph, role) in enumerate(AI_TOOLS):
        x = 64 + i * 430
        y = 130
        parts.append(g(rect(x, y, 400, 86, 16, fill="#ffffff", sw=0, op=0.05),
                       rect(x, y, 400, 86, 16, fill="none", stroke=LINE, sw=1.1),
                       f'<g transform="translate({x + 22} {y + 22}) scale(1.75)">{glyph}</g>',
                       txt(x + 92, y + 40, name, size=16, fill=INK, weight=700, anchor="start"),
                       txt(x + 92, y + 62, role, size=12, fill=MUTED, weight=500, anchor="start")))
    ox = 64 + 2 * 430 + 20
    parts.append(txt(ox, 150, "AI RUNNING INSIDE THE PLATFORM", size=13, fill=BRAND, weight=800, anchor="start"))
    for i, item in enumerate(AI_IN_PRODUCT):
        parts.append(g(circle(ox + 7, 174 + i * 26, 3.5, fill=BRAND),
                       txt(ox + 22, 179 + i * 26, item, size=13, fill=MUTED, weight=500, anchor="start")))
    parts.append(txt(64, AH - 52, "Written with AI assistance and reviewed by the team · no AI service is required at runtime",
                     size=12, fill="#64748b", weight=500, anchor="start"))
    parts.append("</svg>")
    return "\n".join(parts)


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    svg_path = os.path.join(here, "tech_stack.svg")
    png_path = os.path.join(here, "tech_stack.png")
    with open(svg_path, "w") as f:
        f.write(build_svg())
    print("wrote", svg_path)
    ai_svg = os.path.join(here, "ai_tools.svg")
    ai_png = os.path.join(here, "ai_tools.png")
    with open(ai_svg, "w") as f:
        f.write(build_ai_svg())
    print("wrote", ai_svg)
    thin_svg = os.path.join(here, "tech_stack_strip.svg")
    thin_png = os.path.join(here, "tech_stack_strip.png")
    with open(thin_svg, "w") as f:
        f.write(build_thin_svg())
    print("wrote", thin_svg)
    chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if os.path.exists(chrome):
        subprocess.run([chrome, "--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
                        f"--screenshot={png_path}", f"--window-size={W},{H}", "--default-background-color=00000000",
                        f"file://{svg_path}"], check=False, capture_output=True)
        subprocess.run([chrome, "--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
                        f"--screenshot={thin_png}", f"--window-size={TW},{TH}", f"file://{thin_svg}"], check=False, capture_output=True)
        subprocess.run([chrome, "--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
                        f"--screenshot={ai_png}", f"--window-size={AW},{AH}", f"file://{ai_svg}"], check=False, capture_output=True)
        for p_ in (png_path, thin_png, ai_png):
            print("wrote" if os.path.exists(p_) else "PNG render failed for", p_)


if __name__ == "__main__":
    main()
