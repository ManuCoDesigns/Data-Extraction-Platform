from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.core.config import settings

is_sqlite = settings.DATABASE_URL.startswith("sqlite")

connect_args = {"check_same_thread": False} if is_sqlite else {
    # Postgres: set statement timeout so slow queries fail fast, not hang
    "options": "-c statement_timeout=30000"   # 30s max per query
}

engine_kwargs = {"connect_args": connect_args} if is_sqlite else {
    "connect_args": connect_args,
    "pool_pre_ping": True,      # test connection before use — catches stale conns
    "pool_size": 5,             # keep 5 warm connections (Railway limits)
    "max_overflow": 10,         # allow 10 burst connections
    "pool_recycle": 300,        # recycle connections every 5 min (before Railway kills them)
    "pool_timeout": 10,         # fail fast if no connection available (not hang for 30s)
    "pool_reset_on_return": "commit",
}

engine = create_engine(settings.DATABASE_URL, **engine_kwargs)

if is_sqlite:
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
