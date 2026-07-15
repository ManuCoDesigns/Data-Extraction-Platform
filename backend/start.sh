#!/bin/bash
set -e

echo "=== Data Extraction API Starting ==="
echo "Environment: $ENVIRONMENT"
echo "Database: $(echo $DATABASE_URL | cut -d'@' -f2)"

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
