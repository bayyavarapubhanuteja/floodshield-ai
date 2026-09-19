/* API client: JWT auth with refresh, offline cache fallback, connectivity reporting. */
const RAW_API = ((import.meta.env.VITE_API_URL as string | undefined) || "").trim().replace(/\/$/, "");
// A bare host (e.g. injected by Render as "<name>.onrender.com") is treated as https.
export const API_BASE: string = RAW_API && !/^https?:\/\//.test(RAW_API) ? `https://${RAW_API}` : RAW_API;

const TOKEN = "fs_token";
const REFRESH = "fs_refresh";
const CACHE_PREFIX = "fs_cache:";

export type Connectivity = "ONLINE" | "DEGRADED" | "OFFLINE";
type Listener = (c: Connectivity) => void;
const listeners = new Set<Listener>();
let state: Connectivity = navigator.onLine ? "ONLINE" : "OFFLINE";
let lastFailure = 0;

export function onConnectivity(fn: Listener) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}
export function setConnectivity(c: Connectivity) {
  if (c !== state) {
    state = c;
    listeners.forEach((l) => l(c));
  }
}
window.addEventListener("offline", () => setConnectivity("OFFLINE"));
window.addEventListener("online", () => setConnectivity("DEGRADED"));

export const tokens = {
  get access() { return localStorage.getItem(TOKEN); },
  get refresh() { return localStorage.getItem(REFRESH); },
  set(a: string, r?: string) { localStorage.setItem(TOKEN, a); if (r) localStorage.setItem(REFRESH, r); },
  clear() { localStorage.removeItem(TOKEN); localStorage.removeItem(REFRESH); },
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function tryRefresh(): Promise<boolean> {
  const r = tokens.refresh;
  if (!r) return false;
  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: r }) });
    if (!res.ok) return false;
    const j = await res.json();
    tokens.set(j.access_token, j.refresh_token);
    return true;
  } catch { return false; }
}

function errMsg(j: any, status: number): string {
  if (!j) return `Request failed (${status})`;
  if (typeof j.detail === "string") return j.detail;
  if (Array.isArray(j.detail)) return j.detail.map((d: any) => `${(d.loc || []).slice(-1)[0]}: ${d.msg}`).join("; ");
  return `Request failed (${status})`;
}

export interface RequestOpts { method?: string; body?: any; form?: FormData; cache?: boolean; raw?: boolean; signal?: AbortSignal }

export async function request<T = any>(path: string, opts: RequestOpts = {}, retried = false): Promise<T> {
  const method = opts.method || "GET";
  const headers: Record<string, string> = {};
  if (tokens.access) headers.Authorization = `Bearer ${tokens.access}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.body); }
  const cacheKey = CACHE_PREFIX + path;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body, signal: opts.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    lastFailure = Date.now();
    setConnectivity(navigator.onLine ? "DEGRADED" : "OFFLINE");
    if (method === "GET") {
      const hit = localStorage.getItem(cacheKey);
      if (hit) { const j = JSON.parse(hit); return { ...j.data, __cached_at: j.at } as T; }
    }
    throw new ApiError(0, "Network unavailable — showing cached data where possible");
  }
  if (res.status === 401 && !retried && !path.startsWith("/api/auth/login")) {
    if (await tryRefresh()) return request<T>(path, opts, true);
    tokens.clear();
    window.dispatchEvent(new Event("fs:logout"));
  }
  if (res.status === 503 && method === "GET") {
    const hit = localStorage.getItem(cacheKey);
    if (hit) { setConnectivity("DEGRADED"); const j = JSON.parse(hit); return { ...j.data, __cached_at: j.at } as T; }
  }
  if (!res.ok) {
    let j: any = null;
    try { j = await res.json(); } catch { /* ignore */ }
    throw new ApiError(res.status, errMsg(j, res.status));
  }
  if (Date.now() - lastFailure > 5000 && navigator.onLine) setConnectivity("ONLINE");
  if (opts.raw) return res as unknown as T;
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (method === "GET" && opts.cache !== false && typeof data === "object") {
    try {
      const s = JSON.stringify({ at: new Date().toISOString(), data });
      if (s.length < 400_000) localStorage.setItem(cacheKey, s);
    } catch { /* quota */ }
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string, o: RequestOpts = {}) => request<T>(p, { ...o, method: "GET" }),
  post: <T = any>(p: string, body?: any) => request<T>(p, { method: "POST", body }),
  put: <T = any>(p: string, body?: any) => request<T>(p, { method: "PUT", body }),
  patch: <T = any>(p: string, body?: any) => request<T>(p, { method: "PATCH", body }),
  del: <T = any>(p: string) => request<T>(p, { method: "DELETE" }),
  form: <T = any>(p: string, form: FormData) => request<T>(p, { method: "POST", form }),
};

export function qs(params: Record<string, any>): string {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") u.set(k, String(v)); });
  const s = u.toString();
  return s ? `?${s}` : "";
}

export async function downloadFile(path: string, filename: string) {
  const res = await request<Response>(path, { raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function wsUrl(): string {
  if (API_BASE) return API_BASE.replace(/^http/, "ws") + "/api/ws";
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`;
}

export function uploadUrl(u?: string | null) {
  return u ? `${API_BASE}${u}` : "";
}
