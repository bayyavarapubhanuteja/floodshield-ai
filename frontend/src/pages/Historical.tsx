/* Historical Flood Analytics — synthetic (DEMO) event catalogue. */
import React, { useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, BarChart3, CalendarDays, Clock, History, MapPin, Network, Search, TrendingUp, Waves } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend as RLegend, Line, ResponsiveContainer, Scatter, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { Polyline, Tooltip as LTooltip } from "react-leaflet";
import { useApi } from "@/hooks/useApi";
import { Card, DataLabel, Empty, ErrorBox, Kpi, Loading, PageHeader, Progress, Section, cx } from "@/components/ui";
import { CityMap, Legend, MapOverlay } from "@/components/map";
import { depth, fmt, pretty } from "@/lib/format";

const tooltipStyle = { background: "rgb(var(--panel))", border: "1px solid rgb(var(--line))", borderRadius: 8, fontSize: 12 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
type SortKey = "event_date" | "rainfall_mm" | "peak_intensity_mm_hr" | "max_depth_m" | "duration_hr" | "affected_road_count" | "drainage_failures";
const COLS: { key: SortKey; label: string }[] = [
  { key: "event_date", label: "Date" }, { key: "rainfall_mm", label: "Rainfall" }, { key: "peak_intensity_mm_hr", label: "Peak intensity" },
  { key: "max_depth_m", label: "Max depth" }, { key: "duration_hr", label: "Duration" }, { key: "affected_road_count", label: "Roads affected" },
  { key: "drainage_failures", label: "Drain failures" },
];
const depthCol = (d: number) => (d >= 1 ? "#9f1239" : d >= 0.5 ? "#dc2626" : d >= 0.3 ? "#f97316" : d >= 0.1 ? "#eab308" : "#16a34a");
const roadColor = (n: number, max: number) => { const f = n / Math.max(max, 1); return f > 0.8 ? "#9f1239" : f > 0.6 ? "#dc2626" : f > 0.4 ? "#f97316" : "#eab308"; };

export default function Historical() {
  const { data, error, loading, reload } = useApi<any>("/api/historical", { live: false });
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "event_date", dir: -1 });
  const [selRoad, setSelRoad] = useState<string | null>(null);

  const events: any[] = data?.events || [];
  const rel = data?.rain_depth_relation;
  const scatter = useMemo(() => (rel?.points || []).map((p: any) => ({ x: p.peak, y: p.depth })), [rel]);
  const regLine = useMemo(() => {
    if (!rel || !scatter.length) return [];
    const xs = scatter.map((p: any) => p.x);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    const f = (x: number) => Math.max(0, rel.slope_m_per_mmhr * x + rel.intercept_m);
    const x0 = Math.min(hi, Math.max(lo, -rel.intercept_m / (rel.slope_m_per_mmhr || 1)));
    return [{ x: lo, y: f(lo) }, { x: x0, y: f(x0) }, { x: hi, y: f(hi) }].sort((a, b) => a.x - b.x);
  }, [rel, scatter]);
  const byMonth = useMemo(() => (data?.by_month || []).map((m: any) => ({ ...m, name: MONTHS[m.month - 1] })), [data]);
  const maxRoadEvents = Math.max(1, ...(data?.frequent_roads || []).map((r: any) => r.events));

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const f = s ? events.filter((e) => [e.event_date, ...(e.hotspots || []), ...(e.affected_roads || []), String(e.year)].join(" ").toLowerCase().includes(s)) : events;
    return [...f].sort((a, b) => {
      const va = a[sort.key], vb = b[sort.key];
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [events, q, sort]);

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading text={loading ? "Loading historical catalogue…" : "Loading…"} />;
  const s = data.summary;

  return (
    <Section>
      <PageHeader icon={History} title="Historical Flood Analytics"
        subtitle={`${pretty(data.city)} · ${s.years} · rainfall–flood relationships, seasonality, hotspots and frequently flooded roads.`}
        labels={["DEMO_DATA"]} />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-slate-500/50 bg-slate-500/10 p-3 text-sm" role="note">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
        <div><b>DEMO DATA — synthetic reconstruction, not real records.</b> {data.note} Replace with municipal flood records for operational use.</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-4">
        <Kpi label="Flood events" value={s.total_events} icon={Waves} color="#0ea5e9" labelTag="DEMO_DATA" />
        <Kpi label="Years covered" value={s.years} icon={CalendarDays} color="#6366f1" />
        <Kpi label="Max depth recorded" value={depth(s.max_depth_m)} icon={TrendingUp} color="#dc2626" />
        <Kpi label="Mean duration" value={fmt(s.mean_duration_hr, 1)} unit="hr" icon={Clock} color="#f97316" />
        <Kpi label="Drainage failures" value={s.total_drainage_failures.toLocaleString()} icon={Network} color="#a855f7" sub="node overflows, all events" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Card title="Rainfall–flood relationship" icon={TrendingUp} subtitle="Peak intensity vs maximum depth, with linear regression" actions={<DataLabel label="DEMO_DATA" />}>
          {rel && (
            <div className="flex flex-wrap gap-3 text-xs mb-2">
              <span>Slope <b className="tabular-nums">{fmt(rel.slope_m_per_mmhr * 100, 2)} cm per mm/hr</b></span>
              <span>Intercept <b className="tabular-nums">{fmt(rel.intercept_m, 2)} m</b></span>
              <span>Correlation r = <b className="tabular-nums">{fmt(rel.correlation, 3)}</b></span>
            </div>
          )}
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart margin={{ left: -10, right: 8, top: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" />
                <XAxis dataKey="x" type="number" name="Peak intensity" unit=" mm/hr" fontSize={11} stroke="rgb(var(--muted))" domain={["dataMin - 5", "dataMax + 5"]} tickFormatter={(v) => Math.round(v).toString()} />
                <YAxis dataKey="y" type="number" name="Max depth" unit=" m" fontSize={11} stroke="rgb(var(--muted))" />
                <RTooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [typeof v === "number" ? v.toFixed(2) : v, n]} />
                <RLegend wrapperStyle={{ fontSize: 11 }} />
                <Scatter name="Events" data={scatter} fill="#0ea5e9" fillOpacity={0.7} />
                <Line name="Regression" data={regLine} dataKey="y" stroke="#dc2626" strokeWidth={2} dot={false} strokeDasharray="5 3" legendType="line" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Events per year & max depth" icon={BarChart3} actions={<DataLabel label="DEMO_DATA" />}>
          <div className="h-[290px]">
            <ResponsiveContainer>
              <ComposedChart data={data.by_year} margin={{ left: -10, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" />
                <XAxis dataKey="year" fontSize={11} stroke="rgb(var(--muted))" />
                <YAxis yAxisId="l" allowDecimals={false} fontSize={11} stroke="rgb(var(--muted))" />
                <YAxis yAxisId="r" orientation="right" unit=" m" fontSize={11} stroke="rgb(var(--muted))" />
                <RTooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [typeof v === "number" ? +v.toFixed(2) : v, n]} />
                <RLegend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="l" dataKey="events" name="Events" fill="#6366f1" radius={[2, 2, 0, 0]} />
                <Line yAxisId="r" dataKey="max_depth_m" name="Max depth (m)" stroke="#dc2626" strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <Card title="Seasonality" icon={CalendarDays} subtitle="Events and average peak intensity by month">
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={byMonth} margin={{ left: -10, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" />
                <XAxis dataKey="name" fontSize={11} stroke="rgb(var(--muted))" />
                <YAxis yAxisId="l" allowDecimals={false} fontSize={11} stroke="rgb(var(--muted))" />
                <YAxis yAxisId="r" orientation="right" fontSize={11} stroke="rgb(var(--muted))" />
                <RTooltip contentStyle={tooltipStyle} />
                <RLegend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="l" dataKey="events" name="Events" fill="#0ea5e9" radius={[2, 2, 0, 0]} />
                <Line yAxisId="r" dataKey="avg_peak" name="Avg peak mm/hr" stroke="#a855f7" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Hotspot wards" icon={MapPin} subtitle="Share of significant events affecting each ward" bodyClass="max-h-[300px] overflow-auto scroll-thin">
          {(data.hotspot_wards || []).length === 0 ? <Empty /> : (
            <ol className="space-y-1.5">
              {data.hotspot_wards.map((w: any, i: number) => (
                <li key={w.ward} className="flex items-center gap-2 text-sm">
                  <span className="w-5 text-right text-xs text-muted tabular-nums">{i + 1}</span>
                  <span className="w-32 truncate font-medium" title={w.ward}>{w.ward}</span>
                  <Progress value={w.frequency} color={w.frequency >= 0.8 ? "#dc2626" : w.frequency >= 0.5 ? "#f97316" : "#eab308"} />
                  <span className="w-12 text-right text-xs tabular-nums">{Math.round(w.frequency * 100)}%</span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Frequently flooded roads" icon={Waves} bodyClass="px-0 pb-0 max-h-[300px] overflow-auto scroll-thin">
          <table className="table">
            <thead><tr><th>Road</th><th className="text-right">Events</th></tr></thead>
            <tbody>
              {(data.frequent_roads || []).map((r: any) => (
                <tr key={r.road_id} className={cx("cursor-pointer", selRoad === r.road_id && "bg-brand/10")} onClick={() => setSelRoad(selRoad === r.road_id ? null : r.road_id)}>
                  <td><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{r.road_id}</div></td>
                  <td className="text-right tabular-nums font-semibold" style={{ color: roadColor(r.events, maxRoadEvents) }}>{r.events}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card className="mb-4" title="Frequently flooded roads — map" icon={MapPin} subtitle="Line weight and colour scale with the number of historical flood events. Click a row above to highlight.">
        <div className="relative">
          <CityMap className="h-[340px] md:h-[440px]">
            {(data.frequent_roads || []).map((r: any) => (
              <Polyline key={r.road_id} positions={r.coords}
                pathOptions={{ color: selRoad === r.road_id ? "#0ea5e9" : roadColor(r.events, maxRoadEvents), weight: 3 + (r.events / maxRoadEvents) * 7, opacity: selRoad && selRoad !== r.road_id ? 0.35 : 0.9 }}
                eventHandlers={{ click: () => setSelRoad(r.road_id) }}>
                <LTooltip sticky>{r.name} · {r.events} events</LTooltip>
              </Polyline>
            ))}
          </CityMap>
          <MapOverlay position="bottom-left">
            <Legend title="Flood events (relative)" items={[{ color: "#eab308", label: "≤ 40% of max" }, { color: "#f97316", label: "40–60%" }, { color: "#dc2626", label: "60–80%" }, { color: "#9f1239", label: "> 80%" }]} />
          </MapOverlay>
          <MapOverlay position="top-left"><DataLabel label="DEMO_DATA" className="bg-panel" /></MapOverlay>
        </div>
      </Card>

      <Card title={`Event catalogue (${rows.length})`} icon={History}
        actions={<div className="relative"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <label htmlFor="hist-search" className="sr-only">Search events</label>
          <input id="hist-search" className="input py-1.5 pl-8 text-xs w-48 sm:w-64" placeholder="Search date, ward, road…" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
        bodyClass="px-0 pb-0 overflow-x-auto scroll-thin max-h-[520px]">
        {rows.length === 0 ? <Empty text="No events match your search." /> : (
          <table className="table">
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th key={c.key} aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                    <button className="flex items-center gap-1 uppercase hover:text-ink" onClick={() => setSort((p) => ({ key: c.key, dir: p.key === c.key ? (p.dir === 1 ? -1 : 1) : -1 }))}>
                      {c.label}{sort.key === c.key && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                    </button>
                  </th>
                ))}
                <th>Hotspots</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap tabular-nums">{new Date(e.event_date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</td>
                  <td className="tabular-nums whitespace-nowrap">{fmt(e.rainfall_mm, 1)} mm</td>
                  <td className="tabular-nums whitespace-nowrap">{fmt(e.peak_intensity_mm_hr, 1)} mm/hr</td>
                  <td className="tabular-nums whitespace-nowrap font-semibold" style={{ color: depthCol(e.max_depth_m) }}>{depth(e.max_depth_m)}</td>
                  <td className="tabular-nums whitespace-nowrap">{fmt(e.duration_hr, 1)} hr</td>
                  <td className="tabular-nums">{e.affected_road_count}</td>
                  <td className="tabular-nums">{e.drainage_failures}</td>
                  <td className="text-xs min-w-[180px]">{(e.hotspots || []).length ? e.hotspots.join(", ") : <span className="text-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Section>
  );
}
