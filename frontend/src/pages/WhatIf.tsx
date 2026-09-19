/* What-If Simulator: re-runs the coupled flood model with modified parameters and compares against the baseline. */
import React, { useMemo, useState } from "react";
import {
  FlaskConical, Play, RotateCcw, Save, Download, Map as MapIcon, Table2, Activity, ShieldAlert, Building2, Route as RouteIcon, History, Eye,
} from "lucide-react";
import { CartesianGrid, Legend as RLegend, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { Polyline, Tooltip as LTooltip, Marker } from "react-leaflet";
import { useApp } from "@/context/AppContext";
import { useApi } from "@/hooks/useApi";
import { api, downloadFile } from "@/lib/api";
import { Badge, Card, DataLabel, Empty, ErrorBox, LevelBadge, Loading, PageHeader, Section, Slider, Spinner, Stat, Tabs, cx } from "@/components/ui";
import { CityMap, GridOverlay, Legend, LEGENDS, MapOverlay, useMapStatic, Cell } from "@/components/map";
import { RAMPS, RISK_COLORS, depth, fmt, pretty } from "@/lib/format";
import { fmtTs, pinIcon, tooltipStyle } from "@/components/ops/common";

interface Params {
  useProfile: boolean; intensity: number; multiplier: number; duration: number; capacity: number;
  blockAssumed: boolean; blockage: number; imperv: number; tailwater: number; surface: number;
}
const DEFAULTS: Params = {
  useProfile: true, intensity: 60, multiplier: 1, duration: 180, capacity: 100,
  blockAssumed: true, blockage: 30, imperv: 0, tailwater: 0.5, surface: 0,
};
const PRESETS: { label: string; apply: Partial<Params> }[] = [
  { label: "30% drainage blockage", apply: { blockAssumed: false, blockage: 30 } },
  { label: "120 mm/hr cloudburst", apply: { useProfile: false, intensity: 120, duration: 90 } },
  { label: "Drainage upgrade +50%", apply: { capacity: 150 } },
  { label: "High river level 3 m", apply: { tailwater: 3 } },
];

/* metric meta: worse = direction in which the metric gets worse */
const METRICS: Record<string, { label: string; unit?: string; d?: number; worse: "up" | "down" }> = {
  max_flood_extent_km2: { label: "Max flood extent", unit: "km²", d: 3, worse: "up" },
  max_flooded_cells: { label: "Max flooded grid cells", d: 0, worse: "up" },
  max_depth_m: { label: "Max flood depth", unit: "m", d: 2, worse: "up" },
  affected_roads: { label: "Affected roads", d: 0, worse: "up" },
  drainage_failures: { label: "Drainage failures (nodes)", d: 0, worse: "up" },
  overflowing_nodes: { label: "Overflowing nodes", d: 0, worse: "up" },
  infrastructure_impacted: { label: "Infrastructure impacted", d: 0, worse: "up" },
  total_rain_mm: { label: "Total rainfall", unit: "mm", d: 1, worse: "up" },
  peak_runoff_m3s: { label: "Peak runoff", unit: "m³/s", d: 1, worse: "up" },
  first_road_flooding_min: { label: "First road flooding", unit: "min", d: 0, worse: "down" },
  flooded_road_hours: { label: "Flooded road-hours", unit: "h", d: 1, worse: "up" },
  flood_area_km2_hours: { label: "Flood area × time", unit: "km²·h", d: 1, worse: "up" },
};

function buildBody(p: Params, city: string) {
  return {
    city,
    rainfall_intensity: p.useProfile ? null : p.intensity,
    rainfall_multiplier: p.multiplier,
    duration_min: p.duration,
    drainage_capacity_pct: p.capacity,
    blockage_pct: p.blockAssumed ? null : p.blockage,
    imperviousness_delta_pct: p.imperv,
    initial_water_level_m: p.tailwater,
    initial_surface_water_m: p.surface,
  };
}

export default function WhatIf() {
  const { city, toast, isOfficer } = useApp();
  const [p, setP] = useState<Params>(DEFAULTS);
  const [res, setRes] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const saved = useApi<any[]>("/api/simulation", { live: false });
  const set = <K extends keyof Params>(k: K, v: Params[K]) => setP((x) => ({ ...x, [k]: v }));

  const run = async (save = false) => {
    save ? setSaving(true) : setRunning(true);
    setErr(null);
    try {
      const body = { ...buildBody(p, city), ...(save ? { save: true, name: name.trim() || undefined } : {}) };
      const r = await api.post("/api/simulation", body);
      setRes(r);
      if (save) {
        toast({ kind: "success", title: "Scenario saved", body: `Saved as #${r.saved_id}` });
        setName("");
        saved.reload();
      }
    } catch (e: any) {
      setErr(e?.message || "Simulation failed");
      toast({ kind: "error", title: "Simulation failed", body: e?.message });
    } finally {
      setRunning(false); setSaving(false);
    }
  };

  const viewSaved = async (id: number) => {
    try {
      const s = await api.get(`/api/simulation/${id}`, { cache: false });
      setRes({ ...s.result, params: s.params, diff_cells: [], newly_affected_roads: [], saved_view: s.name });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      toast({ kind: "error", title: "Could not load scenario", body: e?.message });
    }
  };

  const exportSim = async (id: number, fmtx: "csv" | "json") => {
    try { await downloadFile(`/api/simulation/${id}/export?fmt=${fmtx}`, `scenario_${id}.${fmtx}`); }
    catch (e: any) { toast({ kind: "error", title: "Export failed", body: e?.message }); }
  };

  const savedList: any[] = Array.isArray(saved.data) ? saved.data : [];

  return (
    <Section>
      <PageHeader icon={FlaskConical} title="What-If Simulator"
        subtitle="Re-run the coupled rainfall–runoff–drainage–surface flood model with modified parameters and compare against the baseline demo storm. All outputs are software simulations."
        labels={["SIMULATED_DATA", "DEMO_DATA"]} />

      <div className="grid xl:grid-cols-[360px_1fr] gap-4 items-start">
        {/* ---------------- parameter panel ---------------- */}
        <div className="flex flex-col gap-4 min-w-0 xl:sticky xl:top-4">
          <Card title="Scenario parameters" icon={FlaskConical}
            actions={<button className="btn-ghost btn-sm" onClick={() => setP(DEFAULTS)} aria-label="Reset parameters"><RotateCcw size={13} />Reset</button>}>
            <div className="mb-3">
              <span className="label">Presets</span>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((pr) => (
                  <button key={pr.label} className="btn-ghost btn-sm" onClick={() => setP({ ...DEFAULTS, ...pr.apply })}>{pr.label}</button>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="label">Rainfall intensity</legend>
                <div className="inline-flex rounded-lg border border-line bg-panel2 p-0.5 text-xs font-semibold" role="radiogroup" aria-label="Rainfall input">
                  <button role="radio" aria-checked={p.useProfile} onClick={() => set("useProfile", true)}
                    className={cx("rounded-md px-2.5 py-1", p.useProfile ? "bg-panel shadow-sm" : "text-muted")}>Use demo storm profile</button>
                  <button role="radio" aria-checked={!p.useProfile} onClick={() => set("useProfile", false)}
                    className={cx("rounded-md px-2.5 py-1", !p.useProfile ? "bg-panel shadow-sm" : "text-muted")}>Constant intensity</button>
                </div>
                {!p.useProfile && <Slider label="Constant intensity" value={p.intensity} min={10} max={200} step={5} unit=" mm/hr" onChange={(v) => set("intensity", v)} />}
              </fieldset>
              <Slider label="Rainfall multiplier" value={p.multiplier} min={0} max={3} step={0.1} unit="×" onChange={(v) => set("multiplier", v)}
                hint="Scales the rainfall series (e.g. 1.5× = 50% heavier storm)" />
              <Slider label="Storm duration" value={p.duration} min={15} max={300} step={15} unit=" min" onChange={(v) => set("duration", v)} />
              <Slider label="Drainage capacity" value={p.capacity} min={10} max={200} step={5} unit="%" onChange={(v) => set("capacity", v)}
                hint="100% = current design capacity; 150% = network upgrade" />
              <fieldset className="space-y-2">
                <legend className="label">Drainage blockage</legend>
                <div className="inline-flex rounded-lg border border-line bg-panel2 p-0.5 text-xs font-semibold" role="radiogroup" aria-label="Blockage input">
                  <button role="radio" aria-checked={p.blockAssumed} onClick={() => set("blockAssumed", true)}
                    className={cx("rounded-md px-2.5 py-1", p.blockAssumed ? "bg-panel shadow-sm" : "text-muted")}>Assumed per-drain</button>
                  <button role="radio" aria-checked={!p.blockAssumed} onClick={() => set("blockAssumed", false)}
                    className={cx("rounded-md px-2.5 py-1", !p.blockAssumed ? "bg-panel shadow-sm" : "text-muted")}>Uniform</button>
                </div>
                {p.blockAssumed
                  ? <p className="text-[11px] text-muted">Per-drain blockage from maintenance-age assumptions (no sensors).</p>
                  : <Slider label="Uniform blockage" value={p.blockage} min={0} max={90} step={5} unit="%" onChange={(v) => set("blockage", v)} />}
              </fieldset>
              <Slider label="Imperviousness change" value={p.imperv} min={-30} max={30} step={5} unit="%" onChange={(v) => set("imperv", v)}
                hint="Negative = more green / permeable surfaces" />
              <Slider label="Initial water level (river / outfall tailwater)" value={p.tailwater} min={0} max={5} step={0.1} unit=" m" onChange={(v) => set("tailwater", v)} />
              <Slider label="Initial surface water" value={p.surface} min={0} max={0.5} step={0.01} unit=" m" onChange={(v) => set("surface", v)} />
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <button className="btn-primary w-full" disabled={running || saving || !isOfficer} onClick={() => run(false)}>
                {running ? <Spinner size={15} className="text-current" /> : <Play size={15} />}{running ? "Simulating… (1–3 s)" : "Run simulation"}
              </button>
              <div className="flex gap-2">
                <label className="flex-1 min-w-0">
                  <span className="sr-only">Scenario name</span>
                  <input className="input py-1.5" placeholder="Scenario name (optional)" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
                </label>
                <button className="btn-ghost btn-sm" disabled={running || saving || !isOfficer} onClick={() => run(true)}>
                  {saving ? <Spinner size={13} /> : <Save size={13} />}Run & save
                </button>
              </div>
              {!isOfficer && <p className="text-xs text-muted">Simulation is available to municipal / emergency officers and analysts.</p>}
            </div>
          </Card>

          <Card title="Saved scenarios" icon={History} bodyClass="max-h-[360px] overflow-auto scroll-thin">
            {saved.error && !saved.data ? <ErrorBox error={saved.error} onRetry={saved.reload} /> : !saved.data ? <Loading /> :
              savedList.length === 0 ? <Empty text="No saved scenarios yet" /> : (
                <ul className="space-y-2">
                  {savedList.map((s) => (
                    <li key={s.id} className="rounded-lg border border-line p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">#{s.id} · {s.name}</div>
                          <div className="text-[11px] text-muted">{fmtTs(s.created_at)}</div>
                        </div>
                        <DataLabel label="SIMULATED_DATA" />
                      </div>
                      {s.headline && <p className="text-xs text-muted mt-1 line-clamp-2">{s.headline}</p>}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <button className="btn-ghost btn-sm" onClick={() => viewSaved(s.id)}><Eye size={12} />View</button>
                        <button className="btn-ghost btn-sm" onClick={() => exportSim(s.id, "csv")}><Download size={12} />CSV</button>
                        <button className="btn-ghost btn-sm" onClick={() => exportSim(s.id, "json")}><Download size={12} />JSON</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
          </Card>
        </div>

        {/* ---------------- results ---------------- */}
        <div className="min-w-0 flex flex-col gap-4">
          {err && <ErrorBox error={err} onRetry={() => run(false)} />}
          {running && !res && <Card><Loading text="Running baseline and scenario simulations…" /></Card>}
          {!res && !running && (
            <Card>
              <Empty icon={FlaskConical} text="Choose parameters or a preset, then press Run simulation to compare the scenario against the baseline." />
            </Card>
          )}
          {res && <Results res={res} running={running} />}
        </div>
      </div>
    </Section>
  );
}

/* ================================================================= results */
function Results({ res, running }: { res: any; running: boolean }) {
  const st = useMapStatic();
  const [layer, setLayer] = useState<"diff" | "depth" | "baseline">("diff");
  const b = res.baseline || {};
  const s = res.scenario || {};
  const delta = res.delta || {};
  const keys = Object.keys(b.summary || {});

  const diffCells = useMemo<Cell[]>(() => (res.diff_cells || []).filter((c: any[]) => Math.abs(c[2]) >= 0.01).map((c: any[]) => [c[0], c[1], c[2]] as Cell), [res]);
  const depthCells = useMemo<Cell[]>(() => (res.diff_cells || []).filter((c: any[]) => c[3] >= 0.02).map((c: any[]) => [c[0], c[1], c[3]] as Cell), [res]);
  const baseDepthCells = useMemo<Cell[]>(() => (res.diff_cells || []).map((c: any[]) => [c[0], c[1], +(c[3] - c[2]).toFixed(2)] as Cell).filter((c: Cell) => c[2] >= 0.02), [res]);

  const series = useMemo(() => {
    const m = new Map<number, any>();
    (b.series || []).forEach((x: any) => m.set(x.t, { t: x.t, b_area: x.flooded_area_km2, b_over: x.overloaded, b_depth: x.max_depth_m }));
    (s.series || []).forEach((x: any) => m.set(x.t, { ...(m.get(x.t) || { t: x.t }), s_area: x.flooded_area_km2, s_over: x.overloaded, s_depth: x.max_depth_m }));
    return [...m.values()].sort((a, c) => a.t - c.t);
  }, [b, s]);

  const wards = useMemo(() => [...(res.ward_changes || [])].sort((x: any, y: any) => y.change - x.change || y.scenario.max_depth_m - x.scenario.max_depth_m), [res]);
  const rc = res.route_comparison;

  return (
    <div className={cx("flex flex-col gap-4", running && "opacity-60 pointer-events-none")}>
      <div className="card p-4" style={{ borderLeft: "4px solid #a855f7" }}>
        <div className="flex flex-wrap items-center gap-2 mb-1.5">
          <DataLabel label="SIMULATED_DATA" />
          {res.saved_view && <Badge color="#0ea5e9">Saved: {res.saved_view}</Badge>}
          {res.saved_id && <Badge color="#16a34a">Saved #{res.saved_id}</Badge>}
          {res.horizon_min && <span className="text-xs text-muted">Simulated horizon {res.horizon_min} min</span>}
          {running && <Spinner size={14} />}
        </div>
        <p className="text-sm font-medium">{res.headline}</p>
      </div>

      <Card title="Baseline vs scenario" icon={Table2} subtitle="Delta coloured red where the scenario is worse, green where it improves."
        actions={<DataLabel label="SIMULATED_DATA" />} bodyClass="overflow-x-auto scroll-thin px-0 pb-0">
        <table className="table">
          <thead><tr><th>Metric</th><th className="text-right">Baseline</th><th className="text-right">Scenario</th><th className="text-right">Δ</th></tr></thead>
          <tbody>
            {keys.map((k) => {
              const m = METRICS[k] || { label: pretty(k), d: 2, worse: "up" as const };
              const dv = delta[k];
              const worse = dv != null && dv !== 0 && (m.worse === "up" ? dv > 0 : dv < 0);
              const better = dv != null && dv !== 0 && !worse;
              const show = (v: any) => (v === null || v === undefined ? (k === "first_road_flooding_min" ? "No flooding" : "—") : `${fmt(v, m.d ?? 2)}${m.unit ? " " + m.unit : ""}`);
              return (
                <tr key={k}>
                  <td className="font-medium">{m.label}</td>
                  <td className="text-right tabular-nums">{show(b.summary[k])}</td>
                  <td className="text-right tabular-nums">{show(s.summary?.[k])}</td>
                  <td className={cx("text-right tabular-nums font-semibold", worse && "text-red-600 dark:text-red-400", better && "text-green-600 dark:text-green-400", !worse && !better && "text-muted")}>
                    {dv == null ? "—" : `${dv > 0 ? "+" : ""}${fmt(dv, m.d ?? 2)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card title="Scenario map" icon={MapIcon}
        subtitle="Depth difference (scenario − baseline max depth), newly affected roads (magenta) and the ambulance route comparison."
        actions={<Tabs value={layer} onChange={setLayer} tabs={[{ key: "diff", label: "Difference" }, { key: "depth", label: "Scenario depth" }, { key: "baseline", label: "Baseline depth" }]} />}>
        {(res.diff_cells || []).length === 0 && <p className="text-xs text-muted mb-2">Grid difference cells are not stored with saved scenarios — re-run to view the map layers.</p>}
        <div className="relative">
          <CityMap className="h-[420px] md:h-[520px]">
            {st && layer === "diff" && <GridOverlay cells={diffCells} rows={st.rows} cols={st.cols} bbox={st.bbox} color={RAMPS.diff} opacity={0.8} />}
            {st && layer === "depth" && <GridOverlay cells={depthCells} rows={st.rows} cols={st.cols} bbox={st.bbox} color={RAMPS.depth} opacity={0.75} />}
            {st && layer === "baseline" && <GridOverlay cells={baseDepthCells} rows={st.rows} cols={st.cols} bbox={st.bbox} color={RAMPS.depth} opacity={0.75} />}
            {(res.newly_affected_roads || []).map((r: any) => (
              <Polyline key={r.id} positions={r.coords} pathOptions={{ color: "#d946ef", weight: 6, opacity: 0.95 }}>
                <LTooltip sticky><b>{r.name}</b><br />Newly affected in scenario</LTooltip>
              </Polyline>
            ))}
            {rc?.baseline?.coords?.length > 0 && (
              <Polyline positions={rc.baseline.coords} pathOptions={{ color: "#64748b", weight: 5, opacity: 0.8, dashArray: "8 6" }}>
                <LTooltip sticky>Baseline ambulance route · {fmt(rc.baseline.time_min)} min</LTooltip>
              </Polyline>
            )}
            {rc?.scenario?.coords?.length > 0 && (
              <Polyline positions={rc.scenario.coords} pathOptions={{ color: "#16a34a", weight: 4, opacity: 0.95 }}>
                <LTooltip sticky>Scenario ambulance route · {fmt(rc.scenario.time_min)} min</LTooltip>
              </Polyline>
            )}
            {rc?.from && <Marker position={rc.from} icon={pinIcon("#f97316", "F", 22)}><LTooltip>Route origin (fire station)</LTooltip></Marker>}
            {rc?.to && <Marker position={rc.to} icon={pinIcon("#dc2626", "H", 22)}><LTooltip>Route destination (hospital)</LTooltip></Marker>}
          </CityMap>
          <MapOverlay position="top-left"><DataLabel label="SIMULATED_DATA" className="bg-panel" /></MapOverlay>
          <MapOverlay position="bottom-left" className="flex gap-2 items-end">
            {layer === "diff"
              ? <Legend title="Depth change" items={[{ color: "#16a34a", label: "−0.5 m (better)" }, { color: "#f1f5f9", label: "No change" }, { color: "#f97316", label: "+0.3 m" }, { color: "#9f1239", label: "≥ +1 m (worse)" }]} />
              : <Legend title="Max depth" items={LEGENDS.depth} />}
            <Legend title="Overlays" className="hidden sm:block" items={[{ color: "#d946ef", label: "Newly affected road" }, { color: "#64748b", label: "Baseline route" }, { color: "#16a34a", label: "Scenario route" }]} />
          </MapOverlay>
        </div>
      </Card>

      <Card title="Timeline: baseline vs scenario" icon={Activity} actions={<DataLabel label="SIMULATED_DATA" />}>
        {series.length === 0 ? <Empty text="No time series" /> : (
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ left: -10, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" />
                <XAxis dataKey="t" tickFormatter={(v) => `${v}m`} fontSize={11} stroke="rgb(var(--muted))" />
                <YAxis yAxisId="l" fontSize={11} stroke="rgb(var(--muted))" label={{ value: "km²", angle: -90, position: "insideLeft", fontSize: 10, fill: "rgb(var(--muted))" }} />
                <YAxis yAxisId="r" orientation="right" fontSize={11} stroke="rgb(var(--muted))" />
                <RTooltip contentStyle={tooltipStyle} labelFormatter={(v) => `Minute ${v}`} />
                <RLegend wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="l" dataKey="b_area" name="Baseline flooded area km²" stroke="#64748b" strokeWidth={2} dot={false} />
                <Line yAxisId="l" dataKey="s_area" name="Scenario flooded area km²" stroke="#0ea5e9" strokeWidth={2.5} dot={false} />
                <Line yAxisId="r" dataKey="b_over" name="Baseline overloaded drains" stroke="#a8a29e" strokeDasharray="4 3" dot={false} />
                <Line yAxisId="r" dataKey="s_over" name="Scenario overloaded drains" stroke="#dc2626" strokeDasharray="4 3" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Ward risk changes" icon={ShieldAlert} bodyClass="overflow-x-auto scroll-thin px-0 pb-0 max-h-[420px]">
          <table className="table">
            <thead><tr><th>Ward</th><th>Risk level</th><th className="text-right">Max depth</th><th className="text-right">Flooded %</th></tr></thead>
            <tbody>
              {wards.map((w: any) => (
                <tr key={w.ward}>
                  <td className="font-medium whitespace-nowrap">{w.ward}</td>
                  <td>
                    <div className="flex items-center gap-1 flex-wrap">
                      <LevelBadge level={w.baseline.risk_level} map={RISK_COLORS} /><span className="text-muted">→</span><LevelBadge level={w.scenario.risk_level} map={RISK_COLORS} />
                      {w.change !== 0 && <span className={cx("text-xs font-bold", w.change > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400")}>{w.change > 0 ? `▲${w.change}` : `▼${-w.change}`}</span>}
                    </div>
                  </td>
                  <td className="text-right tabular-nums whitespace-nowrap">{depth(w.baseline.max_depth_m)} → {depth(w.scenario.max_depth_m)}</td>
                  <td className="text-right tabular-nums whitespace-nowrap">{fmt(w.baseline.flooded_pct)} → {fmt(w.scenario.flooded_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div className="flex flex-col gap-4 min-w-0">
          <Card title="Ambulance route comparison" icon={RouteIcon} subtitle="Fire station → hospital, flood-safe ambulance routing" actions={<DataLabel label="SIMULATED_DATA" />}>
            {!rc ? <Empty text="No route comparison" /> : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {(["baseline", "scenario"] as const).map((k) => {
                    const r = rc[k];
                    const ok = r?.status === "OK";
                    return (
                      <div key={k} className="rounded-lg border border-line p-2.5">
                        <div className="flex items-center justify-between gap-1 mb-1.5">
                          <span className="text-xs font-semibold uppercase text-muted">{k}</span>
                          <Badge color={ok ? "#16a34a" : "#dc2626"}>{pretty(r?.status)}</Badge>
                        </div>
                        <div className="text-sm tabular-nums">{r?.time_min != null ? `${fmt(r.time_min)} min` : "—"} · {r?.distance_km != null ? `${fmt(r.distance_km, 2)} km` : "—"}</div>
                        <div className="text-xs text-muted">Max depth on route {depth(r?.max_depth_m)}</div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs mt-2">{rc.changed ? <b className="text-amber-600 dark:text-amber-400">Route changes under the scenario.</b> : "Route unchanged between baseline and scenario."}</p>
              </>
            )}
          </Card>
          <Card title="Infrastructure impacted" icon={Building2}>
            <div className="grid sm:grid-cols-2 gap-3">
              {(["baseline", "scenario"] as const).map((k) => {
                const list: any[] = res[k]?.infrastructure || [];
                return (
                  <div key={k} className="min-w-0">
                    <div className="text-xs font-semibold uppercase text-muted mb-1">{k} ({list.length})</div>
                    {list.length === 0 ? <p className="text-xs text-muted">None</p> : (
                      <ul className="space-y-1.5">
                        {list.map((f) => (
                          <li key={f.id} className="rounded-md border border-line px-2 py-1.5">
                            <div className="text-sm font-medium truncate">{f.name}</div>
                            <div className="text-[11px] text-muted">{pretty(f.kind)} · site {depth(f.site_depth_m)}{f.access_cut && <span className="text-red-600 dark:text-red-400 font-semibold"> · access cut</span>}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      <Card title="Newly affected roads" icon={RouteIcon}>
        {(res.newly_affected_roads || []).length === 0 ? <p className="text-sm text-muted">No additional roads affected compared to the baseline.</p> : (
          <div className="flex flex-wrap gap-1.5">
            {res.newly_affected_roads.map((r: any) => <Badge key={r.id} color="#d946ef">{r.name}</Badge>)}
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <Stat label="Baseline affected roads" value={b.summary?.affected_roads ?? "—"} />
          <Stat label="Scenario affected roads" value={s.summary?.affected_roads ?? "—"} />
          <Stat label="Baseline failed drains" value={b.summary?.drainage_failures ?? "—"} />
          <Stat label="Scenario failed drains" value={s.summary?.drainage_failures ?? "—"} />
        </div>
      </Card>
    </div>
  );
}
