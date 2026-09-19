/* Citizen Flood Reports — submit (all roles), list + map, officer moderation. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Camera, CheckCircle2, Crosshair, Filter, ListChecks, LocateFixed, MapPin, Megaphone, Plus, ShieldCheck, X } from "lucide-react";
import { CircleMarker, Popup } from "react-leaflet";
import { useApp } from "@/context/AppContext";
import { useApi } from "@/hooks/useApi";
import { api, uploadUrl } from "@/lib/api";
import { Badge, Card, DataLabel, Empty, ErrorBox, Kpi, LevelBadge, Loading, Modal, PageHeader, Section, Spinner, cx } from "@/components/ui";
import { CityMap, FlyTo, Legend, MapOverlay, useMapStatic } from "@/components/map";
import { REPORT_STATUS_COLORS, depth, fmt, pretty } from "@/lib/format";
import { ImageAnalysisSummary, ImageResultPanel } from "@/components/citizen/ImageAnalysis";

const CONDITIONS = ["PASSABLE", "WATERLOGGED", "FLOODED", "BLOCKED", "IMPASSABLE"] as const;
const COND_COLORS: Record<string, string> = { PASSABLE: "#16a34a", WATERLOGGED: "#eab308", FLOODED: "#f97316", BLOCKED: "#dc2626", IMPASSABLE: "#9f1239" };
const STATUSES = ["VERIFIED", "UNVERIFIED", "UNDER_REVIEW", "RESOLVED"] as const;
const AGREE_COLORS: Record<string, string> = { AGREES: "#16a34a", REPORT_HIGHER: "#f97316", REPORT_LOWER: "#0ea5e9" };
const AGREE_TEXT: Record<string, string> = { AGREES: "Agrees with model", REPORT_HIGHER: "Report deeper than model", REPORT_LOWER: "Report shallower than model" };

export default function CitizenReports() {
  const { t, lang, city, hasRole, toast } = useApp();
  const st = useMapStatic();
  const [params, setParams] = useSearchParams();
  const canModerate = hasRole("ADMIN", "MUNICIPAL_OFFICER", "EMERGENCY_RESPONDER");
  const { data, error, loading, reload } = useApi<any>("/api/citizen-report");
  const [formOpen, setFormOpen] = useState(params.get("new") === "1");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const [moderating, setModerating] = useState<any>(null);
  const [lastResult, setLastResult] = useState<any>(null);

  useEffect(() => { if (params.get("new") === "1") setFormOpen(true); }, [params]);
  const closeForm = () => {
    setFormOpen(false);
    if (params.get("new")) { params.delete("new"); setParams(params, { replace: true }); }
  };

  const reports: any[] = data?.reports || [];
  const shown = statusFilter ? reports.filter((r) => r.status === statusFilter) : reports;
  const counts = data?.counts || {};

  return (
    <Section>
      <PageHeader icon={Megaphone} title={lang === "en" ? "Citizen Flood Reports" : t("reports_citizen")}
        subtitle="Ground-truth flood observations from residents, cross-checked against the FloodShield model. Reports are unverified until reviewed by an officer."
        labels={["USER_REPORTED_DATA", "MODEL_PREDICTION"]}
        actions={<button className="btn-primary" onClick={() => setFormOpen((o) => !o)}>{formOpen ? <X size={15} /> : <Plus size={15} />}{formOpen ? "Close form" : t("report_flood")}</button>} />

      {formOpen && (
        <ReportForm city={city} lang={lang} t={t} onClose={closeForm}
          onSubmitted={(r) => { setLastResult(r); toast({ kind: "success", title: t("report_sent") }); closeForm(); reload(); setFocus([r.lat, r.lon]); }} />
      )}

      {lastResult && (
        <Card className="mb-4" title={`Report #${lastResult.id} submitted`} icon={CheckCircle2}
          actions={<button aria-label="Dismiss" className="btn-ghost btn-sm" onClick={() => setLastResult(null)}><X size={13} /></button>}>
          <p className="text-sm mb-2">{t("report_sent")}</p>
          {lastResult.image_analysis ? (
            <div>
              <div className="text-xs font-semibold uppercase text-muted mb-2">Photo analysis (automatic, ESTIMATE)</div>
              <div className="grid md:grid-cols-[200px,1fr] gap-3">
                {lastResult.photo_url && <img src={uploadUrl(lastResult.photo_url)} alt="Submitted" className="rounded-lg border border-line max-h-40 object-cover" />}
                <ImageResultPanel r={lastResult.image_analysis} compact />
              </div>
            </div>
          ) : lastResult.photo_url ? <p className="text-xs text-muted">Photo received; automatic analysis was not available.</p> : null}
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {STATUSES.map((s) => (
          <Kpi key={s} label={pretty(s)} value={counts[s] ?? 0} color={REPORT_STATUS_COLORS[s]} icon={s === "VERIFIED" ? ShieldCheck : s === "RESOLVED" ? CheckCircle2 : ListChecks}
            sub={statusFilter === s ? "Filtered — click to clear" : "Click to filter"} onClick={() => setStatusFilter((f) => (f === s ? "" : s))} />
        ))}
      </div>

      <div className="grid xl:grid-cols-5 gap-4">
        <Card className="xl:col-span-3" title="Report map" icon={MapPin} subtitle="Reports coloured by moderation status">
          <div className="relative">
            <CityMap className="h-[360px] md:h-[520px]">
              {shown.map((r) => (
                <CircleMarker key={r.id} center={[r.lat, r.lon]} radius={8}
                  pathOptions={{ color: COND_COLORS[r.road_condition] || "#fff", weight: 3, fillColor: REPORT_STATUS_COLORS[r.status] || "#f59e0b", fillOpacity: 1 }}>
                  <Popup>
                    <div className="font-semibold">Report #{r.id} · {pretty(r.status)}</div>
                    <div>{pretty(r.road_condition)} · ~{fmt(r.estimated_depth_cm, 0)} cm (reported)</div>
                    {r.model_depth_m != null && <div>Model cross-check: {depth(r.model_depth_m)} · {AGREE_TEXT[r.model_agreement] || pretty(r.model_agreement)}</div>}
                    {r.description && <div className="mt-1">{r.description}</div>}
                    {r.photo_url && <img src={uploadUrl(r.photo_url)} alt="" className="mt-1 max-h-24 rounded" />}
                    <div className="text-[10px] mt-1 opacity-70">USER-REPORTED DATA · {new Date(r.created_at).toLocaleString()}</div>
                  </Popup>
                </CircleMarker>
              ))}
              <FlyTo center={focus} zoom={16} />
            </CityMap>
            <MapOverlay position="bottom-left" className="flex gap-2 items-end">
              <Legend title="Status (fill)" items={STATUSES.map((s) => ({ color: REPORT_STATUS_COLORS[s], label: pretty(s) }))} />
              <Legend title="Condition (ring)" items={CONDITIONS.map((c) => ({ color: COND_COLORS[c], label: pretty(c) }))} className="hidden sm:block" />
            </MapOverlay>
            <MapOverlay position="top-left"><DataLabel label="USER_REPORTED_DATA" className="bg-panel" /></MapOverlay>
          </div>
          {!st && <p className="text-xs text-muted mt-2">Loading map…</p>}
        </Card>

        <Card className="xl:col-span-2" title={`Reports (${shown.length})`} icon={ListChecks}
          subtitle={canModerate ? "All reports in this city — moderate below" : "Your reports and verified community reports"}
          actions={<>
            <label className="sr-only" htmlFor="status-filter">Filter by status</label>
            <div className="flex items-center gap-1"><Filter size={13} className="text-muted" />
              <select id="status-filter" className="input py-1 text-xs w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
              </select>
            </div>
          </>}
          bodyClass="max-h-[560px] overflow-auto scroll-thin">
          {error && !data ? <ErrorBox error={error} onRetry={reload} />
            : loading && !data ? <Loading />
            : shown.length === 0 ? <Empty text="No reports yet." />
            : (
              <ul className="space-y-2">
                {shown.map((r) => (
                  <li key={r.id} className="rounded-lg border border-line p-2.5" style={{ borderLeft: `4px solid ${REPORT_STATUS_COLORS[r.status] || "#64748b"}` }}>
                    <div className="flex gap-2.5">
                      {r.photo_url ? (
                        <a href={uploadUrl(r.photo_url)} target="_blank" rel="noreferrer" className="shrink-0">
                          <img src={uploadUrl(r.photo_url)} alt={`Report ${r.id} photo`} loading="lazy" className="h-16 w-20 object-cover rounded-md border border-line" />
                        </a>
                      ) : (
                        <div className="h-16 w-20 shrink-0 rounded-md border border-dashed border-line flex items-center justify-center text-muted"><Camera size={16} /></div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-sm font-semibold">#{r.id} · {pretty(r.road_condition)}</span>
                          <LevelBadge level={r.status} map={REPORT_STATUS_COLORS} />
                        </div>
                        <div className="text-xs text-muted">{new Date(r.created_at).toLocaleString()} · ~{fmt(r.estimated_depth_cm, 0)} cm reported · {r.language?.toUpperCase()}</div>
                        {r.description && <p className="text-sm mt-1 break-words">{r.description}</p>}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="text-muted">Model cross-check:</span>
                      <span className="font-semibold tabular-nums">{depth(r.model_depth_m)}</span>
                      {r.model_agreement && <Badge color={AGREE_COLORS[r.model_agreement] || "#64748b"}>{AGREE_TEXT[r.model_agreement] || pretty(r.model_agreement)}</Badge>}
                      <DataLabel label="MODEL_PREDICTION" />
                    </div>
                    {r.image_analysis && <div className="mt-1.5 rounded-md bg-panel2 border border-line p-1.5"><div className="text-[10px] uppercase text-muted font-semibold">Photo analysis</div><ImageAnalysisSummary r={r.image_analysis} /></div>}
                    {r.moderator_note && <div className="mt-1.5 text-xs"><b>Moderator note:</b> {r.moderator_note}</div>}
                    <div className="mt-2 flex gap-2">
                      <button className="btn-ghost btn-sm" onClick={() => setFocus([r.lat, r.lon])}><Crosshair size={12} />Show on map</button>
                      {canModerate && <button className="btn-ghost btn-sm" onClick={() => setModerating(r)}><ShieldCheck size={12} />Moderate</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </Card>
      </div>

      <ModerateModal report={moderating} onClose={() => setModerating(null)} onDone={() => { setModerating(null); reload(); }} />
    </Section>
  );
}

function ReportForm({ city, lang, t, onClose, onSubmitted }: {
  city: string; lang: string; t: (k: string) => string; onClose: () => void; onSubmitted: (r: any) => void;
}) {
  const st = useMapStatic();
  const [loc, setLoc] = useState<[number, number] | null>(null);
  const [depthCm, setDepthCm] = useState(20);
  const [cond, setCond] = useState<string>("WATERLOGGED");
  const [desc, setDesc] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!photo) { setPhotoUrl(null); return; } const u = URL.createObjectURL(photo); setPhotoUrl(u); return () => URL.revokeObjectURL(u); }, [photo]);

  const inCity = (lat: number, lon: number) => {
    if (!st) return true;
    const [s, w, n, e] = st.bbox;
    return lat >= s - 0.05 && lat <= n + 0.05 && lon >= w - 0.05 && lon <= e + 0.05;
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { setErr("Geolocation is not available on this device — tap the map instead."); return; }
    setLocating(true); setErr(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        const { latitude, longitude } = p.coords;
        if (!inCity(latitude, longitude)) { setErr("Your location is outside the selected city area — tap the map to set the flood location."); return; }
        setLoc([latitude, longitude]);
      },
      () => { setLocating(false); setErr("Could not get your location — tap the map instead."); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loc) { setErr(t("pick_on_map")); return; }
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.append("lat", String(loc[0]));
    fd.append("lon", String(loc[1]));
    fd.append("estimated_depth_cm", String(depthCm));
    fd.append("road_condition", cond);
    fd.append("description", desc.trim());
    fd.append("language", lang);
    fd.append("city", city);
    if (photo) fd.append("photo", photo, photo.name);
    try {
      const r = await api.form("/api/citizen-report", fd);
      onSubmitted(r);
    } catch (ex: any) { setErr(ex?.message || "Submission failed"); }
    finally { setBusy(false); }
  };

  const mapCenter = useMemo<[number, number] | null>(() => loc, [loc]);

  return (
    <Card className="mb-4" title={t("report_flood")} icon={Megaphone} actions={<><DataLabel label="USER_REPORTED_DATA" /><button aria-label="Close form" className="btn-ghost btn-sm" onClick={onClose}><X size={13} /></button></>}>
      <form onSubmit={submit} className="grid lg:grid-cols-2 gap-4">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
            <span className="label mb-0">{t("your_location")}</span>
            <button type="button" className="btn-ghost btn-sm" onClick={useMyLocation} disabled={locating}>
              {locating ? <Spinner size={12} /> : <LocateFixed size={13} />}{t("use_my_location")}
            </button>
          </div>
          <div className="relative">
            <CityMap className="h-[280px] md:h-[340px]" onClick={(lat, lon) => { setLoc([lat, lon]); setErr(null); }}>
              {loc && <CircleMarker center={loc} radius={10} pathOptions={{ color: "#fff", weight: 3, fillColor: "#f59e0b", fillOpacity: 1 }} />}
              <FlyTo center={mapCenter} zoom={16} />
            </CityMap>
            <MapOverlay position="top-center"><span className="chip bg-panel border border-line"><MapPin size={11} />{t("pick_on_map")}</span></MapOverlay>
          </div>
          <div className="text-xs text-muted mt-1 tabular-nums">{loc ? `${loc[0].toFixed(5)}, ${loc[1].toFixed(5)}` : "—"}</div>
        </div>
        <div className="space-y-3 min-w-0">
          <label className="block">
            <span className="label">{t("depth_estimate")}: <b className="text-ink tabular-nums">{depthCm} cm</b></span>
            <input type="range" min={0} max={200} step={5} value={depthCm} onChange={(e) => setDepthCm(Number(e.target.value))} className="w-full accent-sky-500" aria-label={t("depth_estimate")} />
            <div className="flex justify-between text-[10px] text-muted"><span>0</span><span>ankle ~10</span><span>knee ~45</span><span>waist ~100</span><span>200</span></div>
          </label>
          <fieldset>
            <legend className="label">{t("road_condition")}</legend>
            <div className="flex flex-wrap gap-1.5">
              {CONDITIONS.map((c) => (
                <button key={c} type="button" aria-pressed={cond === c} onClick={() => setCond(c)}
                  className={cx("rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors", cond === c ? "text-white" : "border-line text-muted hover:text-ink")}
                  style={cond === c ? { background: COND_COLORS[c], borderColor: COND_COLORS[c] } : undefined}>
                  {pretty(c)}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className="label">{t("description")}</span>
            <textarea className="input min-h-[80px]" maxLength={2000} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Water knee-deep near the bus stop, two-wheelers stalled" />
          </label>
          <div>
            <span className="label">{t("photo")}</span>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" aria-label={t("photo")}
              onChange={(e) => { setPhoto(e.target.files?.[0] || null); e.target.value = ""; }} />
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()}><Camera size={13} />{photo ? "Change photo" : "Add photo"}</button>
              {photoUrl && <img src={photoUrl} alt="Selected" className="h-12 w-16 object-cover rounded border border-line" />}
              {photo && <button type="button" aria-label="Remove photo" className="btn-ghost btn-sm" onClick={() => setPhoto(null)}><X size={12} /></button>}
            </div>
            <p className="text-[11px] text-muted mt-1">A photo is automatically analysed for water coverage and depth (estimate only).</p>
          </div>
          {err && <ErrorBox error={err} />}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary flex-1 sm:flex-none" disabled={busy || !loc}>{busy && <Spinner size={14} className="text-current" />}{t("submit")}</button>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </form>
    </Card>
  );
}

function ModerateModal({ report, onClose, onDone }: { report: any; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [status, setStatus] = useState("UNDER_REVIEW");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (report) { setStatus(report.status === "UNVERIFIED" ? "VERIFIED" : report.status); setNote(report.moderator_note || ""); } }, [report]);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/citizen-report/${report.id}`, { status, note });
      toast({ kind: "success", title: `Report #${report.id} → ${pretty(status)}` });
      onDone();
    } catch (e: any) { toast({ kind: "error", title: "Moderation failed", body: e?.message }); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={!!report} onClose={onClose} title={report ? `Moderate report #${report.id}` : ""}>
      {report && (
        <div className="space-y-3">
          <div className="text-sm">
            <div><b>{pretty(report.road_condition)}</b> · ~{fmt(report.estimated_depth_cm, 0)} cm reported · model {depth(report.model_depth_m)}</div>
            {report.description && <p className="text-muted mt-1">{report.description}</p>}
          </div>
          {report.photo_url && <img src={uploadUrl(report.photo_url)} alt="" className="max-h-48 rounded-lg border border-line" />}
          <fieldset>
            <legend className="label">New status</legend>
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map((s) => (
                <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}
                  className={cx("rounded-lg border px-2.5 py-1.5 text-xs font-semibold", status === s ? "text-white" : "border-line text-muted")}
                  style={status === s ? { background: REPORT_STATUS_COLORS[s], borderColor: REPORT_STATUS_COLORS[s] } : undefined}>{pretty(s)}</button>
              ))}
            </div>
          </fieldset>
          <label className="block"><span className="label">Moderator note</span>
            <textarea className="input min-h-[70px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Confirmed by field team; drain desilting scheduled" />
          </label>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={busy}>{busy && <Spinner size={14} className="text-current" />}Save</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
