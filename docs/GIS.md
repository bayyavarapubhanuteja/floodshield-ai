# GIS and terrain

Sources: `backend/app/engines/world.py`, `engines/terrain.py`, `app/data/cities.py`, `scripts/seed.py`.

## Grid and coordinate system

| Item | Value |
|---|---|
| CRS | WGS 84 geographic (lat, lon) for every coordinate the API returns. Metric quantities use a local equirectangular approximation. |
| Domain | Square bounding box centred on the city centre: `bbox = (lat₀ − span/2, lon₀ − span/2, lat₀ + span/2, lon₀ + span/2)` |
| Grid | `n × n` cells, `n = FS_GRID_SIZE` (default **48**, i.e. 2,304 cells); row 0 is the north edge |
| Cell size | `span · 111 320 · cos(lat₀) / n` metres. For Hyderabad (span 0.075°) this is **≈ 166 m**, and the domain is ≈ 8 × 8 km. |
| Hyderabad bbox | south 17.3690, west 78.4397, north 17.4440, east 78.5147 |

Cell (r, c) centre: `lat = north − (r + 0.5)·Δlat`, `lon = west + (c + 0.5)·Δlon`. `World.latlon_to_rc`,
`rc_to_latlon` and `cell_bounds` do the conversions. Grid responses use compact `[row, col, value]` triples.

Cities: Hyderabad (default), Mumbai, Delhi, Chennai, Bengaluru and Visakhapatnam. Each has its real centre, 16 real
locality names used as wards, real street names, river name, base elevation, relief and monsoon months.

## Synthetic city "world" (`DEMO_DATA`)

`build_world(city)` is deterministic: it uses a fixed per-city seed, so every run produces identical geography. This
is covered by `tests/test_engines.py::test_world_generation_is_deterministic`.

| Layer | How it is generated |
|---|---|
| **DEM** | Regional tilt towards a meandering river valley at ~62 % of the grid height; 4 Gaussian hills; 6 low-lying pockets 0.9–1.8 m deep (underpasses / old tank beds); smoothed noise; a carved river channel. The result is scaled to `base_elev + relief` (Hyderabad 520–558 m). |
| **River** | Cells within 1 cell of the valley centreline. They act as outfall receiving water and as a fixed-head boundary in the surface model. |
| **Land cover** | 6 classes (table below). Commercial core, dense urban ring, residential outskirts, noise-driven parks and bare soil, and water on the river. |
| **Wards** | 16 Voronoi regions around a 4 × 4 lattice of centres, named from the city's locality list |
| **Roads** | A 10 × 10 jittered junction lattice. Arterial rows/columns (6 lanes, 50 km/h), collectors (4 lanes, 35 km/h), locals (2 lanes, 25 km/h). About 8 % of local links are dropped, the largest connected component is kept, and about 6 % of segments are flagged as underpasses. Each segment stores its polyline and the grid cells it crosses. Hyderabad has 174 segments and 100 junctions. |
| **Drainage twin** | Manholes/junctions under road junctions, street inlets at about 55 % of segment midpoints, and 6 river outfalls. The conduit network is sized by the rational method (see [HYDRAULICS.md](HYDRAULICS.md)). Hyderabad has 192 nodes (55 junctions, 45 manholes, 86 inlets, 6 outfalls) and 186 conduits (138 pipes, 48 box drains; 33 legacy undersized, 10 with adverse grade). |
| **Infrastructure** | 37 facilities of 9 kinds: 6 hospitals, 5 police, 4 fire stations, 6 schools, 3 rail/metro stations, 2 bus terminals, 4 shelters, 4 substations and 3 government offices. They are snapped near junctions. One hospital, one school and one substation are placed deliberately among the lowest junctions, and shelters are placed on high ground. |
| **Analysis cameras** | 8 locations at the highest-degree junctions. They are used only to geolocate uploaded footage; there is no live feed. |

