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
# Using FastAPI's built-in CORSMiddleware (Starlette) rather than a custom
# @app.middleware("http"). The built-in one runs at the ASGI level — it wraps
# every response INCLUDING unhandled exceptions and 4xx/5xx errors, so the
# browser always sees the correct CORS headers and gets the real error code
# instead of a misleading "No Access-Control-Allow-Origin" block.
#
# allow_origin_regex covers:
#   - https://*.vercel.app   (all Vercel preview + production URLs)
#   - http://localhost:*     (local dev, any port)
#   - http://127.0.0.1:*    (local dev alternate)
#
# Explicit origins from env var CORS_ORIGINS are merged in as well so you can
# always add custom domains without touching this file.

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
    return {"status": "ok", "version": "1.0.0"}


@app.get("/health/db")
def health_db():
    """Diagnostic endpoint — checks that all expected DB columns exist."""
    from app.db.session import SessionLocal
    from sqlalchemy import text
    db = SessionLocal()
    try:
        def cols(table):
            rows = db.execute(text(
                f"SELECT column_name FROM information_schema.columns "
                f"WHERE table_name = '{table}' ORDER BY column_name"
            )).fetchall()
            return [r[0] for r in rows]

        extracted = cols("extracted_records")
        sources_cols = cols("sources")
        jobs_cols = cols("extraction_jobs")

        missing = []
        for col in ["is_schema_valid", "validation_errors", "web_check_flags", "web_verified", "web_check_summary"]:
            if col not in extracted:
                missing.append(f"extracted_records.{col}")
        for col in ["source_id"]:
            if col not in jobs_cols:
                missing.append(f"extraction_jobs.{col}")

        return {
            "status": "ok" if not missing else "migration_needed",
            "missing_columns": missing,
            "extracted_records_cols": extracted,
            "sources_exists": bool(sources_cols),
        }
    finally:
        db.close()


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch-all for unhandled 500 errors — returns the real Python error
    so it's visible in the browser instead of a bare CORS block."""
    import traceback
    return JSONResponse(
        status_code=500,
        content={
            "detail": str(exc),
            "type": type(exc).__name__,
            "trace": traceback.format_exc()[-2000:],  # last 2000 chars of traceback
        },
    )


@app.get("/")
def root():
    return {"message": "Xtrium DataOps API", "docs": "/api/docs"}
