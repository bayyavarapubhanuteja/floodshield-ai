import React from "react";
import { motion } from "framer-motion";
import { CloudRain, Network, Route, ShieldCheck } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { LANGS, Lang } from "@/lib/i18n";

export default function AuthLayout({ title, children }: { title: string; children: React.ReactNode }) {
  const { lang, setLang, theme, toggleTheme } = useApp();
  return (
    <div className="min-h-full grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-10 bg-gradient-to-br from-slate-950 via-sky-950 to-slate-900 text-slate-100 relative overflow-hidden">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 64 64" className="h-11 w-11"><path fill="#0ea5e9" d="M32 4 8 12v18c0 15 10 26 24 30 14-4 24-15 24-30V12L32 4z" /><path fill="#fff" d="M32 18c-5 7-10 13-10 19a10 10 0 0 0 20 0c0-6-5-12-10-19z" /></svg>
          <div>
            <div className="text-2xl font-extrabold tracking-tight">FLOOD<span className="text-sky-400">SHIELD</span></div>
            <div className="text-sm text-slate-400">Urban Flood Nowcasting System</div>
          </div>
        </div>
        <div>
          <h1 className="text-4xl font-extrabold leading-tight">Predict the Flood.<br />Protect the City.<br /><span className="text-sky-400">Respond Before Impact.</span></h1>
          <p className="mt-4 max-w-md text-slate-300">Street-level flood nowcasting that couples AI rainfall prediction, terrain, runoff and drainage hydraulics — 100% software, no sensors or hardware.</p>
          <div className="mt-8 grid grid-cols-2 gap-3 max-w-md text-sm">
            {[[CloudRain, "Rainfall nowcast +15 → +180 min"], [Network, "Drainage digital twin"], [Route, "Flood-safe emergency routing"], [ShieldCheck, "Explainable early warnings"]].map(([I, s]: any) => (
              <div key={s} className="flex items-center gap-2 rounded-lg bg-white/5 border border-white/10 p-2.5"><I size={16} className="text-sky-400" />{s}</div>
            ))}
          </div>
        </div>
        <div className="text-xs text-slate-500">Software-only platform · Demo data clearly labelled</div>
      </div>
      <div className="flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="flex justify-end gap-2 mb-6">
            <select aria-label="Language" className="input w-auto py-1.5 text-xs" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
            <button className="btn-ghost btn-sm" onClick={toggleTheme}>{theme === "dark" ? "Light" : "Dark"}</button>
          </div>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card p-6">
            <h2 className="text-xl font-bold mb-4">{title}</h2>
            {children}
          </motion.div>
          <div className="mt-4 flex items-center justify-center gap-2 text-sm">
            <a href="tel:112" className="btn btn-sm bg-red-600 text-white font-bold">CALL 112</a>
            <span className="text-muted">National emergency — available without login</span>
          </div>
        </div>
      </div>
    </div>
  );
}
