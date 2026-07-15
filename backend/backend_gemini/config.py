from pydantic_settings import BaseSettings
from typing import Optional, Union
import json


class Settings(BaseSettings):
    # App
    APP_NAME: str = "Data Extraction Platform"
    API_V1_STR: str = "/api/v1"
    DEBUG: bool = False
    SECRET_KEY: str = "change-me-in-production-use-32-char-min"
    ENVIRONMENT: str = "development"

    # Database
    DATABASE_URL: str = "sqlite:///./_dev.db"

    # Redis / Celery
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/1"

    # JWT
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ALGORITHM: str = "HS256"

    # Gemini
    GEMINI_API_KEY: str = ""
    LLM_MODEL: str = "gemini-2.0-flash"

    # Storage
    SUPABASE_URL: Optional[str] = None
    SUPABASE_SERVICE_KEY: Optional[str] = None
    STORAGE_BUCKET: str = "-uploads"
    STORAGE_PROVIDER: str = "local"

    # S3-compatible (optional)
    S3_ENDPOINT_URL: Optional[str] = None
    S3_ACCESS_KEY_ID: str = ""
    S3_SECRET_ACCESS_KEY: str = ""
    S3_BUCKET_NAME: str = "-uploads"
    S3_REGION: str = "auto"

    # Sentry
    SENTRY_DSN: Optional[str] = None

    # CORS — accepts JSON array string or Python list
    CORS_ORIGINS: Union[list, str] = ["http://localhost:3000", "http://localhost:5173"]

    def model_post_init(self, __context):
        # Parse CORS_ORIGINS if it comes in as a JSON string from env var
        if isinstance(self.CORS_ORIGINS, str):
            try:
                parsed = json.loads(self.CORS_ORIGINS)
                object.__setattr__(self, 'CORS_ORIGINS', parsed)
            except (json.JSONDecodeError, ValueError):
                # Single URL string
                object.__setattr__(self, 'CORS_ORIGINS', [self.CORS_ORIGINS])

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
