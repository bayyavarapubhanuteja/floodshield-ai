/* Command-center layout: sidebar navigation, top bar with event clock / demo controls,
   connectivity, language, theme, 112 button and toasts. */
import React, { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, AlertTriangle, BarChart3, Bot, Brain, Camera, CloudRain, Construction, FileText, FlaskConical, Gauge, History,
  LayoutDashboard, LogOut, Map as MapIcon, Menu, Moon, Mountain, Network, Pause, Phone, Play, RotateCcw, Route, Settings,
  ShieldAlert, Siren, Sun, Users, Wifi, WifiOff, X, Zap, Building2, UserCircle2, Megaphone,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import { LANGS, Lang } from "@/lib/i18n";
import { cx } from "@/components/ui";

export const NAV = [
  { to: "/", key: "dashboard", icon: LayoutDashboard, roles: "all" },
  { to: "/map", key: "map", icon: MapIcon, roles: "all" },
  { to: "/rainfall", key: "rainfall", icon: CloudRain, roles: "all" },
  { to: "/terrain", key: "terrain", icon: Mountain, roles: "officer" },
  { to: "/drainage", key: "drainage", icon: Network, roles: "officer" },
  { to: "/prediction", key: "prediction", icon: Activity, roles: "officer" },
  { to: "/risk", key: "risk", icon: Brain, roles: "officer" },
  { to: "/whatif", key: "whatif", icon: FlaskConical, roles: "officer" },
  { to: "/routing", key: "routing", icon: Route, roles: "all" },
  { to: "/infrastructure", key: "infrastructure", icon: Building2, roles: "officer" },
  { to: "/cctv", key: "cctv", icon: Camera, roles: "all" },
  { to: "/citizen-reports", key: "reports_citizen", icon: Megaphone, roles: "all" },
  { to: "/historical", key: "historical", icon: History, roles: "officer" },
  { to: "/maintenance", key: "maintenance", icon: Construction, roles: "officer" },
  { to: "/emergency", key: "emergency", icon: Siren, roles: "all" },
  { to: "/copilot", key: "copilot", icon: Bot, roles: "all" },
  { to: "/incidents", key: "incidents", icon: ShieldAlert, roles: "officer" },
  { to: "/reports", key: "reports", icon: FileText, roles: "officer" },
  { to: "/settings", key: "settings", icon: Settings, roles: "all" },
] as const;

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 64 64" className="h-8 w-8 shrink-0" aria-hidden>
        <path fill="#0ea5e9" d="M32 4 8 12v18c0 15 10 26 24 30 14-4 24-15 24-30V12L32 4z" />
        <path fill="#fff" d="M32 18c-5 7-10 13-10 19a10 10 0 0 0 20 0c0-6-5-12-10-19z" />
      </svg>
      {!compact && (
        <div className="leading-tight">
          <div className="font-extrabold tracking-tight text-[15px]">FLOOD<span className="text-brand">SHIELD</span></div>
          <div className="text-[10px] text-muted">Predict · Protect · Respond</div>
        </div>
      )}
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t, isOfficer, user, logout } = useApp();
  const items = NAV.filter((n) => n.roles === "all" || isOfficer);
  return (
    <nav aria-label="Main navigation" className="flex h-full flex-col">
      <div className="px-4 py-4 border-b border-line"><Brand /></div>
      <div className="flex-1 overflow-y-auto scroll-thin px-2 py-3 space-y-0.5">
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"} onClick={onNavigate}
            className={({ isActive }) => cx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors",
              isActive ? "bg-brand/15 text-brand" : "text-muted hover:bg-panel2 hover:text-ink")}>
            <n.icon size={17} />{t(n.key)}
          </NavLink>
        ))}
      </div>
      <div className="border-t border-line p-3">
        <NavLink to="/profile" onClick={onNavigate} className="flex items-center gap-2 rounded-lg p-2 hover:bg-panel2">
          <UserCircle2 size={28} className="text-muted" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{user?.full_name}</div>
            <div className="truncate text-[11px] text-muted">{user?.role.replace(/_/g, " ")}</div>
          </div>
        </NavLink>
        <button onClick={logout} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-panel2 hover:text-ink">
          <LogOut size={16} />{t("logout")}
        </button>
      </div>
    </nav>
  );
}

