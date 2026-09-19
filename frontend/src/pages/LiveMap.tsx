/* Live Flood Map — full-height multi-layer GIS view with horizon animation, search and drill-down drawers. */
import { useEffect, useMemo, useState } from "react";
import { Layers, Map as MapIcon, Search, X, ChevronLeft } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { DataLabel, ErrorBox, PageHeader, Section, Select, Spinner } from "@/components/ui";
import {
  CctvLayer, CityMap, DrainsLayer, FacilitiesLayer, FlyTo, GridOverlay, HORIZON_OPTIONS, HorizonBar, LEGENDS, LayerPanel, Legend,
  MapOverlay, ReportsLayer, RoadColorBy, RoadsLayer, useMapStatic,
} from "@/components/map";
import { FACILITY_LABELS, RAMPS, depth, fmt, pct } from "@/lib/format";
import {
  DrainDrawer, FacilityDrawer, PlayButton, RoadDrawer, TerrainGrid, WardLabels, XRAMPS, ZonesLayer, terrainDef, usePlayer,
} from "@/components/gis/common";

const FAC_KINDS = Object.keys(FACILITY_LABELS);
const TERRAIN_KEYS: Record<string, string> = { t_elev: "elevation", t_slope: "slope", t_flow: "flow_accumulation", t_low: "low_lying", t_paths: "water_paths" };

const GROUPS = [
  { title: "Rainfall", layers: [{ key: "rain", label: "Rainfall intensity (at horizon)" }, { key: "rain_accum", label: "Rainfall accumulation" }] },
  { title: "Terrain", layers: [{ key: "t_elev", label: "DEM elevation" }, { key: "t_slope", label: "Slope" }, { key: "t_flow", label: "Flow accumulation" }, { key: "t_low", label: "Low-lying areas" }, { key: "t_paths", label: "Natural water paths" }] },
  { title: "Runoff", layers: [{ key: "runoff", label: "Surface runoff (L/s/ha)" }] },
  { title: "Flood", layers: [{ key: "depth", label: "Flood depth" }, { key: "prob", label: "Flood probability" }, { key: "extent", label: "Flood extent (zones)" }] },
  { title: "Drainage", layers: [{ key: "drain_edges", label: "Conduits" }, { key: "drain_nodes", label: "Manholes / nodes" }] },
  { title: "Roads", layers: [{ key: "roads", label: "Road network" }] },
  { title: "Infrastructure", layers: FAC_KINDS.map((k) => ({ key: `fac_${k}`, label: FACILITY_LABELS[k] })) },
  { title: "Observations", layers: [{ key: "cctv", label: "CCTV analysis locations" }, { key: "reports", label: "Citizen reports" }, { key: "wards", label: "Ward labels" }] },
];
const DEFAULT = new Set(["depth", "extent", "roads", "wards", "fac_hospital", "fac_fire_station", "fac_police", "fac_shelter"]);
const PASS_LEGEND = [
  { color: "#16a34a", label: "Passable" }, { color: "#84cc16", label: "Caution" }, { color: "#eab308", label: "Unsafe light veh." },
  { color: "#f97316", label: "Emergency only" }, { color: "#dc2626", label: "Impassable" },
];

type Hit = { type: "road" | "ward" | "facility" | "drain"; id: string; name: string; sub: string; center: [number, number] };

