from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from contextlib import asynccontextmanager
import re
from app.core.config import settings
from app.api.v1.routes import auth, users, projects, jobs, records, schemas, submission, project_resources, work_submissions, sources


# ─── CORS origin matching ─────────────────────────────────────────────────────
# Supports exact origins from CORS_ORIGINS env var PLUS wildcard patterns for
# Vercel preview URLs (*.vercel.app) so we never have to update env vars when
# Vercel generates a new per-deployment preview URL.

CORS_WILDCARD_PATTERNS = [
    r"https://.*\.vercel\.app$",          # all Vercel preview/prod deployments
    r"http://localhost:\d+$",             # local dev on any port
    r"http://127\.0\.0\.1:\d+$",         # local dev alternate
]


def is_origin_allowed(origin: str) -> bool:
    if not origin:
        return False
    # Exact match against configured origins
    if origin in settings.CORS_ORIGINS:
        return True
    # Wildcard pattern match
    for pattern in CORS_WILDCARD_PATTERNS:
        if re.match(pattern, origin):
            return True
    return False


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


@app.middleware("http")
async def cors_middleware(request: Request, call_next):
    origin = request.headers.get("origin", "")
    allowed = is_origin_allowed(origin)

    # Handle preflight
    if request.method == "OPTIONS":
        if allowed:
            return Response(
                status_code=204,
                headers={
                    "Access-Control-Allow-Origin": origin,
                    "Access-Control-Allow-Credentials": "true",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
                    "Access-Control-Max-Age": "86400",
                },
            )
        return Response(status_code=403)

    response = await call_next(request)

    if allowed:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, Accept"

    return response

PREFIX = settings.API_V1_STR
app.include_router(auth.router,       prefix=PREFIX)
app.include_router(users.router,      prefix=PREFIX)
app.include_router(projects.router,   prefix=PREFIX)
app.include_router(jobs.router,       prefix=PREFIX)
app.include_router(records.router,    prefix=PREFIX)
app.include_router(schemas.router,    prefix=PREFIX)
app.include_router(submission.router, prefix=PREFIX)
app.include_router(submission.stats_router,         prefix=PREFIX)
app.include_router(submission.notifications_router, prefix=PREFIX)
app.include_router(project_resources.router,        prefix=PREFIX)
app.include_router(work_submissions.router,         prefix=PREFIX)
app.include_router(sources.router,                  prefix=PREFIX)


@app.get("/health")
def health():
    return {"status": "ok", "version": "1.0.0"}


@app.get("/")
def root():
    return {"message": "Xtrium DataOps API", "docs": "/api/docs"}
