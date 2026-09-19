/* GIS map primitives (React-Leaflet). Grid layers are rendered to a canvas image overlay
   for performance; vector layers use Leaflet's canvas renderer. */
import React, { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CircleMarker, ImageOverlay, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { api } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { DRAIN_COLORS, FACILITY_STATUS_COLORS, PASSABILITY_COLORS, REPORT_STATUS_COLORS, RISK_COLORS, depth, pct, pretty } from "@/lib/format";
import { cx } from "@/components/ui";

export type Cell = [number, number, number, ...number[]];
export interface MapStatic {
  city: string; name: string; center: [number, number]; bbox: [number, number, number, number]; rows: number; cols: number; cell_m: number;
  wards: { id: string; name: string; center: [number, number] }[];
  roads: { id: string; name: string; street: string; ward: string; road_class: string; coords: [number, number][]; underpass: boolean; from: string; to: string }[];
  junctions: { id: string; lat: number; lon: number; ward: string; elevation_m: number }[];
  drain_nodes: { id: string; kind: string; lat: number; lon: number; ward: string }[];
  drain_edges: { id: string; from: string; to: string; coords: [number, number][]; diameter_m: number; conduit: string }[];
  infrastructure: { id: string; kind: string; name: string; lat: number; lon: number; ward: string; road_node: string; capacity: number; critical: boolean }[];
  cctv: { id: string; name: string; lat: number; lon: number; ward: string; note: string }[];
  river_cells: [number, number][];
}

const staticCache = new Map<string, Promise<MapStatic>>();
export function useMapStatic() {
  const { city } = useApp();
  const [data, setData] = useState<MapStatic | null>(null);
  useEffect(() => {
    let alive = true;
    if (!staticCache.has(city)) staticCache.set(city, api.get<MapStatic>(`/api/map/static?city=${city}`).catch((e) => { staticCache.delete(city); throw e; }));
    staticCache.get(city)!.then((d) => alive && setData(d)).catch(() => {});
    return () => { alive = false; };
  }, [city]);
  return data;
}

export const bboxBounds = (b: [number, number, number, number]): L.LatLngBoundsExpression => [[b[0], b[1]], [b[2], b[3]]];
export function cellToLatLng(bbox: [number, number, number, number], rows: number, cols: number, r: number, c: number): [number, number] {
  const [s, w, n, e] = bbox;
  return [n - (r + 0.5) * (n - s) / rows, w + (c + 0.5) * (e - w) / cols];
}
export function latLngToCell(bbox: [number, number, number, number], rows: number, cols: number, lat: number, lon: number): [number, number] {
  const [s, w, n, e] = bbox;
  return [Math.floor((n - lat) / (n - s) * rows), Math.floor((lon - w) / (e - w) * cols)];
}

/* ---------------- base map ---------------- */
export function CityMap({ children, className, bbox, onClick, zoomControl = true, scrollWheelZoom = true }: {
  children?: React.ReactNode; className?: string; bbox?: [number, number, number, number]; onClick?: (lat: number, lon: number) => void;
  zoomControl?: boolean; scrollWheelZoom?: boolean;
}) {
  const { theme } = useApp();
  const st = useMapStatic();
  const b = bbox || st?.bbox;
  if (!b) return <div className={cx("rounded-xl bg-panel2 animate-pulse", className)} />;
  const tiles = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  return (
    <div className={cx("relative overflow-hidden rounded-xl border border-line", className)}>
      <MapContainer bounds={bboxBounds(b)} className="h-full w-full" zoomControl={zoomControl} scrollWheelZoom={scrollWheelZoom} attributionControl>
        <TileLayer url={tiles} attribution='&copy; OpenStreetMap contributors' maxZoom={19} className={theme === "dark" ? "fs-dark-tiles" : "fs-light-tiles"} />
        <FitTo bbox={b} />
        {onClick && <ClickHandler onClick={onClick} />}
        {children}
      </MapContainer>
    </div>
  );
}

function FitTo({ bbox }: { bbox: [number, number, number, number] }) {
  const map = useMap();
  const key = bbox.join(",");
  useEffect(() => { map.fitBounds(bboxBounds(bbox), { padding: [10, 10] }); }, [key]); // eslint-disable-line
  return null;
}
function ClickHandler({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}
export function FlyTo({ center, zoom = 15 }: { center?: [number, number] | null; zoom?: number }) {
  const map = useMap();
  useEffect(() => { if (center) map.flyTo(center, zoom, { duration: 0.6 }); }, [center?.[0], center?.[1]]); // eslint-disable-line
  return null;
}

/* ---------------- grid overlay ---------------- */
export function GridOverlay({ cells, rows, cols, bbox, color, opacity = 0.65, smooth = false, zIndex = 300 }: {
  cells: Cell[] | undefined | null; rows: number; cols: number; bbox: [number, number, number, number];
  color: (v: number) => [number, number, number, number]; opacity?: number; smooth?: boolean; zIndex?: number;
}) {
  const url = useMemo(() => {
    if (!cells || !cells.length) return null;
    const cv = document.createElement("canvas");
    cv.width = cols; cv.height = rows;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(cols, rows);
    for (const cell of cells) {
      const [r, c, v] = cell;
      const [R, G, B, A] = color(v);
      const i = (r * cols + c) * 4;
      img.data[i] = R; img.data[i + 1] = G; img.data[i + 2] = B; img.data[i + 3] = A;
    }
    ctx.putImageData(img, 0, 0);
    if (!smooth) return cv.toDataURL();
    const big = document.createElement("canvas");
    big.width = cols * 8; big.height = rows * 8;
    const bctx = big.getContext("2d")!;
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = "high";
    bctx.drawImage(cv, 0, 0, big.width, big.height);
    return big.toDataURL();
  }, [cells, rows, cols, color, smooth]);
  if (!url) return null;
  return <ImageOverlay url={url} bounds={bboxBounds(bbox)} opacity={opacity} zIndex={zIndex} className={smooth ? "" : "pixelated"} />;
}

/* ---------------- vector layers ---------------- */
export interface RoadStatus { id: string; depth_m?: number; risk_level?: string; passability?: string | null; closed?: boolean; time_to_flood_min?: number | null; probability_60?: number }
export type RoadColorBy = "depth" | "risk" | "passability" | "none";

export function depthColor(d: number) {
  if (d < 0.05) return "#16a34a";
  if (d < 0.15) return "#84cc16";
  if (d < 0.3) return "#eab308";
  if (d < 0.5) return "#f97316";
  return "#dc2626";
}

export function RoadsLayer({ roads, status, colorBy = "depth", onSelect, highlight, weight = 1 }: {
  roads: MapStatic["roads"]; status?: Record<string, RoadStatus>; colorBy?: RoadColorBy; onSelect?: (id: string) => void;
  highlight?: string | null; weight?: number;
}) {
  return (
    <>
      {roads.map((r) => {
        const s = status?.[r.id];
        let col = "#64748b";
        if (s && colorBy === "depth") col = depthColor(s.depth_m ?? 0);
        if (s && colorBy === "risk") col = RISK_COLORS[s.risk_level || "LOW"];
        if (s && colorBy === "passability") col = PASSABILITY_COLORS[s.passability || "PASSABLE"] || depthColor(s.depth_m ?? 0);
        const w = (r.road_class === "arterial" ? 5 : r.road_class === "collector" ? 3.5 : 2.5) * weight;
        return (
          <Polyline key={r.id} positions={r.coords} pathOptions={{ color: highlight === r.id ? "#22d3ee" : col, weight: highlight === r.id ? w + 3 : w, opacity: 0.9, dashArray: s?.closed ? "6 6" : undefined }}
            eventHandlers={onSelect ? { click: () => onSelect(r.id) } : undefined}>
            <Tooltip sticky>
              <div className="font-semibold">{r.name}</div>
              {s && <div>Depth {depth(s.depth_m)} · Risk {pretty(s.risk_level)}{s.closed ? " · CLOSED" : ""}</div>}
              {r.underpass && <div className="text-amber-500">Underpass</div>}
            </Tooltip>
          </Polyline>
        );
      })}
    </>
  );
}

export function DrainsLayer({ st, status, showEdges = true, showNodes = true, onSelect, nodeFilter }: {
  st: MapStatic; status?: Record<string, { status: string; utilization: number }>; showEdges?: boolean; showNodes?: boolean;
  onSelect?: (id: string) => void; nodeFilter?: (id: string) => boolean;
}) {
  return (
    <>
      {showEdges && st.drain_edges.map((e) => {
        const s = status?.[e.from];
        return <Polyline key={e.id} positions={e.coords} pathOptions={{ color: s ? DRAIN_COLORS[s.status] : "#38bdf8", weight: Math.max(1.5, e.diameter_m * 2.2), opacity: 0.75 }} />;
      })}
      {showNodes && st.drain_nodes.filter((n) => !nodeFilter || nodeFilter(n.id)).map((n) => {
        const s = status?.[n.id];
        const col = n.kind === "outfall" ? "#0ea5e9" : s ? DRAIN_COLORS[s.status] : "#38bdf8";
        return (
          <CircleMarker key={n.id} center={[n.lat, n.lon]} radius={n.kind === "outfall" ? 7 : n.kind === "inlet" ? 3 : 4.5}
            pathOptions={{ color: "#0f172a", weight: 1, fillColor: col, fillOpacity: 0.95 }}
            eventHandlers={onSelect ? { click: () => onSelect(n.id) } : undefined}>
            <Tooltip>
              <div className="font-semibold">{n.id} · {pretty(n.kind)}</div>
              {s && <div>{pretty(s.status)} · {pct(s.utilization)} utilisation</div>}
              <div className="text-muted">{n.ward}</div>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}

const FAC_GLYPH: Record<string, string> = {
  hospital: "H", police: "P", fire_station: "F", school: "S", railway_station: "R", bus_terminal: "B", shelter: "⌂", substation: "⚡", government: "G",
};
export function facilityIcon(kind: string, color: string, size = 22) {
  return L.divIcon({
    className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2],
    html: `<div class="fs-marker" style="width:${size}px;height:${size}px;background:${color}">${FAC_GLYPH[kind] || "•"}</div>`,
  });
}

export function FacilitiesLayer({ st, status, kinds, onSelect }: {
  st: MapStatic; status?: Record<string, { status: string; risk_level?: string }>; kinds?: Set<string>; onSelect?: (id: string) => void;
}) {
  return (
    <>
      {st.infrastructure.filter((f) => !kinds || kinds.has(f.kind)).map((f) => {
        const s = status?.[f.id];
        const col = s ? FACILITY_STATUS_COLORS[s.status] || "#16a34a" : "#0ea5e9";
        return (
          <Marker key={f.id} position={[f.lat, f.lon]} icon={facilityIcon(f.kind, col, f.kind === "hospital" ? 24 : 20)}
            eventHandlers={onSelect ? { click: () => onSelect(f.id) } : undefined}>
            <Tooltip direction="top" offset={[0, -10]}>
              <div className="font-semibold">{f.name}</div>
              <div>{pretty(f.kind)}{s ? ` · ${pretty(s.status)}` : ""}</div>
              <div className="text-[10px] opacity-70">Facility location: DEMO DATA</div>
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
}

export function CctvLayer({ st }: { st: MapStatic }) {
  return (
    <>
      {st.cctv.map((c) => (
        <Marker key={c.id} position={[c.lat, c.lon]} icon={L.divIcon({ className: "", iconSize: [20, 20], iconAnchor: [10, 10], html: `<div class="fs-marker" style="width:20px;height:20px;background:#7c3aed">◉</div>` })}>
          <Popup><div className="font-semibold">{c.id} · {c.name}</div><div className="text-xs mt-1">{c.note}</div></Popup>
        </Marker>
      ))}
    </>
  );
}

export function ReportsLayer({ reports }: { reports: any[] }) {
  return (
    <>
      {reports.map((r) => (
        <CircleMarker key={r.id} center={[r.lat, r.lon]} radius={7} pathOptions={{ color: "#fff", weight: 2, fillColor: REPORT_STATUS_COLORS[r.status] || "#f59e0b", fillOpacity: 1 }}>
          <Popup>
            <div className="font-semibold">Citizen report #{r.id} · {pretty(r.status)}</div>
            <div>{pretty(r.road_condition)} · ~{r.estimated_depth_cm} cm (reported)</div>
            {r.description && <div className="mt-1">{r.description}</div>}
            <div className="text-[10px] mt-1 opacity-70">USER-REPORTED DATA</div>
          </Popup>
        </CircleMarker>
      ))}
    </>
  );
}

/* ---------------- legend & layer panel ---------------- */
export function Legend({ title, items, className }: { title: string; items: { color: string; label: string }[]; className?: string }) {
  return (
    <div className={cx("rounded-lg border border-line bg-panel/95 backdrop-blur px-2.5 py-2 text-[11px] shadow-card", className)}>
      <div className="font-semibold text-muted uppercase tracking-wide mb-1">{title}</div>
      <div className="space-y-0.5">
        {items.map((i) => <div key={i.label} className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm" style={{ background: i.color }} />{i.label}</div>)}
      </div>
    </div>
  );
}

export const LEGENDS = {
  depth: [{ color: "#bae6fd", label: "< 10 cm" }, { color: "#38bdf8", label: "10–30 cm" }, { color: "#2563eb", label: "30–50 cm" }, { color: "#1e40af", label: "50–80 cm" }, { color: "#581c87", label: "> 80 cm" }],
  rain: [{ color: "#bfdbfe", label: "< 10 mm/hr" }, { color: "#2563eb", label: "30 mm/hr" }, { color: "#7c3aed", label: "60 mm/hr" }, { color: "#db2777", label: "100 mm/hr" }, { color: "#dc2626", label: "≥ 150 mm/hr" }],
  roadDepth: [{ color: "#16a34a", label: "Dry < 5 cm" }, { color: "#84cc16", label: "5–15 cm" }, { color: "#eab308", label: "15–30 cm" }, { color: "#f97316", label: "30–50 cm" }, { color: "#dc2626", label: "> 50 cm" }],
  risk: Object.entries(RISK_COLORS).map(([k, v]) => ({ color: v, label: pretty(k) })),
  drain: Object.entries(DRAIN_COLORS).map(([k, v]) => ({ color: v, label: pretty(k) })),
  facility: Object.entries(FACILITY_STATUS_COLORS).map(([k, v]) => ({ color: v, label: pretty(k) })),
  probability: [{ color: "#fef08a", label: "10–40%" }, { color: "#fbbf24", label: "40–70%" }, { color: "#f97316", label: "70–90%" }, { color: "#dc2626", label: "> 90%" }],
};

export function LayerPanel({ groups, value, onChange, className }: {
  groups: { title: string; layers: { key: string; label: string }[] }[]; value: Set<string>; onChange: (s: Set<string>) => void; className?: string;
}) {
  const toggle = (k: string) => { const s = new Set(value); s.has(k) ? s.delete(k) : s.add(k); onChange(s); };
  return (
    <div className={cx("space-y-3 text-sm", className)}>
      {groups.map((g) => (
        <div key={g.title}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">{g.title}</div>
          <div className="space-y-0.5">
            {g.layers.map((l) => (
              <label key={l.key} className="flex items-center gap-2 cursor-pointer rounded px-1 py-0.5 hover:bg-panel2">
                <input type="checkbox" className="accent-sky-500" checked={value.has(l.key)} onChange={() => toggle(l.key)} />
                <span>{l.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export const HORIZON_OPTIONS = [0, 15, 30, 45, 60, 90, 120, 180];
export function HorizonBar({ value, onChange, className }: { value: number; onChange: (h: number) => void; className?: string }) {
  return (
    <div className={cx("inline-flex flex-wrap gap-1 rounded-lg border border-line bg-panel/95 backdrop-blur p-1", className)} role="radiogroup" aria-label="Forecast horizon">
      {HORIZON_OPTIONS.map((h) => (
        <button key={h} role="radio" aria-checked={value === h} onClick={() => onChange(h)}
          className={cx("rounded-md px-2 py-1 text-xs font-semibold tabular-nums", value === h ? "bg-brand text-white dark:text-slate-900" : "text-muted hover:text-ink")}>
          {h === 0 ? "NOW" : `+${h}`}
        </button>
      ))}
    </div>
  );
}

/* Map overlay container positioned over the map */
export function MapOverlay({ children, position = "top-right", className }: { children: React.ReactNode; position?: "top-right" | "top-left" | "bottom-left" | "bottom-right" | "top-center"; className?: string }) {
  const pos = { "top-right": "top-2 right-2", "top-left": "top-2 left-12", "bottom-left": "bottom-6 left-2", "bottom-right": "bottom-6 right-2", "top-center": "top-2 left-1/2 -translate-x-1/2" }[position];
  return <div className={cx("absolute z-[500] pointer-events-auto", pos, className)}>{children}</div>;
}
