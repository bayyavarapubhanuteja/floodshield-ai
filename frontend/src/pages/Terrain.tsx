/* Terrain & Runoff — DEM analysis layers and SCS-CN / rational-method runoff. */
import { useMemo, useState } from "react";
import { Droplets, Layers, Mountain, Table2, TrendingUp, Waves, BookOpen } from "lucide-react";
import { Area, Bar, BarChart, CartesianGrid, Cell as RCell, ComposedChart, Legend as RLegend, Line, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { useApi } from "@/hooks/useApi";
import { Card, DataLabel, ErrorBox, Kpi, Loading, PageHeader, Progress, Section, Spinner, Stat, Tabs } from "@/components/ui";
import { CityMap, GridOverlay, Legend, MapOverlay, useMapStatic } from "@/components/map";
import { LANDCOVER_COLORS, fmt, pct } from "@/lib/format";
import { TERRAIN_LAYERS, WardLabels, XRAMPS, axis, gridStroke, tooltipStyle, useTerrainLayer } from "@/components/gis/common";

const LC_IDS: Record<string, number> = { "Dense urban": 1, Residential: 2, Commercial: 3, "Parks / green": 4, "Water body": 5, "Bare / open soil": 6 };
const lcColor = (name: string) => `rgb(${(LANDCOVER_COLORS[LC_IDS[name]] || [148, 163, 184]).join(",")})`;
const RUNOFF_LEGEND = [1, 60, 150, 300, 450].map((v) => ({ color: `rgb(${XRAMPS.runoffLsha(v).slice(0, 3).join(",")})`, label: `${v} L/s/ha` }));

export default function Terrain() {
  const [tab, setTab] = useState<"terrain" | "runoff">("terrain");
  return (
    <Section>
      <PageHeader icon={Mountain} title="Terrain & Runoff"
        subtitle="DEM hydrological conditioning (slope, flow accumulation, catchments, depressions, water paths) and land-cover-driven surface runoff."
        labels={["DEMO_DATA", "SIMULATED_DATA", "MODEL_PREDICTION"]}
        actions={<Tabs value={tab} onChange={setTab} tabs={[{ key: "terrain", label: "Terrain (DEM)", icon: Mountain }, { key: "runoff", label: "Runoff", icon: Droplets }]} />} />
      {tab === "terrain" ? <TerrainSection /> : <RunoffSection />}
    </Section>
  );
}

function TerrainSection() {
  const st = useMapStatic();
  const [layer, setLayer] = useState("elevation");
  const { data, error, reload } = useApi<any>("/api/terrain", { live: false });
  const L = useTerrainLayer(layer);
  const def = TERRAIN_LAYERS.find((l) => l.key === layer)!;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading text="Analysing DEM…" />;
  const s = data.stats;
  const lc = Object.entries(data.landcover_counts as Record<string, number>).map(([name, n]) => ({ name, n, pct: n / (data.grid.rows * data.grid.cols) }));

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-4">
        <Kpi label="Elevation range" value={`${fmt(s.min_elevation_m, 0)}–${fmt(s.max_elevation_m, 0)}`} unit="m" icon={Mountain} color="#84cc16" />
        <Kpi label="Mean slope" value={fmt(s.mean_slope_pct, 2)} unit="%" icon={TrendingUp} color="#eab308" sub="flat → slow drainage" />
        <Kpi label="Low-lying cells" value={s.low_lying_cells} icon={Waves} color="#ea580c" sub={`of ${data.grid.rows * data.grid.cols} (${data.grid.cell_m} m)`} />
        <Kpi label="Depression cells" value={s.depression_cells} icon={Droplets} color="#2563eb" />
        <Kpi label="Catchments" value={s.catchments} icon={Layers} color="#0ea5e9" />
        <Kpi label="Water-path cells" value={s.water_path_cells} icon={Waves} color="#0284c7" />
        <Kpi label="Imperviousness" value={fmt(s.mean_imperviousness_pct, 1)} unit="%" icon={Table2} color="#475569" />
      </div>

      <div className="grid xl:grid-cols-4 gap-4 mb-4">
        <Card className="xl:col-span-3" title={def.label} icon={Layers} subtitle={def.desc}
          actions={<>{L.loading && <Spinner size={14} />}<DataLabel label="DEMO_DATA" /></>}>
          <div className="flex flex-wrap gap-1 mb-3" role="radiogroup" aria-label="Terrain layer">
            {TERRAIN_LAYERS.map((l) => (
              <button key={l.key} role="radio" aria-checked={layer === l.key} onClick={() => setLayer(l.key)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold border ${layer === l.key ? "bg-brand text-white dark:text-slate-900 border-brand" : "border-line text-muted hover:text-ink"}`}>
                {l.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <CityMap className="h-[480px]">
              {st && L.cells && <GridOverlay cells={L.cells} rows={st.rows} cols={st.cols} bbox={st.bbox} color={def.color} opacity={0.72} smooth={!!def.normalise || layer === "slope" || layer === "flow_accumulation"} />}
              {st && <WardLabels st={st} />}
            </CityMap>
            <MapOverlay position="bottom-left"><Legend title={`${def.label}${def.unit ? ` (${def.unit})` : ""}`} items={def.legend} /></MapOverlay>
            {L.data && <MapOverlay position="top-right"><span className="chip bg-panel border border-line">min {fmt(L.data.min, 2)} · max {fmt(L.data.max, 2)}{def.unit ? ` ${def.unit}` : ""}</span></MapOverlay>}
          </div>
          {L.error && <div className="mt-2"><ErrorBox error={L.error} onRetry={L.reload} /></div>}
          <p className="text-[11px] text-muted mt-2">{data.source}</p>
        </Card>
        <div className="flex flex-col gap-4 min-w-0">
          <Card title="Land cover" icon={Layers} actions={<DataLabel label="DEMO_DATA" />}>
            <div className="h-48">
              <ResponsiveContainer>
                <BarChart data={lc} layout="vertical" margin={{ left: 0, right: 16, top: 4 }}>
                  <XAxis type="number" {...axis} />
                  <YAxis type="category" dataKey="name" width={100} {...axis} interval={0} />
                  <RTooltip contentStyle={tooltipStyle} formatter={(v: any, _n: any, p: any) => [`${v} cells (${pct(p.payload.pct, 1)})`, "Area"]} />
                  <Bar dataKey="n" radius={[0, 3, 3, 0]}>{lc.map((d) => <RCell key={d.name} fill={lcColor(d.name)} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Methods" icon={BookOpen}>
            <ol className="text-xs list-decimal pl-4 space-y-1">{data.method.map((m: string) => <li key={m}>{m}</li>)}</ol>
          </Card>
        </div>
      </div>

      <div className="grid xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2" title="Ward terrain profile" icon={Table2} bodyClass="px-0 pb-0 overflow-x-auto scroll-thin max-h-[420px]" actions={<DataLabel label="DEMO_DATA" />}>
          <table className="table">
            <thead><tr><th>Ward</th><th>Mean elev.</th><th>Min elev.</th><th>Mean slope</th><th>Low-lying</th><th>Impervious</th></tr></thead>
            <tbody>
              {[...data.wards].sort((a: any, b: any) => a.mean_elevation_m - b.mean_elevation_m).map((w: any) => (
                <tr key={w.ward}>
                  <td className="font-medium">{w.ward}</td>
                  <td className="tabular-nums">{fmt(w.mean_elevation_m, 1)} m</td>
                  <td className="tabular-nums">{fmt(w.min_elevation_m, 1)} m</td>
                  <td className="tabular-nums">{fmt(w.mean_slope_pct, 2)}%</td>
                  <td className="tabular-nums">{fmt(w.low_lying_pct, 1)}%</td>
                  <td className="min-w-[120px]"><div className="flex items-center gap-2"><Progress value={w.imperviousness_pct} max={100} color="#475569" /><span className="text-xs tabular-nums">{fmt(w.imperviousness_pct, 0)}%</span></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Land-cover hydrological parameters" icon={Table2} bodyClass="px-0 pb-0 overflow-x-auto scroll-thin">
          <table className="table">
            <thead><tr><th>Class</th><th>Imperv.</th><th>C</th><th>CN</th><th>Manning n</th></tr></thead>
            <tbody>
              {Object.values(data.landcover_classes as Record<string, any>).map((c: any) => (
                <tr key={c.name}>
                  <td className="whitespace-nowrap"><span className="inline-block h-2.5 w-2.5 rounded-sm mr-1.5" style={{ background: lcColor(c.name) }} />{c.name}</td>
                  <td className="tabular-nums">{pct(c.impervious)}</td><td className="tabular-nums">{c.C}</td><td className="tabular-nums">{c.CN}</td><td className="tabular-nums">{c.roughness}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}

function RunoffSection() {
  const st = useMapStatic();
  const { data, error, reload } = useApi<any>("/api/runoff");
  const hist = useMemo(() => (data?.history || []).map((h: any) => ({ t: h.event_minute, runoff: h.runoff_m3s, rain: h.rain_mm_hr })), [data]);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading text="Computing runoff…" />;
  const wards = [...data.wards].sort((a: any, b: any) => b.runoff_m3s - a.runoff_m3s);
  const cumCmp = [{ name: "Cumulative rain", mm: data.cumulative_rain_mm, fill: "#3b82f6" }, { name: "Cumulative runoff", mm: data.cumulative_runoff_mm, fill: "#f97316" }];

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Kpi label="Total runoff rate" value={fmt(data.total_runoff_rate_m3s, 0)} unit="m³/s" icon={Waves} color="#f97316" labelTag="MODEL_PREDICTION" />
        <Kpi label="Runoff ratio" value={pct(data.runoff_ratio)} icon={TrendingUp} color={data.runoff_ratio > 0.6 ? "#dc2626" : "#eab308"} sub="runoff ÷ rainfall" />
        <Kpi label="Cumulative rain" value={fmt(data.cumulative_rain_mm, 0)} unit="mm" icon={Droplets} color="#3b82f6" labelTag="SIMULATED_DATA" />
        <Kpi label="Cumulative runoff" value={fmt(data.cumulative_runoff_mm, 0)} unit="mm" icon={Droplets} color="#f97316" />
        <Kpi label="Volume this 5-min step" value={fmt(data.runoff_volume_step_m3 / 1000, 1)} unit="×1000 m³" icon={Waves} color="#0ea5e9" />
      </div>

      <div className="grid xl:grid-cols-3 gap-4 mb-4">
        <Card className="xl:col-span-2" title="Runoff generation map" icon={Layers} subtitle={`Surface runoff rate per cell (${data.grid_units}); hotspots marked by the table.`} actions={<DataLabel label="MODEL_PREDICTION" />}>
          <div className="relative">
            <CityMap className="h-[440px]">
              {st && <GridOverlay cells={data.grid} rows={st.rows} cols={st.cols} bbox={st.bbox} color={XRAMPS.runoffLsha} opacity={0.65} smooth />}
              {st && <WardLabels st={st} />}
            </CityMap>
            <MapOverlay position="bottom-left"><Legend title="Runoff rate" items={RUNOFF_LEGEND} /></MapOverlay>
          </div>
        </Card>
        <div className="flex flex-col gap-4 min-w-0">
          <Card title="Rain vs runoff (cumulative)" icon={Droplets}>
            <div className="h-40">
              <ResponsiveContainer>
                <BarChart data={cumCmp} margin={{ left: -10, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                  <XAxis dataKey="name" {...axis} />
                  <YAxis {...axis} unit=" mm" />
                  <RTooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="mm" radius={[3, 3, 0, 0]}>{cumCmp.map((d) => <RCell key={d.name} fill={d.fill} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted mt-1">{pct(data.runoff_ratio)} of the rain that has fallen has become surface runoff; the rest is initial abstraction and infiltration.</p>
          </Card>
          <Card title="Method" icon={BookOpen}>
            <p className="text-xs">{data.method}</p>
            <ul className="text-xs text-muted list-disc pl-4 mt-2 space-y-1">
              <li><b>SCS Curve Number:</b> S = 25400/CN − 254 mm; Ia = 0.2 S; Q = (P − Ia)² / (P − Ia + S) for P &gt; Ia. Runoff rate is the increment of Q per time step.</li>
              <li><b>Rational method (cross-check):</b> Q = C · i · A, with C from the land-cover table below.</li>
              <li>CN is set per land-cover class and adjusted for cell imperviousness. Rainfall input is SIMULATED.</li>
            </ul>
          </Card>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Card title="Runoff history" icon={TrendingUp} actions={<DataLabel label="SIMULATED_DATA" />}>
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={hist} margin={{ left: -10, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="t" tickFormatter={(v) => `T+${v}`} {...axis} />
                <YAxis yAxisId="l" {...axis} />
                <YAxis yAxisId="r" orientation="right" {...axis} />
                <RTooltip contentStyle={tooltipStyle} labelFormatter={(v) => `Event minute ${v}`} />
                <RLegend wrapperStyle={{ fontSize: 11 }} />
                <Area yAxisId="l" dataKey="runoff" name="Runoff m³/s" stroke="#f97316" fill="#f97316" fillOpacity={0.25} />
                <Line yAxisId="r" dataKey="rain" name="Rain mm/hr" stroke="#3b82f6" dot={false} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Ward runoff" icon={Waves} actions={<DataLabel label="MODEL_PREDICTION" />}>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={wards} margin={{ left: -10, right: 8, top: 8, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                <XAxis dataKey="ward" {...axis} angle={-40} textAnchor="end" interval={0} fontSize={10} />
                <YAxis {...axis} />
                <RTooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [fmt(v, 1), n]} />
                <Bar dataKey="runoff_m3s" name="Runoff m³/s" fill="#f97316" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2" title="Runoff hotspots" icon={Table2} bodyClass="px-0 pb-0 overflow-x-auto scroll-thin">
          <table className="table">
            <thead><tr><th>#</th><th>Ward</th><th>Cell</th><th>Location</th><th>Runoff</th><th>Cum. runoff</th><th>Land cover</th></tr></thead>
            <tbody>
              {data.hotspots.map((h: any, i: number) => (
                <tr key={`${h.r}-${h.c}`}>
                  <td className="text-muted">{i + 1}</td>
                  <td className="font-medium">{h.ward}</td>
                  <td className="tabular-nums text-xs">r{h.r} c{h.c}</td>
                  <td className="tabular-nums text-xs">{fmt(h.lat_lon[0], 4)}, {fmt(h.lat_lon[1], 4)}</td>
                  <td className="tabular-nums whitespace-nowrap">{fmt(h.runoff_l_s_ha, 0)} L/s/ha</td>
                  <td className="tabular-nums">{fmt(h.cum_runoff_mm, 0)} mm</td>
                  <td className="whitespace-nowrap"><span className="inline-block h-2.5 w-2.5 rounded-sm mr-1.5" style={{ background: lcColor(h.landcover) }} />{h.landcover}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Runoff coefficients" icon={Table2} bodyClass="px-0 pb-0 overflow-x-auto scroll-thin">
          <table className="table">
            <thead><tr><th>Land cover</th><th>C</th><th>CN</th><th>Imperv.</th></tr></thead>
            <tbody>
              {Object.entries(data.coefficients as Record<string, any>).map(([k, v]) => (
                <tr key={k}>
                  <td className="whitespace-nowrap"><span className="inline-block h-2.5 w-2.5 rounded-sm mr-1.5" style={{ background: lcColor(k) }} />{k}</td>
                  <td className="tabular-nums">{v.C}</td><td className="tabular-nums">{v.CN}</td><td className="tabular-nums">{pct(v.impervious)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-3"><Stat label="Ward runoff ratio range" value={`${fmt(Math.min(...wards.map((w: any) => w.runoff_ratio)), 2)} – ${fmt(Math.max(...wards.map((w: any) => w.runoff_ratio)), 2)}`} /></div>
        </Card>
      </div>
    </>
  );
}
