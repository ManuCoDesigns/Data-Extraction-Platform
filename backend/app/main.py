from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from app.core.config import settings
from app.api.v1.routes import (
    auth, users, projects, jobs, records, schemas,
    submission, project_resources, work_submissions, sources,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.SENTRY_DSN:
        import sentry_sdk
        sentry_sdk.init(dsn=settings.SENTRY_DSN, environment=settings.ENVIRONMENT)

    # Warm up the database connection pool on startup
    # This prevents the first real request from taking 60+ seconds
    try:
        from app.db.session import SessionLocal
        from sqlalchemy import text
        db = SessionLocal()
        db.execute(text("SELECT 1"))   # wake up the pool
        db.close()
        print("✓ Database pool warmed up")
    except Exception as e:
        print(f"DB warmup skipped: {e}")

    yield


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# ─── CORS ─────────────────────────────────────────────────────────────────────
_explicit_origins = [o.strip() for o in (settings.CORS_ORIGINS or []) if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_explicit_origins,
    allow_origin_regex=(
        r"https://.*\.vercel\.app"
        r"|http://localhost:\d+"
        r"|http://127\.0\.0\.1:\d+"
    ),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With"],
    max_age=86400,
)

# ─── Routes ───────────────────────────────────────────────────────────────────
PREFIX = settings.API_V1_STR
app.include_router(auth.router,                             prefix=PREFIX)
app.include_router(users.router,                            prefix=PREFIX)
app.include_router(projects.router,                         prefix=PREFIX)
app.include_router(jobs.router,                             prefix=PREFIX)
app.include_router(records.router,                          prefix=PREFIX)
app.include_router(schemas.router,                          prefix=PREFIX)
app.include_router(submission.router,                       prefix=PREFIX)
app.include_router(submission.stats_router,                 prefix=PREFIX)
app.include_router(submission.notifications_router,         prefix=PREFIX)
app.include_router(project_resources.router,                prefix=PREFIX)
app.include_router(work_submissions.router,                 prefix=PREFIX)
app.include_router(sources.router,                          prefix=PREFIX)


@app.get("/health")
def health():
    """Used by Railway healthcheck and frontend keep-alive ping."""
    return {"status": "ok", "version": "1.0.0"}


@app.get("/ping")
def ping():
    """Lightweight keep-alive — frontend pings this every 4 minutes."""
    return "pong"
