/* Rainfall Nowcast — simulated observations, AI nowcast with uncertainty, storm motion and a LIVE Open-Meteo reference. */
import { useMemo, useState } from "react";
import { Activity, AlertTriangle, CloudRain, Compass as CompassIcon, Gauge, Globe, Map as MapIcon, RefreshCw, Table2, TrendingUp, Droplets } from "lucide-react";
import { Area, Bar, CartesianGrid, ComposedChart, Legend as RLegend, Line, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { useApi } from "@/hooks/useApi";
import { Badge, Card, DataLabel, ErrorBox, Kpi, Loading, PageHeader, Progress, Section, Stat, Tabs, cx } from "@/components/ui";
import { CityMap, GridOverlay, LEGENDS, Legend, MapOverlay, useMapStatic } from "@/components/map";
import { RAMPS, fmt, pct } from "@/lib/format";
import { Compass, HORIZONS, WardLabels, axis, gridStroke, tooltipStyle } from "@/components/gis/common";

const catColor = (mm: number) => (mm >= 100 ? "#9f1239" : mm >= 64.5 ? "#dc2626" : mm >= 35.5 ? "#f97316" : mm >= 15.6 ? "#eab308" : mm >= 2.5 ? "#3b82f6" : "#64748b");

export default function Rainfall() {
  const [gridMode, setGridMode] = useState<"current" | "forecast">("current");
  const [gh, setGh] = useState(60);
  const cur = useApi<any>("/api/rainfall/current");
  const fc = useApi<any>(`/api/rainfall/forecast?horizon=${gh}`);
  const live = useApi<any>("/api/rainfall/live", { live: false });
  const st = useMapStatic();

  const c = cur.data, f = fc.data;
  const chart = useMemo(() => {
    if (!c || !f) return [];
    const truth = Object.fromEntries((f.demo_truth_reference?.values || []).map((v: any) => [v.horizon_min, v.simulated_truth_mm_hr]));
    return [
      ...c.history.map((h: any) => ({ t: h.event_minute, observed: h.mm_hr, cum: h.cum_mm })),
      { t: f.event_minute, forecast: f.current_mean_mm_hr, band: [f.current_mean_mm_hr, f.current_mean_mm_hr] },
      ...f.horizons.map((h: any) => ({ t: f.event_minute + h.horizon_min, forecast: h.intensity_mm_hr, band: [h.p10_mm_hr, h.p90_mm_hr], truth: truth[h.horizon_min] })),
    ];
  }, [c, f]);

  if ((cur.error && !c) || (fc.error && !f)) return <ErrorBox error={(cur.error || fc.error)!} onRetry={() => { cur.reload(); fc.reload(); }} />;
  if (!c || !f) return <Loading text="Running rainfall nowcast…" />;

  const sm = f.storm_motion || {};
  const h60 = f.horizons.find((h: any) => h.horizon_min === 60);
  const cum3h = f.horizons.find((h: any) => h.horizon_min === 180)?.accumulation_mm;
  const trend = f.trend_mm_hr_per_hr;
  const wards = [...c.wards].sort((a: any, b: any) => b.mm_hr - a.mm_hr);
  const wmax = Math.max(1, ...wards.map((w: any) => w.mm_hr));

  return (
    <Section>
      <PageHeader icon={CloudRain} title="Rainfall Nowcast"
        subtitle={`Event minute T+${c.event_minute} · issued ${new Date(c.issued_at).toLocaleTimeString()} · 0–3 h probabilistic nowcast on a ${st ? `${st.rows}×${st.cols}` : ""} grid`}
        labels={["SIMULATED_DATA", "MODEL_PREDICTION", "LIVE_DATA"]}
        actions={<button className="btn-ghost btn-sm" onClick={() => { cur.reload(); fc.reload(); }}><RefreshCw size={13} />Refresh</button>} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <Kpi label="Current mean" value={fmt(c.mean_mm_hr)} unit="mm/hr" icon={CloudRain} color={catColor(c.mean_mm_hr)} sub={c.category} labelTag="SIMULATED_DATA" />
        <Kpi label="Current max cell" value={fmt(c.max_mm_hr)} unit="mm/hr" icon={Gauge} color={catColor(c.max_mm_hr)} sub="highest grid cell" labelTag="SIMULATED_DATA" />
        <Kpi label="Cumulative so far" value={fmt(c.cumulative_mm, 0)} unit="mm" icon={Droplets} color="#2563eb" sub={<>+{fmt(cum3h, 0)} mm forecast in 3 h</>} />
        <Kpi label="Trend" value={`${trend >= 0 ? "+" : ""}${fmt(trend)}`} unit="mm/hr per hr" icon={TrendingUp} color={trend > 10 ? "#dc2626" : trend < -10 ? "#16a34a" : "#eab308"} sub={trend > 10 ? "Intensifying" : trend < -10 ? "Weakening" : "Steady"} labelTag="MODEL_PREDICTION" />
        <Kpi label="Storm motion" value={fmt(sm.speed_kmh, 1)} unit="km/h" icon={CompassIcon} color="#8b5cf6" sub={<>toward {Math.round(sm.direction_deg || 0)}°{sm.estimated ? " (estimated)" : ""}</>} />
        <Kpi label="+60 min intensity" value={fmt(h60?.intensity_mm_hr)} unit="mm/hr" icon={Activity} color={catColor(h60?.intensity_mm_hr || 0)} sub={<>conf {pct(h60?.confidence)} · anomaly z {fmt(f.anomaly_zscore, 1)}σ</>} labelTag="MODEL_PREDICTION" />
      </div>

      {f.anomalies?.length > 0 && (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
          <div className="font-semibold flex items-center gap-1.5 text-red-600 dark:text-red-300"><AlertTriangle size={15} />Anomalies detected</div>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">{f.anomalies.map((a: string) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}

      <Card title="Nowcast horizons" icon={Activity} className="mb-4" actions={<DataLabel label="MODEL_PREDICTION" />}>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2">
          {f.horizons.map((h: any) => (
            <div key={h.horizon_min} className="rounded-lg border border-line bg-panel2 p-2.5" style={{ borderTop: `3px solid ${catColor(h.intensity_mm_hr)}` }}>
              <div className="flex items-center justify-between"><span className="text-xs font-bold">+{h.horizon_min} min</span><span className="text-[10px] text-muted">conf {pct(h.confidence)}</span></div>
              <div className="mt-1 text-lg font-bold tabular-nums" style={{ color: catColor(h.intensity_mm_hr) }}>{fmt(h.intensity_mm_hr)}<span className="text-[10px] text-muted font-normal"> mm/hr</span></div>
              <div className="text-[11px] text-muted tabular-nums">P10–P90: {fmt(h.p10_mm_hr, 0)}–{fmt(h.p90_mm_hr, 0)}</div>
              <div className="text-[11px] tabular-nums">Accum: <b>{fmt(h.accumulation_mm, 0)} mm</b></div>
              <div className="text-[11px] tabular-nums">Heavy-rain P: <b>{pct(h.heavy_rain_probability)}</b></div>
              <Progress value={h.confidence} className="mt-1.5 h-1.5" color="#0ea5e9" />
              <div className="text-[10px] mt-1 leading-tight text-muted" title={h.category}>{h.category}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid xl:grid-cols-3 gap-4 mb-4">
        <Card className="xl:col-span-2" title="Observed history & AI nowcast" icon={TrendingUp}
          subtitle="Bars: simulated observed mean intensity. Line: nowcast with P10–P90 ensemble band. Dashed grey: SIMULATED scenario truth — demo validation only."
          actions={<><DataLabel label="SIMULATED_DATA" /><DataLabel label="MODEL_PREDICTION" /></>}>
          <div className="h-72">
            <ResponsiveContainer>
              <ComposedChart data={chart} margin={{ left: -10, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => `T+${v}`} {...axis} />
                <YAxis {...axis} unit="" />
                <RTooltip contentStyle={tooltipStyle} labelFormatter={(v) => `Event minute ${v}`} formatter={(v: any, n: any) => [Array.isArray(v) ? `${fmt(v[0])}–${fmt(v[1])}` : fmt(v), n]} />
                <RLegend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine x={f.event_minute} stroke="#64748b" strokeDasharray="3 3" label={{ value: "NOW", fontSize: 10, fill: "rgb(var(--muted))", position: "top" }} />
                <Area dataKey="band" name="Nowcast P10–P90" fill="#8b5cf6" fillOpacity={0.18} stroke="none" />
                <Bar dataKey="observed" name="Observed (SIMULATED) mm/hr" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                <Line dataKey="forecast" name="Nowcast mm/hr" stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line dataKey="truth" name="SIMULATED scenario truth — demo validation only" stroke="#94a3b8" strokeDasharray="6 4" strokeWidth={1.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <div className="flex flex-col gap-4 min-w-0">
          <Card title="Storm motion" icon={CompassIcon} actions={<DataLabel label="MODEL_PREDICTION" />}>
            <Compass deg={sm.direction_deg || 0} speed={sm.speed_kmh} />
            <p className="text-xs text-muted mt-2">Advection vector {fmt(sm.vector_cells_per_min?.[0], 3)}, {fmt(sm.vector_cells_per_min?.[1], 3)} cells/min estimated by phase correlation between successive rain fields.</p>
          </Card>
          <LivePanel live={live} />
        </div>
      </div>

      <div className="grid xl:grid-cols-3 gap-4 mb-4">
        <Card className="xl:col-span-2" title="Rainfall intensity map" icon={MapIcon}
          actions={<>
            <Tabs value={gridMode} onChange={setGridMode} tabs={[{ key: "current", label: "Current" }, { key: "forecast", label: "Forecast" }]} />
            {gridMode === "forecast" && (
              <label className="flex items-center gap-1 text-xs"><span className="sr-only">Forecast horizon</span>
                <select className="input py-1 w-auto" value={gh} onChange={(e) => setGh(Number(e.target.value))} aria-label="Forecast horizon">
                  {HORIZONS.map((h) => <option key={h} value={h}>+{h} min</option>)}
                </select>
              </label>
            )}
          </>}>
          <div className="relative">
            <CityMap className="h-[440px]">
              {st && <GridOverlay cells={gridMode === "current" ? c.grid : f.grid} rows={st.rows} cols={st.cols} bbox={st.bbox} color={RAMPS.rain} opacity={0.6} smooth />}
              {st && <WardLabels st={st} />}
            </CityMap>
            <MapOverlay position="top-left"><DataLabel label={gridMode === "current" ? "SIMULATED_DATA" : "MODEL_PREDICTION"} className="bg-panel" /></MapOverlay>
            {gridMode === "forecast" && <MapOverlay position="top-right"><span className="chip bg-panel border border-line">Nowcast for +{f.grid_horizon_min} min</span></MapOverlay>}
            <MapOverlay position="bottom-left"><Legend title="Rainfall intensity" items={LEGENDS.rain} /></MapOverlay>
          </div>
        </Card>
        <Card title="Ward rainfall (now)" icon={Table2} bodyClass="px-0 pb-0 overflow-x-auto max-h-[500px] scroll-thin" actions={<DataLabel label="SIMULATED_DATA" />}>
          <table className="table">
            <thead><tr><th>Ward</th><th>mm/hr</th><th className="w-1/2">Intensity</th></tr></thead>
            <tbody>
              {wards.map((w: any) => (
                <tr key={w.ward}>
                  <td className="font-medium">{w.ward}</td>
                  <td className="tabular-nums" style={{ color: catColor(w.mm_hr) }}>{fmt(w.mm_hr)}</td>
                  <td><Progress value={w.mm_hr} max={wmax} color={catColor(w.mm_hr)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="Nowcast model" icon={Activity}>
        <p className="text-sm">{f.model}</p>
        <ul className="mt-2 text-xs text-muted list-disc pl-5 space-y-0.5">
          <li>Storm motion is estimated from successive (simulated) radar-like rain fields by phase correlation and the field is advected forward.</li>
          <li>Growth/decay follows a damped trend; a gradient-boosting model corrects the intensity ratio; a 16-member ensemble gives the P10–P90 band and heavy-rain probability.</li>
          <li>Categories follow IMD thresholds (heavy ≥ 64.5 mm/day-equivalent classes; cloudburst-class ≥ 100 mm/hr).</li>
          <li>Rain observations here are <b>SIMULATED</b> — no radar/gauge feed is configured. The Open-Meteo panel is a live reference only and does not drive the model.</li>
        </ul>
        <div className="flex flex-wrap gap-1.5 mt-2">{(f.sources || []).map((s: string) => <Badge key={s} color="#0ea5e9">{s}</Badge>)}</div>
      </Card>
    </Section>
  );
}

function LivePanel({ live }: { live: { data: any; error: string | null; loading: boolean; reload: () => void } }) {
  const d = live.data;
  const online = d?.status === "ONLINE";
  return (
    <Card title="Live weather reference" icon={Globe} subtitle="Open-Meteo point precipitation at city centre — reference only, not used by the simulation"
      actions={<><DataLabel label="LIVE_DATA" /><button className="btn-ghost btn-sm" aria-label="Refresh live data" onClick={live.reload}><RefreshCw size={13} className={cx(live.loading && "animate-spin")} /></button></>}>
      {live.error && !d && <ErrorBox error={live.error} onRetry={live.reload} />}
      {!d && !live.error && <Loading />}
      {d && (
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge color={online ? "#16a34a" : "#64748b"} solid>{d.status}</Badge>
            <span className="text-xs text-muted">{d.provider}{d.observed_at ? ` · ${d.observed_at} UTC` : ""}</span>
          </div>
          {online ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Precip." value={`${fmt(d.precipitation_mm, 1)} mm`} />
                <Stat label="Temp." value={`${fmt(d.temperature_c, 1)} °C`} />
                <Stat label="Humidity" value={`${fmt(d.humidity_pct, 0)}%`} />
              </div>
              {d.next_3h_15min_mm?.length > 0 && (
                <div className="h-24">
                  <ResponsiveContainer>
                    <ComposedChart data={d.next_3h_15min_mm.map((p: any) => ({ t: String(p.time).slice(11, 16), mm: p.mm }))} margin={{ left: -24, right: 4, top: 4 }}>
                      <XAxis dataKey="t" {...axis} fontSize={9} />
                      <YAxis {...axis} fontSize={9} />
                      <RTooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="mm" name="mm / 15 min" fill="#16a34a" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-muted">Live provider unreachable or disabled{d.error ? ` (${d.error})` : ""}. The dashboard continues on simulated data.</p>
          )}
        </div>
      )}
    </Card>
  );
}
