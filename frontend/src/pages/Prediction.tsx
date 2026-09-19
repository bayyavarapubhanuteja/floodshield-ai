/* Flood Prediction — propagation timeline, street-level flood intelligence and flood zones. */
import React, { useMemo, useState } from "react";
import { Clock, HelpCircle, MapPin, Ruler, Search, Table2, Timer, Waves } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Legend as RLegend, Line, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { useApi } from "@/hooks/useApi";
import { Card, DataLabel, ErrorBox, LevelBadge, Loading, PageHeader, Section, Select, Spinner, Stat, useDebounced } from "@/components/ui";
import { CityMap, GridOverlay, HorizonBar, LEGENDS, Legend, MapOverlay, RoadsLayer, useMapStatic } from "@/components/map";
import { DRAIN_COLORS, PASSABILITY_COLORS, RAMPS, RISK_COLORS, depth, fmt, pct, pretty, ttf } from "@/lib/format";
import { HORIZONS, PlayButton, RISK_ORDER, RoadDrawer, WardLabels, ZonesLayer, axis, gridStroke, tooltipStyle, usePlayer, zonesFromFC } from "@/components/gis/common";

export default function Prediction() {
  const [roadId, setRoadId] = useState<string | null>(null);
  return (
    <Section>
      <PageHeader icon={Waves} title="Flood Prediction"
        subtitle="Street-level flood intelligence: WHERE it will flood, WHEN, HOW DEEP and WHY — with the coupled flood propagation NOW → +180 min."
        labels={["MODEL_PREDICTION", "SIMULATED_DATA", "DEMO_DATA"]} />
      <Answers onRoad={setRoadId} />
      <Timeline />
      <RoadsTable onRoad={setRoadId} />
      <Zones />
      <RoadDrawer id={roadId} onClose={() => setRoadId(null)} />
    </Section>
  );
}

/* ---------------- WHERE / WHEN / HOW DEEP / WHY ---------------- */
function Answers({ onRoad }: { onRoad: (id: string) => void }) {
  const { data } = useApi<any>("/api/flood/roads?min_risk=HIGH&limit=50");
  if (!data) return null;
  const roads = data.roads as any[];
  if (!roads.length) return <div className="card p-4 mb-4 text-sm">No roads at HIGH risk or above in the next 3 hours.</div>;
  const top = roads[0];
  const upcoming = roads.filter((r) => r.time_to_flood_min && r.time_to_flood_min > 0).sort((a, b) => a.time_to_flood_min - b.time_to_flood_min);
  const flooded = roads.filter((r) => r.time_to_flood_min === 0).length;
  const deepest = [...roads].sort((a, b) => b.max_depth_m - a.max_depth_m)[0];
  const wards = [...new Set(roads.map((r) => r.ward))];
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
      <AnswerCard icon={MapPin} q="WHERE?" color="#dc2626">
        <b>{roads.length}</b> road segments at HIGH+ risk in <b>{wards.length}</b> wards: {wards.slice(0, 4).join(", ")}{wards.length > 4 ? "…" : ""}.
        <button className="block text-brand text-xs mt-1 hover:underline" onClick={() => onRoad(top.id)}>Worst: {top.name} →</button>
      </AnswerCard>
      <AnswerCard icon={Clock} q="WHEN?" color="#f97316">
        <b>{flooded}</b> already flooded. {upcoming[0] ? <>Next: <b>{upcoming[0].name}</b> {ttf(upcoming[0].time_to_flood_min)}{upcoming[1] ? <>, then {upcoming[1].name} {ttf(upcoming[1].time_to_flood_min)}</> : null}.</> : "No new flooding expected among these roads."}
      </AnswerCard>
      <AnswerCard icon={Ruler} q="HOW DEEP?" color="#2563eb">
        Peak <b>{depth(deepest.max_depth_m)}</b> on {deepest.name} at +{deepest.time_of_max_min} min; lasting ~{deepest.duration_min} min. {top.name}: {depth(top.depth_now_m)} now → {depth(top.depth_forecast_m?.[60])} at +60.
      </AnswerCard>
      <AnswerCard icon={HelpCircle} q="WHY?" color="#8b5cf6">
        <span className="line-clamp-4">{top.explanation}</span>
      </AnswerCard>
    </div>
  );
}
function AnswerCard({ icon: Icon, q, color, children }: { icon: any; q: string; color: string; children: React.ReactNode }) {
  return (
    <div className="card p-3.5" style={{ borderTop: `3px solid ${color}` }}>
      <div className="flex items-center gap-1.5 text-xs font-bold tracking-wide" style={{ color }}><Icon size={14} />{q}</div>
      <div className="text-sm mt-1.5 leading-snug">{children}</div>
    </div>
  );
}

