from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.core.config import settings

# SQLite needs check_same_thread=False; Postgres needs pool settings
is_sqlite = settings.DATABASE_URL.startswith("sqlite")

connect_args = {"check_same_thread": False} if is_sqlite else {}
engine_kwargs = {"connect_args": connect_args} if is_sqlite else {
    "pool_pre_ping": True,
    "pool_size": 10,
    "max_overflow": 20,
    # Recycle connections before Railway's Postgres proxy can silently
    # kill them server-side (seen as psycopg2.OperationalError: "server
    # closed the connection unexpectedly"). 280s keeps us safely under
    # most 5-minute proxy idle timeouts.
    "pool_recycle": 280,
    # Fail fast instead of hanging if the pool is exhausted (avoids the
    # 46s -> 300s creeping timeouts seen when every worker is waiting
    # on a connection that never frees up).
    "pool_timeout": 10,
}

engine = create_engine(settings.DATABASE_URL, **engine_kwargs)

# Enable WAL mode and foreign keys for SQLite
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