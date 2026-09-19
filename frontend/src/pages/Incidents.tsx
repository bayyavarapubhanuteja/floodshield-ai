/* Municipal Incident Management: incident register, workflow, alert conversion and map. */
import React, { useMemo, useState } from "react";
import { ClipboardList, Plus, Siren, MapPin, MessageSquare, Save, AlertTriangle } from "lucide-react";
import { CircleMarker, Marker, Tooltip as LTooltip } from "react-leaflet";
import { useApp } from "@/context/AppContext";
import { useApi } from "@/hooks/useApi";
import { api, qs } from "@/lib/api";
import { Badge, Card, DataLabel, Drawer, Empty, ErrorBox, Kpi, LevelBadge, Loading, Modal, PageHeader, Section, Spinner, cx } from "@/components/ui";
import { CityMap, Legend, MapOverlay } from "@/components/map";
import { ALERT_COLORS, INCIDENT_STATUS_COLORS, RISK_COLORS, depth, pretty, ttf } from "@/lib/format";
import { fmtTs, latLonStr, nameOf, pinIcon } from "@/components/ops/common";

const STATUSES = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED"];
const SEVERITIES = ["LOW", "MODERATE", "HIGH", "CRITICAL"];
const DEPARTMENTS = ["Municipal Engineering", "Storm Water Drains", "Disaster Response Force", "Traffic Police", "Fire & Rescue", "Health / Ambulance", "Electricity (DISCOM)", "Revenue / Relief"];