function ClockControls() {
  const { clock, demo, isOfficer, toast } = useApp();
  if (!clock) return null;
  const run = async (a: string, m?: number) => { try { await demo(a, m); } catch (e: any) { toast({ kind: "error", title: "Demo control failed", body: e.message }); } };
  const modeColor = clock.mode === "FAST_DEMO" ? "#f97316" : clock.mode === "RUNNING" ? "#16a34a" : "#64748b";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="hidden sm:flex flex-col min-w-[150px]">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-mono font-semibold tabular-nums">T+{Math.floor(clock.minute)} min</span>
          <span className="chip" style={{ color: modeColor, background: modeColor + "1f" }}>{clock.mode.replace("_", " ")}</span>
        </div>
        <input aria-label="Event timeline" type="range" min={0} max={clock.end_minute} step={5} value={clock.t5} disabled={!isOfficer}
          onChange={(e) => run("SEEK", Number(e.target.value))} className="w-full accent-sky-500 h-1.5 mt-1" />
      </div>
      {isOfficer && (
        <div className="flex items-center gap-1">
          {clock.mode === "PAUSED"
            ? <button className="btn-ghost btn-sm" title="Start (12× real time)" onClick={() => run("START")}><Play size={14} /><span className="hidden xl:inline">START</span></button>
            : <button className="btn-ghost btn-sm" title="Pause" onClick={() => run("PAUSE")}><Pause size={14} /><span className="hidden xl:inline">PAUSE</span></button>}
          <button className="btn-ghost btn-sm" title="Reset to T+0" onClick={() => run("RESET")}><RotateCcw size={14} /><span className="hidden xl:inline">RESET</span></button>
          <button className="btn btn-sm bg-orange-500 text-white hover:bg-orange-600" title="Compress the 3-hour event into ~2.5 minutes" onClick={() => run("FAST_DEMO")}>
            <Zap size={14} /><span className="hidden md:inline">FAST DEMO</span>
          </button>
        </div>
      )}
    </div>
  );
}

function Connectivity() {
  const { connectivity, t } = useApp();
  const c = { ONLINE: "#16a34a", DEGRADED: "#eab308", OFFLINE: "#dc2626" }[connectivity];
  return (
    <span className="chip border" style={{ color: c, borderColor: c + "66", background: c + "14" }} title="Connection status. Cached maps, rainfall, predictions, drainage and emergency data remain available offline.">
      {connectivity === "OFFLINE" ? <WifiOff size={12} /> : <Wifi size={12} />}
      <span className="hidden sm:inline">{t(connectivity.toLowerCase())}</span>
    </span>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useApp();
  const col = { info: "#0ea5e9", success: "#16a34a", error: "#dc2626", alert: "#dc2626" };
  return (
    <div className="fixed bottom-4 right-4 z-[3000] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }}
            className="card flex items-start gap-2 p-3" style={{ borderLeft: `4px solid ${col[t.kind]}` }}>
            {t.kind === "alert" ? <AlertTriangle size={18} style={{ color: col.alert }} /> : <Activity size={18} style={{ color: col[t.kind] }} />}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{t.title}</div>
              {t.body && <div className="text-xs text-muted mt-0.5">{t.body}</div>}
            </div>
            <button aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="text-muted hover:text-ink"><X size={14} /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export default function AppShell() {
  const { city, setCity, cities, theme, toggleTheme, lang, setLang, t, isOfficer, kpis } = useApp();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  return (
    <div className="flex h-full">
      <aside className="hidden lg:block w-60 shrink-0 border-r border-line bg-panel"><Sidebar /></aside>
      <AnimatePresence>
        {open && (
          <>
            <motion.div className="fixed inset-0 z-[1200] bg-black/50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.aside className="fixed inset-y-0 left-0 z-[1201] w-64 bg-panel border-r border-line lg:hidden" initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: "tween", duration: 0.2 }}>
              <Sidebar onNavigate={() => setOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-[1000] flex items-center gap-2 border-b border-line bg-panel/95 backdrop-blur px-3 py-2">
          <button className="lg:hidden p-1.5 rounded hover:bg-panel2" aria-label="Open menu" onClick={() => setOpen(true)}><Menu size={20} /></button>
          <div className="lg:hidden"><Brand compact /></div>
          <select aria-label="City" className="input w-auto py-1.5 text-sm font-semibold" value={city} onChange={(e) => setCity(e.target.value)} disabled={!isOfficer}>
            {cities.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
          <ClockControls />
          <div className="flex-1" />
          {kpis && (
            <button onClick={() => nav("/")} className="hidden xl:flex items-center gap-1.5 text-xs text-muted mr-1" title="Live rainfall (SIMULATED) and active alerts">
              <Gauge size={14} /> <b className="text-ink tabular-nums">{kpis.rain_now_mm_hr}</b> mm/hr ·
              <b className="text-red-500 tabular-nums">{kpis.alert_counts?.RED ?? 0}</b> RED
            </button>
          )}
          <Connectivity />
          <select aria-label={t("language")} className="input w-auto py-1.5 text-xs" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
          <button className="btn-ghost btn-sm" aria-label="Toggle theme" onClick={toggleTheme}>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</button>
          <a href="tel:112" className="btn btn-sm bg-red-600 text-white hover:bg-red-700 font-bold" aria-label="Call 112 national emergency">
            <Phone size={14} />112
          </a>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto scroll-thin p-3 md:p-5" id="main">
          <Outlet />
        </main>
      </div>
      <Toasts />
    </div>
  );
}