| Code | Land cover | Impervious | Runoff C | SCS CN | Manning n (surface; defined, not used by the diffusive scheme) |
|---|---|---|---|---|---|
| 1 | Dense urban | 0.90 | 0.88 | 94 | 0.015 |
| 2 | Residential | 0.65 | 0.70 | 86 | 0.030 |
| 3 | Commercial | 0.85 | 0.85 | 92 | 0.015 |
| 4 | Parks / green | 0.12 | 0.20 | 61 | 0.060 |
| 5 | Water body | 1.00 | 1.00 | 98 | 0.035 |
| 6 | Bare / open soil | 0.30 | 0.40 | 77 | 0.040 |

## Terrain algorithms (`engines/terrain.py`)

| Product | Algorithm |
|---|---|
| Slope (% and °), aspect | Central differences (`numpy.gradient`) on the metric grid |
| **Depression filling** | **Priority-flood** (Barnes et al., 2014) with ε = 1e-4 m, so filled flats still drain. All boundary cells seed a min-heap; each popped cell raises unvisited neighbours to at least its own level + ε. `depression = filled − dem`. |
| Flow direction | **D8** steepest descent on the filled DEM (diagonal distance √2·cell) |
| **Flow accumulation** | Cells are processed from highest to lowest filled elevation, and each cell passes its count downstream. Every cell contributes 1, so the counts arriving at outlets sum to the number of cells (tested). |
| Catchments | Outlet-labelled basins, processed low → high. The 8 largest are kept and numbered (Hyderabad has 3 non-trivial basins). |
| Low-lying areas | Elevation ≤ 15th percentile **or** depression depth > 0.25 m |
| Natural water paths | Flow accumulation ≥ max(40 cells, 93rd percentile) |

The drainage-node catchments used by the hydraulic model are different from the topographic catchments above. Each
grid cell drains to its nearest non-outfall drainage node (a Voronoi assignment via a KD-tree), which represents
street-level collection.

## Map layers served by the API

| Endpoint | Layers |
|---|---|
| `GET /api/terrain/layer?name=` | `elevation`, `slope`, `aspect`, `flow_accumulation` (log10), `catchment`, `low_lying`, `water_paths`, `depression`, `imperviousness`, `landcover` (with legend), `runoff_coefficient` |
| `GET /api/map/static` | Wards, road polylines, junctions, drain nodes, drain conduits, infrastructure, analysis cameras, river cells |
| `GET /api/map/dynamic?horizon=` | Rain, accumulated rain, runoff (L/s/ha), depth, flood probability, flood zones, and road / drain / facility / ward states at NOW or a forecast horizon |
| `GET /api/flood/zones?horizon=` | GeoJSON FeatureCollection. Zones are connected components of cells with depth ≥ 0.10 m (at least 2 cells), each a union of cell boxes via Shapely, with area, max/mean depth, probability and risk level. |

## Plugging in real data

The engines read everything through the `World` dataclass that `build_world()` returns, and they depend on that
object's fields, not on how it was produced. Replacing a synthetic layer with real data therefore means writing an
adapter that fills the same fields. **These adapters are not included in this build.** The steps below describe the
integration contract. The optional packages `rasterio` and `geopandas` are listed, commented out, in
`requirements.txt`.

### DEM: SRTM 30 m or Cartosat-1 CartoDEM

1. Download tiles covering the bbox. SRTM GL1 is available from USGS EarthExplorer or OpenTopography; CartoDEM
   (30 m) is available from ISRO Bhuvan / NRSC.
2. Mosaic, and fill voids (e.g. `gdal_fillnodata.py`).
3. Resample onto the platform grid:
   `rasterio.warp.reproject(..., dst_crs="EPSG:4326", dst_transform=from_bounds(west, south, east, north, n, n), resampling=Resampling.average)`.
4. Assign the result to `World.dem` (row 0 = north) and recompute `river_mask` from a water layer. For a finer grid,
   increase `FS_GRID_SIZE`; runtime grows roughly with the number of cells.

Terrain analysis, runoff, surface flow and risk will then use the real DEM unchanged. Note that SRTM/CartoDEM are
surface models with metre-level vertical error in built-up areas, which is coarse relative to street-level ponding.
A LiDAR DTM is preferable where available.

### Roads: OpenStreetMap

1. Extract the drivable network for the bbox (e.g. `osmnx.graph_from_bbox(..., network_type="drive")`, or a
   Geofabrik extract processed with `osmium`).