export default function LiveMap() {
  const st = useMapStatic();
  const [layers, setLayers] = useState<Set<string>>(DEFAULT);
  const [panelOpen, setPanelOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 768);
  const [colorBy, setColorBy] = useState<RoadColorBy>("depth");
  const [q, setQ] = useState("");
  const [fly, setFly] = useState<[number, number] | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [roadId, setRoadId] = useState<string | null>(null);
  const [drainId, setDrainId] = useState<string | null>(null);
  const [facId, setFacId] = useState<string | null>(null);

  // animation only advances once the frame for the current horizon has loaded
  const [ready, setReady] = useState(true);
  const player = usePlayer(HORIZON_OPTIONS.length, { interval: 1600, ready });
  const h = HORIZON_OPTIONS[player.idx] ?? 0;
  const { data: dyn, error, loading, reload } = useApi<any>(`/api/map/dynamic?horizon=${h}`);
  useEffect(() => { setReady(!loading && dyn?.horizon_min === h); }, [loading, dyn, h]);

  const on = (k: string) => layers.has(k);
  const reports = useApi<any>(on("reports") ? "/api/citizen-report" : null);

  const roadStatus = useMemo(() => Object.fromEntries((dyn?.roads || []).map((r: any) => [r.id, r])), [dyn]);
  const facStatus = useMemo(() => Object.fromEntries((dyn?.facilities || []).map((f: any) => [f.id, f])), [dyn]);
  const drainStatus = useMemo(() => Object.fromEntries((dyn?.drains || []).map((d: any) => [d.id, d])), [dyn]);
  const kinds = useMemo(() => new Set(FAC_KINDS.filter((k) => layers.has(`fac_${k}`))), [layers]);
  const wardAlert = useMemo(() => Object.fromEntries((dyn?.wards || []).filter((w: any) => w.alert_level !== "GREEN").map((w: any) => [w.id, w.alert_level])), [dyn]);

  const hits = useMemo<Hit[]>(() => {
    if (!st || q.trim().length < 2) return [];
    const s = q.trim().toLowerCase();
    const out: Hit[] = [];
    st.wards.forEach((w) => { if (w.name.toLowerCase().includes(s)) out.push({ type: "ward", id: w.id, name: w.name, sub: "Ward", center: w.center }); });
    st.infrastructure.forEach((f) => {
      if (f.name.toLowerCase().includes(s) || f.id.toLowerCase() === s) out.push({ type: "facility", id: f.id, name: f.name, sub: `${FACILITY_LABELS[f.kind] || f.kind} · ${f.ward}`, center: [f.lat, f.lon] });
    });
    st.roads.forEach((r) => {
      if (r.name.toLowerCase().includes(s) || r.id.toLowerCase() === s) out.push({ type: "road", id: r.id, name: r.name, sub: `Road ${r.id} · ${r.ward}`, center: r.coords[Math.floor(r.coords.length / 2)] });
    });
    st.drain_nodes.forEach((n) => { if (n.id.toLowerCase() === s) out.push({ type: "drain", id: n.id, name: n.id, sub: `Drain ${n.kind} · ${n.ward}`, center: [n.lat, n.lon] }); });
    return out.slice(0, 10);
  }, [st, q]);

  const pick = (x: Hit) => {
    setFly([x.center[0], x.center[1]]);
    setQ("");
    if (x.type === "road") { setHighlight(x.id); setRoadId(x.id); if (!layers.has("roads")) setLayers(new Set([...layers, "roads"])); }
    if (x.type === "facility") { setFacId(x.id); if (!layers.has(`fac_${st?.infrastructure.find((f) => f.id === x.id)?.kind}`)) setLayers(new Set([...layers, `fac_${st?.infrastructure.find((f) => f.id === x.id)?.kind}`])); }
    if (x.type === "drain") setDrainId(x.id);
  };

  const legends: { title: string; items: { color: string; label: string }[] }[] = [];
  if (on("depth")) legends.push({ title: "Flood depth", items: LEGENDS.depth });
  if (on("prob")) legends.push({ title: "Flood probability", items: LEGENDS.probability });
  if (on("extent")) legends.push({ title: "Flood zones (risk)", items: LEGENDS.risk });
  if (on("rain")) legends.push({ title: "Rainfall", items: LEGENDS.rain });
  if (on("rain_accum")) legends.push({ title: "Accumulation", items: [{ color: "#e0f2fe", label: "< 50 mm" }, { color: "#38bdf8", label: "50 mm" }, { color: "#2563eb", label: "150 mm" }, { color: "#581c87", label: "≥ 300 mm" }] });
  if (on("runoff")) legends.push({ title: "Runoff L/s/ha", items: [1, 60, 150, 300, 450].map((v) => ({ color: `rgb(${XRAMPS.runoffLsha(v).slice(0, 3).join(",")})`, label: `${v}` })) });
  Object.entries(TERRAIN_KEYS).forEach(([k, n]) => { if (on(k)) legends.push({ title: terrainDef(n).label, items: terrainDef(n).legend }); });
  if (on("roads")) legends.push({ title: `Roads by ${colorBy}`, items: colorBy === "risk" ? LEGENDS.risk : colorBy === "passability" ? PASS_LEGEND : LEGENDS.roadDepth });
  if (on("drain_nodes") || on("drain_edges")) legends.push({ title: "Drainage state", items: LEGENDS.drain });
  if (kinds.size) legends.push({ title: "Facility status", items: LEGENDS.facility });

  return (
    <Section>
      <PageHeader icon={MapIcon} title="Live Flood Map"
        subtitle="Multi-layer GIS: rainfall, terrain, runoff, flood depth & extent, drainage, roads, critical infrastructure and field observations. Press Play to animate flood propagation NOW → +180 min."
        labels={[h === 0 ? "SIMULATED_DATA" : "MODEL_PREDICTION", "DEMO_DATA", "USER_REPORTED_DATA"]}
        actions={<>
          {loading && <Spinner size={16} />}
          {dyn && <span className="chip border border-line bg-panel">T+{dyn.event_minute}{h ? ` → +${h} min` : " (now)"} · max {depth(dyn.kpis.max_depth_m)} · {fmt(dyn.kpis.flooded_area_km2, 2)} km² · conf {pct(dyn.kpis.confidence)}</span>}
        </>} />
      {error && !dyn && <div className="mb-3"><ErrorBox error={error} onRetry={reload} /></div>}

      <div className="relative">
        <CityMap className="h-[calc(100vh-170px)] min-h-[460px]">
          {st && dyn && on("rain") && <GridOverlay cells={dyn.rain_cells} rows={st.rows} cols={st.cols} bbox={st.bbox} color={RAMPS.rain} opacity={0.55} smooth />}
          {st && dyn && on("rain_accum") && <GridOverlay cells={dyn.rain_accum_cells} rows={st.rows} cols={st.cols} bbox={st.bbox} color={RAMPS.rainAccum} opacity={0.55} smooth />}
          {st && Object.entries(TERRAIN_KEYS).map(([k, n]) => (on(k) ? <TerrainGrid key={k} name={n} st={st} opacity={0.6} /> : null))}
          {st && dyn && on("runoff") && <GridOverlay cells={dyn.runoff_cells} rows={st.rows} cols={st.cols} bbox={st.bbox} color={XRAMPS.runoffLsha} opacity={0.55} smooth />}
          {st && dyn && on("prob") && <GridOverlay cells={dyn.probability_cells} rows={st.rows} cols={st.cols} bbox={st.bbox} color={RAMPS.probability} opacity={0.5} smooth />}
          {st && dyn && on("depth") && <GridOverlay cells={dyn.depth_cells} rows={st.rows} cols={st.cols} bbox={st.bbox} color={RAMPS.depth} opacity={0.75} />}
          {dyn && on("extent") && <ZonesLayer zones={dyn.zones || []} labels />}
          {st && (on("drain_edges") || on("drain_nodes")) && <DrainsLayer st={st} status={drainStatus} showEdges={on("drain_edges")} showNodes={on("drain_nodes")} onSelect={setDrainId} />}
          {st && on("roads") && <RoadsLayer roads={st.roads} status={roadStatus} colorBy={colorBy} highlight={highlight} onSelect={(id) => { setHighlight(id); setRoadId(id); }} />}
          {st && kinds.size > 0 && <FacilitiesLayer st={st} status={facStatus} kinds={kinds} onSelect={setFacId} />}
          {st && on("cctv") && <CctvLayer st={st} />}
          {on("reports") && reports.data?.reports && <ReportsLayer reports={reports.data.reports} />}
          {st && on("wards") && <WardLabels st={st} extra={wardAlert} />}
          <FlyTo center={fly} zoom={16} />
        </CityMap>

        {/* layer panel */}
        <MapOverlay position="top-left" className="max-w-[calc(100%-4rem)]">
          {panelOpen ? (
            <div className="card w-64 max-w-full max-h-[calc(100vh-280px)] min-h-[200px] overflow-auto scroll-thin p-3 shadow-card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold flex items-center gap-1.5"><Layers size={14} className="text-brand" />Layers</span>
                <button className="p-1 rounded hover:bg-panel2" aria-label="Collapse layer panel" onClick={() => setPanelOpen(false)}><ChevronLeft size={16} /></button>
              </div>
              <Select label="Colour roads by" value={colorBy} onChange={(v) => setColorBy(v as RoadColorBy)} className="mb-3"
                options={[{ value: "depth", label: "Water depth" }, { value: "risk", label: "Risk level" }, { value: "passability", label: "Passability (NOW)" }]} />
              <LayerPanel groups={GROUPS} value={layers} onChange={setLayers} />
              <p className="text-[10.5px] text-muted mt-3">Closed roads are dashed. Click a road, drain node or facility for details. Facility locations are DEMO DATA; citizen reports are USER-REPORTED.</p>
            </div>
          ) : (
            <button className="btn-ghost btn-sm bg-panel shadow-card" onClick={() => setPanelOpen(true)} aria-label="Open layer panel"><Layers size={14} />Layers ({layers.size})</button>
          )}
        </MapOverlay>

        {/* search */}
        <MapOverlay position="top-right" className="w-[min(18rem,calc(100%-9rem))]">
          <div className="relative">
            <label htmlFor="map-search" className="sr-only">Search road, ward or facility</label>
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input id="map-search" className="input py-1.5 pl-8 pr-8 bg-panel shadow-card" placeholder="Find road, ward, facility…" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) pick(hits[0]); }} />
            {q && <button aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted" onClick={() => setQ("")}><X size={14} /></button>}
          </div>
          {q.trim().length >= 2 && (
            <ul className="card mt-1 max-h-72 overflow-auto scroll-thin shadow-card divide-y divide-line" role="listbox" aria-label="Search results">
              {hits.length === 0 && <li className="px-3 py-2 text-xs text-muted">No matches</li>}
              {hits.map((x) => (
                <li key={`${x.type}-${x.id}`}>
                  <button className="w-full text-left px-3 py-1.5 hover:bg-panel2" onClick={() => pick(x)}>
                    <div className="text-sm font-medium truncate">{x.name}</div>
                    <div className="text-[11px] text-muted">{x.sub}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </MapOverlay>

        {/* time control */}
        <MapOverlay position="bottom-right" className="flex flex-wrap items-center justify-end gap-1.5 max-w-[calc(100%-1rem)]">
          <DataLabel label={h === 0 ? "SIMULATED_DATA" : "MODEL_PREDICTION"} className="bg-panel" />
          <PlayButton playing={player.playing} onClick={player.toggle} />
          <HorizonBar value={h} onChange={(v) => { player.setPlaying(false); player.setIdx(HORIZON_OPTIONS.indexOf(v)); }} />
        </MapOverlay>

        {/* legends */}
        <MapOverlay position="bottom-left" className="hidden lg:flex gap-2 items-end max-w-[50%] flex-wrap-reverse" >
          {legends.slice(0, 4).map((l) => <Legend key={l.title} title={l.title} items={l.items} />)}
        </MapOverlay>
      </div>
      {legends.length > 0 && (
        <div className="lg:hidden grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">{legends.map((l) => <Legend key={l.title} title={l.title} items={l.items} />)}</div>
      )}
      {legends.length > 4 && <div className="hidden lg:flex flex-wrap gap-2 mt-3">{legends.slice(4).map((l) => <Legend key={l.title} title={l.title} items={l.items} />)}</div>}

      <RoadDrawer id={roadId} onClose={() => setRoadId(null)} />
      <DrainDrawer id={drainId} onClose={() => setDrainId(null)} />
      <FacilityDrawer id={facId} onClose={() => setFacId(null)} />
    </Section>
  );
}
