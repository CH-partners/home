from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = Field(..., validation_alias="DATABASE_URL")
    auth_secret_key: str = Field(..., validation_alias="AUTH_SECRET_KEY")
    auth_session_hours: int = Field(12, validation_alias="AUTH_SESSION_HOURS")
    auth_cookie_name: str = Field("ch_home_session", validation_alias="AUTH_COOKIE_NAME")
    auth_cookie_secure: bool = Field(False, validation_alias="AUTH_COOKIE_SECURE")
    rent_api_service_key: str = Field("", validation_alias="RENT_API_SERVICE_KEY")

    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[2] / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
