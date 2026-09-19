/* Settings: preferences, alert thresholds, users & roles, audit logs, offline cache, system. */
import React, { useEffect, useMemo, useState } from "react";
import {
  Bell, CheckCircle2, Database, FileClock, Gauge, KeyRound, Moon, RotateCcw, Save, Search, Server, Settings as SettingsIcon, Sun,
  Trash2, UserCheck, Users, WifiOff,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";
import { LANGS, Lang } from "@/lib/i18n";
import { ALERT_COLORS, pretty } from "@/lib/format";
import { Badge, Card, DataLabel, Empty, ErrorBox, Loading, PageHeader, Section, Spinner, Stat, Tabs, cx } from "@/components/ui";

type TabKey = "prefs" | "thresholds" | "users" | "audit" | "offline" | "system";
const LEVELS = ["YELLOW", "ORANGE", "RED"] as const;
const METRICS: { key: string; label: string; unit: string; step: number; hint: string }[] = [
  { key: "rainfall_mm_hr", label: "Rainfall intensity", unit: "mm/hr", step: 1, hint: "Nowcast rainfall intensity" },
  { key: "flood_probability", label: "Flood probability", unit: "0–1", step: 0.05, hint: "Model probability of flooding within the horizon" },
  { key: "depth_m", label: "Flood depth", unit: "m", step: 0.05, hint: "Expected water depth on roads" },
  { key: "time_to_flood_min", label: "Time to flood", unit: "min", step: 5, hint: "Lower is worse — alert escalates as time shrinks" },
  { key: "drainage_utilization", label: "Drainage utilisation", unit: "ratio", step: 0.05, hint: "Flow / capacity (1.0 = full)" },
];
const ROLE_COLORS: Record<string, string> = { ADMIN: "#9f1239", MUNICIPAL_OFFICER: "#0ea5e9", EMERGENCY_RESPONDER: "#dc2626", ANALYST: "#6366f1", CITIZEN: "#16a34a" };

export default function Settings() {
  const { hasRole } = useApp();
  const isAdmin = hasRole("ADMIN");
  const [tab, setTab] = useState<TabKey>("prefs");
  const tabs = [
    { key: "prefs" as const, label: "Preferences", icon: SettingsIcon },
    { key: "thresholds" as const, label: "Alert thresholds", icon: Gauge },
    ...(isAdmin ? [{ key: "users" as const, label: "Users & roles", icon: Users }, { key: "audit" as const, label: "Audit logs", icon: FileClock }] : []),
    { key: "offline" as const, label: "Offline & cache", icon: WifiOff },
    { key: "system" as const, label: "System", icon: Server },
  ];
  return (
    <Section>
      <PageHeader icon={SettingsIcon} title="Settings" subtitle="Personal preferences, early-warning thresholds, access control and system status." />
      <div className="overflow-x-auto scroll-thin mb-4"><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>
      {tab === "prefs" && <Preferences />}
      {tab === "thresholds" && <Thresholds />}
      {tab === "users" && isAdmin && <UsersAdmin />}
      {tab === "audit" && isAdmin && <AuditLogs />}
      {tab === "offline" && <Offline />}
      {tab === "system" && <System />}
    </Section>
  );
}

function Toggle({ checked, onChange, label, desc }: { checked: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <label className="flex items-start justify-between gap-3 py-2 cursor-pointer">
      <span><span className="text-sm font-medium block">{label}</span>{desc && <span className="text-xs text-muted">{desc}</span>}</span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
        className={cx("relative h-6 w-11 shrink-0 rounded-full transition-colors", checked ? "bg-brand" : "bg-panel2 border border-line")}>
        <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
      </button>
    </label>
  );
}

function Preferences() {
  const { user, setUser, theme, toggleTheme, lang, setLang, city, cities, setCity, isOfficer, toast } = useApp();
  const [defCity, setDefCity] = useState(user?.city || city);
  const [nw, setNw] = useState(!!user?.notify_web);
  const [ne, setNe] = useState(!!user?.notify_email);
  const [ns, setNs] = useState(!!user?.notify_sms);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (user) { setDefCity(user.city || city); setNw(user.notify_web); setNe(user.notify_email); setNs(user.notify_sms); } }, [user]); // eslint-disable-line

  const save = async () => {
    setBusy(true);
    try {
      const body: any = { theme, language: lang, notify_web: nw, notify_email: ne, notify_sms: ns };
      if (isOfficer) body.city = defCity;
      const u = await api.put("/api/auth/me", body);
      setUser(u);
      if (isOfficer && defCity !== city) setCity(defCity);
      toast({ kind: "success", title: "Preferences saved" });
    } catch (e: any) { toast({ kind: "error", title: "Could not save preferences", body: e?.message }); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="Display & language" icon={Sun}>
        <div className="space-y-4">
          <div>
            <span className="label">Theme</span>
            <div className="inline-flex rounded-lg border border-line bg-panel2 p-1" role="radiogroup" aria-label="Theme">
              {(["light", "dark"] as const).map((m) => (
                <button key={m} role="radio" aria-checked={theme === m} onClick={() => theme !== m && toggleTheme()}
                  className={cx("rounded-md px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5", theme === m ? "bg-panel text-ink shadow-sm" : "text-muted")}>
                  {m === "light" ? <Sun size={13} /> : <Moon size={13} />}{pretty(m)}
                </button>
              ))}
            </div>
          </div>
          <label className="block max-w-xs">
            <span className="label">Language</span>
            <select className="input py-1.5" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
            <span className="text-[11px] text-muted">Applies to citizen alerts, navigation and reporting labels.</span>
          </label>
          {isOfficer && (
            <label className="block max-w-xs">
              <span className="label">Default city</span>
              <select className="input py-1.5" value={defCity} onChange={(e) => setDefCity(e.target.value)}>
                {cities.map((c) => <option key={c.key} value={c.key}>{c.name}, {c.state}</option>)}
                {!cities.length && <option value={defCity}>{pretty(defCity)}</option>}
              </select>
            </label>
          )}
        </div>
      </Card>
      <Card title="Notification channels" icon={Bell} subtitle="How you receive flood alerts">
        <div className="divide-y divide-line">
          <Toggle label="In-app / web notifications" desc="Live toasts and alert banners in this dashboard" checked={nw} onChange={setNw} />
          <Toggle label="Email" desc={user?.email ? `Sent to ${user.email}` : undefined} checked={ne} onChange={setNe} />
          <Toggle label="SMS" desc={user?.phone ? `Sent to ${user.phone}` : "Add a phone number in your profile"} checked={ns} onChange={setNs} />
        </div>
        <p className="text-[11px] text-muted mt-2">Email/SMS delivery depends on the gateways configured by the administrator.</p>
      </Card>
      <div className="lg:col-span-2 flex justify-end">
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? <Spinner size={14} className="text-current" /> : <Save size={15} />}Save preferences</button>
      </div>
    </div>
  );
}

