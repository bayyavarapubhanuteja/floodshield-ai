/* Shared helpers for the GIS / hydrology pages (LiveMap, Rainfall, Terrain, Drainage, Prediction, Risk). */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis, Cell as RCell } from "recharts";
import { CircleMarker, GeoJSON, Tooltip as LTooltip } from "react-leaflet";
import { Pause, Play } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { Badge, DataLabel, Drawer, ErrorBox, LevelBadge, Loading, Progress, Stat, cx } from "@/components/ui";
import { Cell, GridOverlay, MapStatic } from "@/components/map";
import {
  DRAIN_COLORS, FACILITY_STATUS_COLORS, LANDCOVER_COLORS, PASSABILITY_COLORS, RAMPS, RISK_COLORS, depth, fmt, pct, pretty, ttf,
} from "@/lib/format";

export const tooltipStyle = { background: "rgb(var(--panel))", border: "1px solid rgb(var(--line))", borderRadius: 8, fontSize: 12 };
export const axis = { fontSize: 11, stroke: "rgb(var(--muted))" } as const;
export const gridStroke = "rgb(var(--line))";
export const HORIZONS = [15, 30, 45, 60, 90, 120, 180];

/* ---------------- colour ramps not in format.ts ---------------- */
type RGBA = [number, number, number, number];
export function makeRamp(stops: [number, number[]][]) {
  return (v: number): RGBA => {
    if (v <= stops[0][0]) return [...stops[0][1], 255] as RGBA;
    for (let i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) {
        const t = (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
        const a = stops[i - 1][1], b = stops[i][1];
        return [...a.map((x, k) => Math.round(x + (b[k] - x) * t)), 255] as RGBA;
      }
    }
    return [...stops[stops.length - 1][1], 255] as RGBA;
  };
}
const CATCH_PAL = [[14, 165, 233], [249, 115, 22], [34, 197, 94], [168, 85, 247], [234, 179, 8], [236, 72, 153], [20, 184, 166], [100, 116, 139]];
export const XRAMPS = {
  aspect: makeRamp([[0, [239, 68, 68]], [90, [234, 179, 8]], [180, [34, 197, 94]], [270, [59, 130, 246]], [360, [239, 68, 68]]]),
  catchment: (v: number): RGBA => [...(CATCH_PAL[(Math.round(v) - 1 + CATCH_PAL.length) % CATCH_PAL.length]), 255] as RGBA,
  lowLying: (_v: number): RGBA => [234, 88, 12, 255],
  waterPath: (_v: number): RGBA => [2, 132, 199, 255],
  landcover: (v: number): RGBA => [...(LANDCOVER_COLORS[Math.round(v)] || [148, 163, 184]), 255] as RGBA,
  runoffC: makeRamp([[0.2, [22, 163, 74]], [0.5, [250, 204, 21]], [0.75, [249, 115, 22]], [1, [127, 29, 29]]]),
  depression: makeRamp([[0.05, [186, 230, 253]], [0.3, [56, 189, 248]], [0.8, [37, 99, 235]], [2, [30, 64, 175]]]),
  runoffLsha: makeRamp([[1, [254, 249, 195]], [60, [250, 204, 21]], [150, [249, 115, 22]], [300, [220, 38, 38]], [450, [127, 29, 29]]]),
};
const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;
const rampItems = (f: (v: number) => RGBA, vals: number[], fmtv: (v: number) => string) => vals.map((v) => ({ color: rgb(f(v)), label: fmtv(v) }));

