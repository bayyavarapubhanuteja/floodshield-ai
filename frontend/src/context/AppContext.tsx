/* Global app state: auth user, city, theme, language, event clock (WebSocket), connectivity, toasts. */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, Connectivity, onConnectivity, setConnectivity, tokens, wsUrl } from "@/lib/api";
import { Lang, translate } from "@/lib/i18n";

export interface User {
  id: number; email: string; full_name: string; role: string; department: string; phone: string; city: string;
  language: Lang; theme: string; notify_web: boolean; notify_email: boolean; notify_sms: boolean; requested_role?: string | null;
}
export interface ClockStatus {
  minute: number; t5: number; mode: "PAUSED" | "RUNNING" | "FAST_DEMO"; city: string; speed_min_per_sec: number;
  end_minute: number; progress: number;
}
export interface TickAlert { id: string; level: string; title: string; location: string; expected_time_min: number | null; expected_depth_m: number }
export interface Toast { id: number; kind: "info" | "success" | "error" | "alert"; title: string; body?: string }

interface Ctx {
  user: User | null; loadingUser: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void; setUser: (u: User) => void;
  city: string; setCity: (c: string) => void; cities: { key: string; name: string; state: string; center: [number, number] }[];
  theme: "dark" | "light"; toggleTheme: () => void;
  lang: Lang; setLang: (l: Lang) => void; t: (k: string) => string;
  clock: ClockStatus | null; tick: number; kpis: any; tickAlerts: TickAlert[];
  demo: (action: string, minute?: number) => Promise<void>;
  connectivity: Connectivity; wsConnected: boolean;
  toasts: Toast[]; toast: (t: Omit<Toast, "id">) => void; dismissToast: (id: number) => void;
  isOfficer: boolean; hasRole: (...r: string[]) => boolean;
}
const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [cities, setCities] = useState<Ctx["cities"]>([]);
  const [city, setCityState] = useState<string>(localStorage.getItem("fs_city") || "hyderabad");
  const [theme, setTheme] = useState<"dark" | "light">((localStorage.getItem("fs_theme") as any) || "dark");
  const [lang, setLangState] = useState<Lang>((localStorage.getItem("fs_lang") as Lang) || "en");
  const [clock, setClock] = useState<ClockStatus | null>(null);
  const [tick, setTick] = useState(0);
  const [kpis, setKpis] = useState<any>(null);
  const [tickAlerts, setTickAlerts] = useState<TickAlert[]>([]);
  const [connectivity, setConn] = useState<Connectivity>("ONLINE");
  const [wsConnected, setWs] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastT5 = useRef(-1);
  const redSeen = useRef<Set<string>>(new Set());

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x.slice(-4), { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), t.kind === "alert" ? 9000 : 5000);
  }, []);
  const dismissToast = (id: number) => setToasts((x) => x.filter((y) => y.id !== id));

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("fs_theme", theme);
  }, [theme]);
  useEffect(() => { document.documentElement.lang = lang; localStorage.setItem("fs_lang", lang); }, [lang]);
  useEffect(() => { const off = onConnectivity(setConn); return () => { off(); }; }, []);

  useEffect(() => {
    // retry until the backend is reachable (e.g. still warming up its engines)
    let timer: any;
    let alive = true;
    const boot = async () => {
      try {
        const [cs, c] = await Promise.all([api.get("/api/cities"), api.get<ClockStatus>("/api/demo", { cache: false })]);
        if (!alive) return;
        if (!Array.isArray(cs)) throw new Error("cities unavailable");
        setCities(cs); setClock(c); setCityState(c.city); lastT5.current = c.t5; setTick((x) => x + 1);
      } catch { if (alive) timer = setTimeout(boot, 3000); }
    };
    boot();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  // auth bootstrap
  useEffect(() => {
    const onLogout = () => { setUserState(null); };
    window.addEventListener("fs:logout", onLogout);
    if (tokens.access) {
      api.get<User>("/api/auth/me", { cache: false }).then((u) => { setUserState(u); if (u.language) setLangState(u.language); })
        .catch(() => tokens.clear()).finally(() => setLoadingUser(false));
    } else setLoadingUser(false);
    return () => window.removeEventListener("fs:logout", onLogout);
  }, []);

  // WebSocket: event clock ticks + live alerts
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: any;
    let ping: any;
    const connect = () => {
      try { ws = new WebSocket(wsUrl()); } catch { setWs(false); retry = setTimeout(connect, 4000); return; }
      ws.onopen = () => { setWs(true); if (navigator.onLine) setConnectivity("ONLINE"); ping = setInterval(() => ws?.readyState === 1 && ws.send("ping"), 20000); };
      ws.onclose = () => {
        setWs(false); clearInterval(ping);
        if (navigator.onLine) setConnectivity("DEGRADED");
        if (!closed) retry = setTimeout(connect, 4000);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (ev) => {
        let m: any;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === "clock" || m.type === "tick" || m.type === "hello") {
          const st: ClockStatus = { minute: m.minute, t5: m.t5, mode: m.mode, city: m.city, speed_min_per_sec: m.speed_min_per_sec, end_minute: m.end_minute, progress: m.progress };
          setClock(st);
          if (m.city) setCityState((c) => (c === m.city ? c : m.city));
          if (st.t5 !== lastT5.current) { lastT5.current = st.t5; setTick((x) => x + 1); }
        }
        if (m.type === "tick") {
          setKpis(m.kpis);
          setTickAlerts(m.alerts || []);
          (m.alerts || []).filter((a: TickAlert) => a.level === "RED").forEach((a: TickAlert) => {
            const key = a.location;
            if (!redSeen.current.has(key)) {
              redSeen.current.add(key);
              toast({ kind: "alert", title: `RED ALERT — ${a.location}`, body: `Depth up to ${a.expected_depth_m} m ${a.expected_time_min ? `in ~${a.expected_time_min} min` : "now"}` });
            }
          });
        }
        if (m.type === "alert_broadcast") toast({ kind: "alert", title: m.alert.headline, body: m.alert.action });
        if (m.type === "citizen_report" && m.report?.status === "UNVERIFIED") toast({ kind: "info", title: "New citizen flood report", body: m.report.description?.slice(0, 80) });
      };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); clearInterval(ping); ws?.close(); };
  }, [toast]);

  const login = async (email: string, password: string) => {
    const r = await api.post("/api/auth/login", { email, password });
    tokens.set(r.access_token, r.refresh_token);
    setUserState(r.user);
    if (r.user.language) setLangState(r.user.language);
  };
  const logout = () => { tokens.clear(); setUserState(null); };

  const demo = async (action: string, minute?: number) => {
    const st = await api.post<ClockStatus>("/api/demo", { action, minute, city });
    setClock(st);
    if (st.t5 !== lastT5.current) { lastT5.current = st.t5; setTick((x) => x + 1); }
    if (action === "RESET") redSeen.current.clear();
  };
  const setCity = async (c: string) => {
    setCityState(c);
    localStorage.setItem("fs_city", c);
    redSeen.current.clear();
    try { await api.post("/api/demo", { action: "SET_CITY", city: c }); } catch { /* citizens cannot switch the shared clock city */ }
    setTick((x) => x + 1);
  };
  const setLang = (l: Lang) => {
    setLangState(l);
    if (user) api.put("/api/auth/me", { language: l }).catch(() => {});
  };
  const hasRole = (...r: string[]) => !!user && (user.role === "ADMIN" || r.includes(user.role));
  const isOfficer = !!user && user.role !== "CITIZEN";

  const value = useMemo<Ctx>(() => ({
    user, loadingUser, login, logout, setUser: setUserState, city, setCity, cities, theme,
    toggleTheme: () => setTheme((t) => (t === "dark" ? "light" : "dark")), lang, setLang, t: (k: string) => translate(lang, k),
    clock, tick, kpis, tickAlerts, demo, connectivity, wsConnected, toasts, toast, dismissToast, isOfficer, hasRole,
  }), [user, loadingUser, city, cities, theme, lang, clock, tick, kpis, tickAlerts, connectivity, wsConnected, toasts]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
