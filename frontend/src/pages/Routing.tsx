/* Flood-Safe Emergency Routing: flood-aware shortest paths per vehicle mode vs the naive shortest path. */
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Route as RouteIcon, Crosshair, RotateCcw, ArrowLeftRight, AlertTriangle, CheckCircle2, Navigation, MapPin } from "lucide-react";
import { Marker, Polyline, Tooltip as LTooltip } from "react-leaflet";
import { useApp } from "@/context/AppContext";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";
import { Badge, Card, DataLabel, Empty, ErrorBox, LevelBadge, Loading, PageHeader, Section, Select, Spinner, cx } from "@/components/ui";
import { CityMap, Legend, LEGENDS, MapOverlay, RoadsLayer, useMapStatic } from "@/components/map";
import { FACILITY_LABELS, RISK_COLORS, depth, fmt, pretty } from "@/lib/format";
import { getMyLocation, inBbox, latLonStr, pinIcon } from "@/components/ops/common";

type LL = [number, number];
const MODE_ORDER = ["NORMAL", "AMBULANCE", "FIRE", "POLICE", "EMERGENCY", "PUBLIC_TRANSPORT", "PEDESTRIAN"];

function parseLL(s: string | null): LL | null {
  if (!s) return null;
  const [a, b] = s.split(",").map(Number);
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

export default function Routing() {
  const { city, tick, toast } = useApp();
  const st = useMapStatic();
  const [sp] = useSearchParams();
  const [mode, setMode] = useState("AMBULANCE");
  const [origin, setOrigin] = useState<LL | null>(null);
  const [dest, setDest] = useState<LL | null>(() => parseLL(sp.get("to")));
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string>("rec");
  const [locating, setLocating] = useState(false);

  const modes = useApi<Record<string, any>>("/api/routes/modes", { live: false });
  const { data: dyn } = useApi<any>("/api/map/dynamic?horizon=0");
  const roadStatus = useMemo(() => Object.fromEntries((dyn?.roads || []).map((r: any) => [r.id, r])), [dyn]);
  const roadById = useMemo(() => new Map((st?.roads || []).map((r) => [r.id, r])), [st]);

  useEffect(() => { const d = parseLL(sp.get("to")); if (d) setDest(d); }, [sp]);

  useEffect(() => {
    if (!origin || !dest) { setRes(null); return; }
    let alive = true;
    setBusy(true); setErr(null);
    api.post("/api/routes", { origin, destination: dest, mode, city })
      .then((r) => { if (alive) { setRes(r); setSel("rec"); } })
      .catch((e) => alive && setErr(e?.message || "Routing failed"))
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [origin?.[0], origin?.[1], dest?.[0], dest?.[1], mode, city, tick]); // eslint-disable-line

  const onMapClick = (lat: number, lon: number) => {
    if (!origin) setOrigin([lat, lon]);
    else if (!dest) setDest([lat, lon]);
    else { setOrigin([lat, lon]); setDest(null); }
  };

  const useMine = async () => {
    setLocating(true);
    try {
      const p = await getMyLocation();
      if (!inBbox(st?.bbox, p[0], p[1])) toast({ kind: "error", title: "Your location is outside the city model area", body: "Pick the origin on the map instead." });
      else setOrigin(p);
    } catch (e: any) {
      toast({ kind: "error", title: "Location unavailable", body: e?.message });
    } finally { setLocating(false); }
  };

  const facOptions = useMemo(() => [
    { value: "", label: "Choose a facility…" },
    ...(st?.infrastructure || []).slice().sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
      .map((f) => ({ value: f.id, label: `${FACILITY_LABELS[f.kind] || pretty(f.kind)} — ${f.name}` })),
  ], [st]);
  const pickFac = (id: string, which: "o" | "d") => {
    const f = st?.infrastructure.find((x) => x.id === id);
    if (!f) return;
    which === "o" ? setOrigin([f.lat, f.lon]) : setDest([f.lat, f.lon]);
  };

  const routes = useMemo(() => {
    if (!res) return [] as { key: string; label: string; r: any; kind: "rec" | "alt" | "naive" }[];
    const out: { key: string; label: string; r: any; kind: "rec" | "alt" | "naive" }[] = [];
    if (res.recommended) out.push({ key: "rec", label: "Recommended flood-safe route", r: res.recommended, kind: "rec" });
    (res.alternatives || []).forEach((a: any, i: number) => out.push({ key: `alt${i}`, label: `Alternative ${i + 1}`, r: a, kind: "alt" }));
    if (res.shortest_ignoring_flood) out.push({ key: "naive", label: "Shortest (ignoring flood)", r: res.shortest_ignoring_flood, kind: "naive" });
    return out;
  }, [res]);
  const selected = routes.find((x) => x.key === sel) || routes[0];
  const unsafeNaive: any[] = (res?.shortest_ignoring_flood?.segments || []).filter((s: any) => !s.passable);
  const modeInfo = modes.data?.[mode];

  return (
    <Section>
      <PageHeader icon={RouteIcon} title="Flood-Safe Emergency Routing"
        subtitle="Routes avoid road segments whose predicted water depth exceeds the safe limit for the selected vehicle. Compared against the shortest path that ignores flooding."
        labels={["MODEL_PREDICTION", "SIMULATED_DATA", "DEMO_DATA"]} />

      <div className="grid xl:grid-cols-[340px_1fr] gap-4 items-start">
        <div className="flex flex-col gap-4 min-w-0">
          <Card title="Vehicle / travel mode" icon={Navigation}>
            {modes.error && !modes.data ? <ErrorBox error={modes.error} onRetry={modes.reload} /> : !modes.data ? <Loading /> : (
              <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Travel mode">
                {MODE_ORDER.filter((m) => modes.data![m]).map((m) => (
                  <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                    className={cx("rounded-lg border px-2 py-1.5 text-left transition-colors", mode === m ? "border-brand bg-brand/10" : "border-line hover:bg-panel2")}>
                    <div className="text-xs font-semibold">{modes.data![m].label}</div>
                    <div className="text-[10.5px] text-muted">max safe {depth(modes.data![m].max_depth)}</div>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card title="Origin & destination" icon={MapPin} subtitle="Click the map: first click = origin, second = destination. Markers can be dragged."
            actions={<>
              <button className="btn-ghost btn-sm" aria-label="Swap origin and destination" disabled={!origin && !dest} onClick={() => { setOrigin(dest); setDest(origin); }}><ArrowLeftRight size={13} /></button>
              <button className="btn-ghost btn-sm" onClick={() => { setOrigin(null); setDest(null); setRes(null); setErr(null); }}><RotateCcw size={13} />Reset</button>
            </>}>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="label mb-0 flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-sky-500" />Origin</span>
                  <span className="text-[11px] tabular-nums text-muted">{latLonStr(origin)}</span>
                </div>
                <Select value="" onChange={(v) => pickFac(v, "o")} options={facOptions} label="" />
                <button className="btn-ghost btn-sm mt-1.5 w-full" onClick={useMine} disabled={locating}>
                  {locating ? <Spinner size={13} /> : <Crosshair size={13} />}Use my location
                </button>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="label mb-0 flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red-600" />Destination</span>
                  <span className="text-[11px] tabular-nums text-muted">{latLonStr(dest)}</span>
                </div>
                <Select value="" onChange={(v) => pickFac(v, "d")} options={facOptions} />
              </div>
              {modeInfo && <p className="text-xs text-muted">{modeInfo.label}: segments deeper than <b className="text-ink">{depth(modeInfo.max_depth)}</b> are treated as impassable.</p>}
            </div>
          </Card>

          {res && (
            <div className={cx("rounded-xl border p-3 text-sm flex gap-2", res.status === "NO_SAFE_ROUTE" ? "border-red-500/50 bg-red-500/10" : unsafeNaive.length ? "border-amber-500/50 bg-amber-500/10" : "border-green-500/50 bg-green-500/10")}>
              {res.status === "NO_SAFE_ROUTE" ? <AlertTriangle size={18} className="text-red-600 shrink-0" /> : unsafeNaive.length ? <AlertTriangle size={18} className="text-amber-600 shrink-0" /> : <CheckCircle2 size={18} className="text-green-600 shrink-0" />}
              <div>
                <div className="font-semibold">{res.status === "NO_SAFE_ROUTE" ? "No flood-safe route" : unsafeNaive.length ? "Route diverted around flooding" : "Route is flood-safe"}</div>
                <div className="text-xs mt-0.5">{res.message}</div>
                <div className="text-[11px] text-muted mt-1">Event minute T+{res.event_minute} · {res.mode_label}</div>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          <Card title="Route map" icon={RouteIcon} actions={<>{busy && <Spinner size={14} />}<DataLabel label="MODEL_PREDICTION" /></>}>
            <div className="relative">
              <CityMap className="h-[420px] md:h-[560px]" onClick={onMapClick}>
                {st && <RoadsLayer roads={st.roads} status={roadStatus} colorBy="depth" weight={0.7} />}
                {res?.shortest_ignoring_flood && (
                  <Polyline positions={res.shortest_ignoring_flood.coords} pathOptions={{ color: "#dc2626", weight: 4, opacity: 0.9, dashArray: "2 8", lineCap: "round" }}>
                    <LTooltip sticky>Shortest ignoring flood · {fmt(res.shortest_ignoring_flood.time_min)} min · max {depth(res.shortest_ignoring_flood.max_depth_m)}</LTooltip>
                  </Polyline>
                )}
                {unsafeNaive.map((s, i) => {
                  const rd = roadById.get(s.road_id);
                  return rd ? (
                    <Polyline key={`u${i}`} positions={rd.coords} pathOptions={{ color: "#9f1239", weight: 9, opacity: 0.55 }}>
                      <LTooltip sticky><b>Unsafe: {s.name}</b><br />Depth {depth(s.depth_m)}</LTooltip>
                    </Polyline>
                  ) : null;
                })}
                {(res?.alternatives || []).map((a: any, i: number) => (
                  <Polyline key={`a${i}`} positions={a.coords} pathOptions={{ color: "#2563eb", weight: sel === `alt${i}` ? 6 : 4, opacity: 0.85, dashArray: "10 8" }}
                    eventHandlers={{ click: () => setSel(`alt${i}`) }}>
                    <LTooltip sticky>Alternative {i + 1} · {fmt(a.time_min)} min</LTooltip>
                  </Polyline>
                ))}
                {res?.recommended && (
                  <>
                    <Polyline positions={res.recommended.coords} pathOptions={{ color: "#ffffff", weight: 11, opacity: 0.8 }} />
                    <Polyline positions={res.recommended.coords} pathOptions={{ color: "#16a34a", weight: 7, opacity: 1 }} eventHandlers={{ click: () => setSel("rec") }}>
                      <LTooltip sticky>Recommended · {fmt(res.recommended.time_min)} min · {fmt(res.recommended.distance_km, 2)} km</LTooltip>
                    </Polyline>
                  </>
                )}
                {origin && (
                  <Marker position={origin} draggable icon={pinIcon("#0ea5e9", "A")}
                    eventHandlers={{ dragend: (e: any) => { const l = e.target.getLatLng(); setOrigin([l.lat, l.lng]); } }}>
                    <LTooltip>Origin (drag to move)</LTooltip>
                  </Marker>
                )}
                {dest && (
                  <Marker position={dest} draggable icon={pinIcon("#dc2626", "B")}
                    eventHandlers={{ dragend: (e: any) => { const l = e.target.getLatLng(); setDest([l.lat, l.lng]); } }}>
                    <LTooltip>Destination (drag to move)</LTooltip>
                  </Marker>
                )}
              </CityMap>
              <MapOverlay position="top-left" className="flex flex-col gap-1 items-start">
                <span className="chip bg-panel border border-line">{!origin ? "Click map to set origin (A)" : !dest ? "Click map to set destination (B)" : "Click map to start a new route"}</span>
              </MapOverlay>
              <MapOverlay position="bottom-left" className="flex gap-2 items-end">
                <Legend title="Routes" items={[{ color: "#16a34a", label: "Recommended" }, { color: "#2563eb", label: "Alternative" }, { color: "#dc2626", label: "Shortest ignoring flood" }, { color: "#9f1239", label: "Unsafe segment" }]} />
                <Legend title="Road depth" items={LEGENDS.roadDepth} className="hidden sm:block" />
              </MapOverlay>
            </div>
          </Card>

          {err && <ErrorBox error={err} />}
          {!res && !busy && !err && <Card><Empty icon={RouteIcon} text="Set an origin and a destination to compute flood-safe routes." /></Card>}
          {busy && !res && <Card><Loading text="Computing flood-safe routes…" /></Card>}

          {routes.length > 0 && (
            <div className="grid sm:grid-cols-2 2xl:grid-cols-4 gap-3">
              {routes.map(({ key, label, r, kind }) => {
                const col = kind === "rec" ? "#16a34a" : kind === "alt" ? "#2563eb" : "#dc2626";
                return (
                  <button key={key} onClick={() => setSel(key)} aria-pressed={sel === key}
                    className={cx("card p-3 text-left transition-colors", sel === key ? "ring-2 ring-brand" : "hover:border-brand/60")} style={{ borderTop: `4px solid ${col}` }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
                      {r.safe_for_mode ? <Badge color="#16a34a">Safe for mode</Badge> : <Badge color="#dc2626">Unsafe</Badge>}
                    </div>
                    <div className="mt-1.5 flex items-baseline gap-2">
                      <span className="kpi-v">{fmt(r.time_min)}</span><span className="text-xs text-muted">min · {fmt(r.distance_km, 2)} km</span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
                      <span className="text-muted">Max depth</span><span className="tabular-nums text-right">{depth(r.max_depth_m)}</span>
                      <span className="text-muted">Flooded segs</span><span className="tabular-nums text-right">{r.flooded_segments}</span>
                      <span className="text-muted">Unsafe segs</span><span className={cx("tabular-nums text-right", r.unsafe_segments > 0 && "text-red-600 font-semibold")}>{r.unsafe_segments}</span>
                      <span className="text-muted">Exposure</span><span className="tabular-nums text-right">{fmt(r.exposure_m2, 0)} m²</span>
                      <span className="text-muted">Risk</span><span className="text-right"><LevelBadge level={r.risk_level} map={RISK_COLORS} /></span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {selected && (
            <Card title={`Segments — ${selected.label}`} icon={RouteIcon} bodyClass="overflow-x-auto scroll-thin px-0 pb-0 max-h-[420px]">
              <table className="table">
                <thead><tr><th>#</th><th>Road</th><th className="text-right">Length</th><th className="text-right">Depth</th><th>Risk</th><th>Passable</th></tr></thead>
                <tbody>
                  {(selected.r.segments || []).map((s: any, i: number) => (
                    <tr key={i}>
                      <td className="text-muted tabular-nums">{i + 1}</td>
                      <td className="font-medium">{s.name}<div className="text-[11px] text-muted">{s.road_id}</div></td>
                      <td className="text-right tabular-nums whitespace-nowrap">{fmt(s.length_m, 0)} m</td>
                      <td className="text-right tabular-nums">{depth(s.depth_m)}</td>
                      <td><LevelBadge level={s.risk_level} map={RISK_COLORS} /></td>
                      <td>{s.passable ? <Badge color="#16a34a">Yes</Badge> : <Badge color="#dc2626" solid>No</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>
    </Section>
  );
}
