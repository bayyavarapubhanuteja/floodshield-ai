"""FloodShield AI Copilot — grounded question answering.

Design rule: the Copilot NEVER generates measurements. It classifies the intent, retrieves
records from the live engine snapshot (or runs the What-If engine), and renders answers
from those records only. Every answer returns its sources, data labels, event time and
confidence. Unknown questions get a capability list instead of a guess.
"""
from __future__ import annotations

import re

from app.engines.risk import LEVELS
from app.engines.simulation import run_whatif
from app.engines.world import get_world

INTENTS = [
    ("whatif_blockage", r"(block|clog|choke).*(\d+)\s*%|(\d+)\s*%.*(block|clog|choke)"),
    ("whatif_rain", r"(\d+(\.\d+)?)\s*(mm\s*/?\s*(hr|h|hour))"),
    ("summary", r"summary|sitrep|situation report|brief|overview|response plan"),
    ("hospitals", r"hospital|medical|health cent"),
    ("infrastructure", r"infrastructure|substation|school|police station|fire station|shelter|metro|railway|bus"),
    ("drains", r"drain|manhole|sewer|overload|pipe|culvert|nala"),
    ("unsafe_roads", r"unsafe|impassable|closed road|avoid|which roads|roads? (will|to) (become|be)"),
    ("why", r"\bwhy\b|explain|reason|cause"),
    ("flood_next", r"(flood|inundat|waterlog).*(next|hour|60|soon|coming)|which (areas|wards|localities)"),
    ("rain", r"rain|precip|nowcast|storm|forecast"),
    ("alerts", r"alert|warning|red|orange"),
    ("route", r"route|path|reach|go to|travel"),
]


def _fmt_depth(d: float) -> str:
    return f"{d:.2f} m"


def _match_entity(q: str, snap: dict):
    ql = q.lower()
    w = get_world(snap["city"])
    for m in re.findall(r"\b(r\d{3}|mh\d{4}|in\d{3}|j\d{4}|of\d{2})\b", ql):
        m = m.upper()
        if m.startswith("R"):
            r = next((x for x in snap["roads"] if x["id"] == m), None)
            if r:
                return "road", r
        if m.startswith(("MH", "IN", "OF")):
            d = next((x for x in snap["drains"] if x["id"] == m), None)
            if d:
                return "drain", d
        if m.startswith("J"):
            return "junction", m
    for f in snap["facilities"]:
        if f["name"].lower() in ql:
            return "facility", f
    streets = sorted({r["street"] for r in snap["roads"]}, key=len, reverse=True)
    for s in streets:
        if s.lower() in ql:
            cands = [r for r in snap["roads"] if r["street"] == s]
            ward = next((wd["name"] for wd in snap["wards"] if wd["name"].lower() in ql), None)
            if ward:
                cands = [r for r in cands if r["ward"] == ward] or cands
            return "road", max(cands, key=lambda r: r["risk_score"])
    for wd in snap["wards"]:
        if wd["name"].lower() in ql:
            return "ward", wd
    return None, None


def _src(snap: dict, *labels: str) -> dict:
    return {"event_minute": snap["event_minute"], "issued_at": snap["issued_at"], "data_labels": list(labels),
            "sources": ["Coupled flood engine snapshot", "Rainfall nowcast", "Drainage digital twin"]}