/* ---------------- propagation timeline ---------------- */
function Timeline() {
  const st = useMapStatic();
  const { data, error, reload } = useApi<any>("/api/flood/timeline");
  const frames = (data?.frames || []) as any[];
  const player = usePlayer(frames.length, { interval: 1200 });
  const fr = frames[Math.min(player.idx, frames.length - 1)];
  const chart = useMemo(() => frames.map((f) => ({ t: f.offset_min, extent: f.flooded_area_km2, maxd: f.max_depth_m, rain: f.rain_mm_hr, over: f.overloaded_nodes })), [frames]);
  if (error && !data) return <div className="mb-4"><ErrorBox error={error} onRetry={reload} /></div>;
  if (!data || !fr) return <Loading text="Building flood propagation timeline…" />;
  const grid = data.grid || st;

  return (
    <div className="grid xl:grid-cols-3 gap-4 mb-4">
      <Card className="xl:col-span-2" title="Flood propagation timeline" icon={Timer} subtitle="Coupled rainfall → runoff → drainage → 2-D surface flood, every 15 min."
        actions={<><DataLabel label={fr.offset_min === 0 ? "SIMULATED_DATA" : "MODEL_PREDICTION"} /><PlayButton playing={player.playing} onClick={player.toggle} /></>}>
        <div className="relative">
          <CityMap className="h-[440px]">
            {st && grid && <GridOverlay cells={fr.cells} rows={grid.rows} cols={grid.cols} bbox={grid.bbox || st.bbox} color={RAMPS.depth} opacity={0.8} />}
            {st && <WardLabels st={st} />}
          </CityMap>
          <MapOverlay position="top-right"><span className="chip bg-panel border border-line text-sm">{fr.label} · T+{fr.event_minute}</span></MapOverlay>
          <MapOverlay position="bottom-left"><Legend title="Flood depth" items={LEGENDS.depth} /></MapOverlay>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <label htmlFor="tl-scrub" className="text-xs text-muted whitespace-nowrap">Frame</label>
          <input id="tl-scrub" type="range" className="w-full accent-sky-500" min={0} max={frames.length - 1} value={player.idx}
            onChange={(e) => { player.setPlaying(false); player.setIdx(Number(e.target.value)); }} aria-valuetext={fr.label} />
          <span className="text-xs font-semibold tabular-nums w-16 text-right">{fr.label}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <Stat label="Flood extent" value={`${fmt(fr.flooded_area_km2, 2)} km²`} />
          <Stat label="Max depth" value={depth(fr.max_depth_m)} />
          <Stat label="Rainfall (mean)" value={`${fmt(fr.rain_mm_hr)} mm/hr`} />
          <Stat label="Overloaded drains" value={fr.overloaded_nodes} />
        </div>
      </Card>
      <Card title="Extent & depth over time" icon={Waves} actions={<DataLabel label="MODEL_PREDICTION" />}>
        <div className="h-64 xl:h-[420px]">
          <ResponsiveContainer>
            <ComposedChart data={chart} margin={{ left: -10, right: 4, top: 8 }} onClick={(e: any) => { if (e?.activeTooltipIndex !== undefined) { player.setPlaying(false); player.setIdx(e.activeTooltipIndex); } }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="t" tickFormatter={(v) => (v === 0 ? "NOW" : `+${v}`)} {...axis} />
              <YAxis yAxisId="l" {...axis} />
              <YAxis yAxisId="r" orientation="right" {...axis} />
              <RTooltip contentStyle={tooltipStyle} labelFormatter={(v) => (v === 0 ? "NOW" : `+${v} min`)} />
              <RLegend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine yAxisId="l" x={fr.offset_min} stroke="#22d3ee" strokeWidth={2} />
              <Area yAxisId="l" dataKey="extent" name="Extent km²" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.25} />
              <Line yAxisId="r" dataKey="maxd" name="Max depth m" stroke="#1e40af" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-muted">Click the chart to jump to a frame.</p>
      </Card>
    </div>
  );
}

