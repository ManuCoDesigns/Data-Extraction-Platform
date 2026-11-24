#!/bin/bash
set -e

echo "=== Data Extraction API Starting ==="
echo "Environment: $ENVIRONMENT"
echo "Database: $(echo $DATABASE_URL | cut -d'@' -f2)"

echo "--- Waiting for the database (up to 3 minutes) ---"
python - <<'PY'
import sys, time
sys.path.insert(0, ".")
from sqlalchemy import text
from app.db.session import engine
for n in range(1, 37):
    try:
        with engine.connect() as c:
            c.execute(text("SELECT 1"))
        print(f"Database is ready (attempt {n})")
        break
    except Exception as e:
        print(f"Database not ready (attempt {n}/36): {str(e).splitlines()[0][:120]}")
        time.sleep(5)
else:
    print("Database still unavailable; continuing so migrations report the real error")
PY

echo "--- Running database migrations ---"
alembic upgrade head || {
    echo "Migration failed — attempting to create tables directly"
    python -c "
import sys
sys.path.insert(0, '.')
from app.db.session import Base, engine
import app.models.all_models
Base.metadata.create_all(bind=engine)
print('Tables created via SQLAlchemy')
"
}

echo "--- Starting API server ---"
exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1