def answer(question: str, snap: dict, city: str) -> dict:
    q = question.strip()
    ql = q.lower()
    intent = next((name for name, pat in INTENTS if re.search(pat, ql)), "help")
    k = snap["kpis"]
    conf = k.get("nowcast_confidence_60") or 0.7
    data: dict = {}
    lines: list[str] = []

    if intent == "flood_next":
        wards = sorted([wd for wd in snap["wards"] if wd["flooded_roads_60"] > 0 or wd["alert_level"] in ("ORANGE", "RED")],
                       key=lambda x: (-["GREEN", "YELLOW", "ORANGE", "RED"].index(x["alert_level"]), -x["max_depth_60_m"]))
        roads = sorted([r for r in snap["roads"] if r["depth_forecast_m"][60] >= 0.15 and r["depth_now_m"] < 0.15],
                       key=lambda r: (r["time_to_flood_min"] or 999))
        lines.append(f"**Areas expected to flood within the next 60 minutes** (event minute {snap['event_minute']}, nowcast confidence {conf*100:.0f}%):")
        if not wards:
            lines.append("- No ward is forecast to flood in the next hour.")
        for wd in wards[:8]:
            ttf = f"~{wd['time_to_flood_min']} min" if wd["time_to_flood_min"] is not None else "—"
            lines.append(f"- **{wd['name']}** — {wd['alert_level']} alert, max depth {_fmt_depth(wd['max_depth_60_m'])}, "
                         f"{wd['flooded_roads_60']} road(s) flooded by +60 min, time-to-flood {ttf}.")
        if roads:
            lines.append("\n**Roads newly flooding in the next hour:** " + ", ".join(
                f"{r['name']} (in {r['time_to_flood_min']} min → {_fmt_depth(r['depth_forecast_m'][60])})" for r in roads[:8]))
        data = {"wards": wards[:8], "roads": [{"id": r["id"], "name": r["name"], "ttf": r["time_to_flood_min"]} for r in roads[:12]]}

    elif intent == "why":
        kind, ent = _match_entity(q, snap)
        if kind is None:
            ent = max(snap["roads"], key=lambda r: r["risk_score"])
            kind = "road"
            lines.append("_No specific location recognised — explaining the highest-risk location._\n")
        if kind == "road":
            lines.append(f"**Why {ent['name']} is {ent['risk_level'].replace('_', ' ')} risk**")
            lines.append(ent["explanation"])
            lines.append("\n**Contributing factors (explainable risk model):**")
            for f in ent["factors"][:6]:
                lines.append(f"- {f['label']}: normalised value {f['value']:.2f} × weight {f['weight']} → {f['contribution_pct']:.0f}% of score")
            lines.append(f"\nRisk score {ent['risk_score']:.2f}; ML susceptibility {ent['ml_susceptibility']*100:.0f}%; confidence {ent['confidence']*100:.0f}%.")
            data = {"road": {k_: ent[k_] for k_ in ("id", "name", "risk_level", "risk_score", "factors", "depth_now_m", "depth_forecast_m")}}
        elif kind in ("junction",):
            roads = [r for r in snap["roads"] if ent in (get_world(city).road(r["id"])["from"], get_world(city).road(r["id"])["to"])]
            worst = max(roads, key=lambda r: r["risk_score"]) if roads else None
            lines.append(f"**Junction {ent}** connects {len(roads)} road segments.")
            if worst:
                lines.append(worst["explanation"])
            data = {"junction": ent, "roads": [r["id"] for r in roads]}
        elif kind == "ward":
            lines.append(f"**{ent['name']}: alert {ent['alert_level']}, risk {ent['risk_level']}**")
            for t in ent["triggers"]:
                lines.append(f"- Triggered by {t['metric'].replace('_', ' ')} = {t['value']} (≥ {t['level']} threshold {t['threshold']})")
            lines.append(f"- Urban Flood Vulnerability Index {ent['ufvi']} ({ent['ufvi_class']}); drainage utilisation {ent['drainage_utilization']*100:.0f}%; "
                         f"forecast rain up to {ent['rain_60_max_mm_hr']} mm/hr; max depth {_fmt_depth(ent['max_depth_60_m'])} within 60 min.")
            data = {"ward": ent}
        elif kind == "drain":
            lines.append(f"**Drain node {ent['id']} ({ent['kind']}, {ent['ward']}) — {ent['status']}**")
            lines.append(f"- Utilisation {ent['utilization']*100:.0f}% (inflow {ent['inflow_m3s']:.2f} m³/s vs effective capacity {ent['effective_capacity_m3s']:.2f} m³/s)")
            lines.append(f"- Assumed blockage {ent['blockage']*100:.0f}% ({ent['days_since_cleaning']} days since cleaning; SIMULATED assumption)")
            lines.append(f"- Overflow this step {ent['overflow_m3']} m³; backflow: {'yes' if ent['backflow'] else 'no'}; forecast +60 min: {ent['status_60']}")
            data = {"drain": ent}
        else:
            lines.append(f"**{ent['name']}** — status {ent['status']}, site depth {_fmt_depth(ent['site_depth_now_m'])}, "
                         f"{len(ent['access_roads_flooded'])} access road(s) flooded; {ent['reachable_network_pct']}% of network reachable by ambulance.")
            data = {"facility": ent}

    elif intent == "unsafe_roads":
        rs = sorted([r for r in snap["roads"] if r["passability_60"] not in ("PASSABLE", "PASSABLE_WITH_CAUTION")],
                    key=lambda r: -r["depth_forecast_m"][60])
        lines.append(f"**{len(rs)} road segment(s) unsafe by +60 min** ({k['flooded_roads_now']} flooded now):")
        for r in rs[:12]:
            lines.append(f"- {r['name']}: {_fmt_depth(r['depth_now_m'])} now → {_fmt_depth(r['depth_forecast_m'][60])} at +60 min "
                         f"({r['passability_60'].replace('_', ' ').lower()}); risk {r['risk_level']}")
        data = {"roads": [{"id": r["id"], "name": r["name"], "depth_60": r["depth_forecast_m"][60], "passability_60": r["passability_60"]} for r in rs]}

    elif intent in ("hospitals", "infrastructure"):
        kinds = ("hospital",) if intent == "hospitals" else None
        fs = [f for f in snap["facilities"] if (kinds is None or f["kind"] in kinds)]
        aff = [f for f in fs if f["status"] != "OPERATIONAL"]
        label = "hospitals" if intent == "hospitals" else "critical facilities"
        lines.append(f"**{len(aff)} of {len(fs)} {label} affected** (facility locations are DEMO data):")
        for f in sorted(aff, key=lambda f: -LEVELS.index(f["risk_level"])):
            alt = f" → alternative: {f['alternative']['name']}" + (f" ({f['alternative']['travel_time_min']} min)" if f['alternative'] and f['alternative']['travel_time_min'] else "") if f.get("alternative") else ""
            lines.append(f"- **{f['name']}** ({f['kind'].replace('_', ' ')}): {f['status'].replace('_', ' ')}, site depth {_fmt_depth(f['site_depth_now_m'])} "
                         f"(+60: {_fmt_depth(f['site_depth_60_m'])}), ambulance reach {f['reachable_network_pct']}%{alt}")
        if not aff:
            lines.append(f"- All {label} are currently operational and accessible.")
        data = {"facilities": aff}

    elif intent == "drains":
        ds = sorted([d for d in snap["drains"] if d["status"] in ("OVERLOADED", "OVERFLOW") and d["kind"] != "outfall"],
                    key=lambda d: -d["utilization"])
        bn = [e for e in snap["edges"] if e["bottleneck"]]
        sc = k["drainage_state_counts"]
        lines.append(f"**Drainage network:** {sc['OVERFLOW']} overflowing, {sc['OVERLOADED']} overloaded, {sc['NEAR_CAPACITY']} near capacity, "
                     f"{sc['HIGH_LOAD']} high load, {sc['NORMAL']} normal (mean utilisation {k['drainage_utilization_mean']*100:.0f}%).")
        for d in ds[:10]:
            lines.append(f"- {d['id']} ({d['ward']}): {d['status']} at {d['utilization']*100:.0f}% utilisation, overflow {d['overflow_m3']} m³, "
                         f"assumed blockage {d['blockage']*100:.0f}%")
        if bn:
            lines.append(f"\n**Bottleneck conduits:** " + ", ".join(f"{e['id']} ({'legacy undersized' if e['legacy_undersized'] else 'adverse grade'}, {e['utilization']*100:.0f}%)" for e in bn[:8]))
        data = {"drains": ds[:20], "bottlenecks": bn[:20]}

    elif intent == "whatif_rain":
        m = re.search(r"(\d+(\.\d+)?)\s*mm", ql)
        val = float(m.group(1))
        dm = re.search(r"(\d+)\s*(min|minutes)", ql)
        hm = re.search(r"(\d+(\.\d+)?)\s*(hour|hr)s?\b(?!.*mm)", ql)
        dur = int(dm.group(1)) if dm else int(float(hm.group(1)) * 60) if hm and "for" in ql else 120
        res = run_whatif(city, {"rainfall_intensity": val, "duration_min": dur})
        lines.append(f"**What-If: constant {val:.0f} mm/hr for {dur} min** (SIMULATED scenario vs baseline demo storm)")
        lines += _whatif_lines(res)
        data = {"whatif": {k_: res[k_] for k_ in ("baseline", "scenario", "delta", "headline")}}
        data["whatif"]["baseline"] = res["baseline"]["summary"]
        data["whatif"]["scenario"] = res["scenario"]["summary"]

    elif intent == "whatif_blockage":
        m = re.search(r"(\d+)\s*%", ql)
        val = float(m.group(1))
        res = run_whatif(city, {"blockage_pct": val})
        lines.append(f"**What-If: {val:.0f}% drainage blockage across the network** (SIMULATED; baseline uses assumed per-drain blockage)")
        lines += _whatif_lines(res)
        data = {"whatif": {"baseline": res["baseline"]["summary"], "scenario": res["scenario"]["summary"], "delta": res["delta"], "headline": res["headline"]}}

    elif intent == "summary":
        a = snap["alerts"]
        lines.append(f"## Flood Response Summary — {snap['city_name']} (event minute {snap['event_minute']})")
        lines.append(f"**Rainfall:** {k['rain_now_mm_hr']} mm/hr now ({k['rain_category']}), {k['rain_cum_mm']} mm so far; "
                     f"forecast {k['rain_3h_forecast_mm']} mm over next 3 h, peak {k['rain_peak_forecast_mm_hr']} mm/hr.")
        lines.append(f"**Flooding:** {k['flooded_area_km2']} km² inundated, max depth {k['max_depth_m']} m (→ {k['max_depth_60_m']} m at +60 min); "
                     f"{k['flooded_roads_now']} roads flooded now, {k['flooded_roads_60']} by +60 min, {k['impassable_roads']} impassable.")
        lines.append(f"**Drainage:** {k['drainage_overloaded']} nodes overloaded/overflowing; mean utilisation {k['drainage_utilization_mean']*100:.0f}%.")
        lines.append(f"**Alerts:** {k['alert_counts']['RED']} RED, {k['alert_counts']['ORANGE']} ORANGE, {k['alert_counts']['YELLOW']} YELLOW. Worst ward: {k['worst_ward']} ({k['worst_ward_level']}).")
        lines.append(f"**Critical infrastructure:** {k['affected_facilities']} of {k['total_facilities']} facilities affected.")
        lines.append("\n**Priority actions:**")
        for al in a[:4]:
            lines.append(f"- [{al['level']}] {al['location']}: {al['recommended_actions']['authority'][0]}")
        for f in [f for f in snap["facilities"] if f["status"] in ("FLOODED", "ISOLATED")][:3]:
            alt = f['alternative']['name'] if f.get('alternative') else 'none available'
            lines.append(f"- Redirect patients/services from {f['name']} ({f['status']}) → {alt}")
        lines.append("- Keep 112 and district EOC (1077) lines staffed; publish multilingual citizen advisories.")
        data = {"kpis": k, "alerts": [{"id": x["id"], "level": x["level"], "location": x["location"]} for x in a]}

    elif intent == "rain":
        nc = snap["nowcast"]
        lines.append(f"**Rainfall nowcast** (issued event minute {snap['event_minute']}; model: {nc['model']})")
        lines.append(f"Current city-mean {nc['current_mean_mm_hr']} mm/hr, trend {nc['trend_mm_hr_per_hr']:+} mm/hr per hour; storm moving "
                     f"{nc['storm_motion']['speed_kmh']} km/h towards {nc['storm_motion']['direction_deg']:.0f}°.")
        for h in nc["horizons"]:
            lines.append(f"- +{h['horizon_min']} min: {h['intensity_mm_hr']} mm/hr ({h['category']}), accumulation {h['accumulation_mm']} mm, "
                         f"P(heavy ≥50 mm/hr) {h['heavy_rain_probability']*100:.0f}%, confidence {h['confidence']*100:.0f}%")
        if nc["anomalies"]:
            lines.append("**Anomalies:** " + "; ".join(nc["anomalies"]))
        data = {"nowcast": nc}

    elif intent == "alerts":
        a = snap["alerts"]
        lines.append(f"**{len(a)} active alert(s):**")
        for al in a[:10]:
            ttf = f"in ~{al['expected_time_min']} min" if al["expected_time_min"] else "now/ongoing"
            lines.append(f"- [{al['level']}] {al['location']}: depth up to {al['expected_depth_m']} m ({ttf}); {len(al['affected_roads'])} roads affected")
        data = {"alerts": a[:10]}

    elif intent == "route":
        lines.append("Use **Emergency Routing** to pick origin/destination on the map. Quick facts: "
                     f"{k['impassable_roads']} roads are currently impassable for normal vehicles; routes are recomputed every 5 minutes "
                     "using depth now and forecast at +30 min.")

    else:
        lines.append("I answer from live FloodShield data only. Try:\n- Which areas will flood in the next hour?\n- Why is Ameerpet high risk?\n"
                     "- Which roads will become unsafe?\n- Which hospitals are affected?\n- Which drains are overloaded?\n"
                     "- What happens at 120 mm/hr?\n- What happens with 30% drainage blockage?\n- Generate a response summary")

    labels = ["MODEL_PREDICTION"] if intent not in ("whatif_rain", "whatif_blockage") else ["SIMULATED_DATA"]
    if intent in ("hospitals", "infrastructure"):
        labels.append("DEMO_DATA")
    return {"question": q, "intent": intent, "answer": "\n".join(lines), "data": data, "confidence": conf,
            "grounded": True, **_src(snap, *labels)}