/* ---------------- street-level table ---------------- */
function RoadsTable({ onRoad }: { onRoad: (id: string) => void }) {
  const st = useMapStatic();
  const [q, setQ] = useState("");
  const [ward, setWard] = useState("");
  const [minRisk, setMinRisk] = useState("");
  const dq = useDebounced(q, 300);
  const params = [dq.trim() && `q=${encodeURIComponent(dq.trim())}`, ward && `ward=${encodeURIComponent(ward)}`, minRisk && `min_risk=${minRisk}`].filter(Boolean).join("&");
  const { data, error, loading, reload } = useApi<any>(`/api/flood/roads${params ? `?${params}` : ""}`);
  const [showMap, setShowMap] = useState(false);
  const status = useMemo(() => Object.fromEntries((data?.roads || []).map((r: any) => [r.id, { id: r.id, depth_m: r.depth_forecast_m?.[60], risk_level: r.risk_level, closed: r.closed }])), [data]);
  const shown = useMemo(() => new Set((data?.roads || []).map((r: any) => r.id)), [data]);

  return (
    <Card title={`Street-level flood intelligence${data ? ` (${data.count})` : ""}`} icon={Table2} className="mb-4" bodyClass="px-0 pb-0"
      subtitle="Sorted by risk. Click a row for the explanation, contributing factors and full depth forecast."
      actions={<>{loading && <Spinner size={14} />}<button className="btn-ghost btn-sm" onClick={() => setShowMap(!showMap)}>{showMap ? "Hide map" : "Show on map"}</button><DataLabel label="MODEL_PREDICTION" /></>}>
      <div className="flex flex-wrap gap-2 px-4 pb-3 items-end">
        <label className="block">
          <span className="label">Search road</span>
          <div className="relative"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input py-1.5 pl-7 w-52" placeholder="Name or id" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </label>
        <Select label="Ward" value={ward} onChange={setWard} options={[{ value: "", label: "All wards" }, ...(st?.wards || []).map((w) => ({ value: w.name, label: w.name }))]} />
        <Select label="Minimum risk" value={minRisk} onChange={setMinRisk} options={[{ value: "", label: "Any" }, ...RISK_ORDER.map((k) => ({ value: k, label: pretty(k) }))]} />
      </div>
      {showMap && st && (
        <div className="px-4 pb-3 relative">
          <CityMap className="h-[380px]">
            <RoadsLayer roads={st.roads.filter((r) => shown.has(r.id))} status={status} colorBy="depth" onSelect={onRoad} />
          </CityMap>
          <MapOverlay position="bottom-left" className="ml-4"><Legend title="Road depth at +60" items={LEGENDS.roadDepth} /></MapOverlay>
        </div>
      )}
      {error && !data && <div className="px-4 pb-4"><ErrorBox error={error} onRetry={reload} /></div>}
      {!data && !error && <Loading />}
      {data && (
        <div className="overflow-auto scroll-thin max-h-[600px]">
          <table className="table">
            <thead><tr>
              <th>Road</th><th>Ward</th><th>Now</th>{HORIZONS.map((h) => <th key={h}>+{h}</th>)}<th>P(+60)</th><th>Time to flood</th><th>Duration</th><th>Drainage</th><th>Passability</th><th>Risk</th>
            </tr></thead>
            <tbody>
              {data.roads.length === 0 && <tr><td colSpan={16} className="text-center text-muted py-6">No roads match the filters.</td></tr>}
              {data.roads.map((r: any) => (
                <tr key={r.id} className="cursor-pointer" tabIndex={0} onClick={() => onRoad(r.id)} onKeyDown={(e) => { if (e.key === "Enter") onRoad(r.id); }}>
                  <td className="font-medium min-w-[180px]">{r.name}{r.underpass && <span className="ml-1 text-[10px] text-amber-500">UNDERPASS</span>}{r.closed && <span className="ml-1 text-[10px] text-red-500">CLOSED</span>}</td>
                  <td className="whitespace-nowrap text-xs">{r.ward}</td>
                  <td className="tabular-nums whitespace-nowrap font-semibold">{depth(r.depth_now_m)}</td>
                  {HORIZONS.map((h) => <td key={h} className="tabular-nums whitespace-nowrap text-xs" style={{ color: depthTone(r.depth_forecast_m?.[h]) }}>{depth(r.depth_forecast_m?.[h])}</td>)}
                  <td className="tabular-nums">{pct(r.probability?.[60])}</td>
                  <td className="whitespace-nowrap text-xs">{ttf(r.time_to_flood_min)}</td>
                  <td className="tabular-nums text-xs">{r.duration_min ? `${r.duration_min} min` : "—"}</td>
                  <td><LevelBadge level={r.drainage_status} map={DRAIN_COLORS} /></td>
                  <td><LevelBadge level={r.passability} map={PASSABILITY_COLORS} /></td>
                  <td><LevelBadge level={r.risk_level} map={RISK_COLORS} solid /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
const depthTone = (d?: number) => (d === undefined || d === null ? undefined : d >= 0.5 ? "#dc2626" : d >= 0.3 ? "#f97316" : d >= 0.15 ? "#ca8a04" : undefined);

/* ---------------- flood zones ---------------- */
function Zones() {
  const st = useMapStatic();
  const [h, setH] = useState(60);
  const { data, error, loading, reload } = useApi<any>(`/api/flood/zones?horizon=${h}`);
  const zones = useMemo(() => zonesFromFC(data).sort((a, b) => b.area_km2 - a.area_km2), [data]);
  return (
    <Card title="Flood zones" icon={MapPin} subtitle="Connected flooded areas (depth ≥ threshold) at the selected horizon."
      actions={<>{loading && <Spinner size={14} />}<HorizonBar value={h} onChange={setH} /><DataLabel label={h === 0 ? "SIMULATED_DATA" : "MODEL_PREDICTION"} /></>}>
      {error && !data && <ErrorBox error={error} onRetry={reload} />}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="relative">
          <CityMap className="h-[380px]">
            {st && <ZonesLayer zones={zones} fill={0.3} />}
          </CityMap>
          <MapOverlay position="bottom-left"><Legend title="Zone risk" items={LEGENDS.risk} /></MapOverlay>
        </div>
        <div className="overflow-auto scroll-thin max-h-[380px]">
          {data && zones.length === 0 && <p className="text-sm text-muted py-6 text-center">No flood zones at this horizon.</p>}
          {zones.length > 0 && (
            <table className="table">
              <thead><tr><th>Zone</th><th>Area</th><th>Max depth</th><th>Mean depth</th><th>Prob.</th><th>Risk</th></tr></thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.id}>
                    <td className="font-medium">{z.name}<div className="text-[10px] text-muted">{z.id}</div></td>
                    <td className="tabular-nums whitespace-nowrap">{fmt(z.area_km2, 2)} km²</td>
                    <td className="tabular-nums">{depth(z.max_depth_m)}</td>
                    <td className="tabular-nums">{depth(z.mean_depth_m)}</td>
                    <td className="tabular-nums">{pct(z.probability)}</td>
                    <td><LevelBadge level={z.risk_level} map={RISK_COLORS} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Card>
  );
}
