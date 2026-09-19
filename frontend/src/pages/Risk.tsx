/* Risk Analysis & Explainable AI — road/ward risk, factor attribution, UFVI and model card. */
import { useEffect, useMemo, useState } from "react";
import { Brain, Cpu, Gauge, Map as MapIcon, ShieldAlert, Table2, Scale, Building } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell as RCell, Legend as RLegend, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { CircleMarker, Tooltip as LTooltip } from "react-leaflet";
import { useApi } from "@/hooks/useApi";
import { Badge, Card, DataLabel, ErrorBox, Kpi, LevelBadge, Loading, PageHeader, Progress, Section, Select, Stat } from "@/components/ui";
import { CityMap, LEGENDS, Legend, MapOverlay, RoadsLayer, useMapStatic } from "@/components/map";
import { ALERT_COLORS, RISK_COLORS, depth, fmt, pct, pretty, ttf } from "@/lib/format";
import { FactorBars, RISK_ORDER, axis, gridStroke, tooltipStyle } from "@/components/gis/common";

const UFVI_COLORS: Record<string, string> = {
  low_elevation: "#16a34a", flat_terrain: "#84cc16", imperviousness: "#64748b", drainage_deficit: "#0ea5e9",
  historical_flooding: "#8b5cf6", infrastructure_exposure: "#f97316", road_connectivity_criticality: "#dc2626",
};
const TRIGGER_UNITS: Record<string, (v: number) => string> = {
  rainfall_mm_hr: (v) => `${fmt(v)} mm/hr`, flood_probability: (v) => pct(v), depth_m: (v) => depth(v),
  time_to_flood_min: (v) => `${v} min`, drainage_utilization: (v) => pct(v),
};

