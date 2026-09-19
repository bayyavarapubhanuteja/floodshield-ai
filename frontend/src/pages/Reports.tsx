/* Reports: PDF incident report, model validation (demo twin experiment), data quality and alert notification outbox. */
import React, { useState } from "react";
import { FileText, Download, FlaskConical, Database, Send, Inbox, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend as RLegend, Line, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { useApp } from "@/context/AppContext";
import { useApi } from "@/hooks/useApi";
import { api, downloadFile, qs } from "@/lib/api";
import { Badge, Card, DataLabel, Empty, ErrorBox, LevelBadge, Loading, PageHeader, Progress, Section, Spinner, Stat, cx } from "@/components/ui";
import { ALERT_COLORS, fmt, pct, pretty } from "@/lib/format";
import { fmtTs, tooltipStyle } from "@/components/ops/common";
import { LANGS } from "@/lib/i18n";

const CONN_COLORS: Record<string, string> = { ONLINE: "#16a34a", DEGRADED: "#eab308", OFFLINE: "#dc2626" };
const PDF_CONTENTS = [
  "Current rainfall and 3-hour AI nowcast", "Flood extent and maximum depth", "Affected and impassable roads",
  "Critical infrastructure status", "Drainage failures and overloaded nodes", "Active alerts and recommended actions",
  "Emergency route (fire station → hospital)", "Flood map snapshot", "Flood propagation timeline", "Recommendations and model validation summary",
];

export default function Reports() {
  const { hasRole } = useApp();
  const canOutbox = hasRole("MUNICIPAL_OFFICER");
  const canSend = hasRole("MUNICIPAL_OFFICER", "EMERGENCY_RESPONDER");
  return (
    <Section>
      <PageHeader icon={FileText} title="Reports"
        subtitle="Flood incident reports, model validation, data-source quality and alert notification delivery."
        labels={["SIMULATED_DATA", "MODEL_PREDICTION", "DEMO_DATA"]} />
      <div className="grid xl:grid-cols-3 gap-4 mb-4">
        <PdfCard />
        <DataQualityCard className="xl:col-span-2" />
      </div>
      <ValidationCard />
      {(canSend || canOutbox) && (
        <div className="grid xl:grid-cols-2 gap-4 mt-4">
          {canSend && <SendAlertCard />}
          {canOutbox && <OutboxCard />}
        </div>
      )}
    </Section>
  );
}

function PdfCard() {
  const { city, clock, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const minute = Math.round(clock?.minute ?? 0);
  const gen = async () => {
    setBusy(true);
    try {
      await downloadFile(`/api/reports/incident.pdf${qs({ city, t: minute })}`, `FloodShield_${city}_T${String(minute).padStart(3, "0")}.pdf`);
      toast({ kind: "success", title: "Report generated" });
    } catch (e: any) { toast({ kind: "error", title: "Report generation failed", body: e?.message }); }
    finally { setBusy(false); }
  };
  return (
    <Card title="Flood Incident Report (PDF)" icon={FileText} subtitle={`Snapshot at event minute T+${minute} · ${pretty(city)}`}>
      <button className="btn-primary w-full py-3" onClick={gen} disabled={busy}>
        {busy ? <Spinner size={16} className="text-current" /> : <Download size={16} />}{busy ? "Generating PDF…" : "Generate PDF report"}
      </button>
      <div className="label mt-4">Report contents</div>
      <ul className="text-xs space-y-1">
        {PDF_CONTENTS.map((c) => <li key={c} className="flex items-start gap-1.5"><CheckCircle2 size={13} className="text-brand mt-0.5 shrink-0" />{c}</li>)}
      </ul>
      <p className="text-[11px] text-muted mt-3">Every value in the PDF carries its provenance label (simulated / model prediction / demo data).</p>
    </Card>
  );
}

function DataQualityCard({ className }: { className?: string }) {
  const { data, error, loading, reload } = useApi<any>("/api/data-quality?check_live=true", { live: false });
  return (
    <Card className={className} title="Data quality" icon={Database}
      actions={<>{data && <Badge color={CONN_COLORS[data.overall] || "#64748b"} solid>{data.overall}</Badge>}<button className="btn-ghost btn-sm" onClick={reload} disabled={loading}>{loading ? <Spinner size={12} /> : null}Re-check</button></>}
      subtitle={data ? `Checked ${fmtTs(data.checked_at)}` : undefined} bodyClass="overflow-x-auto scroll-thin px-0 pb-0 max-h-[460px]">
      {error && !data ? <div className="px-4 pb-4"><ErrorBox error={error} onRetry={reload} /></div> : !data ? <Loading text="Checking data sources…" /> : (
        <table className="table">
          <thead><tr><th>Source</th><th>Type</th><th>Status</th><th>Last updated</th><th>Completeness</th><th className="text-right">Confidence</th><th>Anomalies</th></tr></thead>
          <tbody>
            {(data.sources || []).map((s: any) => (
              <tr key={s.source}>
                <td className="min-w-[160px]"><div className="font-medium">{s.source}</div>{s.note && <div className="text-[11px] text-muted">{s.note}</div>}</td>
                <td><DataLabel label={s.type} /></td>
                <td><LevelBadge level={s.status} map={CONN_COLORS} /></td>
                <td className="text-xs whitespace-nowrap">{fmtTs(s.last_updated)}</td>
                <td className="min-w-[110px]"><div className="flex items-center gap-2"><Progress value={s.completeness_pct ?? 0} max={100} color={(s.completeness_pct ?? 0) >= 90 ? "#16a34a" : (s.completeness_pct ?? 0) >= 50 ? "#eab308" : "#dc2626"} /><span className="text-xs tabular-nums">{fmt(s.completeness_pct, 0)}%</span></div></td>
                <td className="text-right tabular-nums">{pct(s.confidence)}</td>
                <td className="text-xs min-w-[140px]">{(s.anomalies || []).length === 0 ? <span className="text-muted">None</span> : <ul className="list-disc pl-4 text-amber-700 dark:text-amber-400">{s.anomalies.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function ValidationCard() {
  const { data, error, reload } = useApi<any>("/api/validation", { live: false });
  const flood = data ? Object.entries(data.flood_extent?.by_horizon || {}).map(([h, v]: [string, any]) => ({ h: `+${h}`, ...v })).sort((a, b) => parseInt(a.h) - parseInt(b.h)) : [];
  const rain = (data?.rainfall || []).map((r: any) => ({ ...r, h: `+${r.horizon_min}` }));
  return (
    <Card title="Model validation" icon={FlaskConical}>
      <div className="rounded-xl border-2 border-amber-500 bg-amber-500/10 p-3 mb-4 flex items-start gap-2">
        <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={20} />
        <div className="text-sm">
          <div className="font-bold text-amber-700 dark:text-amber-400">DEMO VALIDATION (twin experiment) — NOT real-world validation</div>
          {data && <p className="text-xs mt-1">{data.description}</p>}
          {data?.real_world_validation && (
            <p className="text-xs mt-1.5"><b>Real-world validation: {pretty(data.real_world_validation.status)}.</b> Requires: {data.real_world_validation.requirement}</p>
          )}
        </div>
      </div>
      {error && !data ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Loading text="Scoring forecasts…" /> : (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="min-w-0">
            <div className="label">Rainfall nowcast error by lead time (mm/hr)</div>
            <div className="h-64">
              <ResponsiveContainer>
                <ComposedChart data={rain} margin={{ left: -10, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" />
                  <XAxis dataKey="h" fontSize={11} stroke="rgb(var(--muted))" />
                  <YAxis fontSize={11} stroke="rgb(var(--muted))" />
                  <RTooltip contentStyle={tooltipStyle} labelFormatter={(v) => `Lead time ${v} min`} />
                  <RLegend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="mae_mm_hr" name="MAE" fill="#0ea5e9" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="rmse_mm_hr" name="RMSE" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                  <Line dataKey="cell_rmse_mm_hr" name="Cell RMSE" stroke="#f97316" strokeWidth={2} dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="min-w-0">
            <div className="label">Flood extent skill by lead time</div>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={flood} margin={{ left: -10, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" />
                  <XAxis dataKey="h" fontSize={11} stroke="rgb(var(--muted))" />
                  <YAxis domain={[0, 1]} fontSize={11} stroke="rgb(var(--muted))" />
                  <RTooltip contentStyle={tooltipStyle} labelFormatter={(v) => `Lead time ${v} min`} formatter={(v: any) => Number(v).toFixed(3)} />
                  <RLegend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="precision" name="Precision" fill="#16a34a" />
                  <Bar dataKey="recall" name="Recall" fill="#0ea5e9" />
                  <Bar dataKey="f1" name="F1" fill="#8b5cf6" />
                  <Bar dataKey="iou" name="IoU" fill="#f97316" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            <Stat label="Overall precision" value={fmt(data.flood_extent?.overall?.precision, 3)} />
            <Stat label="Overall recall" value={fmt(data.flood_extent?.overall?.recall, 3)} />
            <Stat label="Overall F1" value={fmt(data.flood_extent?.overall?.f1, 3)} />
            <Stat label="Overall IoU" value={fmt(data.flood_extent?.overall?.iou, 3)} />
            <Stat label="Depth MAE" value={`${fmt(data.depth?.mae_m, 3)} m`} />
            <Stat label="Depth RMSE" value={`${fmt(data.depth?.rmse_m, 3)} m`} />
            <Stat label="Depth cells scored" value={data.depth?.n_cells ?? "—"} />
          </div>
          <p className="lg:col-span-2 text-[11px] text-muted">Generated {fmtTs(data.generated_at)} · validation type {data.validation_type}</p>
        </div>
      )}
    </Card>
  );
}

function SendAlertCard() {
  const { city, toast } = useApp();
  const alerts = useApi<any>("/api/alerts");
  const [alertId, setAlertId] = useState("");
  const [channels, setChannels] = useState<Set<string>>(new Set(["WEB"]));
  const [recipients, setRecipients] = useState("");
  const [language, setLanguage] = useState("en");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const list: any[] = alerts.data?.alerts || [];
  const chosen = list.find((a) => a.id === alertId) || list[0];
  const toggle = (c: string) => { const s = new Set(channels); s.has(c) ? s.delete(c) : s.add(c); setChannels(s); };

  const send = async () => {
    if (!chosen || channels.size === 0) return;
    setBusy(true);
    try {
      const r = await api.post(`/api/alerts/${encodeURIComponent(chosen.id)}/notify${qs({ city })}`, {
        channels: [...channels], recipients: recipients.split(/[\n,;]/).map((x) => x.trim()).filter(Boolean), language,
      });
      setResult(r);
      toast({ kind: "success", title: "Alert dispatched", body: `${r.deliveries?.length ?? 0} delivery record(s)` });
      window.dispatchEvent(new Event("fs:outbox"));
    } catch (e: any) { toast({ kind: "error", title: "Send failed", body: e?.message }); }
    finally { setBusy(false); }
  };

  return (
    <Card title="Send alert notification" icon={Send} actions={<DataLabel label="MODEL_PREDICTION" />}>
      <div className="flex items-start gap-2 rounded-lg border border-line bg-panel2 p-2.5 text-xs mb-3">
        <Inbox size={14} className="text-muted shrink-0 mt-0.5" />
        <span>WEB broadcasts to all connected dashboards. EMAIL / SMS are delivered only if an SMTP host or SMS gateway is configured on the server; otherwise deliveries are logged in the outbox as <b>SIMULATED</b>.</span>
      </div>
      {alerts.error && !alerts.data ? <ErrorBox error={alerts.error} onRetry={alerts.reload} /> : !alerts.data ? <Loading /> : list.length === 0 ? <Empty text="No current alerts to send" /> : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <label className="block"><span className="label">Alert</span>
            <select className="input py-1.5" value={chosen?.id || ""} onChange={(e) => setAlertId(e.target.value)}>
              {list.map((a) => <option key={a.id} value={a.id}>[{a.level}] {a.location}</option>)}
            </select>
          </label>
          {chosen && (
            <div className="rounded-lg border border-line p-2.5 text-xs" style={{ borderLeft: `4px solid ${ALERT_COLORS[chosen.level]}` }}>
              <div className="font-semibold">{chosen.messages?.[language]?.headline || chosen.messages?.en?.headline || chosen.title}</div>
              <div className="text-muted mt-0.5">{chosen.messages?.[language]?.action || chosen.messages?.en?.action}</div>
            </div>
          )}
          <fieldset>
            <legend className="label">Channels</legend>
            <div className="flex flex-wrap gap-3">
              {["WEB", "EMAIL", "SMS"].map((c) => (
                <label key={c} className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="accent-sky-500" checked={channels.has(c)} onChange={() => toggle(c)} />{c}</label>
              ))}
            </div>
          </fieldset>
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="block sm:col-span-2"><span className="label">Recipients (email / phone, comma separated)</span>
              <input className="input" value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="ward-officer@city.gov.in, +91…" disabled={!channels.has("EMAIL") && !channels.has("SMS")} />
            </label>
            <label className="block"><span className="label">Language</span>
              <select className="input py-1.5" value={language} onChange={(e) => setLanguage(e.target.value)}>{LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select>
            </label>
          </div>
          <button type="submit" className="btn-primary w-full" disabled={busy || channels.size === 0}>{busy ? <Spinner size={14} className="text-current" /> : <Send size={14} />}Send alert</button>
          {result && (
            <ul className="text-xs space-y-1">
              {(result.deliveries || []).map((d: any, i: number) => (
                <li key={i} className="flex items-center gap-2"><Badge color={d.status === "SENT" || d.status === "BROADCAST" ? "#16a34a" : d.status === "SIMULATED" ? "#a855f7" : "#dc2626"}>{d.status}</Badge>{d.channel} → {d.to}</li>
              ))}
            </ul>
          )}
        </form>
      )}
    </Card>
  );
}

function OutboxCard() {
  const { data, error, loading, reload } = useApi<any[]>("/api/notifications/outbox", { live: false });
  React.useEffect(() => { const f = () => reload(); window.addEventListener("fs:outbox", f); return () => window.removeEventListener("fs:outbox", f); }, [reload]);
  const rows: any[] = Array.isArray(data) ? data : [];
  return (
    <Card title="Notification outbox" icon={Inbox} actions={<button className="btn-ghost btn-sm" onClick={reload} disabled={loading}>{loading && <Spinner size={12} />}Refresh</button>}
      bodyClass="overflow-auto scroll-thin px-0 pb-0 max-h-[460px]">
      {error && !data ? <div className="px-4 pb-4"><ErrorBox error={error} onRetry={reload} /></div> : !data ? <Loading /> : rows.length === 0 ? <Empty text="No notifications sent in this server session" /> : (
        <table className="table">
          <thead><tr><th>Time</th><th>Channel</th><th>To</th><th>Subject</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="text-xs whitespace-nowrap">{fmtTs(r.at)}</td>
                <td><Badge color="#0ea5e9">{r.channel}</Badge></td>
                <td className="text-xs">{r.to}</td>
                <td className="text-xs min-w-[200px]"><div className="font-medium">{r.subject}</div><div className="text-muted line-clamp-2">{r.body}</div></td>
                <td><Badge color={r.status === "SENT" || r.status === "BROADCAST" ? "#16a34a" : r.status === "SIMULATED" ? "#a855f7" : "#dc2626"} className={cx(String(r.status).startsWith("FAILED") && "whitespace-normal")}>{r.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
