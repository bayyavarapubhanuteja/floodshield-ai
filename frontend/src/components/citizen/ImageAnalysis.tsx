/* Shared computer-vision result widgets (CCTV page + citizen report photo analysis). */
import React, { useState } from "react";
import { AlertTriangle, Car, Eye } from "lucide-react";
import { Badge, DataLabel, Stat, cx } from "@/components/ui";
import { PASSABILITY_COLORS, RISK_COLORS, depth, fmt, pct, pretty } from "@/lib/format";

export const SEVERITY_COLORS: Record<string, string> = { LOW: RISK_COLORS.LOW, MODERATE: RISK_COLORS.MODERATE, HIGH: RISK_COLORS.HIGH, CRITICAL: RISK_COLORS.CRITICAL };

/* Image preview with detection boxes. Boxes are in pixels of the analysed frame, which the backend
   downsizes to max 640 px on the long side, so we scale by the frame size derived from the natural size. */
export function DetectionPreview({ src, detections, className }: { src: string; detections?: any[]; className?: string }) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const scale = nat ? Math.min(1, 640 / Math.max(nat.w, nat.h)) : 1;
  const aw = nat ? Math.round(nat.w * scale) : 1;
  const ah = nat ? Math.round(nat.h * scale) : 1;
  return (
    <div className={cx("relative inline-block max-w-full rounded-lg overflow-hidden border border-line bg-black", className)}>
      <img src={src} alt="Analysed frame" className="block max-w-full h-auto max-h-[420px]"
        onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
      {nat && (detections || []).map((d, i) => {
        const [x1, y1, x2, y2] = d.box || [0, 0, 0, 0];
        const color = d.lower_part_in_water ? "#dc2626" : "#facc15";
        return (
          <div key={i} className="absolute pointer-events-none" aria-hidden
            style={{ left: `${(x1 / aw) * 100}%`, top: `${(y1 / ah) * 100}%`, width: `${((x2 - x1) / aw) * 100}%`, height: `${((y2 - y1) / ah) * 100}%`, border: `2px solid ${color}` }}>
            <span className="absolute -top-4 left-0 text-[10px] font-semibold px-1 rounded-sm whitespace-nowrap" style={{ background: color, color: "#111" }}>
              {d.label} {pct(d.confidence)}{d.lower_part_in_water ? " · in water" : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ImageResultPanel({ r, compact }: { r: any; compact?: boolean }) {
  if (!r) return null;
  const yes = (b: any) => (b ? "Yes" : "No");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge color={SEVERITY_COLORS[r.severity] || "#64748b"} solid>Severity: {r.severity}</Badge>
        {r.passability && <Badge color={PASSABILITY_COLORS[r.passability] || "#64748b"}>{pretty(r.passability)}</Badge>}
        <DataLabel label={r.data_label || "USER_REPORTED_DATA"} />
        {r.is_estimate && <Badge color="#f59e0b">ESTIMATE</Badge>}
      </div>
      <div className={cx("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
        <Stat label="Water detected" value={<span style={{ color: r.water_detected ? "#0ea5e9" : undefined }}>{yes(r.water_detected)}</span>} />
        <Stat label="Water coverage" value={`${fmt(r.water_coverage_pct, 1)}%`} />
        <Stat label="Flooded road" value={yes(r.flooded_road)} />
        <Stat label="Depth band (ESTIMATE)" value={<span title="Computer-vision estimate, not a measurement">{r.estimated_depth_band} <span className="text-muted text-xs">≈{depth(r.estimated_depth_m)}</span></span>} className="col-span-2 sm:col-span-1" />
        <Stat label="Vehicles detected" value={<span className="flex items-center gap-1"><Car size={13} />{r.vehicles_detected}</span>} />
        <Stat label="Stranded vehicles" value={<span style={{ color: r.stranded_vehicles ? "#dc2626" : undefined }}>{r.stranded_vehicles}</span>} />
        <Stat label="Road blocked" value={<span style={{ color: r.road_blocked ? "#dc2626" : "#16a34a" }}>{yes(r.road_blocked)}</span>} />
        <Stat label="Traffic" value={pretty(r.traffic)} />
        <Stat label="Confidence" value={pct(r.confidence)} />
      </div>
      {!compact && <div className="text-xs text-muted flex items-center gap-1"><Eye size={12} />Detector: <b className="text-ink">{r.detector}</b></div>}
      {r.disclaimer && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />{r.disclaimer}
        </div>
      )}
    </div>
  );
}

export function ImageAnalysisSummary({ r }: { r: any }): React.ReactElement | null {
  if (!r) return null;
  return (
    <div className="text-xs space-y-0.5">
      <div className="flex flex-wrap gap-1 items-center">
        <Badge color={SEVERITY_COLORS[r.severity] || "#64748b"}>{r.severity}</Badge>
        <span>Water {fmt(r.water_coverage_pct, 0)}% · {r.estimated_depth_band} <b>(estimate)</b></span>
      </div>
      <div className="text-muted">{r.vehicles_detected} vehicles · {r.stranded_vehicles} stranded · {r.road_blocked ? "road blocked" : "road open"} · conf {pct(r.confidence)}</div>
    </div>
  );
}