export default function Risk() {
  const st = useMapStatic();
  const { data, error, reload } = useApi<any>("/api/risk");
  const roadsApi = useApi<any>("/api/flood/roads");
  const [roadId, setRoadId] = useState<string>("");
  const [wardId, setWardId] = useState<string>("");

  const roads = (roadsApi.data?.roads || []) as any[];
  useEffect(() => { if (!roadId && roads[0]) setRoadId(roads[0].id); }, [roads, roadId]);
  useEffect(() => { if (!wardId && data?.wards?.[0]) setWardId(data.wards[0].id); }, [data, wardId]);
  const status = useMemo(() => Object.fromEntries(roads.map((r) => [r.id, { id: r.id, risk_level: r.risk_level, depth_m: r.depth_now_m, closed: r.closed }])), [roads]);

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading text="Scoring flood risk…" />;
  const total = RISK_ORDER.reduce((s, k) => s + (data.counts[k] || 0), 0);

  return (
    <Section>
      <PageHeader icon={ShieldAlert} title="Risk Analysis & Explainable AI"
        subtitle={`Transparent weighted risk model + ML susceptibility + Urban Flood Vulnerability Index · event minute T+${data.event_minute} · issued ${new Date(data.issued_at).toLocaleTimeString()}`}
        labels={["MODEL_PREDICTION", "SIMULATED_DATA", "DEMO_DATA"]} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <Kpi label="City risk level" value={pretty(data.city_level)} icon={ShieldAlert} color={RISK_COLORS[data.city_level]} labelTag="MODEL_PREDICTION" />
        {RISK_ORDER.map((k) => (
          <Kpi key={k} label={`${pretty(k)} roads`} value={data.counts[k] || 0} color={RISK_COLORS[k]}
            sub={<div className="w-full"><Progress value={data.counts[k] || 0} max={total || 1} color={RISK_COLORS[k]} /></div>} />
        ))}
      </div>

      <div className="grid xl:grid-cols-5 gap-4 mb-4">
        <Card className="xl:col-span-3" title="Road risk map" icon={MapIcon} subtitle="Roads coloured by risk level; rings show ward alert levels. Click a road to explain it.">
          <div className="relative">
            <CityMap className="h-[480px]">
              {st && <RoadsLayer roads={st.roads} status={status} colorBy="risk" highlight={roadId} onSelect={setRoadId} />}
              {st && data.wards.map((w: any) => (
                <CircleMarker key={w.id} center={w.center} radius={14} pathOptions={{ color: ALERT_COLORS[w.alert_level], weight: 3, fillOpacity: 0.1, fillColor: RISK_COLORS[w.risk_level] }}
                  eventHandlers={{ click: () => setWardId(w.id) }}>
                  <LTooltip direction="top">{w.name}: {w.alert_level} alert · {pretty(w.risk_level)} risk · UFVI {fmt(w.ufvi, 2)}</LTooltip>
                </CircleMarker>
              ))}
            </CityMap>
            <MapOverlay position="bottom-left" className="flex gap-2 items-end">
              <Legend title="Road risk" items={LEGENDS.risk} />
              <Legend title="Ward alert" className="hidden sm:block" items={Object.entries(ALERT_COLORS).map(([k, v]) => ({ color: v, label: k }))} />
            </MapOverlay>
          </div>
        </Card>
        <div className="xl:col-span-2 min-w-0">
          <RoadExplain roads={roads} roadId={roadId} setRoadId={setRoadId} />
        </div>
      </div>

      <Card title="Risk level cut-offs" icon={Scale} className="mb-4">
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.levels as Record<string, string>).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs"><LevelBadge level={k} map={RISK_COLORS} solid /><span className="tabular-nums">score {v}</span></span>
          ))}
        </div>
        <p className="text-xs text-muted mt-2">Risk score = Σ weightᵢ × normalised factorᵢ (0–1). Contribution % = each weighted term ÷ total score.</p>
      </Card>

      <div className="grid xl:grid-cols-5 gap-4 mb-4">
        <Card className="xl:col-span-3" title="Ward risk & early-warning status" icon={Table2} bodyClass="px-0 pb-0 overflow-x-auto scroll-thin max-h-[520px]" actions={<DataLabel label="MODEL_PREDICTION" />}>
          <table className="table">
            <thead><tr><th>Ward</th><th>Alert</th><th>Risk</th><th>P(+60)</th><th>Depth +60</th><th>Time to flood</th><th>Triggers</th><th>UFVI</th></tr></thead>
            <tbody>
              {[...data.wards].sort((a: any, b: any) => RISK_ORDER.indexOf(b.risk_level) - RISK_ORDER.indexOf(a.risk_level) || b.flood_probability_60 - a.flood_probability_60).map((w: any) => (
                <tr key={w.id} className="cursor-pointer" onClick={() => setWardId(w.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setWardId(w.id); }}>
                  <td className="font-medium">{w.name}</td>
                  <td><LevelBadge level={w.alert_level} map={ALERT_COLORS} solid /></td>
                  <td><LevelBadge level={w.risk_level} map={RISK_COLORS} /></td>
                  <td className="tabular-nums">{pct(w.flood_probability_60)}</td>
                  <td className="tabular-nums">{depth(w.max_depth_60_m)}</td>
                  <td className="whitespace-nowrap text-xs">{ttf(w.time_to_flood_min)}</td>
                  <td className="text-xs">
                    <div className="flex flex-wrap gap-1">{(w.triggers || []).filter((t: any) => t.level !== "GREEN").map((t: any) => <Badge key={t.metric} color={ALERT_COLORS[t.level] || "#64748b"}>{pretty(t.metric)}</Badge>)}</div>
                  </td>
                  <td className="tabular-nums whitespace-nowrap">{fmt(w.ufvi, 2)} <span className="text-[10px] text-muted">{pretty(w.ufvi_class)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="xl:col-span-2 min-w-0">
          <WardExplain wards={data.wards} wardId={wardId} setWardId={setWardId} />
        </div>
      </div>

      <Vulnerability />
      <ModelCard />
    </Section>
  );
}

function RoadExplain({ roads, roadId, setRoadId }: { roads: any[]; roadId: string; setRoadId: (id: string) => void }) {
  const { data, error, reload } = useApi<any>(roadId ? `/api/risk/explain?kind=road&id=${roadId}` : null);
  const e = data && data.id === roadId ? data : null;
  return (
    <Card title="Explainable AI — road" icon={Brain} className="h-full" actions={<DataLabel label="MODEL_PREDICTION" />}>
      <Select label="Road (sorted by risk)" value={roadId} onChange={setRoadId} className="mb-3"
        options={roads.map((r) => ({ value: r.id, label: `${r.name} · ${pretty(r.risk_level)}` }))} />
      {error && !e && <ErrorBox error={error} onRetry={reload} />}
      {!e && !error && <Loading />}
      {e && (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <LevelBadge level={e.prediction.risk_level} map={RISK_COLORS} solid />
            <span className="text-xs text-muted">score {fmt(e.prediction.risk_score, 3)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Depth now → +60" value={`${depth(e.prediction.depth_now_m)} → ${depth(e.prediction.depth_forecast_m?.[60])}`} />
            <Stat label="Probability +60" value={pct(e.prediction.probability?.[60])} />
            <Stat label="Time to flood" value={ttf(e.prediction.time_to_flood_min)} />
            <Stat label="Confidence" value={pct(e.confidence)} />
            <Stat label="ML susceptibility" value={pct(e.ml_susceptibility)} />
            <Stat label="Issued" value={<span className="text-xs">{new Date(e.issued_at).toLocaleString()} (T+{e.event_minute})</span>} />
          </div>
          <p className="rounded-lg border border-line bg-panel2 p-2.5 text-xs leading-relaxed">{e.explanation}</p>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">Contributing factors (% of score)</div>
            <FactorBars factors={e.factors} />
          </div>
          <div className="overflow-x-auto scroll-thin">
            <table className="table text-xs">
              <thead><tr><th>Factor</th><th>Normalised value</th><th>Weight</th><th>Contribution</th></tr></thead>
              <tbody>{[...e.factors].sort((a: any, b: any) => b.contribution_pct - a.contribution_pct).map((f: any) => (
                <tr key={f.factor}><td title={f.label}>{f.label}</td><td className="tabular-nums">{fmt(f.value, 3)}</td><td className="tabular-nums">{f.weight}</td><td className="tabular-nums font-semibold">{fmt(f.contribution_pct, 1)}%</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="text-xs"><span className="text-muted">Data sources:</span> {(e.sources || []).join(" · ")}</div>
        </div>
      )}
    </Card>
  );
}

function WardExplain({ wards, wardId, setWardId }: { wards: any[]; wardId: string; setWardId: (id: string) => void }) {
  const { data, error, reload } = useApi<any>(wardId ? `/api/risk/explain?kind=ward&id=${wardId}` : null);
  const e = data && data.id === wardId ? data : null;
  const comps = e?.vulnerability ? Object.entries(e.vulnerability.components as Record<string, number>).map(([k, v]) => ({ k, name: pretty(k), v, w: e.vulnerability.weights?.[k] })) : [];
  return (
    <Card title="Explainable AI — ward" icon={Brain} className="h-full" actions={<DataLabel label="MODEL_PREDICTION" />}>
      <Select label="Ward" value={wardId} onChange={setWardId} className="mb-3" options={wards.map((w) => ({ value: w.id, label: w.name }))} />
      {error && !e && <ErrorBox error={error} onRetry={reload} />}
      {!e && !error && <Loading />}
      {e && (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-1.5 items-center">
            <LevelBadge level={e.prediction.alert_level} map={ALERT_COLORS} solid />
            <LevelBadge level={e.prediction.risk_level} map={RISK_COLORS} />
            <span className="text-xs text-muted">conf {pct(e.confidence)} · T+{e.event_minute}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Max depth +60" value={depth(e.prediction.max_depth_60_m)} />
            <Stat label="Flood prob. +60" value={pct(e.prediction.flood_probability_60)} />
          </div>
          <div className="overflow-x-auto scroll-thin">
            <table className="table text-xs">
              <thead><tr><th>Trigger</th><th>Value</th><th>Threshold</th><th>Level</th></tr></thead>
              <tbody>{(e.triggers || []).map((t: any) => (
                <tr key={t.metric}>
                  <td>{pretty(t.metric)}</td>
                  <td className="tabular-nums">{(TRIGGER_UNITS[t.metric] || ((v: number) => fmt(v, 2)))(t.value)}</td>
                  <td className="tabular-nums">{t.threshold === null || t.threshold === undefined ? "—" : (TRIGGER_UNITS[t.metric] || ((v: number) => fmt(v, 2)))(t.threshold)}</td>
                  <td><LevelBadge level={t.level} map={ALERT_COLORS} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {e.vulnerability && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">UFVI {fmt(e.vulnerability.ufvi, 3)} · {pretty(e.vulnerability.class)}</div>
              <div className="space-y-1">
                {comps.map((c) => (
                  <div key={c.k} className="grid grid-cols-[1fr_90px_36px] items-center gap-2 text-xs">
                    <span className="truncate" title={c.name}>{c.name} <span className="text-muted">(w {c.w})</span></span>
                    <Progress value={c.v} color={UFVI_COLORS[c.k] || "#0ea5e9"} />
                    <span className="tabular-nums text-right">{fmt(c.v, 2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Vulnerability() {
  const { data, error, reload } = useApi<any>("/api/risk/vulnerability", { live: false });
  if (error && !data) return <div className="mb-4"><ErrorBox error={error} onRetry={reload} /></div>;
  if (!data) return <Loading />;
  const keys = Object.keys(data.wards[0]?.components || {});
  const chart = [...data.wards].sort((a: any, b: any) => b.ufvi - a.ufvi).map((w: any) => ({
    ward: w.ward, ufvi: w.ufvi, cls: w.class, ...Object.fromEntries(keys.map((k) => [k, +(w.components[k] * (w.weights?.[k] ?? 0)).toFixed(3)])),
  }));
  return (
    <div className="grid xl:grid-cols-5 gap-4 mb-4">
      <Card className="xl:col-span-3" title={data.index} icon={Building} subtitle="Stacked bars: weighted contribution of each component (component × weight) to the ward's UFVI." actions={<DataLabel label="MODEL_PREDICTION" />}>
        <div className="h-80">
          <ResponsiveContainer>
            <BarChart data={chart} margin={{ left: -10, right: 8, top: 8, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis dataKey="ward" {...axis} angle={-40} textAnchor="end" interval={0} fontSize={10} />
              <YAxis {...axis} domain={[0, 1]} />
              <RTooltip contentStyle={tooltipStyle} />
              <RLegend wrapperStyle={{ fontSize: 10 }} verticalAlign="top" />
              {keys.map((k) => <Bar key={k} dataKey={k} name={pretty(k)} stackId="u" fill={UFVI_COLORS[k] || "#94a3b8"} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card className="xl:col-span-2" title="UFVI ranking" icon={Table2} bodyClass="px-0 pb-0 overflow-auto scroll-thin max-h-[380px]">
        <table className="table">
          <thead><tr><th>#</th><th>Ward</th><th>UFVI</th><th>Class</th></tr></thead>
          <tbody>{chart.map((w: any, i: number) => (
            <tr key={w.ward}>
              <td className="text-muted">{i + 1}</td><td className="font-medium">{w.ward}</td>
              <td className="min-w-[120px]"><div className="flex items-center gap-2"><Progress value={w.ufvi} color={RISK_COLORS[w.cls] || "#0ea5e9"} /><span className="text-xs tabular-nums">{fmt(w.ufvi, 2)}</span></div></td>
              <td><LevelBadge level={w.cls} map={RISK_COLORS} /></td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}

function ModelCard() {
  const { data, error, reload } = useApi<any>("/api/risk/model", { live: false });
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const fi = [...data.feature_importances].sort((a: any, b: any) => b.importance - a.importance).map((f: any) => ({ ...f, name: pretty(f.feature) }));
  const weights = Object.entries(data.explainable_weights as Record<string, number>).sort((a, b) => b[1] - a[1]);
  return (
    <div className="grid xl:grid-cols-5 gap-4">
      <Card className="xl:col-span-3" title="ML model card" icon={Cpu} actions={<><DataLabel label="MODEL_PREDICTION" /><DataLabel label="SIMULATED_DATA" /></>}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <Stat label="Model" value={<span className="text-xs">{data.model}</span>} className="col-span-2" />
          <Stat label="Training samples" value={data.train_samples} />
          <Stat label="Positive rate" value={pct(data.positive_rate, 1)} />
        </div>
        <div className="rounded-lg border border-purple-500/40 bg-purple-500/10 p-2.5 text-xs mb-3">
          <b>Trained on SIMULATED storms:</b> {data.trained_on}. Training accuracy {pct(data.train_accuracy)} is in-sample on synthetic data and is <b>not</b> a field-validated skill score.
        </div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">Feature importances</div>
        <div style={{ height: Math.max(180, fi.length * 26 + 20) }}>
          <ResponsiveContainer>
            <BarChart data={fi} layout="vertical" margin={{ left: 4, right: 24, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
              <XAxis type="number" {...axis} />
              <YAxis type="category" dataKey="name" width={140} {...axis} interval={0} />
              <RTooltip contentStyle={tooltipStyle} formatter={(v: any) => [fmt(v, 3), "Importance"]} />
              <Bar dataKey="importance" radius={[0, 3, 3, 0]}>{fi.map((f: any, i: number) => <RCell key={f.feature} fill={i < 3 ? "#8b5cf6" : "#a78bfa"} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card className="xl:col-span-2" title="Explainable risk weights" icon={Gauge} bodyClass="px-0 pb-0 overflow-x-auto scroll-thin">
        <table className="table">
          <thead><tr><th>Factor</th><th>Weight</th><th className="w-2/5">Share</th></tr></thead>
          <tbody>{weights.map(([k, v]) => (
            <tr key={k}><td>{pretty(k)}</td><td className="tabular-nums">{v}</td><td><Progress value={v} max={weights[0][1]} color="#0ea5e9" /></td></tr>
          ))}</tbody>
        </table>
        <p className="text-xs text-muted p-3">The deterministic weighted model drives the risk level (fully auditable); the ML model supplies a separate susceptibility score shown alongside.</p>
      </Card>
    </div>
  );
}
