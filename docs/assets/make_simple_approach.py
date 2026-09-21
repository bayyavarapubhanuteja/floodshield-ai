"""Plain-language "How FloodShield works" graphic (same blue colour pattern as the technical one).

    python docs/assets/make_simple_approach.py
Icons: Lucide (ISC licence), exported to docs/assets/icons.json.
"""
from __future__ import annotations

import json
import os
import re
import subprocess

from make_stack_image import (atom, bolt, cylinder, leaf, python_mark, scatter, ts_mark, txt, whale)

HERE = os.path.dirname(os.path.abspath(__file__))
ICONS = json.load(open(os.path.join(HERE, "icons.json")))
W, H = 2000, 880
NAVY, BLUE, BLUE2, TINT, EDGE, INK, MUTED = "#0b3a8c", "#1d6fd8", "#3b8ff0", "#eef5fd", "#d4e4f7", "#0b1f3a", "#475569"
GREEN, GTINT = "#15803d", "#ecfdf3"


def icon(name, x, y, size=34, colour=BLUE):
    inner = re.sub(r"^<svg[^>]*>|</svg>$", "", ICONS[name]).replace("COLOR", colour)
    s = size / 24
    return (f'<g transform="translate({x} {y}) scale({s:.3f})" fill="none" stroke="{colour}" stroke-width="2" '
            f'stroke-linecap="round" stroke-linejoin="round">{inner}</g>')


def box(x, y, w, h, r=12, fill="#fff", stroke=EDGE, sw=1.5):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'


def column(x, w, num, title, sub):
    return "".join([
        box(x, 16, w, 700, 18, fill="#ffffff", stroke=EDGE, sw=2),
        f'<path d="M{x + 18} 16h{w - 36}a18 18 0 0 1 18 18v58h-{w}v-58a18 18 0 0 1 18-18z" fill="url(#hdr)"/>',
        f'<circle cx="{x + 52}" cy="54" r="27" fill="{NAVY}"/>',
        txt(x + 52, 63, num, size=24, fill="#fff", weight=800),
        txt(x + 96, 50, title, size=25, fill="#fff", weight=800, anchor="start"),
        txt(x + 96, 76, sub, size=15.5, fill="#dbeafe", weight=500, anchor="start"),
    ])


def row(x, y, w, h, ic, title, sub=None, title_col=INK):
    out = [box(x, y, w, h, 12, fill=TINT, stroke=EDGE), icon(ic, x + 18, y + h / 2 - 17)]
    if sub:
        out += [txt(x + 72, y + h / 2 - 3, title, size=17, fill=title_col, weight=700, anchor="start"),
                txt(x + 72, y + h / 2 + 18, sub, size=14, fill=MUTED, weight=500, anchor="start")]
    else:
        out.append(txt(x + 72, y + h / 2 + 6, title, size=17, fill=title_col, weight=600, anchor="start"))
    return "".join(out)


