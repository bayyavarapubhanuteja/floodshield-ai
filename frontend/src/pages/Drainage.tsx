/* Drainage Network Digital Twin — hydraulic state of every node and conduit, bottlenecks and node drill-down. */
import { useMemo, useState } from "react";
import { AlertTriangle, BookOpen, Gauge, Network, Search, Table2, Waves, ArrowDownUp } from "lucide-react";
import { CircleMarker, Polyline, Tooltip as LTooltip } from "react-leaflet";
import { useApi } from "@/hooks/useApi";
import { Badge, Card, DataLabel, ErrorBox, Kpi, LevelBadge, Loading, PageHeader, Section, Select, Tabs } from "@/components/ui";
import { CityMap, LEGENDS, Legend, MapOverlay } from "@/components/map";
import { DRAIN_COLORS, fmt, pct, pretty } from "@/lib/format";
import { DrainDrawer, SortTh, UtilBar } from "@/components/gis/common";

const STATES = ["NORMAL", "HIGH_LOAD", "NEAR_CAPACITY", "OVERLOADED", "OVERFLOW"];

export default function Drainage() {
  const { data, error, reload } = useApi<any>("/api/drains");
  const [sel, setSel] = useState<string | null>(null);
  const [when, setWhen] = useState<"status" | "status_30" | "status_60">("status");
  const [fStatus, setFStatus] = useState("");
  const [fWard, setFWard] = useState("");
  const [fKind, setFKind] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ k: string; d: 1 | -1 }>({ k: "utilization", d: -1 });
  const [edgeSort, setEdgeSort] = useState<{ k: string; d: 1 | -1 }>({ k: "utilization", d: -1 });

  const nodeStatus = useMemo(() => Object.fromEntries((data?.nodes || []).map((n: any) => [n.id, n])), [data]);
  const wards = useMemo(() => [...new Set<string>((data?.nodes || []).map((n: any) => n.ward))].sort(), [data]);
  const kinds = useMemo(() => [...new Set<string>((data?.nodes || []).map((n: any) => n.kind))].sort(), [data]);

  const rows = useMemo(() => {
    let r = (data?.nodes || []) as any[];
    if (fStatus) r = r.filter((n) => n.status === fStatus);
    if (fWard) r = r.filter((n) => n.ward === fWard);
    if (fKind) r = r.filter((n) => n.kind === fKind);
    if (q.trim()) { const s = q.trim().toLowerCase(); r = r.filter((n) => n.id.toLowerCase().includes(s) || (n.connected_roads || []).some((x: string) => x.toLowerCase().includes(s))); }
    const k = sort.k;
    return [...r].sort((a, b) => {
      const va = k === "status" ? STATES.indexOf(a.status) : a[k], vb = k === "status" ? STATES.indexOf(b.status) : b[k];
      return (typeof va === "string" ? va.localeCompare(vb) : (va ?? 0) - (vb ?? 0)) * sort.d;
    });
  }, [data, fStatus, fWard, fKind, q, sort]);

  const bottlenecks = useMemo(() => {
    const e = ((data?.edges || []) as any[]).filter((x) => x.bottleneck || x.legacy_undersized || x.adverse_grade);
    const k = edgeSort.k;
    return [...e].sort((a, b) => ((a[k] ?? 0) - (b[k] ?? 0)) * edgeSort.d);
  }, [data, edgeSort]);

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading text="Solving drainage hydraulics…" />;
  const s = data.summary;

  return (
    <Section>
      <PageHeader icon={Network} title="Drainage Network Digital Twin"
        subtitle={`${s.nodes} nodes · ${s.edges} conduits · event minute T+${data.event_minute}. Node loads are computed from simulated runoff; network geometry is demo data; blockage is an assumption.`}
        labels={["MODEL_PREDICTION", "SIMULATED_DATA", "DEMO_DATA"]} />

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-4">
        {STATES.map((k) => (
          <Kpi key={k} label={pretty(k)} value={s.state_counts[k] ?? 0} color={DRAIN_COLORS[k]} onClick={() => setFStatus(fStatus === k ? "" : k)} sub={fStatus === k ? "filter active" : "click to filter"} />
        ))}
        <Kpi label="Mean utilisation" value={pct(s.mean_utilization)} icon={Gauge} color={s.mean_utilization >= 1 ? "#dc2626" : "#16a34a"} />
        <Kpi label="Bottlenecks / backflow" value={`${s.bottlenecks} / ${s.backflow_nodes}`} icon={AlertTriangle} color="#f97316" sub="conduits / nodes" />
        <Kpi label="Total overflow" value={fmt(s.total_overflow_m3 / 1000, 1)} unit="×1000 m³" icon={Waves} color="#dc2626" />
      </div>

      <div className="grid xl:grid-cols-3 gap-4 mb-4">
        <Card className="xl:col-span-2" title="Network state map" icon={Network}
          subtitle="Conduit width ∝ diameter, colour = conduit state; nodes coloured by hydraulic state. Click a node for hydraulics."
          actions={<Tabs value={when} onChange={setWhen} tabs={[{ key: "status", label: "NOW" }, { key: "status_30", label: "+30" }, { key: "status_60", label: "+60" }]} />}>
          <div className="relative">
            <CityMap className="h-[500px]">
              {data.edges.map((e: any) => {
                const st = when === "status" ? e.status : nodeStatus[e.from]?.[when] || e.status;
                return (
                  <Polyline key={e.id} positions={e.coords} pathOptions={{ color: DRAIN_COLORS[st] || "#38bdf8", weight: Math.max(2, e.diameter_m * 3), opacity: 0.8, dashArray: e.bottleneck ? "6 4" : undefined }}>
                    <LTooltip sticky>
                      <div className="font-semibold">{e.id} · {pretty(e.conduit)} Ø {fmt(e.diameter_m, 2)} m</div>
                      <div>{fmt(e.flow_m3s, 2)} / {fmt(e.effective_capacity_m3s, 2)} m³/s · {fmt(e.velocity_ms, 2)} m/s · {pretty(st)}</div>
                      {e.bottleneck && <div className="text-red-500">Bottleneck</div>}
                    </LTooltip>
                  </Polyline>
                );
              })}
              {data.nodes.map((n: any) => {
                const st = n[when];
                return (
                  <CircleMarker key={n.id} center={[n.lat, n.lon]} radius={n.kind === "outfall" ? 7 : n.kind === "inlet" ? 3.5 : 5}
                    pathOptions={{ color: sel === n.id ? "#22d3ee" : "#0f172a", weight: sel === n.id ? 3 : 1, fillColor: n.kind === "outfall" ? "#0ea5e9" : DRAIN_COLORS[st], fillOpacity: 0.95 }}
                    eventHandlers={{ click: () => setSel(n.id) }}>
                    <LTooltip>
                      <div className="font-semibold">{n.id} · {pretty(n.kind)}</div>
                      <div>{pretty(st)} · {pct(n.utilization)} now{n.backflow ? " · backflow" : ""}</div>
                      <div className="opacity-70">{n.ward}</div>
                    </LTooltip>
                  </CircleMarker>
                );
              })}
            </CityMap>
            <MapOverlay position="bottom-left" className="flex gap-2 items-end">
              <Legend title="Drainage state" items={LEGENDS.drain} />
              <Legend title="Symbols" className="hidden sm:block" items={[{ color: "#0ea5e9", label: "Outfall" }, { color: "repeating-linear-gradient(90deg,#f97316 0 5px,transparent 5px 8px)", label: "Bottleneck (dashed)" }]} />
            </MapOverlay>
            <MapOverlay position="top-left"><DataLabel label={when === "status" ? "SIMULATED_DATA" : "MODEL_PREDICTION"} className="bg-panel" /></MapOverlay>
          </div>
        </Card>
        <Card title="Hydraulic method" icon={BookOpen}>
          <ul className="text-sm space-y-2">
            <li><b>Manning full-flow capacity</b> — Q = (1/n)·A·R<sup>2/3</sup>·S<sup>1/2</sup> for each conduit from diameter, slope and roughness; reduced by assumed blockage to give <i>effective capacity</i>.</li>
            <li><b>Node routing</b> — inflow = local runoff from the node's catchment + upstream outflow; outflow limited by the outgoing conduit's effective capacity.</li>
            <li><b>Backwater</b> — when a downstream node is surcharged its upstream nodes cannot discharge freely (backflow flag).</li>
            <li><b>Surcharge storage</b> — excess fills manhole/pipe storage (surcharge 0–100%).</li>
            <li><b>Overflow</b> — once storage is full, excess volume spills to the street surface and is passed to the 2-D flood model.</li>
            <li>States: utilisation &lt;60% Normal, &lt;80% High load, &lt;100% Near capacity, ≥100% Overloaded, spilling = Overflow.</li>
          </ul>
          <p className="text-xs text-muted mt-3">Blockage values are a <b>SIMULATED assumption</b> from a maintenance-age model — no sensors are installed.</p>
        </Card>
      </div>

      <Card title={`Drainage nodes (${rows.length})`} icon={Table2} className="mb-4" bodyClass="px-0 pb-0"
        actions={<DataLabel label="MODEL_PREDICTION" />}>
        <div className="flex flex-wrap gap-2 px-4 pb-3 items-end">
          <label className="block">
            <span className="label">Search</span>
            <div className="relative"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input className="input py-1.5 pl-7 w-44" placeholder="Node or road id" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </label>
          <Select label="Status" value={fStatus} onChange={setFStatus} options={[{ value: "", label: "All" }, ...STATES.map((k) => ({ value: k, label: pretty(k) }))]} />
          <Select label="Ward" value={fWard} onChange={setFWard} options={[{ value: "", label: "All wards" }, ...wards.map((w) => ({ value: w, label: w }))]} />
          <Select label="Kind" value={fKind} onChange={setFKind} options={[{ value: "", label: "All kinds" }, ...kinds.map((k) => ({ value: k, label: pretty(k) }))]} />
        </div>
        <div className="overflow-auto scroll-thin max-h-[520px]">
          <table className="table">
            <thead><tr>
              <SortTh label="Node" k="id" sort={sort} setSort={setSort} /><th>Kind</th><SortTh label="Ward" k="ward" sort={sort} setSort={setSort} />
              <SortTh label="Utilisation" k="utilization" sort={sort} setSort={setSort} /><SortTh label="Inflow m³/s" k="inflow_m3s" sort={sort} setSort={setSort} />
              <SortTh label="Cap / eff. m³/s" k="effective_capacity_m3s" sort={sort} setSort={setSort} />
              <SortTh label="Now" k="status" sort={sort} setSort={setSort} /><th>+30</th><th>+60</th>
              <SortTh label="Overflow m³" k="overflow_m3" sort={sort} setSort={setSort} /><SortTh label="Surcharge" k="surcharge" sort={sort} setSort={setSort} />
              <th>Backflow</th><SortTh label="Blockage*" k="blockage" sort={sort} setSort={setSort} /><th>Roads</th>
            </tr></thead>
            <tbody>
              {rows.map((n: any) => (
                <tr key={n.id} className="cursor-pointer" onClick={() => setSel(n.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setSel(n.id); }}>
                  <td className="font-mono text-xs font-semibold">{n.id}</td>
                  <td className="text-xs">{pretty(n.kind)}</td>
                  <td className="whitespace-nowrap">{n.ward}</td>
                  <td><UtilBar value={n.utilization} status={n.status} /></td>
                  <td className="tabular-nums">{fmt(n.inflow_m3s, 2)}</td>
                  <td className="tabular-nums whitespace-nowrap">{fmt(n.capacity_m3s, 2)} / {fmt(n.effective_capacity_m3s, 2)}</td>
                  <td><LevelBadge level={n.status} map={DRAIN_COLORS} /></td>
                  <td><LevelBadge level={n.status_30} map={DRAIN_COLORS} /></td>
                  <td><LevelBadge level={n.status_60} map={DRAIN_COLORS} /></td>
                  <td className="tabular-nums">{fmt(n.overflow_m3, 1)}</td>
                  <td className="tabular-nums">{pct(n.surcharge)}</td>
                  <td>{n.backflow ? <Badge color="#dc2626">Yes</Badge> : <span className="text-muted text-xs">No</span>}</td>
                  <td className="tabular-nums" title={n.blockage_label}>{pct(n.blockage)} <span className="text-[10px] text-purple-500">SIM</span></td>
                  <td className="text-xs text-muted">{(n.connected_roads || []).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted px-4 py-2">* Blockage: ASSUMED — SIMULATED maintenance-age model, no sensors.</p>
      </Card>

      <Card title={`Bottleneck & deficient conduits (${bottlenecks.length})`} icon={ArrowDownUp} bodyClass="px-0 pb-0">
        <div className="overflow-auto scroll-thin max-h-[460px]">
          <table className="table">
            <thead><tr>
              <th>Conduit</th><th>From → To</th><SortTh label="Ø m" k="diameter_m" sort={edgeSort} setSort={setEdgeSort} /><SortTh label="Slope" k="slope" sort={edgeSort} setSort={setEdgeSort} />
              <SortTh label="Flow / eff. cap m³/s" k="flow_m3s" sort={edgeSort} setSort={setEdgeSort} /><SortTh label="Utilisation" k="utilization" sort={edgeSort} setSort={setEdgeSort} />
              <SortTh label="Velocity" k="velocity_ms" sort={edgeSort} setSort={setEdgeSort} /><th>State</th><th>Issues</th>
            </tr></thead>
            <tbody>
              {bottlenecks.map((e: any) => (
                <tr key={e.id} className="cursor-pointer" onClick={() => setSel(e.from)}>
                  <td className="font-mono text-xs font-semibold">{e.id}</td>
                  <td className="font-mono text-xs whitespace-nowrap">{e.from} → {e.to}</td>
                  <td className="tabular-nums">{fmt(e.diameter_m, 2)}</td>
                  <td className="tabular-nums">{fmt(e.slope * 100, 2)}%</td>
                  <td className="tabular-nums whitespace-nowrap">{fmt(e.flow_m3s, 2)} / {fmt(e.effective_capacity_m3s, 2)}</td>
                  <td><UtilBar value={e.utilization} status={e.status} /></td>
                  <td className="tabular-nums whitespace-nowrap">{fmt(e.velocity_ms, 2)} m/s</td>
                  <td><LevelBadge level={e.status} map={DRAIN_COLORS} /></td>
                  <td className="whitespace-nowrap space-x-1">
                    {e.bottleneck && <Badge color="#dc2626">Bottleneck</Badge>}
                    {e.legacy_undersized && <Badge color="#f97316">Legacy undersized</Badge>}
                    {e.adverse_grade && <Badge color="#eab308">Adverse grade</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <DrainDrawer id={sel} onClose={() => setSel(null)} />
    </Section>
  );
}