2. Build `road_nodes` (`id`, `lat`, `lon`, `r`, `c`, `elevation_m`, `ward`) and `roads` (`id`, `name`, `street`,
   `ward`, `road_class` from the OSM `highway` tag, `from`, `to`, `length_m`, `lanes`, `speed_kmh`, `underpass`
   from `tunnel=*` / `layer<0`, `coords`, and `cells` = grid cells crossed).
3. Build `road_graph` as a NetworkX `Graph` with edge attributes `id` and `length`.

### Drainage: municipal storm-water GIS (shapefile / GeoPackage)

1. Read manholes, inlets and outfalls as points and conduits as lines (`geopandas.read_file`).
2. Map attributes to the node fields (`id`, `kind` ∈ manhole/junction/inlet/outfall, `lat`, `lon`, `elevation_m`,
   `invert_m`, `storage_m3`, `connected_roads`, `downstream`, `upstream`) and the conduit fields (`id`, `from`, `to`,
   `length_m`, `diameter_m`, `slope`, `roughness`, `capacity_m3s`; compute the capacity with Manning's equation if
   it is missing).
3. Compute `drain_order` (upstream → downstream topological order), `node_cells` / `cell_node` (catchment
   assignment) and `catch_ids`, as `_build_drainage()` does.
4. Replace the assumed `baseline_blockage` and `days_since_cleaning` with values from maintenance records where
   they exist.

### Facilities

Load hospitals, police, fire, schools, shelters and so on from municipal registers or OSM (`amenity=hospital`,
`amenity=police`, `amenity=fire_station`, …). Snap each to its nearest road node (`road_node`) and set `critical`.

## PostGIS

In Docker the database is `postgis/postgis:16-3.4`, and `init_db()` runs `CREATE EXTENSION IF NOT EXISTS postgis`.
To stay portable with SQLite, geometries are stored as **GeoJSON in `JSON` columns**:

| Table | Column | Geometry |
|---|---|---|
| `roads` | `geom` | LineString |
| `drainage_nodes` | `geom` | Point |
| `drainage_edges` | `geom` | LineString |
| `infrastructure` | `geom` | Point |
| `flood_zones` | `geom` | Polygon / MultiPolygon |

The seed populates `roads`, `drainage_nodes`, `drainage_edges`, `infrastructure`, `dem_tiles` and `land_cover` for the
default city (or for all cities with `python -m scripts.seed --all-cities`). IDs are prefixed with the city,
e.g. `hyd-R001`. Coordinates are `[lon, lat]` (GeoJSON order, EPSG:4326).

Cast GeoJSON to PostGIS geometry with `ST_GeomFromGeoJSON`:

```sql
-- roads within 500 m of a point
SELECT id, name
FROM roads
WHERE city = 'hyderabad'
  AND ST_DWithin(
        ST_SetSRID(ST_GeomFromGeoJSON(geom::text), 4326)::geography,
        ST_SetSRID(ST_MakePoint(78.4772, 17.4065), 4326)::geography,
        500);

-- total conduit length per diameter class
SELECT round(diameter_m::numeric, 1) AS d,
       sum(ST_Length(ST_SetSRID(ST_GeomFromGeoJSON(geom::text), 4326)::geography)) / 1000 AS km
FROM drainage_edges WHERE city = 'hyderabad' GROUP BY 1 ORDER BY 1;

-- facilities inside a flood-zone polygon
SELECT f.id, f.name
FROM infrastructure f, flood_zones z
WHERE ST_Intersects(ST_SetSRID(ST_GeomFromGeoJSON(z.geom::text), 4326),
                    ST_SetSRID(ST_GeomFromGeoJSON(f.geom::text), 4326));
```

For heavy spatial querying, add a stored geometry column, e.g.
`ALTER TABLE roads ADD COLUMN the_geom geometry(LineString, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_GeomFromGeoJSON(geom::text), 4326)) STORED;`,
and put a GiST index on it.

The engines themselves compute flooding, zones, routing and exposure in memory (NumPy / Shapely / NetworkX). They do
not issue spatial SQL. PostGIS is available for external GIS tools (QGIS can connect directly), analytics and export.