/* ---------------- terrain layer registry ---------------- */
export interface TerrainLayerDef {
  key: string; label: string; unit: string; desc: string; normalise?: boolean; color: (v: number) => RGBA; legend: { color: string; label: string }[];
}
export const TERRAIN_LAYERS: TerrainLayerDef[] = [
  { key: "elevation", label: "DEM elevation", unit: "m", normalise: true, color: RAMPS.elevation, desc: "Ground elevation from the digital elevation model (normalised to the city's min–max).",
    legend: rampItems(RAMPS.elevation, [0, 0.35, 0.6, 0.8, 1], (v) => (v === 0 ? "Lowest" : v === 1 ? "Highest" : `${Math.round(v * 100)}th pct of range`)) },
  { key: "slope", label: "Slope", unit: "%", color: RAMPS.slope, desc: "Terrain gradient; flat terrain (<1%) slows surface drainage.", legend: rampItems(RAMPS.slope, [0, 2, 5, 10, 20], (v) => `${v}%`) },
  { key: "aspect", label: "Aspect", unit: "°", color: XRAMPS.aspect, desc: "Direction the slope faces (0° = North).", legend: rampItems(XRAMPS.aspect, [0, 90, 180, 270], (v) => ["N", "E", "S", "W"][v / 90]) },
  { key: "flow_accumulation", label: "Flow accumulation", unit: "log₁₀ cells", color: RAMPS.flowAcc, desc: "D8 upstream contributing area (log scale); high values mark natural drainage lines.",
    legend: rampItems(RAMPS.flowAcc, [0, 1, 2, 3.3], (v) => `10^${v} cells`) },
  { key: "catchment", label: "Catchments", unit: "id", color: XRAMPS.catchment, desc: "Outlet-labelled sub-catchments.", legend: CATCH_PAL.slice(0, 6).map((c, i) => ({ color: rgb(c), label: `Catchment ${i + 1}` })) },
  { key: "low_lying", label: "Low-lying areas", unit: "", color: XRAMPS.lowLying, desc: "15th elevation percentile or depression > 0.25 m.", legend: [{ color: "rgb(234,88,12)", label: "Low-lying cell" }] },
  { key: "depression", label: "Depressions", unit: "m", color: XRAMPS.depression, desc: "Depth of sinks filled by priority-flood — water ponds here first.",
    legend: rampItems(XRAMPS.depression, [0.05, 0.3, 0.8, 2], (v) => `${v} m`) },
  { key: "water_paths", label: "Natural water paths", unit: "", color: XRAMPS.waterPath, desc: "Cells with high flow accumulation — overland flow lines.", legend: [{ color: "rgb(2,132,199)", label: "Water path" }] },
  { key: "landcover", label: "Land cover", unit: "class", color: XRAMPS.landcover, desc: "Land-use classes driving imperviousness & runoff.",
    legend: [["Dense urban", 1], ["Residential", 2], ["Commercial", 3], ["Parks / green", 4], ["Water body", 5], ["Bare / open soil", 6]].map(([l, k]) => ({ color: rgb(LANDCOVER_COLORS[k as number]), label: l as string })) },
  { key: "imperviousness", label: "Imperviousness", unit: "fraction", color: RAMPS.impervious, desc: "Fraction of sealed surface (roofs, roads, paving).",
    legend: rampItems(RAMPS.impervious, [0, 0.5, 1], (v) => `${v * 100}%`) },
  { key: "runoff_coefficient", label: "Runoff coefficient C", unit: "C", color: XRAMPS.runoffC, desc: "Rational-method runoff coefficient per land-cover class.",
    legend: rampItems(XRAMPS.runoffC, [0.2, 0.5, 0.75, 1], (v) => `C = ${v}`) },
];
export const terrainDef = (k: string) => TERRAIN_LAYERS.find((l) => l.key === k)!;

export function useTerrainLayer(name: string | null) {
  const { data, error, loading, reload } = useApi<any>(name ? `/api/terrain/layer?name=${name}` : null, { live: false });
  const def = name ? terrainDef(name) : null;
  const cells = useMemo<Cell[] | null>(() => {
    if (!data?.cells || !def || data.layer !== name) return null;
    if (!def.normalise) return data.cells;
    const span = (data.max - data.min) || 1;
    return data.cells.map((c: Cell) => [c[0], c[1], (c[2] - data.min) / span] as Cell);
  }, [data, def, name]);
  return { data, cells, def, error, loading, reload };
}

