/* Municipal Command Center (officers) / Citizen Home (citizens). */
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity, AlertTriangle, Building2, CloudRain, Gauge, Hospital, LayoutDashboard, MapPin, Megaphone, Network, Phone,
  Route as RouteIcon, ShieldAlert, Siren, Waves, ArrowRight, Clock,
} from "lucide-react";
import { Area, Bar, CartesianGrid, ComposedChart, Legend as RLegend, Line, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { CircleMarker, Tooltip as LTooltip } from "react-leaflet";
import { useApp } from "@/context/AppContext";
import { useApi } from "@/hooks/useApi";
import { Badge, Card, DataLabel, ErrorBox, Kpi, LevelBadge, Loading, PageHeader, Progress, Section, cx } from "@/components/ui";
import { CityMap, FacilitiesLayer, GridOverlay, HorizonBar, LEGENDS, Legend, MapOverlay, RoadsLayer, useMapStatic } from "@/components/map";
import { ALERT_COLORS, RAMPS, RISK_COLORS, depth, fmt, pct, pretty, ttf } from "@/lib/format";

const PIPELINE = ["Weather / Radar", "AI Nowcast", "DEM / Terrain", "Runoff", "Surface flow", "Drainage hydraulics", "Coupled flood", "Street-level risk", "Early warning", "Emergency routing", "Municipal response"];
const tooltipStyle = { background: "rgb(var(--panel))", border: "1px solid rgb(var(--line))", borderRadius: 8, fontSize: 12 };

export default function Dashboard() {
  const { isOfficer } = useApp();
  return isOfficer ? <CommandCenter /> : <CitizenHome />;
}

export function FloodMapPanel({ height = "h-[520px]", showFacilities = true }: { height?: string; showFacilities?: boolean }) {
  const st = useMapStatic();
  const [h, setH] = useState(0);
  const { data: dyn } = useApi<any>(`/api/map/dynamic?horizon=${h}`, { deps: [h] });
  const nav = useNavigate();
  const roadStatus = useMemo(() => Object.fromEntries((dyn?.roads || []).map((r: any) => [r.id, r])), [dyn]);
  const facStatus = useMemo(() => Object.fromEntries((dyn?.facilities || []).map((f: any) => [f.id, f])), [dyn]);
  const kinds = useMemo(() => new Set(["hospital", "fire_station", "police", "shelter", "substation"]), []);
  return (
    <div className="relative">
      <CityMap className={height}>
        {st && dyn && <GridOverlay cells={dyn.depth_cells} rows={st.rows} cols={st.cols} bbox={st.bbox} color={RAMPS.depth} opacity={0.75} />}
        {st && <RoadsLayer roads={st.roads} status={roadStatus} colorBy="depth" onSelect={() => nav("/prediction")} />}
        {st && showFacilities && <FacilitiesLayer st={st} status={facStatus} kinds={kinds} onSelect={() => nav("/infrastructure")} />}
        {st && dyn && st.wards.map((w) => {
          const lvl = dyn.wards.find((x: any) => x.id === w.id)?.alert_level;
          if (!lvl || lvl === "GREEN") return null;
          return (
            <CircleMarker key={w.id} center={w.center} radius={10} pathOptions={{ color: ALERT_COLORS[lvl], weight: 3, fillOpacity: 0.12 }}>
              <LTooltip>{w.name}: {lvl} alert</LTooltip>
            </CircleMarker>
          );
        })}
      </CityMap>
      <MapOverlay position="top-right"><HorizonBar value={h} onChange={setH} /></MapOverlay>
      <MapOverlay position="bottom-left" className="flex gap-2 items-end">
        <Legend title="Flood depth" items={LEGENDS.depth} />
        <Legend title="Road depth" items={LEGENDS.roadDepth} className="hidden sm:block" />
      </MapOverlay>
      <MapOverlay position="top-left" className="flex flex-col gap-1 items-start">
        <DataLabel label={h === 0 ? "SIMULATED_DATA" : "MODEL_PREDICTION"} className="bg-panel" />
        {dyn && <span className="chip bg-panel border border-line">Max {depth(dyn.kpis.max_depth_m)} · {fmt(dyn.kpis.flooded_area_km2, 2)} km²</span>}
      </MapOverlay>
    </div>
  );
}

function CommandCenter() {
  const { data, error, reload } = useApi<any>("/api/dashboard");
  const nav = useNavigate();
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading text="Computing coupled flood snapshot…" />;
  const k = data.kpis;
  const nc = data.nowcast;
  const riskColor = RISK_COLORS[k.city_risk_level];
  const chart = [
    ...data.history.map((h: any) => ({ t: h.event_minute, observed: h.rain_mm_hr })),
    ...nc.horizons.map((h: any) => ({ t: data.event_minute + h.horizon_min, forecast: h.intensity_mm_hr, band: [h.p10_mm_hr, h.p90_mm_hr] })),
  ];
  return (
    <Section>
      <PageHeader icon={LayoutDashboard} title="Municipal Command Center"
        subtitle={`${data.city.toUpperCase()} · event minute T+${data.event_minute} · issued ${new Date(data.issued_at).toLocaleTimeString()} · compute ${data.compute_ms} ms`}
        labels={["SIMULATED_DATA", "MODEL_PREDICTION", "DEMO_DATA"]}
        actions={<><button className="btn-ghost btn-sm" onClick={() => nav("/copilot")}>Ask Copilot</button><button className="btn-primary btn-sm" onClick={() => nav("/reports")}>Incident report (PDF)</button></>} />

      <div className="card mb-4 px-3 py-2 overflow-x-auto scroll-thin" aria-label="Processing pipeline">
        <div className="flex items-center gap-1 min-w-max text-[11px] font-semibold">
          {PIPELINE.map((p, i) => (
            <React.Fragment key={p}>
              <span className="rounded-md bg-brand/10 text-brand px-2 py-1 whitespace-nowrap">{p}</span>
              {i < PIPELINE.length - 1 && <ArrowRight size={12} className="text-muted" />}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-4">
        <Kpi label="Current rainfall" value={fmt(k.rain_now_mm_hr)} unit="mm/hr" icon={CloudRain} color="#3b82f6" sub={<>{k.rain_category} · {fmt(k.rain_cum_mm, 0)} mm so far</>} labelTag="SIMULATED_DATA" onClick={() => nav("/rainfall")} />
        <Kpi label="3-hour forecast" value={fmt(k.rain_3h_forecast_mm, 0)} unit="mm" icon={Activity} color="#8b5cf6" sub={<>peak {fmt(k.rain_peak_forecast_mm_hr)} mm/hr · conf {pct(k.nowcast_confidence_60)}</>} labelTag="MODEL_PREDICTION" onClick={() => nav("/rainfall")} />
        <Kpi label="City flood risk" value={pretty(k.city_risk_level)} icon={ShieldAlert} color={riskColor} sub={<>{k.risk_counts.CRITICAL} critical · {k.risk_counts.VERY_HIGH} very high roads</>} onClick={() => nav("/risk")} />
        <Kpi label="Flooded roads" value={`${k.flooded_roads_now}`} unit={`/ ${k.total_roads}`} icon={Waves} color="#0ea5e9" sub={<>+60 min: <b>{k.flooded_roads_60}</b> · {k.impassable_roads} unsafe now</>} onClick={() => nav("/prediction")} />
        <Kpi label="Drainage utilisation" value={pct(k.drainage_utilization_mean)} icon={Network} color={k.drainage_utilization_mean >= 1 ? "#dc2626" : k.drainage_utilization_mean >= 0.8 ? "#f97316" : "#16a34a"} sub={<>{k.drainage_overloaded} nodes overloaded</>} onClick={() => nav("/drainage")} />
        <Kpi label="Active alerts" value={k.active_alerts} icon={Siren} color={k.alert_counts.RED ? "#dc2626" : k.alert_counts.ORANGE ? "#f97316" : "#eab308"}
          sub={<span className="flex gap-1"><Badge color="#dc2626">{k.alert_counts.RED} R</Badge><Badge color="#f97316">{k.alert_counts.ORANGE} O</Badge><Badge color="#eab308">{k.alert_counts.YELLOW} Y</Badge></span>} />
        <Kpi label="Affected infrastructure" value={k.affected_facilities} unit={`/ ${k.total_facilities}`} icon={Building2} color={k.affected_facilities ? "#f97316" : "#16a34a"} sub="hospitals, substations…" onClick={() => nav("/infrastructure")} />
      </div>

      <div className="grid xl:grid-cols-3 gap-4 mb-4">
        <Card className="xl:col-span-2" title="Live GIS flood map" icon={MapPin} subtitle="Flood depth grid, street-level road depth, critical facilities and ward alerts. Switch horizon to view the forecast."
          actions={<button className="btn-ghost btn-sm" onClick={() => nav("/map")}>Open full map</button>}>
          <FloodMapPanel />
        </Card>
        <div className="flex flex-col gap-4 min-w-0">
          <Card title={`Active alerts (${data.alerts.length})`} icon={AlertTriangle} bodyClass="max-h-[270px] overflow-auto scroll-thin">
            {data.alerts.length === 0 && <p className="text-sm text-muted py-4">No active alerts — all wards GREEN.</p>}
            <ul className="space-y-2">
              {data.alerts.map((a: any) => (
                <li key={a.id} className="rounded-lg border border-line p-2.5" style={{ borderLeft: `4px solid ${ALERT_COLORS[a.level]}` }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold truncate">{a.location}</span>
                    <LevelBadge level={a.level} map={ALERT_COLORS} solid />
                  </div>
                  <div className="text-xs text-muted mt-0.5">Depth up to <b className="text-ink">{depth(a.expected_depth_m)}</b> · {ttf(a.expected_time_min)} · P {pct(a.flood_probability)} · {a.affected_roads.length} roads</div>
                  <div className="text-xs mt-1">{a.recommended_actions.authority[0]}</div>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Critical locations" icon={MapPin} bodyClass="max-h-[250px] overflow-auto scroll-thin">
            <ul className="divide-y divide-line">
              {data.critical_locations.map((c: any) => (
                <li key={c.id} className="py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{c.name}</div>
                    <div className="text-xs text-muted">{depth(c.depth_now_m)} now → {depth(c.depth_60_m)} at +60 · {ttf(c.time_to_flood_min)}</div>
                  </div>
                  <LevelBadge level={c.risk_level} map={RISK_COLORS} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Card title="Rainfall: observed & AI nowcast" icon={CloudRain} actions={<><DataLabel label="SIMULATED_DATA" /><DataLabel label="MODEL_PREDICTION" /></>}>
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={chart} margin={{ left: -10, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" />
                <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => `T+${v}`} fontSize={11} stroke="rgb(var(--muted))" />
                <YAxis fontSize={11} stroke="rgb(var(--muted))" />
                <RTooltip contentStyle={tooltipStyle} labelFormatter={(v) => `Event minute ${v}`} />
                <RLegend wrapperStyle={{ fontSize: 11 }} />
                <Area dataKey="band" name="Forecast P10–P90" fill="#8b5cf6" fillOpacity={0.15} stroke="none" />
                <Bar dataKey="observed" name="Observed (simulated) mm/hr" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                <Line dataKey="forecast" name="Nowcast mm/hr" stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Flood extent & drainage load" icon={Gauge} actions={<DataLabel label="SIMULATED_DATA" />}>
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={data.history.map((h: any) => ({ t: h.event_minute, extent: h.flooded_area_km2, util: Math.round(h.drainage_util_mean * 100), over: h.overloaded_nodes }))} margin={{ left: -10, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" />
                <XAxis dataKey="t" tickFormatter={(v) => `T+${v}`} fontSize={11} stroke="rgb(var(--muted))" />
                <YAxis yAxisId="l" fontSize={11} stroke="rgb(var(--muted))" />
                <YAxis yAxisId="r" orientation="right" fontSize={11} stroke="rgb(var(--muted))" />
                <RTooltip contentStyle={tooltipStyle} />
                <RLegend wrapperStyle={{ fontSize: 11 }} />
                <Area yAxisId="l" dataKey="extent" name="Flood extent km²" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.25} />
                <Line yAxisId="r" dataKey="util" name="Mean drain utilisation %" stroke="#f97316" dot={false} strokeWidth={2} />
                <Line yAxisId="r" dataKey="over" name="Overloaded nodes" stroke="#dc2626" dot={false} strokeDasharray="4 3" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2" title="Ward status" icon={ShieldAlert} bodyClass="overflow-x-auto scroll-thin px-0 pb-0">
          <table className="table">
            <thead><tr><th>Ward</th><th>Alert</th><th>Risk</th><th>Rain now</th><th>Max depth +60</th><th>Time to flood</th><th>Drain util.</th><th>Flooded roads</th><th>UFVI</th></tr></thead>
            <tbody>
              {[...data.wards].sort((a: any, b: any) => b.max_depth_60_m - a.max_depth_60_m).map((w: any) => (
                <tr key={w.id}>
                  <td className="font-medium">{w.name}</td>
                  <td><LevelBadge level={w.alert_level} map={ALERT_COLORS} solid /></td>
                  <td><LevelBadge level={w.risk_level} map={RISK_COLORS} /></td>
                  <td className="tabular-nums whitespace-nowrap">{fmt(w.rain_now_mm_hr)} mm/hr</td>
                  <td className="tabular-nums">{depth(w.max_depth_60_m)}</td>
                  <td className="whitespace-nowrap">{ttf(w.time_to_flood_min)}</td>
                  <td className="min-w-[120px]"><div className="flex items-center gap-2"><Progress value={Math.min(w.drainage_utilization, 2)} max={2} color={w.drainage_utilization >= 1 ? "#dc2626" : "#16a34a"} /><span className="text-xs tabular-nums">{pct(w.drainage_utilization)}</span></div></td>
                  <td className="tabular-nums">{w.flooded_roads_now} → {w.flooded_roads_60}</td>
                  <td className="tabular-nums whitespace-nowrap">{fmt(w.ufvi, 2)} <span className="text-xs text-muted">{pretty(w.ufvi_class)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Affected infrastructure" icon={Hospital} bodyClass="max-h-[430px] overflow-auto scroll-thin">
          {data.facilities_affected.length === 0 && <p className="text-sm text-muted py-4">All critical facilities operational and accessible.</p>}
          <ul className="space-y-2">
            {data.facilities_affected.map((f: any) => (
              <li key={f.id} className="rounded-lg border border-line p-2.5">
                <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold truncate">{f.name}</span>
                  <Badge color={f.status === "FLOODED" ? "#9f1239" : f.status === "ISOLATED" ? "#dc2626" : f.status === "ACCESS_RESTRICTED" ? "#f97316" : "#eab308"}>{pretty(f.status)}</Badge></div>
                <div className="text-xs text-muted mt-0.5">{pretty(f.kind)} · site {depth(f.site_depth_now_m)} → {depth(f.site_depth_60_m)} · ambulance reach {f.reachable_network_pct}%</div>
                {f.alternative && <div className="text-xs mt-1">Alternative: <b>{f.alternative.name}</b>{f.alternative.travel_time_min != null && ` (${f.alternative.travel_time_min} min)`}</div>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Section>
  );
}

function CitizenHome() {
  const { t, lang } = useApp();
  const nav = useNavigate();
  const { data } = useApi<any>(`/api/alerts/public?lang=${lang}`, { deps: [lang] });
  const actions = [
    { label: t("call112"), icon: Phone, color: "bg-red-600 hover:bg-red-700", href: "tel:112" },
    { label: t("nearest_hospital"), icon: Hospital, color: "bg-sky-600 hover:bg-sky-700", to: "/emergency?nearest=hospital" },
    { label: t("safe_route"), icon: RouteIcon, color: "bg-emerald-600 hover:bg-emerald-700", to: "/routing" },
    { label: t("report_flood"), icon: Megaphone, color: "bg-amber-500 hover:bg-amber-600", to: "/citizen-reports?new=1" },
    { label: t("view_contacts"), icon: Siren, color: "bg-slate-700 hover:bg-slate-800", to: "/emergency" },
  ];
  return (
    <Section>
      <PageHeader icon={LayoutDashboard} title={t("dashboard")} subtitle={t("stay_safe")} labels={["MODEL_PREDICTION"]} />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {actions.map((a) => a.href ? (
          <a key={a.label} href={a.href} className={cx("btn text-white font-bold py-4 text-sm flex-col text-center", a.color)}><a.icon size={22} />{a.label}</a>
        ) : (
          <button key={a.label} onClick={() => nav(a.to!)} className={cx("btn text-white font-bold py-4 text-sm flex-col text-center", a.color)}><a.icon size={22} />{a.label}</button>
        ))}
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2" title={t("map")} icon={MapPin}><FloodMapPanel height="h-[460px]" /></Card>
        <Card title={t("active_alerts")} icon={AlertTriangle} bodyClass="max-h-[500px] overflow-auto scroll-thin">
          {!data ? <Loading /> : data.alerts.length === 0 ? <p className="text-sm text-muted py-4">{t("no_alerts")}</p> : (
            <ul className="space-y-2">
              {data.alerts.map((a: any) => (
                <li key={a.id} className="rounded-lg border border-line p-3" style={{ borderLeft: `4px solid ${ALERT_COLORS[a.level]}` }}>
                  <div className="flex items-center justify-between gap-2"><LevelBadge level={a.level} map={ALERT_COLORS} solid /><span className="text-xs text-muted flex items-center gap-1"><Clock size={12} />{ttf(a.expected_time_min)}</span></div>
                  <div className="text-sm font-semibold mt-1.5">{a.message.headline}</div>
                  <div className="text-sm mt-1">{a.message.action}</div>
                  <div className="text-xs text-muted mt-1">{t("depth")}: {depth(a.expected_depth_m)} · {t("affected_roads")}: {a.affected_roads.slice(0, 3).join(", ")}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Section>
  );
}
