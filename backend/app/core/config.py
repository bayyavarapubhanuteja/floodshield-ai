"""Application configuration loaded from environment variables."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="FS_", extra="ignore")

    app_name: str = "FloodShield AI"
    tagline: str = "Predict the Flood. Protect the City. Respond Before Impact."
    version: str = "1.0.0"
    env: str = "development"
    secret_key: str = "change-me-in-production-floodshield"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60 * 8
    refresh_token_days: int = 7
    database_url: str = "sqlite:///./floodshield.db"
    redis_url: str = ""
    cors_origins: str = "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"
    rate_limit_per_minute: int = 240
    upload_dir: str = "./storage/uploads"
    max_upload_mb: int = 50
    default_city: str = "hyderabad"
    grid_size: int = 48
    weather_api_key: str = ""          # e.g. OpenWeatherMap key; empty => deterministic simulation
    weather_provider: str = "simulated"  # simulated | openweathermap
    seed_admin_password: str = "Admin@123"
    demo_seconds_total: int = 150       # fast demo compresses a 3h event into ~2.5 min

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