def _whatif_lines(res: dict) -> list[str]:
    b, s = res["baseline"]["summary"], res["scenario"]["summary"]
    out = ["| Metric | Baseline | Scenario |", "|---|---|---|"]
    for key, lab in [("max_flood_extent_km2", "Flood extent (km²)"), ("max_depth_m", "Max depth (m)"), ("affected_roads", "Affected roads"),
                     ("drainage_failures", "Drainage failures"), ("overflowing_nodes", "Overflowing manholes"),
                     ("infrastructure_impacted", "Facilities impacted"), ("flooded_road_hours", "Flooded road-hours"),
                     ("flood_area_km2_hours", "Flood area × duration (km²·h)"), ("first_road_flooding_min", "First road flooding (event min)"),
                     ("total_rain_mm", "Total rain (mm)")]:
        out.append(f"| {lab} | {b[key]} | {s[key]} |")
    rc = res["route_comparison"]
    out.append(f"\nAmbulance route (fire station → hospital): baseline {rc['baseline']['time_min']} min, scenario "
               f"{rc['scenario']['time_min'] if rc['scenario']['time_min'] is not None else 'NO SAFE ROUTE'} min"
               + (" — route changes." if rc["changed"] else "."))
    worse = [w for w in res["ward_changes"] if w["change"] > 0]
    if worse:
        out.append("Wards with higher risk: " + ", ".join(f"{w['ward']} ({w['baseline']['risk_level']}→{w['scenario']['risk_level']})" for w in worse[:6]))
    return out
