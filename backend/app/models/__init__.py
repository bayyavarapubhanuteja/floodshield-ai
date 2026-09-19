"""SQLAlchemy ORM models. Geometry is stored as GeoJSON (JSON column) for portability;
on PostgreSQL the PostGIS extension is enabled and the same GeoJSON can be cast with
ST_GeomFromGeoJSON for spatial SQL. See docs/GIS.md."""
from datetime import datetime
from sqlalchemy import JSON, Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from app.core.database import Base


def now() -> datetime:
    return datetime.utcnow()


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    full_name = Column(String(255), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(40), default="CITIZEN", nullable=False)
    requested_role = Column(String(40), nullable=True)  # privileged roles need admin approval
    department = Column(String(120), default="")
    phone = Column(String(40), default="")
    city = Column(String(60), default="hyderabad")
    language = Column(String(10), default="en")
    theme = Column(String(10), default="dark")
    notify_web = Column(Boolean, default=True)
    notify_email = Column(Boolean, default=False)
    notify_sms = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now)


class Role(Base):
    __tablename__ = "roles"
    id = Column(Integer, primary_key=True)
    name = Column(String(40), unique=True)
    description = Column(String(255))
    permissions = Column(JSON, default=list)


class PasswordReset(Base):
    __tablename__ = "password_resets"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    token = Column(String(128), unique=True, index=True)
    expires_at = Column(DateTime)
    used = Column(Boolean, default=False)


class RainfallObservation(Base):
    __tablename__ = "rainfall_observations"
    id = Column(Integer, primary_key=True)
    city = Column(String(60), index=True)
    ts = Column(DateTime, default=now, index=True)
    intensity_mm_hr = Column(Float)
    source = Column(String(60))
    data_label = Column(String(30))
    grid = Column(JSON, nullable=True)


class RainfallForecast(Base):
    __tablename__ = "rainfall_forecasts"
    id = Column(Integer, primary_key=True)
    city = Column(String(60), index=True)
    issued_at = Column(DateTime, default=now)
    horizon_min = Column(Integer)
    intensity_mm_hr = Column(Float)
    accumulation_mm = Column(Float)
    confidence = Column(Float)
    model = Column(String(60))


class DEMTile(Base):
    __tablename__ = "dem_tiles"
    id = Column(Integer, primary_key=True)
    city = Column(String(60), index=True)
    bbox = Column(JSON)
    rows = Column(Integer)
    cols = Column(Integer)
    elevation = Column(JSON)
    source = Column(String(80))
    data_label = Column(String(30))


class LandCoverCell(Base):
    __tablename__ = "land_cover"
    id = Column(Integer, primary_key=True)
    city = Column(String(60), index=True)
    grid = Column(JSON)
    imperviousness = Column(JSON)
    source = Column(String(80))


class RunoffResult(Base):
    __tablename__ = "runoff_results"
    id = Column(Integer, primary_key=True)
    city = Column(String(60), index=True)
    ts = Column(DateTime, default=now)
    total_m3 = Column(Float)
    peak_rate_m3s = Column(Float)
    hotspots = Column(JSON)


class DrainageNode(Base):
    __tablename__ = "drainage_nodes"
    id = Column(String(40), primary_key=True)
    city = Column(String(60), index=True)
    kind = Column(String(20))
    lat = Column(Float)
    lon = Column(Float)
    elevation_m = Column(Float)
    invert_m = Column(Float)
    capacity_m3s = Column(Float)
    connected_roads = Column(JSON, default=list)
    geom = Column(JSON)


class DrainageEdge(Base):
    __tablename__ = "drainage_edges"
    id = Column(String(40), primary_key=True)
    city = Column(String(60), index=True)
    from_node = Column(String(40))
    to_node = Column(String(40))
    length_m = Column(Float)
    diameter_m = Column(Float)
    slope = Column(Float)
    roughness = Column(Float)
    capacity_m3s = Column(Float)
    geom = Column(JSON)


class DrainageEvent(Base):
    __tablename__ = "drainage_events"
    id = Column(Integer, primary_key=True)
    city = Column(String(60), index=True)
    ts = Column(DateTime, default=now)
    node_id = Column(String(40))
    state = Column(String(20))
    utilization = Column(Float)
    overflow_m3s = Column(Float)


class FloodPrediction(Base):
    __tablename__ = "flood_predictions"
    id = Column(Integer, primary_key=True)
    city = Column(String(60), index=True)
    ts = Column(DateTime, default=now, index=True)
    horizon_min = Column(Integer)
    max_depth_m = Column(Float)
    flooded_cells = Column(Integer)
    flooded_roads = Column(Integer)
    confidence = Column(Float)
    summary = Column(JSON)


class FloodZone(Base):
    __tablename__ = "flood_zones"
    id = Column(Integer, primary_key=True)
    city = Column(String(60), index=True)
    name = Column(String(120))
    geom = Column(JSON)
    risk = Column(String(20))
    depth_m = Column(Float)
    probability = Column(Float)


class Road(Base):
    __tablename__ = "roads"
    id = Column(String(40), primary_key=True)
    city = Column(String(60), index=True)
    name = Column(String(120))
    road_class = Column(String(20))
    geom = Column(JSON)
    length_m = Column(Float)
    elevation_m = Column(Float)
    lanes = Column(Integer)


class Infrastructure(Base):
    __tablename__ = "infrastructure"
    id = Column(String(40), primary_key=True)
    city = Column(String(60), index=True)
    kind = Column(String(30))
    name = Column(String(160))
    lat = Column(Float)
    lon = Column(Float)
    capacity = Column(Integer, default=0)
    phone = Column(String(40), default="")
    geom = Column(JSON)


