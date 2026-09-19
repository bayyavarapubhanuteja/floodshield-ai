/* Predictive Drain Maintenance: prioritised REPAIR / CLEAN / INSPECT / MONITOR work list. */
import React, { useMemo, useState } from "react";
import { Wrench, MapPin, Info, ListChecks, Search } from "lucide-react";
import { CircleMarker, Tooltip as LTooltip } from "react-leaflet";
import { useApp } from "@/context/AppContext";
import { useApi } from "@/hooks/useApi";
import { api, qs } from "@/lib/api";
import { Badge, Card, DataLabel, Empty, ErrorBox, Kpi, LevelBadge, Loading, PageHeader, Progress, Section, Select, cx } from "@/components/ui";
import { CityMap, DrainsLayer, FlyTo, Legend, MapOverlay, useMapStatic } from "@/components/map";
import { MAINT_COLORS, fmt, pct, pretty } from "@/lib/format";

const ACTIONS = ["REPAIR", "CLEAN", "INSPECT", "MONITOR"];
const WORK = ["PENDING", "SCHEDULED", "IN_PROGRESS", "DONE"];
const PRIORITY_COLORS: Record<string, string> = { P1: "#dc2626", P2: "#f97316", P3: "#eab308" };
const WORK_COLORS: Record<string, string> = { PENDING: "#64748b", SCHEDULED: "#0ea5e9", IN_PROGRESS: "#eab308", DONE: "#16a34a" };
const PAGE = 50;

