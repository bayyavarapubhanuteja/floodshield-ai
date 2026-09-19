/* Emergency & Helpline Center: citizen-friendly quick actions, helpline directory and nearest reachable help. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Phone, Hospital, Route as RouteIcon, Megaphone, BookUser, Crosshair, ShieldCheck, AlertTriangle, Plus, Pencil, Trash2, LifeBuoy, Navigation, Siren, Flame, Home } from "lucide-react";
import { CircleMarker, Marker, Polyline, Tooltip as LTooltip } from "react-leaflet";
import { useApp } from "@/context/AppContext";
import { useApi } from "@/hooks/useApi";
import { api, qs } from "@/lib/api";
import { Badge, Card, DataLabel, Empty, ErrorBox, LevelBadge, Loading, Modal, PageHeader, Section, Spinner, cx } from "@/components/ui";
import { CityMap, MapOverlay, useMapStatic, facilityIcon } from "@/components/map";
import { FACILITY_STATUS_COLORS, fmt, pretty } from "@/lib/format";
import { getMyLocation, inBbox, pinIcon } from "@/components/ops/common";

type LL = [number, number];
const HELP_KINDS: { key: string; label: string; icon: any; color: string }[] = [
  { key: "hospital", label: "Hospital", icon: Hospital, color: "#0ea5e9" },
  { key: "police", label: "Police", icon: Siren, color: "#6366f1" },
  { key: "fire_station", label: "Fire station", icon: Flame, color: "#f97316" },
  { key: "shelter", label: "Shelter", icon: Home, color: "#16a34a" },
];
const CATEGORIES = ["EMERGENCY", "POLICE", "FIRE", "AMBULANCE", "HOSPITAL", "DISASTER", "MUNICIPAL", "COLLECTORATE", "TRAFFIC", "ELECTRICITY", "ROAD", "WOMEN", "CHILD", "RAILWAY", "OTHER"];
const EMPTY_FORM = { id: 0, city: "", category: "MUNICIPAL", name: "", number: "", description: "", verified: false, sort_order: 100 };

export default function Emergency() {
  const { t, city, toast, hasRole } = useApp();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const st = useMapStatic();
  const contactsRef = useRef<HTMLDivElement>(null);
  const contacts = useApi<any>("/api/emergency-contacts", { live: false });
  const [loc, setLoc] = useState<LL | null>(null);
  const [help, setHelp] = useState<any>(null);
  const [helpBusy, setHelpBusy] = useState(false);
  const [helpErr, setHelpErr] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [form, setForm] = useState<typeof EMPTY_FORM | null>(null);
  const [saving, setSaving] = useState(false);
  const canEdit = hasRole("ADMIN", "MUNICIPAL_OFFICER");
  const canDelete = hasRole("ADMIN");

  const findHelp = async (p: LL) => {
    setLoc(p); setHelpBusy(true); setHelpErr(null);
    try { setHelp(await api.get(`/api/nearest-help${qs({ lat: p[0].toFixed(6), lon: p[1].toFixed(6), city })}`)); }
    catch (e: any) { setHelpErr(e?.message || "Could not find nearest help"); }
    finally { setHelpBusy(false); }
  };
  const useMine = async () => {
    setLocating(true);
    try {
      const p = await getMyLocation();
      if (st && !inBbox(st.bbox, p[0], p[1])) toast({ kind: "error", title: "Location outside the city model area", body: t("pick_on_map") });
      else await findHelp(p);
    } catch (e: any) {
      toast({ kind: "info", title: "Location unavailable", body: t("pick_on_map") });
    } finally { setLocating(false); }
  };

  const nearestParam = sp.get("nearest");
  const prompted = useRef(false);
  useEffect(() => {
    if (nearestParam && st && !prompted.current) {
      prompted.current = true;
      document.getElementById("nearest-help")?.scrollIntoView({ behavior: "smooth" });
      useMine();
    }
  }, [nearestParam, st]); // eslint-disable-line

  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    (contacts.data?.contacts || []).forEach((c: any) => { const k = c.category || "OTHER"; m.set(k, [...(m.get(k) || []), c]); });
    return [...m.entries()];
  }, [contacts.data]);

  const saveContact = async () => {
    if (!form) return;
    if (!form.name.trim()) { toast({ kind: "error", title: "Name is required" }); return; }
    setSaving(true);
    const body = { city: form.city || city, category: form.category, name: form.name.trim(), number: form.number.trim(), description: form.description, verified: form.verified, sort_order: Number(form.sort_order) || 100 };
    try {
      if (form.id) await api.put(`/api/emergency-contacts/${form.id}`, body);
      else await api.post("/api/emergency-contacts", body);
      toast({ kind: "success", title: form.id ? "Contact updated" : "Contact added" });
      setForm(null); contacts.reload();
    } catch (e: any) { toast({ kind: "error", title: "Save failed", body: e?.message }); }
    finally { setSaving(false); }
  };
  const del = async (c: any) => {
    if (!window.confirm(`Delete contact "${c.name}"? This cannot be undone.`)) return;
    try { await api.del(`/api/emergency-contacts/${c.id}`); toast({ kind: "success", title: "Contact deleted" }); contacts.reload(); }
    catch (e: any) { toast({ kind: "error", title: "Delete failed", body: e?.message }); }
  };

  const scrollContacts = () => contactsRef.current?.scrollIntoView({ behavior: "smooth" });
  const actions = [
    { label: t("call112"), icon: Phone, color: "bg-red-600 hover:bg-red-700", href: "tel:112" },
    { label: t("nearest_hospital"), icon: Hospital, color: "bg-sky-600 hover:bg-sky-700", onClick: () => { document.getElementById("nearest-help")?.scrollIntoView({ behavior: "smooth" }); useMine(); } },
    { label: t("safe_route"), icon: RouteIcon, color: "bg-emerald-600 hover:bg-emerald-700", onClick: () => nav("/routing") },
    { label: t("report_flood"), icon: Megaphone, color: "bg-amber-500 hover:bg-amber-600", onClick: () => nav("/citizen-reports?new=1") },
    { label: t("view_contacts"), icon: BookUser, color: "bg-slate-700 hover:bg-slate-800", onClick: scrollContacts },
  ];
  const hosp = help?.results?.hospital;

  return (
    <Section>
      <PageHeader icon={LifeBuoy} title={t("emergency")} subtitle={t("stay_safe")} labels={["MODEL_PREDICTION", "DEMO_DATA"]} />

      <a href="tel:112" aria-label="Call 112 emergency number"
        className="mb-4 flex items-center justify-center gap-4 rounded-2xl bg-red-600 hover:bg-red-700 text-white py-6 md:py-8 px-4 shadow-lg transition-colors">
        <Phone size={44} className="shrink-0" />
        <div className="text-left">
          <div className="text-3xl md:text-5xl font-extrabold tracking-tight">{t("call112")}</div>
          <div className="text-sm md:text-base opacity-90">National Emergency Response · Police · Fire · Ambulance</div>
        </div>
      </a>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {actions.map((a) => a.href ? (
          <a key={a.label} href={a.href} className={cx("btn text-white font-bold py-4 text-sm flex-col text-center", a.color)}><a.icon size={22} />{a.label}</a>
        ) : (
          <button key={a.label} onClick={a.onClick} className={cx("btn text-white font-bold py-4 text-sm flex-col text-center", a.color)}><a.icon size={22} />{a.label}</button>
        ))}
      </div>

      <div id="nearest-help" className="grid xl:grid-cols-5 gap-4 mb-4 scroll-mt-4">
        <Card className="xl:col-span-3" title={t("nearest_help")} icon={Navigation} subtitle={t("pick_on_map")}
          actions={<button className="btn-primary btn-sm" onClick={useMine} disabled={locating}>{locating ? <Spinner size={13} className="text-current" /> : <Crosshair size={13} />}{t("use_my_location")}</button>}>
          <div className="relative">
            <CityMap className="h-[380px] md:h-[460px]" onClick={(lat, lon) => findHelp([lat, lon])}>
              {hosp?.route?.coords && <Polyline positions={hosp.route.coords} pathOptions={{ color: "#16a34a", weight: 6, opacity: 0.95 }}><LTooltip sticky>Flood-safe route to hospital · {fmt(hosp.route.time_min)} min</LTooltip></Polyline>}
              {help && HELP_KINDS.map((k) => {
                const n = help.results?.[k.key]?.nearest;
                return n ? (
                  <Marker key={k.key} position={[n.lat, n.lon]} icon={facilityIcon(k.key, FACILITY_STATUS_COLORS[n.status] || k.color, 24)}>
                    <LTooltip direction="top" offset={[0, -10]}><b>{n.name}</b><br />{k.label} · {n.travel_time_min != null ? `${n.travel_time_min} min` : "unreachable"}</LTooltip>
                  </Marker>
                ) : null;
              })}
              {loc && <Marker position={loc} icon={pinIcon("#0ea5e9", "●", 22)}><LTooltip>{t("your_location")}</LTooltip></Marker>}
              {loc && <CircleMarker center={loc} radius={18} pathOptions={{ color: "#0ea5e9", weight: 1, fillOpacity: 0.1 }} />}
            </CityMap>
            <MapOverlay position="top-left" className="flex flex-col gap-1 items-start">
              <span className="chip bg-panel border border-line">{loc ? t("your_location") : t("pick_on_map")}</span>
              <DataLabel label="DEMO_DATA" className="bg-panel" />
            </MapOverlay>
          </div>
        </Card>

        <div className="xl:col-span-2 flex flex-col gap-3 min-w-0">
          {helpErr && <ErrorBox error={helpErr} onRetry={loc ? () => findHelp(loc) : undefined} />}
          {helpBusy && <Card><Loading text="Finding nearest reachable help…" /></Card>}
          {!help && !helpBusy && <Card><Empty icon={Navigation} text={`${t("pick_on_map")} / ${t("use_my_location")}`} /></Card>}
          {help && (
            <>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <DataLabel label={help.data_label} /><DataLabel label={help.facility_data_label} />
                <span>Flood-safe travel times at event minute T+{help.event_minute}{help.__cached_at ? " · cached (offline)" : ""}</span>
              </div>
              {HELP_KINDS.map((k) => {
                const r = help.results?.[k.key];
                const n = r?.nearest;
                return (
                  <div key={k.key} className="card p-3" style={{ borderLeft: `4px solid ${k.color}` }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted flex items-center gap-1.5"><k.icon size={14} style={{ color: k.color }} />{k.label}</span>
                      {n && (n.reachable ? <Badge color="#16a34a">Reachable</Badge> : <Badge color="#dc2626" solid>Not reachable</Badge>)}
                    </div>
                    {!n ? <p className="text-sm text-muted mt-1">None found</p> : (
                      <>
                        <div className="font-semibold mt-1">{n.name}</div>
                        <div className="text-xs text-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-ink font-semibold text-sm">{n.travel_time_min != null ? `${fmt(n.travel_time_min)} min` : "—"}</span>
                          <span>{pretty(r.mode)}</span><span>{fmt(n.straight_line_m / 1000, 1)} km straight-line</span>
                          <LevelBadge level={n.status} map={FACILITY_STATUS_COLORS} />
                        </div>
                        <button className="btn-ghost btn-sm mt-2" onClick={() => nav(`/routing?to=${n.lat},${n.lon}`)}><RouteIcon size={12} />{t("safe_route")}</button>
                      </>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      <div ref={contactsRef} className="scroll-mt-4">
        <Card title={t("view_contacts")} icon={BookUser}
          actions={canEdit ? <button className="btn-primary btn-sm" onClick={() => setForm({ ...EMPTY_FORM, city })}><Plus size={13} />Add contact</button> : undefined}>
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs mb-4">
            <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <b>112 is India's single national emergency number.</b> {contacts.data?.note || "Local and state helpline numbers vary and are not universal; local numbers must be configured and verified by the municipality."}
            </div>
          </div>
          {contacts.error && !contacts.data ? <ErrorBox error={contacts.error} onRetry={contacts.reload} /> : !contacts.data ? <Loading /> : groups.length === 0 ? <Empty text="No contacts" /> : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {groups.map(([cat, list]) => (
                <div key={cat} className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">{pretty(cat)}</div>
                  <ul className="space-y-2">
                    {list.map((c: any) => {
                      const configured = !!(c.number || "").trim();
                      return (
                        <li key={c.id} className={cx("rounded-lg border p-2.5", c.primary ? "border-red-500/60 bg-red-500/5" : "border-line")}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold">{c.name}</div>
                              {c.description && <div className="text-xs text-muted">{c.description}</div>}
                              <div className="text-[10.5px] text-muted mt-0.5">{c.city === "national" ? "National" : pretty(c.city)}</div>
                            </div>
                            {configured ? (
                              <a href={`tel:${c.number.replace(/[^\d+]/g, "")}`} className={cx("btn btn-sm text-white font-bold shrink-0", c.primary ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700")} aria-label={`Call ${c.name} ${c.number}`}>
                                <Phone size={13} />{c.number}
                              </a>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            {!configured ? <Badge color="#64748b">NOT CONFIGURED — set by municipality</Badge>
                              : c.verified ? <Badge color="#16a34a"><ShieldCheck size={11} />Verified</Badge> : <Badge color="#eab308">Unverified</Badge>}
                            {c.primary && <Badge color="#dc2626" solid>Primary</Badge>}
                            {canEdit && (
                              <button className="ml-auto p-1 rounded hover:bg-panel2 text-muted" aria-label={`Edit ${c.name}`}
                                onClick={() => setForm({ id: c.id, city: c.city, category: c.category, name: c.name, number: c.number || "", description: c.description || "", verified: !!c.verified, sort_order: c.sort_order ?? 100 })}>
                                <Pencil size={13} />
                              </button>
                            )}
                            {canDelete && !c.primary && (
                              <button className={cx("p-1 rounded hover:bg-panel2 text-red-600", !canEdit && "ml-auto")} aria-label={`Delete ${c.name}`} onClick={() => del(c)}><Trash2 size={13} /></button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Edit emergency contact" : "Add emergency contact"}>
        {form && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveContact(); }}>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="label">Scope</span>
                <select className="input py-1.5" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}>
                  <option value={city}>{pretty(city)} (local)</option>
                  <option value="national">National</option>
                </select>
              </label>
              <label className="block"><span className="label">Category</span>
                <select className="input py-1.5" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {[...new Set([form.category, ...CATEGORIES])].map((c) => <option key={c} value={c}>{pretty(c)}</option>)}
                </select>
              </label>
            </div>
            <label className="block"><span className="label">Name</span><input className="input" required maxLength={160} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="block"><span className="label">Number (leave empty if not yet configured)</span><input className="input" inputMode="tel" maxLength={60} value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></label>
            <label className="block"><span className="label">Description</span><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <div className="grid grid-cols-2 gap-3 items-end">
              <label className="block"><span className="label">Sort order</span><input className="input" type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} /></label>
              <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" className="accent-sky-500" checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} />Number verified</label>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving}>{saving && <Spinner size={14} className="text-current" />}Save</button>
            </div>
          </form>
        )}
      </Modal>
    </Section>
  );
}