function Thresholds() {
  const { hasRole, toast } = useApp();
  const canEdit = hasRole("ADMIN", "MUNICIPAL_OFFICER");
  const { data, error, reload } = useApi<any>("/api/alerts", { live: false });
  const [draft, setDraft] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data?.thresholds) setDraft(JSON.parse(JSON.stringify(data.thresholds))); }, [data]);

  const problems = useMemo(() => {
    if (!draft) return [];
    const out: string[] = [];
    METRICS.forEach((m) => {
      const t = draft[m.key];
      if (!t) return;
      const [y, o, r] = LEVELS.map((l) => Number(t[l]));
      if ([y, o, r].some((v) => Number.isNaN(v))) out.push(`${m.label}: all values required`);
      else if (t.higher_is_worse !== false ? !(y < o && o < r) : !(y > o && o > r))
        out.push(`${m.label}: values must ${t.higher_is_worse !== false ? "increase" : "decrease"} from YELLOW to RED`);
    });
    return out;
  }, [draft]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const body: any = {};
      METRICS.forEach((m) => { if (draft[m.key]) body[m.key] = Object.fromEntries(LEVELS.map((l) => [l, Number(draft[m.key][l])])); });
      const th = await api.put("/api/alerts/thresholds", { thresholds: body });
      setDraft(th);
      toast({ kind: "success", title: "Alert thresholds updated", body: "Alerts are re-evaluated on the next snapshot." });
    } catch (e: any) { toast({ kind: "error", title: "Could not save thresholds", body: e?.message }); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    if (!window.confirm("Reset all alert thresholds to defaults?")) return;
    setBusy(true);
    try { const th = await api.post("/api/alerts/thresholds/reset"); setDraft(th); toast({ kind: "success", title: "Thresholds reset to defaults" }); }
    catch (e: any) { toast({ kind: "error", title: "Reset failed", body: e?.message }); }
    finally { setBusy(false); }
  };

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!draft) return <Loading />;
  return (
    <Card title="Early-warning alert thresholds" icon={Gauge}
      subtitle={canEdit ? "Values at which each ward/road escalates to YELLOW, ORANGE and RED." : "Read-only — only administrators and municipal officers can edit thresholds."}
      actions={canEdit && <>
        <button className="btn-ghost btn-sm" onClick={reset} disabled={busy}><RotateCcw size={13} />Reset defaults</button>
        <button className="btn-primary btn-sm" onClick={save} disabled={busy || problems.length > 0}>{busy ? <Spinner size={12} className="text-current" /> : <Save size={13} />}Save</button>
      </>}
      bodyClass="px-0 overflow-x-auto scroll-thin">
      <table className="table">
        <thead><tr><th>Metric</th><th>Direction</th>{LEVELS.map((l) => <th key={l}><Badge color={ALERT_COLORS[l]} solid>{l}</Badge></th>)}</tr></thead>
        <tbody>
          {METRICS.map((m) => {
            const t = draft[m.key];
            if (!t) return null;
            return (
              <tr key={m.key}>
                <td><div className="font-medium">{m.label}</div><div className="text-xs text-muted">{m.hint}</div></td>
                <td className="text-xs whitespace-nowrap">{t.higher_is_worse === false ? "Lower is worse ↓" : "Higher is worse ↑"}</td>
                {LEVELS.map((l) => (
                  <td key={l} className="min-w-[110px]">
                    <div className="flex items-center gap-1">
                      <input type="number" step={m.step} min={0} disabled={!canEdit} aria-label={`${m.label} ${l} threshold`}
                        className="input py-1 w-24 tabular-nums disabled:opacity-70" style={{ borderLeft: `3px solid ${ALERT_COLORS[l]}` }}
                        value={t[l]} onChange={(e) => setDraft({ ...draft, [m.key]: { ...t, [l]: e.target.value } })} />
                      <span className="text-[10px] text-muted">{m.unit}</span>
                    </div>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {problems.length > 0 && <div className="px-4 pt-3"><ErrorBox error={problems.join(" · ")} /></div>}
    </Card>
  );
}

function UsersAdmin() {
  const { user: me, toast } = useApp();
  const { data, error, loading, reload, setData } = useApi<any[]>("/api/users", { live: false });
  const { data: roles } = useApi<any>("/api/auth/roles", { live: false });
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const roleList: string[] = roles?.roles || ["ADMIN", "MUNICIPAL_OFFICER", "EMERGENCY_RESPONDER", "ANALYST", "CITIZEN"];

  const patch = async (id: number, body: any, msg: string) => {
    setBusyId(id);
    try {
      const u = await api.patch(`/api/users/${id}`, body);
      setData((d) => (d || []).map((x) => (x.id === id ? u : x)));
      toast({ kind: "success", title: msg });
    } catch (e: any) { toast({ kind: "error", title: "Update failed", body: e?.message }); }
    finally { setBusyId(null); }
  };

  const users = (data || []).filter((u) => !q || `${u.full_name} ${u.email} ${u.role} ${u.department}`.toLowerCase().includes(q.toLowerCase()));
  const pending = (data || []).filter((u) => u.requested_role && u.requested_role !== u.role);

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  return (
    <div className="space-y-4">
      <Card title={`Pending role approvals (${pending.length})`} icon={UserCheck}>
        {pending.length === 0 ? <p className="text-sm text-muted">No pending role requests.</p> : (
          <ul className="divide-y divide-line">
            {pending.map((u) => (
              <li key={u.id} className="py-2 flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0"><div className="text-sm font-medium">{u.full_name} <span className="text-muted text-xs">{u.email}</span></div>
                  <div className="text-xs text-muted">Current <b>{pretty(u.role)}</b> → requested <b className="text-ink">{pretty(u.requested_role)}</b>{u.department && ` · ${u.department}`}</div></div>
                <button className="btn-primary btn-sm" disabled={busyId === u.id} onClick={() => patch(u.id, { role: u.requested_role }, `${u.full_name} approved as ${pretty(u.requested_role)}`)}>
                  {busyId === u.id ? <Spinner size={12} className="text-current" /> : <CheckCircle2 size={13} />}Approve
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={`Users (${users.length})`} icon={Users}
        actions={<div className="relative"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><label htmlFor="user-q" className="sr-only">Search users</label>
          <input id="user-q" className="input py-1.5 pl-8 text-xs w-48 sm:w-60" placeholder="Search users…" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
        bodyClass="px-0 pb-0 overflow-x-auto scroll-thin max-h-[560px]">
        {users.length === 0 ? <Empty text="No users" /> : (
          <table className="table">
            <thead><tr><th>User</th><th>Department</th><th>City</th><th>Role</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><div className="font-medium">{u.full_name}</div><div className="text-xs text-muted">{u.email}</div></td>
                  <td className="text-xs">{u.department || "—"}</td>
                  <td className="text-xs">{pretty(u.city)}</td>
                  <td>
                    <label className="sr-only" htmlFor={`role-${u.id}`}>Role for {u.email}</label>
                    <select id={`role-${u.id}`} className="input py-1 text-xs w-auto" value={u.role} disabled={busyId === u.id || u.id === me?.id}
                      onChange={(e) => patch(u.id, { role: e.target.value }, `${u.full_name} → ${pretty(e.target.value)}`)} style={{ borderLeft: `3px solid ${ROLE_COLORS[u.role] || "#64748b"}` }}>
                      {roleList.map((r) => <option key={r} value={r}>{pretty(r)}</option>)}
                    </select>
                    {u.requested_role && u.requested_role !== u.role && <div className="text-[10px] text-amber-500 mt-0.5">requested {pretty(u.requested_role)}</div>}
                  </td>
                  <td>
                    <button className={cx("btn-sm btn", u.is_active ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-red-500/15 text-red-500")}
                      disabled={busyId === u.id || u.id === me?.id} onClick={() => patch(u.id, { is_active: !u.is_active }, `${u.full_name} ${u.is_active ? "deactivated" : "activated"}`)}
                      aria-label={`${u.is_active ? "Deactivate" : "Activate"} ${u.email}`}>
                      {u.is_active ? "Active" : "Disabled"}
                    </button>
                  </td>
                  <td className="text-xs whitespace-nowrap">{u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function AuditLogs() {
  const { data, error, loading, reload } = useApi<any[]>("/api/audit-logs?limit=500", { live: false });
  const [q, setQ] = useState("");
  const rows = (data || []).filter((r) => !q || `${r.action} ${r.resource} ${r.detail} ${r.user_id} ${r.ip}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Card title={`Audit logs (${rows.length})`} icon={FileClock}
      actions={<>
        <div className="relative"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><label htmlFor="audit-q" className="sr-only">Filter logs</label>
          <input id="audit-q" className="input py-1.5 pl-8 text-xs w-44 sm:w-60" placeholder="Filter action, resource…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="btn-ghost btn-sm" onClick={reload} aria-label="Refresh audit logs"><RotateCcw size={13} /></button>
      </>}
      bodyClass="px-0 pb-0 overflow-x-auto scroll-thin max-h-[620px]">
      {error && !data ? <div className="p-4"><ErrorBox error={error} onRetry={reload} /></div> : loading && !data ? <Loading /> : rows.length === 0 ? <Empty text="No log entries" /> : (
        <table className="table">
          <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Resource</th><th>Detail</th><th>IP</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="text-xs whitespace-nowrap tabular-nums">{new Date(r.ts).toLocaleString()}</td>
                <td className="tabular-nums">{r.user_id ?? "—"}</td>
                <td><Badge color="#6366f1">{r.action}</Badge></td>
                <td className="text-xs">{r.resource}</td>
                <td className="text-xs max-w-[360px] break-words">{r.detail}</td>
                <td className="text-xs tabular-nums">{r.ip || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Offline() {
  const { connectivity, wsConnected, t, toast } = useApp();
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const countCache = () => { let n = 0; try { for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith("fs_cache:")) n++; } catch { /* ignore */ } setCount(n); };
  useEffect(countCache, []);
  const clear = async () => {
    setBusy(true);
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith("fs_cache:")) keys.push(k); }
      keys.forEach((k) => localStorage.removeItem(k));
      let n = 0;
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.filter((x) => x.startsWith("fs-")).map((x) => { n++; return caches.delete(x); }));
      }
      countCache();
      toast({ kind: "success", title: "Cached data cleared", body: `${keys.length} API responses and ${n} service-worker caches removed.` });
    } catch (e: any) { toast({ kind: "error", title: "Could not clear cache", body: e?.message }); }
    finally { setBusy(false); }
  };
  const color = connectivity === "ONLINE" ? "#16a34a" : connectivity === "DEGRADED" ? "#f97316" : "#dc2626";
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card title="Connectivity" icon={WifiOff}>
        <div className="flex items-center gap-3 mb-3">
          <span className="h-3 w-3 rounded-full" style={{ background: color }} />
          <span className="text-lg font-bold" style={{ color }}>{t(connectivity.toLowerCase())}</span>
          <Badge color={wsConnected ? "#16a34a" : "#64748b"}>Live channel {wsConnected ? "connected" : "disconnected"}</Badge>
        </div>
        <ul className="text-sm space-y-1 text-muted">
          <li><b className="text-ink">ONLINE</b> — live data from the FloodShield server.</li>
          <li><b className="text-ink">DEGRADED</b> — server or live channel unreachable; last cached values are shown with their timestamp.</li>
          <li><b className="text-ink">OFFLINE</b> — no network; the app runs from the offline cache.</li>
        </ul>
      </Card>
      <Card title="Offline cache" icon={Database}>
        <p className="text-sm">When the network fails during a storm, FloodShield keeps working from cached data. The service worker caches:</p>
        <ul className="text-sm list-disc pl-5 my-2 space-y-0.5">
          <li>Map tiles and the application shell</li>
          <li>Latest rainfall observations and nowcasts</li>
          <li>Flood predictions and road status</li>
          <li>Drainage network status</li>
          <li>Emergency contacts, shelters and nearest-help information</li>
        </ul>
        <div className="flex items-center justify-between gap-2 flex-wrap mt-3">
          <span className="text-xs text-muted">{count} API responses cached in this browser</span>
          <button className="btn-danger btn-sm" onClick={clear} disabled={busy}>{busy ? <Spinner size={12} className="text-current" /> : <Trash2 size={13} />}Clear cached data</button>
        </div>
      </Card>
    </div>
  );
}

function System() {
  const { data: h, error, reload } = useApi<any>("/api/health", { live: false });
  const { data: roles } = useApi<any>("/api/auth/roles", { live: false });
  const perms: Record<string, string[]> = roles?.permissions || {};
  const allPerms = useMemo(() => Array.from(new Set(Object.values(perms).flat().filter((p) => p !== "*"))), [perms]);
  return (
    <div className="grid xl:grid-cols-5 gap-4">
      <Card className="xl:col-span-2" title="System health" icon={Server} actions={<button className="btn-ghost btn-sm" onClick={reload} aria-label="Refresh health"><RotateCcw size={13} /></button>}>
        {error && !h ? <ErrorBox error={error} onRetry={reload} /> : !h ? <Loading /> : (
          <div className="space-y-3">
            <div className="flex items-center gap-2"><Badge color={h.status === "ok" ? "#16a34a" : "#dc2626"} solid>{String(h.status).toUpperCase()}</Badge><span className="font-semibold">{h.app}</span></div>
            {h.tagline && <p className="text-xs text-muted italic">{h.tagline}</p>}
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Version" value={h.version} />
              <Stat label="Database" value={h.database} />
              <Stat label="Cache / Redis" value={h.redis} />
              <Stat label="Hardware dependencies" value={h.hardware_dependencies} />
            </div>
            {h.clock && (
              <div>
                <div className="label">Event clock</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Stat label="Minute" value={`T+${Math.round(h.clock.minute)}`} />
                  <Stat label="Mode" value={pretty(h.clock.mode)} />
                  <Stat label="City" value={pretty(h.clock.city)} />
                  <Stat label="Progress" value={`${Math.round((h.clock.progress || 0) * 100)}%`} />
                </div>
                {h.clock.updated && <div className="text-[11px] text-muted mt-1">Updated {new Date(h.clock.updated).toLocaleString()}</div>}
              </div>
            )}
            <DataLabel label="SIMULATED_DATA" />
          </div>
        )}
      </Card>
      <Card className="xl:col-span-3" title="Role permissions" icon={KeyRound} bodyClass="px-0 pb-0 overflow-x-auto scroll-thin">
        {!roles ? <Loading /> : (
          <table className="table">
            <thead><tr><th>Permission</th>{Object.keys(perms).map((r) => <th key={r} className="text-center">{pretty(r)}</th>)}</tr></thead>
            <tbody>
              {allPerms.map((p) => (
                <tr key={p}>
                  <td className="font-medium text-xs">{pretty(p)}</td>
                  {Object.entries(perms).map(([r, ps]) => {
                    const ok = ps.includes("*") || ps.includes(p);
                    return <td key={r} className="text-center">{ok ? <CheckCircle2 size={15} className="inline text-emerald-500" aria-label="allowed" /> : <span className="text-muted" aria-label="not allowed">—</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {roles?.self_register && <p className="text-xs text-muted px-4 py-2">Self-registration allowed for: {roles.self_register.map(pretty).join(", ")} (officer roles require admin approval).</p>}
      </Card>
    </div>
  );
}
