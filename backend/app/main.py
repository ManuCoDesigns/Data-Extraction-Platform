from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from app.core.config import settings
import app.core.notify_events  # noqa: F401  (registers the notification listeners)
import app.core.mailer  # noqa: F401  (sends email alerts after commit)
from app.api.v1.routes import (
    auth, users, projects, jobs, records, schemas,
    submission, project_resources, work_submissions, sources,
    integrations, notifications, enhancements, quality, observations, sop_assign, balance, dispatch, admin_upload, briefs, versions,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.SENTRY_DSN:
        import sentry_sdk
        sentry_sdk.init(dsn=settings.SENTRY_DSN, environment=settings.ENVIRONMENT)

    # Warm up the database connection pool on startup. Retry for a short while: Railway can restart
    # Postgres at the same time as this service, and the first attempts then get "connection refused".
    import asyncio
    from sqlalchemy import text
    from app.db.session import SessionLocal

    def _ping() -> None:
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
        finally:
            db.close()

    for attempt in range(1, 7):
        try:
            await asyncio.to_thread(_ping)
            print("✓ Database pool warmed up")
            break
        except Exception as e:
            print(f"DB warmup attempt {attempt}/6 failed: {str(e).splitlines()[0][:140]}")
            await asyncio.sleep(min(2 * attempt, 10))

    from app.core.scheduler import start_scheduler
    task = start_scheduler()

    yield

    if task:
        task.cancel()


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

# Compress JSON responses: the sources list shrinks about tenfold, which matters on slow links.
app.add_middleware(GZipMiddleware, minimum_size=1024)
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
app.include_router(notifications.router,                    prefix=PREFIX)
app.include_router(project_resources.router,                prefix=PREFIX)
app.include_router(work_submissions.router,                 prefix=PREFIX)
app.include_router(sources.router,                          prefix=PREFIX)
app.include_router(integrations.router,                     prefix=PREFIX)
app.include_router(enhancements.router,                     prefix=PREFIX)
app.include_router(quality.router,                          prefix=PREFIX)
app.include_router(observations.router,                     prefix=PREFIX)
app.include_router(sop_assign.router,                       prefix=PREFIX)
app.include_router(balance.router,                          prefix=PREFIX)
app.include_router(dispatch.router,                         prefix=PREFIX)
app.include_router(admin_upload.router,                    prefix=PREFIX)
app.include_router(briefs.router,                 prefix=PREFIX)
app.include_router(versions.router,               prefix=PREFIX)


# ─── Database unavailable ─────────────────────────────────────────────────────
# When Postgres is restarting, a request fails with a connection error or a pool timeout. Answer with a clear 503
# (this handler sits inside the CORS middleware, so the browser can read it) instead of a bare 500 that shows up as a CORS error.
from sqlalchemy.exc import OperationalError, InterfaceError, TimeoutError as PoolTimeoutError  # noqa: E402


@app.exception_handler(OperationalError)
@app.exception_handler(InterfaceError)
@app.exception_handler(PoolTimeoutError)
async def database_unavailable(request: Request, exc: Exception):
    msg = str(getattr(exc, "orig", exc)).lower()
    if isinstance(exc, OperationalError) and "statement timeout" in msg:
        return JSONResponse(status_code=504, content={"detail": "That took too long and was stopped. Try again, or narrow what you asked for."}, headers={"Retry-After": "5"})
    return JSONResponse(status_code=503, content={"detail": "The database is restarting or busy. Wait a moment and try again. Your work is safe."}, headers={"Retry-After": "10"})


@app.get("/health/db")
def health_db():
    """Reports whether the database answers. Not used by Railway's healthcheck, so a database restart does not restart this service."""
    from sqlalchemy import text
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "database": "up"}
    except Exception:
        return JSONResponse(status_code=503, content={"status": "degraded", "database": "down"})
    finally:
        db.close()


@app.get("/health")
def health():
    """Used by Railway healthcheck and frontend keep-alive ping."""
    return {"status": "ok", "version": "1.0.0"}


@app.get("/ping")
def ping():
    """Lightweight keep-alive — frontend pings this every 4 minutes."""
    return "pong"
