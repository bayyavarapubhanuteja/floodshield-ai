/* Critical Infrastructure Protection: facility flood status, accessibility and alternatives. */
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Navigation, MapPin, Hospital, Siren, Flame, School, TrainFront, Bus, Home, Zap, Landmark } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { Badge, Card, DataLabel, Drawer, Empty, ErrorBox, LevelBadge, Loading, PageHeader, Progress, Section, Select, Stat, cx } from "@/components/ui";
import { CityMap, FacilitiesLayer, FlyTo, Legend, LEGENDS, MapOverlay, RoadsLayer, useMapStatic } from "@/components/map";
import { FACILITY_LABELS, FACILITY_STATUS_COLORS, RISK_COLORS, depth, fmt, pretty } from "@/lib/format";
import { nameOf } from "@/components/ops/common";

const KIND_ICONS: Record<string, any> = {
  hospital: Hospital, police: Siren, fire_station: Flame, school: School, railway_station: TrainFront,
  bus_terminal: Bus, shelter: Home, substation: Zap, government: Landmark,
};
const STATUSES = ["OPERATIONAL", "AT_RISK", "ACCESS_RESTRICTED", "ISOLATED", "FLOODED"];

export default function Infrastructure() {
  const nav = useNavigate();
  const st = useMapStatic();
  const { data, error, reload } = useApi<any>("/api/infrastructure");
  const { data: dyn } = useApi<any>("/api/map/dynamic?horizon=0");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [selId, setSelId] = useState<string | null>(null);

  const facilities: any[] = data?.facilities || [];
  const filtered = useMemo(() => facilities.filter((f) => (!kind || f.kind === kind) && (!status || f.status === status))
    .sort((a, b) => STATUSES.indexOf(b.status) - STATUSES.indexOf(a.status) || b.site_depth_60_m - a.site_depth_60_m), [facilities, kind, status]);
  const facStatus = useMemo(() => Object.fromEntries(facilities.map((f) => [f.id, f])), [facilities]);
  const kinds = useMemo(() => new Set(kind ? [kind] : Object.keys(FACILITY_LABELS)), [kind]);
  const roadStatus = useMemo(() => Object.fromEntries((dyn?.roads || []).map((r: any) => [r.id, r])), [dyn]);
  const floodedRoads = useMemo(() => (st?.roads || []).filter((r) => (roadStatus[r.id]?.depth_m ?? 0) >= 0.05), [st, roadStatus]);
  const statusCounts = useMemo(() => Object.fromEntries(STATUSES.map((s) => [s, facilities.filter((f) => f.status === s).length])), [facilities]);
  const sel = facilities.find((f) => f.id === selId) || null;

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading text="Assessing facility flood exposure and access…" />;

  return (
    <Section>
      <PageHeader icon={Building2} title="Critical Infrastructure Protection"
        subtitle={`Flood exposure, ambulance accessibility and alternatives for hospitals, emergency services, shelters and utilities · T+${data.event_minute}`}
        labels={["MODEL_PREDICTION", "DEMO_DATA"]} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-9 gap-3 mb-4">
        {Object.entries(data.counts || {}).map(([k, c]: [string, any]) => {
          const Icon = KIND_ICONS[k] || Building2;
          const col = c.affected ? "#f97316" : "#16a34a";
          return (
            <button key={k} onClick={() => setKind(kind === k ? "" : k)} aria-pressed={kind === k}
              className={cx("card p-3 text-left transition-colors", kind === k ? "ring-2 ring-brand" : "hover:border-brand/60")}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted leading-tight">{FACILITY_LABELS[k] || pretty(k)}</span>
                <span className="rounded-lg p-1.5" style={{ background: col + "1f", color: col }}><Icon size={15} /></span>
              </div>
              <div className="mt-1 flex items-baseline gap-1"><span className="kpi-v" style={{ color: col }}>{c.affected}</span><span className="text-xs text-muted">/ {c.total} affected</span></div>
            </button>
          );
        })}
      </div>

      <div className="card p-3 mb-4 flex flex-wrap items-end gap-3">
        <Select className="w-48" label="Facility type" value={kind} onChange={setKind}
          options={[{ value: "", label: "All types" }, ...Object.keys(FACILITY_LABELS).map((k) => ({ value: k, label: FACILITY_LABELS[k] }))]} />
        <Select className="w-52" label="Status" value={status} onChange={setStatus}
          options={[{ value: "", label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: `${pretty(s)} (${statusCounts[s]})` }))]} />
        <div className="flex flex-wrap gap-1.5 ml-auto">
          {STATUSES.map((s) => <Badge key={s} color={FACILITY_STATUS_COLORS[s]}>{pretty(s)}: {statusCounts[s]}</Badge>)}
        </div>
      </div>

      <div className="grid xl:grid-cols-5 gap-4">
        <Card className="xl:col-span-2" title="Facility map" icon={MapPin} actions={<DataLabel label="DEMO_DATA" />}
          subtitle="Facility locations are DEMO DATA. Colour = predicted status; flooded roads (≥ 5 cm) shown by depth.">
          <div className="relative">
            <CityMap className="h-[420px] xl:h-[620px]">
              {st && <RoadsLayer roads={floodedRoads} status={roadStatus} colorBy="depth" />}
              {st && <FacilitiesLayer st={st} status={facStatus} kinds={kinds} onSelect={setSelId} />}
              {sel && <FlyTo center={[sel.lat, sel.lon]} zoom={15} />}
            </CityMap>
            <MapOverlay position="bottom-left" className="flex gap-2 items-end">
              <Legend title="Facility status" items={LEGENDS.facility} />
              <Legend title="Road depth" items={LEGENDS.roadDepth} className="hidden sm:block" />
            </MapOverlay>
          </div>
        </Card>

        <Card className="xl:col-span-3" title={`Facilities (${filtered.length})`} icon={Building2} actions={<DataLabel label="MODEL_PREDICTION" />}
          bodyClass="overflow-auto scroll-thin px-0 pb-0 max-h-[680px]">
          {filtered.length === 0 ? <Empty text="No facilities match the filters" /> : (
            <table className="table">
              <thead>
                <tr><th>Facility</th><th>Status</th><th>Risk</th><th className="text-right">Site depth now → +60</th><th>Ambulance reach</th>
                  <th className="text-right">Access flooded</th><th className="text-right">Nearby affected</th><th>Alternative</th></tr>
              </thead>
              <tbody>
                {filtered.map((f) => (
                  <tr key={f.id} className="cursor-pointer" onClick={() => setSelId(f.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSelId(f.id)}>
                    <td className="min-w-[180px]">
                      <div className="font-medium">{f.name}</div>
                      <div className="text-[11px] text-muted">{pretty(f.kind)} · {f.ward}{f.critical && <span className="text-red-600 dark:text-red-400 font-semibold"> · critical</span>}</div>
                    </td>
                    <td><LevelBadge level={f.status} map={FACILITY_STATUS_COLORS} solid /></td>
                    <td><LevelBadge level={f.risk_level} map={RISK_COLORS} /></td>
                    <td className="text-right tabular-nums whitespace-nowrap">{depth(f.site_depth_now_m)} → <b>{depth(f.site_depth_60_m)}</b></td>
                    <td className="min-w-[110px]">
                      <div className="flex items-center gap-2">
                        <Progress value={f.reachable_network_pct ?? 0} max={100} color={(f.reachable_network_pct ?? 0) >= 80 ? "#16a34a" : (f.reachable_network_pct ?? 0) >= 50 ? "#eab308" : "#dc2626"} />
                        <span className="text-xs tabular-nums">{fmt(f.reachable_network_pct, 0)}%</span>
                      </div>
                    </td>
                    <td className={cx("text-right tabular-nums", (f.access_roads_flooded || []).length > 0 && "text-red-600 dark:text-red-400 font-semibold")}>
                      {(f.access_roads_flooded || []).length}/{(f.access_roads || []).length}
                    </td>
                    <td className="text-right tabular-nums">{(f.affected_roads || []).length}</td>
                    <td className="min-w-[160px]">
                      {f.alternative ? (
                        <div className="text-xs">
                          <div className="font-medium">{f.alternative.name}</div>
                          <div className="text-muted">{f.alternative.travel_time_min != null ? `${fmt(f.alternative.travel_time_min)} min` : "time n/a"} · {f.alternative.basis}</div>
                        </div>
                      ) : <span className="text-muted text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Drawer open={!!sel} onClose={() => setSelId(null)} title={sel?.name || ""}>
        {sel && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-1.5">
              <LevelBadge level={sel.status} map={FACILITY_STATUS_COLORS} solid />
              <LevelBadge level={sel.risk_level} map={RISK_COLORS} />
              <DataLabel label={sel.facility_data_label || "DEMO_DATA"} />
              <DataLabel label={sel.data_label || "MODEL_PREDICTION"} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Type" value={pretty(sel.kind)} />
              <Stat label="Ward" value={sel.ward} />
              <Stat label="Site depth now" value={depth(sel.site_depth_now_m)} />
              <Stat label="Site depth +60 min" value={depth(sel.site_depth_60_m)} />
              <Stat label="Ambulance reach" value={`${fmt(sel.reachable_network_pct, 0)}% of network`} />
              <Stat label="Capacity" value={sel.capacity ?? "—"} />
            </div>
            <button className="btn-primary w-full" onClick={() => nav(`/routing?to=${sel.lat},${sel.lon}`)}><Navigation size={15} />Route here</button>
            <div>
              <div className="label">Access roads ({(sel.access_roads || []).length})</div>
              <div className="flex flex-wrap gap-1">
                {(sel.access_roads || []).map((r: any) => {
                  const id = nameOf(r);
                  const flooded = (sel.access_roads_flooded || []).map(nameOf).includes(id);
                  return <Badge key={id} color={flooded ? "#dc2626" : "#64748b"}>{id}{flooded ? " · flooded" : ""}</Badge>;
                })}
              </div>
            </div>
            <div>
              <div className="label">Affected nearby roads</div>
              {(sel.affected_roads || []).length === 0 ? <p className="text-muted text-xs">None</p> : (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {sel.affected_roads.map((r: any) => (
                    <li key={r.id} className="px-2.5 py-1.5 flex items-center justify-between gap-2">
                      <div className="min-w-0"><div className="truncate font-medium text-xs">{r.name}</div><div className="text-[11px] text-muted">{r.distance_m} m away</div></div>
                      <span className="text-xs tabular-nums whitespace-nowrap">{depth(r.depth_now_m)} → {depth(r.depth_60_m)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="label">Alternative facility</div>
              {sel.alternative ? (
                <div className="rounded-lg border border-line p-2.5">
                  <div className="font-semibold">{sel.alternative.name}</div>
                  <div className="text-xs text-muted">{sel.alternative.travel_time_min != null ? `${fmt(sel.alternative.travel_time_min)} min` : "travel time n/a"} · {sel.alternative.basis}</div>
                  {sel.alternative.status && <div className="mt-1"><LevelBadge level={sel.alternative.status} map={FACILITY_STATUS_COLORS} /></div>}
                </div>
              ) : <p className="text-xs text-muted">Not required — facility operational.</p>}
            </div>
            <p className="text-[11px] text-muted">Facility location: DEMO DATA ({sel.lat.toFixed(5)}, {sel.lon.toFixed(5)}). Status is a model prediction from simulated rainfall.</p>
          </div>
        )}
      </Drawer>
    </Section>
  );
}