def build() -> str:
    p = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Inter, Helvetica, Arial, sans-serif">',
         f'<defs><linearGradient id="hdr" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{BLUE}"/><stop offset="1" stop-color="{BLUE2}"/></linearGradient></defs>',
         f'<rect width="{W}" height="{H}" fill="#ffffff"/>']

    # 01 — what we collect
    x, w = 24, 440
    p.append(column(x, w, "01", "WHAT WE COLLECT", "Existing data · no sensors needed"))
    items = [("CloudRain", "Rain & weather", "Radar, satellite & weather services"),
             ("Mountain", "Land height maps", "Where water naturally collects"),
             ("Route", "Roads & drains", "City road and drainage maps"),
             ("History", "Past floods", "Records of earlier flood events"),
             ("Camera", "Photos & videos", "CCTV clips and uploaded images"),
             ("Megaphone", "Citizen reports", "Location, photo and water depth")]
    for i, (ic, t, s) in enumerate(items):
        p.append(row(x + 16, 112 + i * 98, w - 32, 84, ic, t, s))

    # 02 — how it works (flow)
    x, w = 482, 452
    p.append(column(x, w, "02", "HOW IT WORKS", "AI + water physics, step by step"))
    steps = [("CloudRain", "Predicts the rain", "Next 15 minutes to 3 hours"),
             ("Droplets", "Follows the water", "Downhill, into low-lying streets"),
             ("Network", "Checks the drains", "Can the pipes carry it away?"),
             ("MapPin", "Predicts street flooding", "Where, when and how deep"),
             ("Lightbulb", "Explains the risk", "Why each street is in danger")]
    for i, (ic, t, s) in enumerate(steps):
        y = 112 + i * 118
        p.append(box(x + 16, y, w - 32, 90, 12, fill=TINT, stroke=EDGE))
        p.append(f'<circle cx="{x + 52}" cy="{y + 45}" r="24" fill="#dbeafe"/>')
        p.append(icon(ic, x + 36, y + 29, 32))
        p.append(txt(x + 92, y + 40, f"{i + 1}. {t}", size=18.5, fill=BLUE, weight=800, anchor="start"))
        p.append(txt(x + 92, y + 64, s, size=14.5, fill=MUTED, weight=500, anchor="start"))
        if i < len(steps) - 1:
            cx = x + w / 2
            p.append(f'<path d="M{cx} {y + 94}v20M{cx - 7} {y + 107}l7 7 7-7" fill="none" stroke="{BLUE}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>')

    # 03 — what it delivers
    x, w = 952, 392
    p.append(column(x, w, "03", "WHAT IT DELIVERS", "From prediction to action"))
    outs = [("MapPin", "Street-level flood map"), ("Timer", "Time until flooding"),
            ("TriangleAlert", "Early warnings (Green → Red)"), ("Ambulance", "Safe routes for ambulances"),
            ("Hospital", "Hospitals & services at risk"), ("SlidersHorizontal", "What-if planning"),
            ("FileText", "One-click PDF reports"), ("Bot", "AI assistant for questions")]
    for i, (ic, t) in enumerate(outs):
        p.append(row(x + 16, 112 + i * 74, w - 32, 62, ic, t))

    # 04 — who it helps
    x, w = 1362, W - 24 - 1362
    p.append(column(x, w, "04", "WHO IT HELPS", "Officials, responders & citizens"))
    roles = [("Building2", "City officials", "Plan & act early"), ("Siren", "Emergency teams", "Respond faster"),
             ("BarChart3", "Analysts", "Study patterns"), ("Users", "Citizens", "Stay safe")]
    rw = (w - 32 - 3 * 12) / 4
    for i, (ic, t, s) in enumerate(roles):
        rx = x + 16 + i * (rw + 12)
        p.append(box(rx, 112, rw, 132, 12, fill=TINT, stroke=EDGE))
        p.append(f'<circle cx="{rx + rw / 2}" cy="{150}" r="26" fill="#dbeafe"/>')
        p.append(icon(ic, rx + rw / 2 - 17, 133, 34))
        p.append(txt(rx + rw / 2, 202, t, size=14.5, fill=INK, weight=800))
        p.append(txt(rx + rw / 2, 224, s, size=13.5, fill=MUTED, weight=500))
    # easy to use
    ey = 262
    p.append(box(x + 16, ey, w - 32, 222, 12, fill=TINT, stroke=EDGE))
    p.append(icon("ShieldCheck", x + 34, ey + 18, 30))
    p.append(txt(x + 74, ey + 42, "SIMPLE & RELIABLE", size=18, fill=BLUE, weight=800, anchor="start"))
    feats = ["Works on laptop and phone", "5 Indian languages", "Works with weak internet", "Live updates every 5 minutes",
             "Call 112 in one tap", "Ready for any Indian city"]
    for i, f in enumerate(feats):
        fx = x + 40 + (i % 2) * ((w - 60) / 2)
        fy = ey + 86 + (i // 2) * 44
        p.append(f'<circle cx="{fx + 11}" cy="{fy - 6}" r="11" fill="{BLUE}"/>')
        p.append(f'<path d="M{fx + 6} {fy - 6}l3.5 3.5 6.5-7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>')
        p.append(txt(fx + 32, fy, f, size=15.5, fill=INK, weight=600, anchor="start"))
    # five questions
    qy = 502
    p.append(box(x + 16, qy, w - 32, 198, 12, fill=GTINT, stroke="#bbf7d0"))
    p.append(f'<circle cx="{x + 50}" cy="{qy + 36}" r="16" fill="{GREEN}"/>')
    p.append(txt(x + 50, qy + 42, "?", size=18, fill="#fff", weight=800))
    p.append(txt(x + 78, qy + 43, "ANSWERS THE FIVE QUESTIONS", size=18, fill=GREEN, weight=800, anchor="start"))
    qs = [("WHERE", "will it flood?"), ("WHEN", "will it flood?"), ("HOW DEEP", "will it get?"), ("WHY", "is it at risk?"),
          ("WHAT", "should we do?")]
    qw = (w - 32 - 24 - 4 * 10) / 5
    for i, (a, b) in enumerate(qs):
        bx = x + 28 + i * (qw + 10)
        p.append(box(bx, qy + 76, qw, 100, 10, fill="#ffffff", stroke="#bbf7d0"))
        p.append(txt(bx + qw / 2, qy + 118, a, size=17, fill=GREEN, weight=800))
        p.append(txt(bx + qw / 2, qy + 144, b, size=13, fill=MUTED, weight=500))

    # built with
    by = 734
    p.append(box(24, by, W - 48, 128, 18, fill="#ffffff", stroke=EDGE, sw=2))
    p.append(txt(64, by + 60, "BUILT", size=26, fill=INK, weight=800, anchor="start"))
    p.append(txt(64, by + 92, "WITH", size=26, fill=INK, weight=800, anchor="start"))
    stack = [("React", atom("#61dafb")), ("TypeScript", ts_mark()), ("Python", python_mark()), ("FastAPI", bolt("#059669")),
             ("PostgreSQL", cylinder("#336791")), ("Leaflet maps", leaf("#16a34a")), ("scikit-learn", scatter("#f7931e")),
             ("Docker", whale("#2496ed"))]
    x0, x1 = 230, W - 330
    step = (x1 - x0) / len(stack)
    for i, (label, glyph) in enumerate(stack):
        cx = x0 + step * i + step / 2
        p.append(box(cx - 32, by + 18, 64, 64, 14, fill=TINT, stroke=EDGE))
        p.append(f'<g transform="translate({cx - 21} {by + 29}) scale(1.75)">{glyph}</g>')
        p.append(txt(cx, by + 108, label, size=14.5, fill=INK, weight=600))
    p.append(box(W - 310, by + 24, 262, 80, 14, fill=TINT, stroke=EDGE))
    p.append(txt(W - 179, by + 58, "100% software", size=19, fill=BLUE, weight=800))
    p.append(txt(W - 179, by + 84, "No sensors · No hardware", size=14, fill=MUTED, weight=600))
    p.append("</svg>")
    return "\n".join(p)


def main():
    svg, png = os.path.join(HERE, "approach_simple.svg"), os.path.join(HERE, "approach_simple.png")
    open(svg, "w").write(build())
    chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    subprocess.run([chrome, "--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
                    f"--screenshot={png}", f"--window-size={W},{H}", f"file://{svg}"], check=False, capture_output=True)
    print("wrote", svg, png if os.path.exists(png) else "(png failed)")


if __name__ == "__main__":
    main()
