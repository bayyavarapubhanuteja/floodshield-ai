/* CCTV & Flood Image Analysis — software-only analysis of UPLOADED images and RECORDED videos. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Film, History, ImageIcon, Info, MapPin, Sparkles, Upload, Video } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Legend as RLegend, Line, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { CircleMarker, Popup, Tooltip as LTooltip } from "react-leaflet";
import { useApp } from "@/context/AppContext";
import { useApi } from "@/hooks/useApi";
import { api, request, uploadUrl } from "@/lib/api";
import { Badge, Card, DataLabel, Empty, ErrorBox, Loading, PageHeader, Section, Spinner, Stat, Tabs } from "@/components/ui";
import { CctvLayer, CityMap, Legend, MapOverlay, useMapStatic } from "@/components/map";
import { depth, fmt, pretty } from "@/lib/format";
import { DetectionPreview, ImageResultPanel, SEVERITY_COLORS } from "@/components/citizen/ImageAnalysis";

const tooltipStyle = { background: "rgb(var(--panel))", border: "1px solid rgb(var(--line))", borderRadius: 8, fontSize: 12 };
const IMG_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VID_TYPES = ["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm"];
const TREND_COLORS: Record<string, string> = { RISING: "#dc2626", STABLE: "#eab308", RECEDING: "#16a34a" };

export default function Cctv() {
  const { city, isOfficer, toast } = useApp();
  const st = useMapStatic();
  const { data, error, loading, reload } = useApi<any>("/api/cctv", { live: false });
  const [mode, setMode] = useState<"image" | "video">("image");
  const [camId, setCamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [imgResult, setImgResult] = useState<any>(null);
  const [vidResult, setVidResult] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const cameras: any[] = st?.cctv || data?.cameras || [];
  const cam = cameras.find((c) => c.id === camId);
  useEffect(() => () => { if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview); }, [preview]);

  const buildForm = (file: File) => {
    const fd = new FormData();
    fd.append("file", file, file.name || "upload.jpg");
    fd.append("city", city);
    if (cam) { fd.append("camera_id", cam.id); fd.append("lat", String(cam.lat)); fd.append("lon", String(cam.lon)); }
    return fd;
  };

  const analyseImage = async (file: File) => {
    if (file.type && !IMG_TYPES.includes(file.type)) { setErr("Unsupported image type — use JPEG, PNG or WebP."); return; }
    setErr(null); setBusy(true); setVidResult(null); setImgResult(null);
    setPreview(URL.createObjectURL(file));
    try {
      const r = await api.form("/api/image-analysis", buildForm(file));
      setImgResult(r);
      toast({ kind: r.severity === "HIGH" || r.severity === "CRITICAL" ? "alert" : "success", title: `Image analysed — severity ${r.severity}`, body: `${r.estimated_depth_band} (estimate)` });
      reload();
    } catch (e: any) { setErr(e?.message || "Analysis failed"); }
    finally { setBusy(false); }
  };

  const analyseVideo = async (file: File) => {
    if (!isOfficer) { setErr("Video analysis is available to officer roles only."); return; }
    if (file.type && !VID_TYPES.includes(file.type)) { setErr("Unsupported video type — use MP4, MOV, AVI or WebM."); return; }
    setErr(null); setBusy(true); setImgResult(null); setVidResult(null); setPreview(null);
    try {
      const r = await api.form("/api/video-analysis", buildForm(file));
      setVidResult(r);
      toast({ kind: "success", title: `Video analysed — ${r.frames_analysed} frames`, body: `Trend ${r.water_trend}, worst severity ${r.severity}` });
      reload();
    } catch (e: any) { setErr(e?.message || "Video analysis failed"); }
    finally { setBusy(false); }
  };

  const trySample = async (kind: "flooded" | "dry") => {
    setErr(null); setBusy(true);
    let file: File;
    try {
      const res = await request<Response>(`/api/cctv/sample?kind=${kind}`, { raw: true });
      file = new File([await res.blob()], `sample_${kind}.jpg`, { type: "image/jpeg" });
    } catch (e: any) { setErr(e?.message || "Could not load sample image"); setBusy(false); return; }
    await analyseImage(file);
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (mode === "image") analyseImage(f); else analyseVideo(f);
  };

  const events: any[] = data?.events || [];

  return (
    <Section>
      <PageHeader icon={Camera} title="CCTV & Flood Image Analysis"
        subtitle="Computer-vision flood assessment of uploaded street images and recorded video clips: water coverage, depth band, vehicles and road passability."
        labels={["USER_REPORTED_DATA", "DEMO_DATA"]} />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
        <Info size={16} className="mt-0.5 shrink-0 text-sky-500" />
        <div>
          <b>Software-only analysis — no live CCTV hardware.</b> This module analyses <b>UPLOADED images</b> and <b>RECORDED videos</b> only.
          Camera locations are analysis locations used to geotag footage. All depth and severity values are computer-vision <b>estimates</b>, not measurements.
        </div>
      </div>

      <div className="grid xl:grid-cols-3 gap-4 mb-4">
        <Card className="xl:col-span-2" title="Analyse footage" icon={Upload}
          actions={<Tabs value={mode} onChange={(m) => { setMode(m); setErr(null); }} tabs={[{ key: "image", label: "Image", icon: ImageIcon }, { key: "video", label: "Recorded video", icon: Film }]} />}>
          <div className="grid sm:grid-cols-2 gap-3 mb-2">
            <label className="block">
              <span className="label">Camera / analysis location (optional)</span>
              <select className="input py-1.5" value={camId} onChange={(e) => setCamId(e.target.value)}>
                <option value="">No location (untagged)</option>
                {cameras.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.name}{c.ward ? ` (${c.ward})` : ""}</option>)}
              </select>
            </label>
            <div className="flex items-end gap-2 flex-wrap">
              <input ref={fileRef} type="file" className="hidden" aria-label={mode === "image" ? "Upload image" : "Upload video"}
                accept={mode === "image" ? ".jpg,.jpeg,.png,.webp," + IMG_TYPES.join(",") : ".mp4,.mov,.avi,.webm," + VID_TYPES.join(",")} onChange={onFile} />
              <button className="btn-primary" disabled={busy || (mode === "video" && !isOfficer)} onClick={() => fileRef.current?.click()}>
                {busy ? <Spinner size={14} className="text-current" /> : mode === "image" ? <ImageIcon size={15} /> : <Video size={15} />}
                {mode === "image" ? "Upload image" : "Upload video"}
              </button>
              {mode === "image" && (
                <>
                  <button className="btn-ghost btn-sm" disabled={busy} onClick={() => trySample("flooded")}><Sparkles size={13} />Try sample (flooded)</button>
                  <button className="btn-ghost btn-sm" disabled={busy} onClick={() => trySample("dry")}><Sparkles size={13} />Try sample (dry)</button>
                </>
              )}
            </div>
          </div>
          <p className="text-xs text-muted mb-3">
            {mode === "image" ? "Accepted: JPEG, PNG, WebP. Sample images are synthetic (SIMULATED) street scenes for demonstrating the pipeline."
              : isOfficer ? "Accepted: MP4, MOV, AVI, WebM recordings. Up to 24 frames are sampled across the clip."
                : "Video analysis is restricted to officer roles (municipal, emergency, analyst, admin)."}
          </p>
          {err && <div className="mb-3"><ErrorBox error={err} /></div>}
          {busy && <Loading text={mode === "image" ? "Running water segmentation & vehicle detection…" : "Sampling frames and analysing video…"} />}

          {!busy && imgResult && (
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="min-w-0">
                {preview && <DetectionPreview src={preview} detections={imgResult.detections} />}
                <div className="text-[11px] text-muted mt-1 flex flex-wrap gap-3">
                  <span className="flex items-center gap-1"><span className="h-2 w-3 border-2 border-yellow-400" />Detection</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-3 border-2 border-red-600" />Lower part in water</span>
                  {imgResult.camera_id && <span>Location: {imgResult.camera_id}</span>}
                </div>
              </div>
              <ImageResultPanel r={imgResult} />
            </div>
          )}
          {!busy && vidResult && <VideoResult r={vidResult} />}
          {!busy && !imgResult && !vidResult && !err && <Empty icon={Camera} text="Upload footage or try a sample image to run the analysis." />}
        </Card>

        <Card title="Camera locations & events" icon={MapPin} subtitle="Analysis locations (no live feed) and geotagged results">
          <div className="relative">
            <CityMap className="h-[340px] sm:h-[400px]">
              {st && <CctvLayer st={st} />}
              {events.filter((e) => e.lat != null && e.lon != null).map((e) => (
                <CircleMarker key={e.id} center={[e.lat, e.lon]} radius={9}
                  pathOptions={{ color: "#fff", weight: 2, fillColor: SEVERITY_COLORS[e.severity] || "#64748b", fillOpacity: 0.95 }}>
                  <LTooltip>{pretty(e.media_type)} · {e.severity} · {depth(e.estimated_depth_m)} (est.)</LTooltip>
                  <Popup>
                    <div className="font-semibold">{pretty(e.media_type)} analysis #{e.id}</div>
                    <div>Severity {e.severity} · depth ≈ {depth(e.estimated_depth_m)} (ESTIMATE)</div>
                    <div className="text-[10px] opacity-70 mt-1">{new Date(e.ts).toLocaleString()} · USER-REPORTED DATA</div>
                  </Popup>
                </CircleMarker>
              ))}
            </CityMap>
            <MapOverlay position="bottom-left">
              <Legend title="Analysis severity" items={[{ color: "#7c3aed", label: "Camera location" }, ...Object.entries(SEVERITY_COLORS).map(([k, v]) => ({ color: v, label: pretty(k) }))]} />
            </MapOverlay>
            <MapOverlay position="top-left"><DataLabel label="USER_REPORTED_DATA" className="bg-panel" /></MapOverlay>
          </div>
        </Card>
      </div>

      <Card title={`Analysis history (${events.length})`} icon={History} actions={<DataLabel label="USER_REPORTED_DATA" />} bodyClass="px-0 pb-0 overflow-x-auto scroll-thin max-h-[460px]">
        {error && !data ? <div className="p-4"><ErrorBox error={error} onRetry={reload} /></div>
          : loading && !data ? <Loading />
          : events.length === 0 ? <Empty text="No analyses yet for this city." />
          : (
            <table className="table">
              <thead><tr><th>#</th><th>When</th><th>Media</th><th>Location</th><th>Severity</th><th>Depth (est.)</th><th>Water</th><th>Vehicles</th><th>Road</th><th>Preview</th></tr></thead>
              <tbody>
                {events.map((e) => {
                  const r = e.result || {};
                  const near = e.lat != null ? cameras.find((c) => Math.abs(c.lat - e.lat) < 1e-5 && Math.abs(c.lon - e.lon) < 1e-5) : null;
                  const blocked = r.road_blocked ?? r.road_blocked_any;
                  return (
                    <tr key={e.id}>
                      <td className="tabular-nums">{e.id}</td>
                      <td className="whitespace-nowrap text-xs">{new Date(e.ts).toLocaleString()}</td>
                      <td>{e.media_type === "video" ? <Badge color="#6366f1"><Film size={11} />Video</Badge> : <Badge color="#0ea5e9"><ImageIcon size={11} />Image</Badge>}</td>
                      <td className="text-xs">{near ? `${near.id} · ${near.name}` : e.lat != null ? `${fmt(e.lat, 4)}, ${fmt(e.lon, 4)}` : <span className="text-muted">Untagged</span>}</td>
                      <td><Badge color={SEVERITY_COLORS[e.severity] || "#64748b"}>{e.severity || "—"}</Badge></td>
                      <td className="tabular-nums whitespace-nowrap">{depth(e.estimated_depth_m)}</td>
                      <td className="tabular-nums">{r.water_coverage_pct != null ? `${fmt(r.water_coverage_pct, 0)}%` : r.water_trend ? pretty(r.water_trend) : "—"}</td>
                      <td className="tabular-nums">{r.vehicles_detected ?? r.max_vehicles ?? "—"}</td>
                      <td className="text-xs">{blocked ? <span className="text-red-500 font-semibold">Blocked</span> : "Open"}</td>
                      <td>{e.media_type === "image"
                        ? <a href={uploadUrl(e.file_url)} target="_blank" rel="noreferrer"><img src={uploadUrl(e.file_url)} alt={`Analysis ${e.id}`} className="h-10 w-16 object-cover rounded border border-line" loading="lazy" /></a>
                        : <span className="text-xs text-muted">{r.frames_analysed} frames</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </Card>
    </Section>
  );
}

function VideoResult({ r }: { r: any }) {
  const chart = useMemo(() => (r.timeline || []).map((f: any) => ({ t: f.t_sec, cov: f.water_coverage_pct, depth: Math.round(f.estimated_depth_m * 100), veh: f.vehicles_detected })), [r]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge color={SEVERITY_COLORS[r.severity] || "#64748b"} solid>Worst severity: {r.severity}</Badge>
        <Badge color={TREND_COLORS[r.water_trend] || "#64748b"}>Water trend: {r.water_trend}</Badge>
        <DataLabel label={r.data_label || "USER_REPORTED_DATA"} />
        <Badge color="#f59e0b">ESTIMATE</Badge>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Stat label="Frames analysed" value={r.frames_analysed} />
        <Stat label="Duration" value={`${fmt(r.duration_sec, 1)} s`} />
        <Stat label="Max depth (est.)" value={depth(r.max_estimated_depth_m)} />
        <Stat label="Max vehicles" value={r.max_vehicles} />
        <Stat label="Road blocked" value={<span style={{ color: r.road_blocked_any ? "#dc2626" : "#16a34a" }}>{r.road_blocked_any ? "Yes (some frames)" : "No"}</span>} />
      </div>
      <div className="h-60">
        <ResponsiveContainer>
          <ComposedChart data={chart} margin={{ left: -10, right: 8, top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" />
            <XAxis dataKey="t" tickFormatter={(v) => `${v}s`} fontSize={11} stroke="rgb(var(--muted))" />
            <YAxis yAxisId="l" fontSize={11} stroke="rgb(var(--muted))" unit="%" domain={[0, 100]} />
            <YAxis yAxisId="r" orientation="right" fontSize={11} stroke="rgb(var(--muted))" unit="cm" />
            <RTooltip contentStyle={tooltipStyle} labelFormatter={(v) => `t = ${v} s`} />
            <RLegend wrapperStyle={{ fontSize: 11 }} />
            <Area yAxisId="l" dataKey="cov" name="Water coverage %" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.2} />
            <Line yAxisId="r" dataKey="depth" name="Est. depth cm (ESTIMATE)" stroke="#7c3aed" strokeWidth={2} dot={{ r: 2 }} type="stepAfter" />
            <Line yAxisId="l" dataKey="veh" name="Vehicles" stroke="#f97316" strokeDasharray="4 3" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">{r.disclaimer}</p>
    </div>
  );
}