export function TerrainGrid({ name, st, opacity = 0.7 }: { name: string; st: MapStatic; opacity?: number }) {
  const { cells, def } = useTerrainLayer(name);
  if (!cells || !def) return null;
  return <GridOverlay cells={cells} rows={st.rows} cols={st.cols} bbox={st.bbox} color={def.color} opacity={opacity} smooth={!!def.normalise || name === "slope" || name === "flow_accumulation"} />;
}

/* ---------------- flood zones (shapely GeoJSON, [lon,lat]) ---------------- */
export interface Zone { id: string; name: string; ward: string; geometry: any; area_km2: number; max_depth_m: number; mean_depth_m: number; probability: number; risk_level: string; cells?: number }
export function zonesFromFC(fc: any): Zone[] {
  return (fc?.features || []).map((f: any) => ({ ...f.properties, geometry: f.geometry }));
}
export function ZonesLayer({ zones, labels = true, onSelect, fill = 0.12 }: { zones: Zone[]; labels?: boolean; onSelect?: (z: Zone) => void; fill?: number }) {
  const key = zones.map((z) => `${z.id}:${z.area_km2}`).join("|");
  return (
    <>
      {zones.map((z) => (
        <GeoJSON key={`${key}-${z.id}`} data={{ type: "Feature", geometry: z.geometry, properties: {} } as any}
          style={() => ({ color: RISK_COLORS[z.risk_level] || "#2563eb", weight: 2, fillOpacity: fill, fillColor: RISK_COLORS[z.risk_level] || "#2563eb", dashArray: "4 3" })}
          eventHandlers={onSelect ? { click: () => onSelect(z) } : undefined}>
          <LTooltip sticky>
            <div className="font-semibold">{z.name}</div>
            <div>{fmt(z.area_km2, 2)} km² · max {depth(z.max_depth_m)} · mean {depth(z.mean_depth_m)}</div>
            <div>P {pct(z.probability)} · {pretty(z.risk_level)}</div>
          </LTooltip>
        </GeoJSON>
      ))}
      {labels && zones.map((z) => {
        const c = centroid(z.geometry);
        if (!c) return null;
        return (
          <CircleMarker key={`lbl-${z.id}`} center={c} radius={0} pathOptions={{ opacity: 0, fillOpacity: 0 }}>
            <LTooltip permanent direction="center" className="fs-map-label">{z.ward}: {depth(z.max_depth_m)}</LTooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}
export function centroid(geom: any): [number, number] | null {
  const pts: number[][] = [];
  const walk = (a: any) => { if (typeof a?.[0] === "number") pts.push(a); else if (Array.isArray(a)) a.forEach(walk); };
  walk(geom?.coordinates);
  if (!pts.length) return null;
  const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [lat, lon];
}

/* Ward name labels on the map */
export function WardLabels({ st, extra }: { st: MapStatic; extra?: Record<string, string> }) {
  return (
    <>
      {st.wards.map((w) => (
        <CircleMarker key={w.id} center={w.center} radius={0} pathOptions={{ opacity: 0, fillOpacity: 0 }}>
          <LTooltip permanent direction="center" className="fs-map-label">{w.name}{extra?.[w.id] ? ` · ${extra[w.id]}` : ""}</LTooltip>
        </CircleMarker>
      ))}
    </>
  );
}

/* ---------------- play/pause animation ---------------- */
export function usePlayer(length: number, { interval = 1400, ready = true }: { interval?: number; ready?: boolean } = {}) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const t = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || !ready || length < 2) return;
    t.current = window.setTimeout(() => setIdx((i) => (i + 1) % length), interval);
    return () => { if (t.current) window.clearTimeout(t.current); };
  }, [playing, ready, idx, length, interval]);
  useEffect(() => { if (idx >= length && length > 0) setIdx(0); }, [length, idx]);
  return { idx, setIdx, playing, setPlaying, toggle: () => setPlaying((p) => !p) };
}
export function PlayButton({ playing, onClick, className }: { playing: boolean; onClick: () => void; className?: string }) {
  return (
    <button type="button" className={cx("btn-primary btn-sm", className)} onClick={onClick} aria-label={playing ? "Pause animation" : "Play animation"}>
      {playing ? <Pause size={14} /> : <Play size={14} />}{playing ? "Pause" : "Play"}
    </button>
  );
}

/* ---------------- contributing factor bars ---------------- */
export function FactorBars({ factors, height }: { factors: any[]; height?: number }) {
  const data = [...(factors || [])].sort((a, b) => b.contribution_pct - a.contribution_pct).map((f) => ({ ...f, short: pretty(f.factor) }));
  return (
    <div style={{ height: height || Math.max(160, data.length * 26 + 20) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 24, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
          <XAxis type="number" {...axis} unit="%" />
          <YAxis type="category" dataKey="short" width={130} {...axis} interval={0} />
          <RTooltip contentStyle={tooltipStyle} formatter={(v: any, _n: any, p: any) => [`${fmt(v, 1)}% (w ${p.payload.weight}, value ${fmt(p.payload.value, 2)})`, p.payload.label]} />
          <Bar dataKey="contribution_pct" name="Contribution" radius={[0, 3, 3, 0]}>
            {data.map((d, i) => <RCell key={d.factor} fill={i === 0 ? "#dc2626" : i < 3 ? "#f97316" : "#0ea5e9"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------- road detail drawer (/api/flood/roads/{id}) ---------------- */
export function roadForecastSeries(r: any) {
  if (r?.forecast_series?.length) return r.forecast_series.map((p: any) => ({ t: p.offset_min, depth: p.depth_m }));
  return [{ t: 0, depth: r?.depth_now_m }, ...HORIZONS.map((h) => ({ t: h, depth: r?.depth_forecast_m?.[h], prob: r?.probability?.[h] }))];
}
export function DepthForecastChart({ road, height = 180 }: { road: any; height?: number }) {
  const data = roadForecastSeries(road).map((p: any) => ({ ...p, prob: road?.probability?.[p.t] ?? p.prob }));
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ left: -14, right: 8, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          <XAxis dataKey="t" type="number" domain={[0, "dataMax"]} ticks={[0, 15, 30, 60, 90, 120, 180]} tickFormatter={(v) => (v === 0 ? "NOW" : `+${v}`)} {...axis} />
          <YAxis {...axis} unit=" m" />
          <RTooltip contentStyle={tooltipStyle} labelFormatter={(v) => (v === 0 ? "NOW" : `+${v} min`)} formatter={(v: any, n: any) => [n === "Depth" ? depth(v) : v, n]} />
          <ReferenceLine y={0.15} stroke="#eab308" strokeDasharray="4 3" label={{ value: "15 cm", fontSize: 10, fill: "#eab308", position: "insideTopRight" }} />
          <ReferenceLine y={0.3} stroke="#dc2626" strokeDasharray="4 3" label={{ value: "30 cm", fontSize: 10, fill: "#dc2626", position: "insideTopRight" }} />
          <Area dataKey="depth" name="Depth" stroke="#2563eb" fill="#2563eb" fillOpacity={0.2} strokeWidth={2} connectNulls />
          <Line dataKey="depth" name="Depth" stroke="#2563eb" dot={false} legendType="none" connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RoadDetail({ r }: { r: any }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-1.5 items-center">
        <LevelBadge level={r.risk_level} map={RISK_COLORS} solid />
        {r.passability && <LevelBadge level={r.passability} map={PASSABILITY_COLORS} />}
        {r.closed && <Badge color="#dc2626">CLOSED</Badge>}
        {r.underpass && <Badge color="#f59e0b">Underpass</Badge>}
        <DataLabel label={r.data_label || "MODEL_PREDICTION"} />
      </div>
      <div className="text-xs text-muted">{r.ward} · {pretty(r.road_class)} · {fmt(r.length_m, 0)} m · elev {fmt(r.elevation_m, 1)} m</div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="WHERE" value={`${r.street || r.name}, ${r.ward}`} />
        <Stat label="WHEN (time to flood)" value={ttf(r.time_to_flood_min)} />
        <Stat label="HOW DEEP now" value={depth(r.depth_now_m)} />
        <Stat label="Peak depth" value={<>{depth(r.max_depth_m)} <span className="text-xs text-muted">at +{r.time_of_max_min} min</span></>} />
        <Stat label="Probability +60" value={pct(r.probability?.[60])} />
        <Stat label="Flood duration" value={r.duration_min ? `${r.duration_min} min` : "—"} />
        <Stat label="Drainage" value={<span style={{ color: DRAIN_COLORS[r.drainage_status] }}>{pretty(r.drainage_status)} · {pct(r.drainage_utilization)}</span>} />
        <Stat label="Passability +60" value={<span style={{ color: PASSABILITY_COLORS[r.passability_60] }}>{pretty(r.passability_60)}</span>} />
        <Stat label="Risk score" value={`${fmt(r.risk_score, 2)} · conf ${pct(r.confidence)}`} />
        <Stat label="ML susceptibility" value={pct(r.ml_susceptibility)} />
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">Depth forecast (NOW → +180 min)</div>
        <DepthForecastChart road={r} />
        <div className="overflow-x-auto scroll-thin mt-2">
          <table className="table text-xs">
            <thead><tr><th>Horizon</th>{HORIZONS.map((h) => <th key={h}>+{h}</th>)}</tr></thead>
            <tbody>
              <tr><td className="font-medium">Depth</td>{HORIZONS.map((h) => <td key={h} className="tabular-nums whitespace-nowrap">{depth(r.depth_forecast_m?.[h])}</td>)}</tr>
              <tr><td className="font-medium">Prob.</td>{HORIZONS.map((h) => <td key={h} className="tabular-nums">{pct(r.probability?.[h])}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-lg border border-line bg-panel2 p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">WHY — explanation</div>
        <p className="leading-relaxed">{r.explanation}</p>
      </div>
      {r.factors?.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">Contributing factors</div>
          <FactorBars factors={r.factors} />
        </div>
      )}
      {r.drain_nodes?.length > 0 && <div className="text-xs text-muted">Connected drain nodes: {r.drain_nodes.join(", ")}</div>}
    </div>
  );
}

export function RoadDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, error, reload } = useApi<any>(id ? `/api/flood/roads/${id}` : null);
  const r = data && data.id === id ? data : null;
  return (
    <Drawer open={!!id} onClose={onClose} title={r ? r.name : "Road details"}>
      {error && !r && <ErrorBox error={error} onRetry={reload} />}
      {!r && !error && <Loading />}
      {r && <RoadDetail r={r} />}
    </Drawer>
  );
}

/* ---------------- drain node drawer (/api/drains/{id}) ---------------- */
export function DrainDetail({ d }: { d: any }) {
  const chart = [
    ...(d.history || []).map((h: any) => ({ t: h.event_minute, obs: Math.round(h.utilization * 100) })),
    ...(d.forecast || []).map((f: any) => ({ t: (d.history?.[d.history.length - 1]?.event_minute ?? 0) + f.offset_min, fc: Math.round(f.utilization * 100) })),
  ];
  const oc = d.outgoing_conduit;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-1.5 items-center">
        <LevelBadge level={d.status} map={DRAIN_COLORS} solid />
        <span className="text-xs text-muted">+30: </span><LevelBadge level={d.status_30} map={DRAIN_COLORS} />
        <span className="text-xs text-muted">+60: </span><LevelBadge level={d.status_60} map={DRAIN_COLORS} />
        <DataLabel label="MODEL_PREDICTION" />
      </div>
      <div className="text-xs text-muted">{pretty(d.kind)} · {d.ward} · ground {fmt(d.elevation_m, 1)} m · invert {fmt(d.invert_m, 1)} m</div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Utilisation" value={<span style={{ color: DRAIN_COLORS[d.status] }}>{pct(d.utilization)}</span>} />
        <Stat label="Inflow / outflow" value={`${fmt(d.inflow_m3s, 2)} / ${fmt(d.outflow_m3s, 2)} m³/s`} />
        <Stat label="Capacity (design)" value={`${fmt(d.capacity_m3s, 2)} m³/s`} />
        <Stat label="Effective capacity" value={`${fmt(d.effective_capacity_m3s, 2)} m³/s`} />
        <Stat label="Overflow volume" value={`${fmt(d.overflow_m3, 1)} m³`} />
        <Stat label="Surcharge (storage used)" value={pct(d.surcharge)} />
        <Stat label="Backflow" value={d.backflow ? <span className="text-red-500">Yes — backwater</span> : "No"} />
        <Stat label="Catchment" value={`${fmt((d.catchment_m2 || 0) / 1e4, 1)} ha`} />
      </div>
      <div className="rounded-lg border border-purple-500/40 bg-purple-500/10 p-2.5 text-xs">
        <div className="font-semibold">Assumed blockage: {pct(d.blockage)}</div>
        <div className="text-muted">{d.blockage_label || "SIMULATED assumption"} · {d.days_since_cleaning} days since cleaning · {d.historical_failures} past failures</div>
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">Utilisation: history & forecast (%)</div>
        <div className="h-44">
          <ResponsiveContainer>
            <ComposedChart data={chart} margin={{ left: -14, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => `T+${v}`} {...axis} />
              <YAxis {...axis} />
              <RTooltip contentStyle={tooltipStyle} labelFormatter={(v) => `Event minute ${v}`} />
              <ReferenceLine y={100} stroke="#dc2626" strokeDasharray="4 3" />
              <Area dataKey="obs" name="Simulated utilisation %" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.2} />
              <Line dataKey="fc" name="Forecast utilisation %" stroke="#f97316" strokeWidth={2} strokeDasharray="5 3" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      {oc && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">Outgoing conduit {oc.id} → {oc.to}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat label="Diameter" value={`${fmt(oc.diameter_m, 2)} m`} />
            <Stat label="Slope" value={`${fmt(oc.slope * 100, 2)}%`} />
            <Stat label="Length" value={`${fmt(oc.length_m, 0)} m`} />
            <Stat label="Manning capacity" value={`${fmt(oc.capacity_m3s, 2)} m³/s`} />
            <Stat label="Flow" value={`${fmt(oc.flow_m3s, 2)} m³/s`} />
            <Stat label="Velocity" value={`${fmt(oc.velocity_ms, 2)} m/s`} />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {oc.bottleneck && <Badge color="#dc2626">Bottleneck</Badge>}
            {oc.legacy_undersized && <Badge color="#f97316">Legacy undersized</Badge>}
            {oc.adverse_grade && <Badge color="#eab308">Adverse grade</Badge>}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Upstream" value={d.upstream?.length ? d.upstream.join(", ") : "—"} />
        <Stat label="Downstream" value={d.downstream || "Outfall"} />
      </div>
      {d.connected_roads?.length > 0 && <div className="text-xs text-muted">Connected roads: {d.connected_roads.join(", ")}</div>}
    </div>
  );
}
export function DrainDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, error, reload } = useApi<any>(id ? `/api/drains/${id}` : null);
  const d = data && data.id === id ? data : null;
  return (
    <Drawer open={!!id} onClose={onClose} title={d ? `Drain node ${d.id}` : "Drain node"}>
      {error && !d && <ErrorBox error={error} onRetry={reload} />}
      {!d && !error && <Loading />}
      {d && <DrainDetail d={d} />}
    </Drawer>
  );
}

/* ---------------- facility drawer (/api/infrastructure/{id}) ---------------- */
export function FacilityDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, error, reload } = useApi<any>(id ? `/api/infrastructure/${id}` : null);
  const f = data && data.id === id ? data : null;
  return (
    <Drawer open={!!id} onClose={onClose} title={f ? f.name : "Facility"}>
      {error && !f && <ErrorBox error={error} onRetry={reload} />}
      {!f && !error && <Loading />}
      {f && (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-1.5">
            <LevelBadge level={f.status} map={FACILITY_STATUS_COLORS} solid />
            <LevelBadge level={f.risk_level} map={RISK_COLORS} />
            <DataLabel label="MODEL_PREDICTION" /><DataLabel label="DEMO_DATA" />
          </div>
          <div className="text-xs text-muted">{pretty(f.kind)} · {f.ward} · capacity {f.capacity}{f.critical ? " · critical facility" : ""}</div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Site depth now" value={depth(f.site_depth_now_m)} />
            <Stat label="Site depth +60" value={depth(f.site_depth_60_m)} />
            <Stat label="Reachable network" value={`${fmt(f.reachable_network_pct, 0)}%`} />
            <Stat label="Access roads flooded" value={`${f.access_roads_flooded?.length || 0} / ${f.access_roads?.length || 0}`} />
          </div>
          {f.affected_roads?.length > 0 && (
            <div className="overflow-x-auto scroll-thin">
              <table className="table text-xs">
                <thead><tr><th>Nearby road</th><th>Now</th><th>+60</th><th>Dist.</th></tr></thead>
                <tbody>{f.affected_roads.map((r: any) => <tr key={r.id}><td>{r.name}</td><td>{depth(r.depth_now_m)}</td><td>{depth(r.depth_60_m)}</td><td>{r.distance_m} m</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {f.alternative && (
            <div className="rounded-lg border border-line bg-panel2 p-2.5 text-xs">
              Alternative: <b>{f.alternative.name}</b> · {fmt(f.alternative.travel_time_min, 1)} min ({f.alternative.basis})
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

/* Utilisation bar with % label */
export function UtilBar({ value, status }: { value: number; status?: string }) {
  const col = status ? DRAIN_COLORS[status] : value >= 1 ? "#dc2626" : value >= 0.8 ? "#eab308" : "#16a34a";
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <Progress value={Math.min(value, 2)} max={2} color={col} />
      <span className="text-xs tabular-nums w-11 text-right">{pct(value)}</span>
    </div>
  );
}

/* Storm motion compass */
export function Compass({ deg, speed, size = 96 }: { deg: number; speed?: number; size?: number }) {
  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`Storm moving toward ${Math.round(deg)} degrees`}>
        <circle cx="50" cy="50" r="46" fill="none" stroke="rgb(var(--line))" strokeWidth="2" />
        {["N", "E", "S", "W"].map((l, i) => (
          <text key={l} x={50 + 38 * Math.sin((i * Math.PI) / 2)} y={54 - 38 * Math.cos((i * Math.PI) / 2)} textAnchor="middle" fontSize="10" fill="rgb(var(--muted))" fontWeight={600}>{l}</text>
        ))}
        <g transform={`rotate(${deg} 50 50)`}>
          <line x1="50" y1="68" x2="50" y2="22" stroke="#8b5cf6" strokeWidth="4" strokeLinecap="round" />
          <polygon points="50,14 42,28 58,28" fill="#8b5cf6" />
        </g>
      </svg>
      {speed !== undefined && <div className="text-sm"><div className="font-semibold tabular-nums">{fmt(speed, 1)} km/h</div><div className="text-xs text-muted">toward {Math.round(deg)}° ({bearing(deg)})</div></div>}
    </div>
  );
}
export const bearing = (d: number) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((d % 360) + 360) % 360 / 45) % 8];

export function ChipLegendRow({ items }: { items: { color: string; label: string }[] }) {
  return <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">{items.map((i) => <span key={i.label} className="flex items-center gap-1"><span className="h-2.5 w-3.5 rounded-sm" style={{ background: i.color }} />{i.label}</span>)}</div>;
}

export const RISK_ORDER = ["LOW", "MODERATE", "HIGH", "VERY_HIGH", "CRITICAL"];
export function SortTh({ label, k, sort, setSort, className }: { label: string; k: string; sort: { k: string; d: 1 | -1 }; setSort: (s: { k: string; d: 1 | -1 }) => void; className?: string }) {
  const active = sort.k === k;
  return (
    <th className={cx("cursor-pointer select-none whitespace-nowrap", className)} aria-sort={active ? (sort.d === 1 ? "ascending" : "descending") : "none"}
      onClick={() => setSort({ k, d: active ? ((-sort.d) as 1 | -1) : -1 })}>
      {label}{active ? (sort.d === 1 ? " ▲" : " ▼") : ""}
    </th>
  );
}
export type { RGBA };