class CCTVFile(Base):
    __tablename__ = "cctv_files"
    id = Column(Integer, primary_key=True)
    city = Column(String(60))
    filename = Column(String(255))
    media_type = Column(String(20))
    lat = Column(Float, nullable=True)
    lon = Column(Float, nullable=True)
    uploaded_by = Column(Integer, nullable=True)
    uploaded_at = Column(DateTime, default=now)


class CCTVEvent(Base):
    __tablename__ = "cctv_events"
    id = Column(Integer, primary_key=True)
    file_id = Column(Integer, ForeignKey("cctv_files.id"))
    city = Column(String(60))
    ts = Column(DateTime, default=now)
    result = Column(JSON)


class CitizenReport(Base):
    __tablename__ = "citizen_reports"
    id = Column(Integer, primary_key=True)
    city = Column(String(60), index=True)
    user_id = Column(Integer, nullable=True)
    lat = Column(Float)
    lon = Column(Float)
    estimated_depth_cm = Column(Float, default=0)
    road_condition = Column(String(40))
    description = Column(Text, default="")
    photo_path = Column(String(255), nullable=True)
    language = Column(String(10), default="en")
    status = Column(String(20), default="UNVERIFIED")
    moderator_note = Column(Text, default="")
    image_analysis = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=now)
    updated_at = Column(DateTime, default=now, onupdate=now)


class Alert(Base):
    __tablename__ = "alerts"
    id = Column(Integer, primary_key=True)
    city = Column(String(60), index=True)
    level = Column(String(10))
    title = Column(String(200))
    location = Column(String(200))
    lat = Column(Float)
    lon = Column(Float)
    expected_time_min = Column(Integer)
    expected_depth_m = Column(Float)
    affected_roads = Column(JSON, default=list)
    affected_infrastructure = Column(JSON, default=list)
    recommended_action = Column(Text)
    factors = Column(JSON, default=list)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now)


class RouteRecord(Base):
    __tablename__ = "routes"
    id = Column(Integer, primary_key=True)
    city = Column(String(60))
    mode = Column(String(30))
    origin = Column(JSON)
    destination = Column(JSON)
    result = Column(JSON)
    created_at = Column(DateTime, default=now)


class EmergencyContact(Base):
    __tablename__ = "emergency_contacts"
    id = Column(Integer, primary_key=True)
    city = Column(String(60), index=True)  # 'national' for pan-India numbers
    category = Column(String(40))
    name = Column(String(160))
    number = Column(String(60))
    description = Column(String(255), default="")
    verified = Column(Boolean, default=False)
    primary = Column(Boolean, default=False)
    sort_order = Column(Integer, default=100)


class Simulation(Base):
    __tablename__ = "simulations"
    id = Column(Integer, primary_key=True)
    city = Column(String(60), index=True)
    name = Column(String(160))
    user_id = Column(Integer, nullable=True)
    params = Column(JSON)
    result = Column(JSON)
    created_at = Column(DateTime, default=now)


class HistoricalFlood(Base):
    __tablename__ = "historical_floods"
    id = Column(Integer, primary_key=True)
    city = Column(String(60), index=True)
    event_date = Column(DateTime)
    rainfall_mm = Column(Float)
    peak_intensity_mm_hr = Column(Float)
    max_depth_m = Column(Float)
    duration_hr = Column(Float)
    affected_roads = Column(JSON, default=list)
    drainage_failures = Column(Integer, default=0)
    hotspots = Column(JSON, default=list)
    source = Column(String(80))
    data_label = Column(String(30))


class MaintenanceRecommendation(Base):
    __tablename__ = "maintenance"
    id = Column(Integer, primary_key=True)
    city = Column(String(60), index=True)
    node_id = Column(String(40))
    action = Column(String(20))
    priority_score = Column(Float)
    reasons = Column(JSON, default=list)
    status = Column(String(20), default="PENDING")
    created_at = Column(DateTime, default=now)


class Incident(Base):
    __tablename__ = "incidents"
    id = Column(Integer, primary_key=True)
    incident_id = Column(String(30), unique=True, index=True)
    city = Column(String(60), index=True)
    title = Column(String(200))
    location = Column(String(200))
    lat = Column(Float)
    lon = Column(Float)
    severity = Column(String(20))
    department = Column(String(80))
    affected_roads = Column(JSON, default=list)
    affected_infrastructure = Column(JSON, default=list)
    recommended_actions = Column(JSON, default=list)
    status = Column(String(20), default="OPEN")
    created_by = Column(Integer, nullable=True)
    notes = Column(JSON, default=list)
    created_at = Column(DateTime, default=now)
    updated_at = Column(DateTime, default=now, onupdate=now)


class AIPrediction(Base):
    __tablename__ = "ai_predictions"
    id = Column(Integer, primary_key=True)
    city = Column(String(60), index=True)
    ts = Column(DateTime, default=now)
    model = Column(String(60))
    kind = Column(String(40))
    payload = Column(JSON)
    confidence = Column(Float)


class ModelMetric(Base):
    __tablename__ = "model_metrics"
    id = Column(Integer, primary_key=True)
    model = Column(String(60))
    metric = Column(String(30))
    value = Column(Float)
    dataset = Column(String(60))
    validation_type = Column(String(30))  # DEMO_VALIDATION | REAL_WORLD_VALIDATION
    ts = Column(DateTime, default=now)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=True)
    action = Column(String(80))
    resource = Column(String(120))
    detail = Column(Text, default="")
    ip = Column(String(60), default="")
    ts = Column(DateTime, default=now)
