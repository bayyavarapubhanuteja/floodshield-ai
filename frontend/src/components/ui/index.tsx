/* Shared UI primitives. */
import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import { Info, Loader2, X, AlertTriangle, Inbox } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DATA_LABELS, pretty } from "@/lib/format";

export const cx = clsx;

export function Card({ title, actions, children, className, bodyClass, icon: Icon, subtitle }: {
  title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClass?: string;
  icon?: any; subtitle?: React.ReactNode;
}) {
  return (
    <section className={cx("card flex flex-col min-w-0", className)}>
      {(title || actions) && (
        <header className="card-h">
          <div className="min-w-0">
            <h2 className="card-t flex items-center gap-1.5">{Icon && <Icon size={14} className="text-brand" />}{title}</h2>
            {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 flex-wrap justify-end">{actions}</div>}
        </header>
      )}
      <div className={cx("px-4 pb-4 min-w-0 flex-1", !title && !actions && "pt-4", bodyClass)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, icon: Icon, actions, labels }: {
  title: string; subtitle?: string; icon?: any; actions?: React.ReactNode; labels?: string[];
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
          {Icon && <Icon className="text-brand shrink-0" size={24} />}{title}
        </h1>
        {subtitle && <p className="text-sm text-muted mt-1 max-w-3xl">{subtitle}</p>}
        {labels && labels.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{labels.map((l) => <DataLabel key={l} label={l} />)}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function DataLabel({ label, className }: { label?: string | null; className?: string }) {
  if (!label) return null;
  const d = DATA_LABELS[label] || { text: pretty(label), color: "#64748b", hint: "" };
  return (
    <span title={d.hint} className={cx("chip border", className)} style={{ color: d.color, borderColor: d.color + "66", background: d.color + "14" }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: d.color }} />{d.text}
    </span>
  );
}

export function Badge({ children, color, solid, className, title }: { children: React.ReactNode; color: string; solid?: boolean; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("chip", className)} style={solid ? { background: color, color: "#fff" } : { color, background: color + "1f", border: `1px solid ${color}55` }}>
      {children}
    </span>
  );
}

export function LevelBadge({ level, map, solid }: { level?: string | null; map: Record<string, string>; solid?: boolean }) {
  if (!level) return <span className="text-muted">—</span>;
  return <Badge color={map[level] || "#64748b"} solid={solid}>{pretty(level).toUpperCase()}</Badge>;
}

export function Kpi({ label, value, unit, sub, icon: Icon, color, trend, onClick, labelTag }: {
  label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; icon?: any; color?: string; trend?: React.ReactNode; onClick?: () => void; labelTag?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={cx("card p-3.5 text-left w-full disabled:cursor-default", onClick && "hover:border-brand/60 transition-colors")}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted leading-tight">{label}</span>
        {Icon && <span className="rounded-lg p-1.5" style={{ background: (color || "#0ea5e9") + "1f", color: color || "#0ea5e9" }}><Icon size={16} /></span>}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="kpi-v" style={color ? { color } : undefined}>{value}</span>
        {unit && <span className="text-xs text-muted">{unit}</span>}
      </div>
      {(sub || trend) && <div className="mt-1 text-xs text-muted flex items-center gap-1.5 flex-wrap">{trend}{sub}</div>}
      {labelTag && <div className="mt-1.5"><DataLabel label={labelTag} /></div>}
    </button>
  );
}

export function Spinner({ className, size = 18 }: { className?: string; size?: number }) {
  return <Loader2 size={size} className={cx("animate-spin text-brand", className)} />;
}

export function Loading({ text = "Loading…", className }: { text?: string; className?: string }) {
  return <div className={cx("flex items-center justify-center gap-2 py-10 text-sm text-muted", className)}><Spinner />{text}</div>;
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">{error}</div>
      {onRetry && <button className="btn-ghost btn-sm" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Empty({ text = "Nothing to show", icon: Icon = Inbox }: { text?: string; icon?: any }) {
  return <div className="flex flex-col items-center justify-center gap-2 py-8 text-sm text-muted"><Icon size={22} />{text}</div>;
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: {
  tabs: { key: T; label: React.ReactNode; icon?: any }[]; value: T; onChange: (k: T) => void; className?: string;
}) {
  return (
    <div role="tablist" className={cx("inline-flex flex-wrap gap-1 rounded-lg border border-line bg-panel2 p-1", className)}>
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}
          className={cx("rounded-md px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-colors",
            value === t.key ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink")}>
          {t.icon && <t.icon size={13} />}{t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div role="dialog" aria-modal="true" className={cx("card w-full max-h-[90vh] overflow-auto scroll-thin", wide ? "max-w-4xl" : "max-w-lg")}
            initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h3 className="font-semibold">{title}</h3>
              <button aria-label="Close" className="p-1 rounded hover:bg-panel2" onClick={onClose}><X size={18} /></button>
            </div>
            <div className="p-4">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-[1500] bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside className="fixed right-0 top-0 bottom-0 z-[1501] w-full max-w-md bg-panel border-l border-line shadow-2xl flex flex-col"
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "tween", duration: 0.2 }}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h3 className="font-semibold min-w-0 truncate">{title}</h3>
              <button aria-label="Close" className="p-1 rounded hover:bg-panel2" onClick={onClose}><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-auto scroll-thin p-4">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export function Tip({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <span className="relative inline-flex group align-middle">
      {children || <Info size={13} className="text-muted" />}
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-max max-w-[260px] -translate-x-1/2 rounded-md border border-line bg-panel px-2 py-1 text-[11px] font-normal normal-case tracking-normal text-ink opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

export function Stat({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-lg border border-line bg-panel2 px-3 py-2", className)}>
      <div className="text-[10.5px] uppercase tracking-wide text-muted font-semibold">{label}</div>
      <div className="text-sm font-semibold mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

export function Progress({ value, color = "#0ea5e9", max = 1, className }: { value: number; color?: string; max?: number; className?: string }) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return <div className={cx("h-2 w-full rounded-full bg-panel2 border border-line overflow-hidden", className)}><div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} /></div>;
}

export function Markdown({ children }: { children: string }) {
  return <div className="prose-fs text-sm leading-relaxed"><ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown></div>;
}

export function Select({ value, onChange, options, className, label }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string; label?: string;
}) {
  return (
    <label className={cx("block", className)}>
      {label && <span className="label">{label}</span>}
      <select className="input py-1.5" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Slider({ label, value, min, max, step = 1, onChange, unit, hint }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string; hint?: string;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-medium text-muted flex items-center gap-1">{label}{hint && <Tip text={hint} />}</span>
        <span className="font-semibold tabular-nums">{value}{unit}</span>
      </div>
      <input type="range" className="w-full accent-sky-500" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function Section({ children, className }: { children: React.ReactNode; className?: string }) {
  return <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className={className}>{children}</motion.div>;
}
