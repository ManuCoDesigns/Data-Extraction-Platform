from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.core.config import settings
from app.api.v1.routes import auth, users, projects, jobs, records, schemas, submission


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

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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


@app.get("/health")
def health():
    return {"status": "ok", "version": "1.0.0"}


@app.get("/")
def root():
    return {"message": "Xtrium DataOps API", "docs": "/api/docs"}