export default function Maintenance() {
  const { city, toast, hasRole } = useApp();
  const st = useMapStatic();
  const { data, error, reload, setData } = useApi<any>("/api/maintenance");
  const [action, setAction] = useState("");
  const [ward, setWard] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [focus, setFocus] = useState<string | null>(null);
  const canEdit = hasRole("MUNICIPAL_OFFICER");

  const recs: any[] = data?.recommendations || [];
  const wards = useMemo(() => [...new Set(recs.map((r) => r.ward))].sort(), [recs]);
  const filtered = useMemo(() => recs
    .filter((r) => (!action || r.action === action) && (!ward || r.ward === ward) && (!q || r.node_id.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.priority_score - a.priority_score), [recs, action, ward, q]);
  const focused = recs.find((r) => r.node_id === focus);

  const setWork = async (nodeId: string, status: string) => {
    const prev = recs.find((r) => r.node_id === nodeId)?.work_status;
    const apply = (s: string) => setData((d: any) => d ? { ...d, recommendations: d.recommendations.map((r: any) => (r.node_id === nodeId ? { ...r, work_status: s } : r)) } : d);
    apply(status);
    try {
      await api.patch(`/api/maintenance/${encodeURIComponent(nodeId)}${qs({ city })}`, { status });
      toast({ kind: "success", title: `${nodeId}: ${pretty(status)}` });
    } catch (e: any) {
      apply(prev || "PENDING");
      toast({ kind: "error", title: "Update failed", body: e?.message });
    }
  };

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading text="Ranking drains for maintenance…" />;

  return (
    <Section>
      <PageHeader icon={Wrench} title="Predictive Drain Maintenance"
        subtitle="Pre-monsoon work list ranking drain nodes by simulated peak utilisation, assumed blockage, maintenance age, failure history and flood contribution."
        labels={["MODEL_PREDICTION", "SIMULATED_DATA", "DEMO_DATA"]} />

      <div className="flex items-start gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-sm mb-4">
        <Info size={16} className="text-sky-600 shrink-0 mt-0.5" />
        <div><b>No physical sensors are used.</b> {data.note || "Utilisation comes from the hydraulic simulation; blockage is assumed from maintenance age."} Field inspection is required before committing works.</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {ACTIONS.map((a) => (
          <div key={a} className={cx("rounded-xl", action === a && "ring-2 ring-brand")}>
            <Kpi label={a} value={data.counts?.[a] ?? 0} unit="nodes" color={MAINT_COLORS[a]} icon={Wrench}
              sub={action === a ? "Filtered — click to clear" : "Click to filter"} onClick={() => { setAction(action === a ? "" : a); setLimit(PAGE); }} />
          </div>
        ))}
      </div>

      <div className="grid xl:grid-cols-5 gap-4">
        <Card className="xl:col-span-2" title="Drain nodes by recommended action" icon={MapPin} actions={<DataLabel label="MODEL_PREDICTION" />}>
          <div className="relative">
            <CityMap className="h-[420px] xl:h-[640px]">
              {st && <DrainsLayer st={st} showNodes={false} />}
              {filtered.map((r) => (
                <CircleMarker key={r.node_id} center={[r.lat, r.lon]} radius={r.priority === "P1" ? 7 : r.priority === "P2" ? 5.5 : 4.5}
                  pathOptions={{ color: focus === r.node_id ? "#22d3ee" : "#0f172a", weight: focus === r.node_id ? 3 : 1, fillColor: MAINT_COLORS[r.action], fillOpacity: 0.95 }}
                  eventHandlers={{ click: () => setFocus(r.node_id) }}>
                  <LTooltip>
                    <div className="font-semibold">{r.node_id} · {r.action} ({r.priority})</div>
                    <div>{r.ward} · score {fmt(r.priority_score, 2)}</div>
                    <div>Peak util. {pct(r.peak_utilization)} · blockage {pct(r.assumed_blockage)}</div>
                  </LTooltip>
                </CircleMarker>
              ))}
              {focused && <FlyTo center={[focused.lat, focused.lon]} zoom={16} />}
            </CityMap>
            <MapOverlay position="bottom-left">
              <Legend title="Action" items={ACTIONS.map((a) => ({ color: MAINT_COLORS[a], label: pretty(a) }))} />
            </MapOverlay>
          </div>
        </Card>

        <Card className="xl:col-span-3" title={`Prioritised work list (${filtered.length})`} icon={ListChecks}
          actions={
            <div className="flex flex-wrap gap-2 items-end">
              <Select className="w-32" value={action} onChange={(v) => { setAction(v); setLimit(PAGE); }} options={[{ value: "", label: "All actions" }, ...ACTIONS.map((a) => ({ value: a, label: pretty(a) }))]} />
              <Select className="w-36" value={ward} onChange={(v) => { setWard(v); setLimit(PAGE); }} options={[{ value: "", label: "All wards" }, ...wards.map((w) => ({ value: w, label: w }))]} />
              <label className="relative w-32">
                <span className="sr-only">Search node id</span>
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
                <input className="input py-1.5 pl-7" placeholder="Node id" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
            </div>
          }
          bodyClass="overflow-auto scroll-thin px-0 pb-0 max-h-[700px]">
          {filtered.length === 0 ? <Empty text="No drains match the filters" /> : (
            <>
              <table className="table">
                <thead>
                  <tr><th>Priority</th><th>Node</th><th>Score</th><th>Action</th><th>Reasons</th><th className="text-right">Assumed blockage</th>
                    <th className="text-right">Days since cleaning</th><th className="text-right">Peak util.</th><th className="text-right">Hist. failures</th>
                    <th className="text-right">Flood contrib.</th><th>Work status</th></tr>
                </thead>
                <tbody>
                  {filtered.slice(0, limit).map((r) => (
                    <tr key={r.node_id} className={cx(focus === r.node_id && "bg-brand/10")} onClick={() => setFocus(r.node_id)}>
                      <td><Badge color={PRIORITY_COLORS[r.priority] || "#64748b"} solid>{r.priority}</Badge></td>
                      <td className="whitespace-nowrap"><div className="font-mono text-xs font-semibold">{r.node_id}</div><div className="text-[11px] text-muted">{pretty(r.kind)} · {r.ward}</div></td>
                      <td className="min-w-[90px]"><div className="flex items-center gap-1.5"><Progress value={r.priority_score} max={1} color={PRIORITY_COLORS[r.priority] || "#64748b"} /><span className="text-xs tabular-nums">{fmt(r.priority_score, 2)}</span></div></td>
                      <td><LevelBadge level={r.action} map={MAINT_COLORS} /></td>
                      <td className="text-xs min-w-[200px]"><ul className="list-disc pl-4">{(r.reasons || []).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></td>
                      <td className="text-right tabular-nums">{pct(r.assumed_blockage)}</td>
                      <td className="text-right tabular-nums">{r.days_since_cleaning}</td>
                      <td className={cx("text-right tabular-nums", r.peak_utilization >= 1 && "text-red-600 dark:text-red-400 font-semibold")}>{pct(r.peak_utilization)}</td>
                      <td className="text-right tabular-nums">{r.historical_failures}</td>
                      <td className="text-right tabular-nums whitespace-nowrap">{fmt(r.flood_contribution_m, 2)} m</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {canEdit ? (
                          <label>
                            <span className="sr-only">Work status for {r.node_id}</span>
                            <select className="input py-1 text-xs w-[118px]" value={r.work_status || "PENDING"} onChange={(e) => setWork(r.node_id, e.target.value)}
                              style={{ color: WORK_COLORS[r.work_status || "PENDING"] }}>
                              {WORK.map((w) => <option key={w} value={w}>{pretty(w)}</option>)}
                            </select>
                          </label>
                        ) : <LevelBadge level={r.work_status || "PENDING"} map={WORK_COLORS} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length > limit && (
                <div className="p-3 text-center"><button className="btn-ghost btn-sm" onClick={() => setLimit(limit + PAGE)}>Show more ({filtered.length - limit} remaining)</button></div>
              )}
            </>
          )}
        </Card>
      </div>
      <p className="text-[11px] text-muted mt-3">Basis: {recs[0]?.basis || "Utilisation from simulation + maintenance-age blockage assumption (no sensors)"}. Drain network geometry: DEMO DATA.</p>
    </Section>
  );
}