export default function Incidents() {
  const { city, toast, isOfficer } = useApp();
  const inc = useApi<any>("/api/incidents");
  const alerts = useApi<any>("/api/alerts");
  const [filter, setFilter] = useState("");
  const [selId, setSelId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyAlert, setBusyAlert] = useState<string | null>(null);

  const list: any[] = inc.data?.incidents || [];
  const shown = useMemo(() => list.filter((i) => !filter || i.status === filter), [list, filter]);
  const sel = list.find((i) => i.id === selId) || null;
  const existingAlertTitles = useMemo(() => new Set(list.filter((i) => i.status !== "RESOLVED").map((i) => i.title)), [list]);

  const fromAlert = async (a: any) => {
    setBusyAlert(a.id);
    try {
      const r = await api.post(`/api/incidents/from-alert/${encodeURIComponent(a.id)}${qs({ city })}`);
      toast({ kind: "success", title: "Incident created", body: r.incident_id });
      inc.reload();
    } catch (e: any) { toast({ kind: "error", title: "Could not create incident", body: e?.message }); }
    finally { setBusyAlert(null); }
  };

  if (inc.error && !inc.data) return <ErrorBox error={inc.error} onRetry={inc.reload} />;
  if (!inc.data) return <Loading text="Loading incident register…" />;

  return (
    <Section>
      <PageHeader icon={ClipboardList} title="Municipal Incident Management"
        subtitle="Track flood incidents from alert to resolution: assignment, severity, actions and field notes."
        labels={["MODEL_PREDICTION", "DEMO_DATA"]}
        actions={isOfficer ? <button className="btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={14} />New incident</button> : undefined} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {STATUSES.map((s) => (
          <div key={s} className={cx("rounded-xl", filter === s && "ring-2 ring-brand")}>
            <Kpi label={pretty(s)} value={inc.data.counts?.[s] ?? 0} color={INCIDENT_STATUS_COLORS[s]} icon={ClipboardList}
              sub={filter === s ? "Filtered — click to clear" : "Click to filter"} onClick={() => setFilter(filter === s ? "" : s)} />
          </div>
        ))}
      </div>

      <div className="grid xl:grid-cols-3 gap-4 mb-4">
        <Card className="xl:col-span-2" title={`Incidents (${shown.length}${filter ? ` · ${pretty(filter)}` : ""})`} icon={ClipboardList}
          actions={filter ? <button className="btn-ghost btn-sm" onClick={() => setFilter("")}>Clear filter</button> : undefined}
          bodyClass="overflow-auto scroll-thin px-0 pb-0 max-h-[560px]">
          {shown.length === 0 ? <Empty text="No incidents" /> : (
            <table className="table">
              <thead><tr><th>Incident</th><th>Location</th><th>Severity</th><th>Department</th><th>Affected</th><th>Recommended actions</th><th>Status</th><th>Created</th></tr></thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id} className="cursor-pointer" tabIndex={0} onClick={() => setSelId(i.id)} onKeyDown={(e) => e.key === "Enter" && setSelId(i.id)}>
                    <td className="min-w-[180px]"><div className="text-[11px] font-mono text-muted">{i.incident_id}</div><div className="font-medium">{i.title}</div></td>
                    <td className="min-w-[140px] text-xs">{i.location || "—"}</td>
                    <td><LevelBadge level={i.severity} map={RISK_COLORS} solid /></td>
                    <td className="text-xs min-w-[120px]">{i.department}</td>
                    <td className="text-xs min-w-[150px]">
                      {(i.affected_roads || []).length > 0 && <div>{i.affected_roads.length} road(s): {i.affected_roads.slice(0, 2).map(nameOf).join(", ")}{i.affected_roads.length > 2 ? "…" : ""}</div>}
                      {(i.affected_infrastructure || []).length > 0 && <div>{i.affected_infrastructure.length} facility(ies): {i.affected_infrastructure.slice(0, 2).map(nameOf).join(", ")}</div>}
                      {!(i.affected_roads || []).length && !(i.affected_infrastructure || []).length && <span className="text-muted">—</span>}
                    </td>
                    <td className="text-xs min-w-[200px]">
                      <ul className="list-disc pl-4">{(i.recommended_actions || []).slice(0, 2).map((a: any, k: number) => <li key={k}>{nameOf(a)}</li>)}</ul>
                      {(i.recommended_actions || []).length > 2 && <span className="text-muted">+{i.recommended_actions.length - 2} more</span>}
                    </td>
                    <td><LevelBadge level={i.status} map={INCIDENT_STATUS_COLORS} solid /></td>
                    <td className="text-xs whitespace-nowrap">{fmtTs(i.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Incident map" icon={MapPin}>
          <div className="relative">
            <CityMap className="h-[400px] xl:h-[500px]">
              {shown.map((i) => (
                <CircleMarker key={i.id} center={[i.lat, i.lon]} radius={i.severity === "CRITICAL" ? 11 : i.severity === "HIGH" ? 9 : 7}
                  pathOptions={{ color: INCIDENT_STATUS_COLORS[i.status] || "#fff", weight: 3, fillColor: RISK_COLORS[i.severity] || "#64748b", fillOpacity: 0.9 }}
                  eventHandlers={{ click: () => setSelId(i.id) }}>
                  <LTooltip><b>{i.incident_id}</b><br />{i.title}<br />{pretty(i.severity)} · {pretty(i.status)}</LTooltip>
                </CircleMarker>
              ))}
            </CityMap>
            <MapOverlay position="bottom-left">
              <Legend title="Severity (fill)" items={SEVERITIES.map((s) => ({ color: RISK_COLORS[s], label: pretty(s) }))} />
            </MapOverlay>
          </div>
          <p className="text-[11px] text-muted mt-2">Ring colour = workflow status.</p>
        </Card>
      </div>

      <Card title="Create incident from current alert" icon={Siren} subtitle="Alerts are regenerated every 5-minute step by the early-warning engine."
        actions={<DataLabel label="MODEL_PREDICTION" />} bodyClass="max-h-[420px] overflow-auto scroll-thin">
        {alerts.error && !alerts.data ? <ErrorBox error={alerts.error} onRetry={alerts.reload} /> : !alerts.data ? <Loading /> :
          (alerts.data.alerts || []).length === 0 ? <Empty text="No active alerts" /> : (
            <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-2">
              {alerts.data.alerts.map((a: any) => (
                <li key={a.id} className="rounded-lg border border-line p-2.5 flex flex-col gap-1.5" style={{ borderLeft: `4px solid ${ALERT_COLORS[a.level]}` }}>
                  <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold truncate">{a.location}</span><LevelBadge level={a.level} map={ALERT_COLORS} solid /></div>
                  <div className="text-xs text-muted">Depth up to {depth(a.expected_depth_m)} · {ttf(a.expected_time_min)} · {(a.affected_roads || []).length} roads</div>
                  <div className="flex items-center justify-between gap-2 mt-auto">
                    {existingAlertTitles.has(a.title) ? <Badge color="#0ea5e9">Incident open</Badge> : <span />}
                    <button className="btn-ghost btn-sm" disabled={!isOfficer || busyAlert === a.id} onClick={() => fromAlert(a)}>
                      {busyAlert === a.id ? <Spinner size={12} /> : <Plus size={12} />}Create incident
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </Card>

      <IncidentDrawer inc={sel} onClose={() => setSelId(null)} onUpdated={(u) => { inc.setData({ ...inc.data, incidents: list.map((x) => (x.id === u.id ? u : x)), counts: recount(list.map((x) => (x.id === u.id ? u : x))) }); }} />
      <CreateModal open={creating} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); inc.reload(); }} />
    </Section>
  );
}

function recount(rows: any[]) {
  return Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
}

function IncidentDrawer({ inc, onClose, onUpdated }: { inc: any; onClose: () => void; onUpdated: (u: any) => void }) {
  const { toast, isOfficer } = useApp();
  const [note, setNote] = useState("");
  const [dept, setDept] = useState("");
  const [sev, setSev] = useState("");
  const [busy, setBusy] = useState(false);

  const patch = async (body: Record<string, any>) => {
    if (!inc) return;
    setBusy(true);
    try {
      const u = await api.patch(`/api/incidents/${inc.id}`, body);
      onUpdated(u); setNote(""); setDept(""); setSev("");
      toast({ kind: "success", title: `${u.incident_id} updated`, body: body.status ? `Status → ${pretty(body.status)}` : undefined });
    } catch (e: any) { toast({ kind: "error", title: "Update failed", body: e?.message }); }
    finally { setBusy(false); }
  };

  return (
    <Drawer open={!!inc} onClose={onClose} title={inc ? `${inc.incident_id}` : ""}>
      {inc && (
        <div className="space-y-4 text-sm">
          <div>
            <div className="font-semibold text-base">{inc.title}</div>
            <div className="text-xs text-muted">{inc.location} · {latLonStr([inc.lat, inc.lon])}</div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <LevelBadge level={inc.status} map={INCIDENT_STATUS_COLORS} solid /><LevelBadge level={inc.severity} map={RISK_COLORS} /><Badge color="#64748b">{inc.department}</Badge>
            </div>
          </div>

          <div>
            <div className="label">Status workflow</div>
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map((s) => (
                <button key={s} disabled={!isOfficer || busy || inc.status === s} onClick={() => patch({ status: s, note: note.trim() || undefined })}
                  className={cx("btn btn-sm border", inc.status === s ? "text-white" : "border-line hover:bg-panel2")}
                  style={inc.status === s ? { background: INCIDENT_STATUS_COLORS[s], borderColor: INCIDENT_STATUS_COLORS[s] } : { color: INCIDENT_STATUS_COLORS[s] }}>
                  {pretty(s)}
                </button>
              ))}
            </div>
          </div>

          {isOfficer && (
            <div className="rounded-lg border border-line p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="label">Department</span>
                  <select className="input py-1.5" value={dept} onChange={(e) => setDept(e.target.value)}>
                    <option value="">(unchanged)</option>{[...new Set([inc.department, ...DEPARTMENTS])].map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </label>
                <label className="block"><span className="label">Severity</span>
                  <select className="input py-1.5" value={sev} onChange={(e) => setSev(e.target.value)}>
                    <option value="">(unchanged)</option>{SEVERITIES.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
                  </select>
                </label>
              </div>
              <label className="block"><span className="label">Note</span>
                <textarea className="input min-h-[70px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Field update, action taken…" />
              </label>
              <button className="btn-primary btn-sm w-full" disabled={busy || (!note.trim() && !dept && !sev)}
                onClick={() => patch({ note: note.trim() || undefined, department: dept || undefined, severity: sev || undefined })}>
                {busy ? <Spinner size={13} className="text-current" /> : <Save size={13} />}Save update
              </button>
            </div>
          )}

          {(inc.recommended_actions || []).length > 0 && (
            <div><div className="label">Recommended actions</div>
              <ul className="list-disc pl-5 space-y-0.5 text-xs">{inc.recommended_actions.map((a: any, k: number) => <li key={k}>{nameOf(a)}</li>)}</ul></div>
          )}
          {(inc.affected_roads || []).length > 0 && (
            <div><div className="label">Affected roads</div>
              <div className="flex flex-wrap gap-1">{inc.affected_roads.map((r: any, k: number) => <Badge key={k} color="#f97316">{nameOf(r)}{r?.depth_60_m != null ? ` · ${depth(r.depth_60_m)}` : ""}</Badge>)}</div></div>
          )}
          {(inc.affected_infrastructure || []).length > 0 && (
            <div><div className="label">Affected infrastructure</div>
              <div className="flex flex-wrap gap-1">{inc.affected_infrastructure.map((r: any, k: number) => <Badge key={k} color="#dc2626">{nameOf(r)}</Badge>)}</div></div>
          )}

          <div>
            <div className="label flex items-center gap-1"><MessageSquare size={12} />Notes timeline</div>
            {(inc.notes || []).length === 0 ? <p className="text-xs text-muted">No notes</p> : (
              <ol className="relative border-l border-line ml-1.5 space-y-3">
                {[...inc.notes].reverse().map((n: any, k: number) => (
                  <li key={k} className="ml-3">
                    <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-brand" />
                    <div className="text-[11px] text-muted">{fmtTs(n.at)} · {n.by}</div>
                    <div className="text-xs">{n.text}</div>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="text-[11px] text-muted">Created {fmtTs(inc.created_at)}{inc.updated_at ? ` · updated ${fmtTs(inc.updated_at)}` : ""}</div>
        </div>
      )}
    </Drawer>
  );
}

function CreateModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { city, toast } = useApp();
  const [f, setF] = useState({ title: "", location: "", severity: "HIGH", department: DEPARTMENTS[0], roads: "", actions: "" });
  const [pos, setPos] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!f.title.trim() || !pos) { toast({ kind: "error", title: "Title and map location are required" }); return; }
    setBusy(true);
    try {
      const split = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
      const r = await api.post("/api/incidents", {
        city, title: f.title.trim(), location: f.location.trim(), lat: pos[0], lon: pos[1], severity: f.severity, department: f.department,
        affected_roads: split(f.roads), affected_infrastructure: [], recommended_actions: f.actions.split("\n").map((x) => x.trim()).filter(Boolean),
      });
      toast({ kind: "success", title: "Incident created", body: r.incident_id });
      setF({ title: "", location: "", severity: "HIGH", department: DEPARTMENTS[0], roads: "", actions: "" }); setPos(null);
      onCreated();
    } catch (e: any) { toast({ kind: "error", title: "Create failed", body: e?.message }); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New incident" wide>
      <form className="grid md:grid-cols-2 gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="space-y-3">
          <label className="block"><span className="label">Title</span><input className="input" required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
          <label className="block"><span className="label">Location description</span><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="e.g. Underpass near Koti junction" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="label">Severity</span>
              <select className="input py-1.5" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{SEVERITIES.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}</select></label>
            <label className="block"><span className="label">Department</span>
              <select className="input py-1.5" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select></label>
          </div>
          <label className="block"><span className="label">Affected roads (comma separated)</span><input className="input" value={f.roads} onChange={(e) => setF({ ...f, roads: e.target.value })} /></label>
          <label className="block"><span className="label">Recommended actions (one per line)</span><textarea className="input min-h-[80px]" value={f.actions} onChange={(e) => setF({ ...f, actions: e.target.value })} /></label>
        </div>
        <div className="space-y-2">
          <span className="label flex items-center gap-1"><MapPin size={12} />Location — click the map ({pos ? latLonStr(pos) : "not set"})</span>
          <CityMap className="h-[280px]" onClick={(lat, lon) => setPos([lat, lon])}>
            {pos && <Marker position={pos} icon={pinIcon("#dc2626", "!", 24)} />}
          </CityMap>
          {!pos && <p className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle size={12} />Click the map to place the incident.</p>}
        </div>
        <div className="md:col-span-2 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy && <Spinner size={14} className="text-current" />}Create incident</button>
        </div>
      </form>
    </Modal>
  );
}
