/* Small helpers shared by the operations pages (routing, emergency, incidents, what-if…). */
import L from "leaflet";
import { MapStatic } from "@/components/map";

export const tooltipStyle = { background: "rgb(var(--panel))", border: "1px solid rgb(var(--line))", borderRadius: 8, fontSize: 12 };

/** Items from the backend are sometimes plain ids, sometimes {id,name,...} objects. */
export const nameOf = (x: any): string => (typeof x === "string" ? x : x?.name || x?.id || "—");

export function inBbox(b: MapStatic["bbox"] | undefined, lat: number, lon: number) {
  if (!b) return false;
  return lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3];
}

/** Backend timestamps without a zone are UTC. */
export function parseTs(iso?: string | null): Date | null {
  if (!iso) return null;
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
export const fmtTs = (iso?: string | null) => parseTs(iso)?.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) ?? "—";

export function getMyLocation(): Promise<[number, number]> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("Geolocation is not available in this browser"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.latitude, p.coords.longitude]),
      (e) => reject(new Error(e.message || "Location permission denied")),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

export function pinIcon(color: string, text: string, size = 26) {
  return L.divIcon({
    className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2],
    html: `<div class="fs-marker" style="width:${size}px;height:${size}px;background:${color}">${text}</div>`,
  });
}

export const latLonStr = (p?: [number, number] | null) => (p ? `${p[0].toFixed(5)}, ${p[1].toFixed(5)}` : "—");
