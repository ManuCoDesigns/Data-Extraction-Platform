# Xtrium DataOps Platform

Internal platform for structured data extraction, LLM-assisted review, and validated submission.  
**Stack:** FastAPI · PostgreSQL (Supabase) · Redis · Celery · Anthropic Claude · React · Vite · Railway · Vercel

---

## Quick Start (Local Dev)

### Prerequisites
- Docker + Docker Compose
- Node 20+
- Python 3.12+

### 1. Clone and configure

```bash
git clone <your-repo>
cd xtrium-platform

# Backend env
cp backend/.env.example backend/.env
# Edit backend/.env — set DATABASE_URL, ANTHROPIC_API_KEY at minimum

# Frontend env
cp frontend/.env.example frontend/.env.local
# VITE_API_URL=http://localhost:8000/api/v1
```

### 2. Start everything with Docker Compose

```bash
ANTHROPIC_API_KEY=sk-ant-... docker compose up
```

Services started:
- **API** → http://localhost:8000
- **Frontend** → http://localhost:3000
- **API Docs** → http://localhost:8000/api/docs
- **Postgres** → localhost:5432
- **Redis** → localhost:6379

### 3. Apply migrations and seed first admin

```bash
# Run migrations
docker compose exec backend alembic upgrade head

# Create the first Org Admin
docker compose exec backend python seed.py \
  --email admin@xtrium.ai \
  --name "Xtrium Admin" \
  --password yourpassword
```

### 4. Log in

Open http://localhost:3000 and sign in with the credentials from step 3.

---

## Running Without Docker

### Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Copy and fill .env
cp .env.example .env

# Apply migrations
alembic upgrade head

# Seed admin
python seed.py --email admin@xtrium.ai --name "Admin" --password secret

# Start API
uvicorn app.main:app --reload --port 8000

# Start Celery worker (separate terminal)
celery -A app.tasks.celery_app worker --loglevel=info -Q extraction,llm -c 4
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

---

## Project Structure

```
xtrium-platform/
├── backend/
│   ├── app/
│   │   ├── api/v1/routes/      # auth, users, projects, jobs, records, schemas, submission
│   │   ├── core/               # config, security (JWT)
│   │   ├── db/                 # SQLAlchemy session
│   │   ├── models/             # all_models.py — every DB table
│   │   ├── schemas/            # Pydantic request/response schemas
│   │   ├── tasks/              # Celery tasks: extraction.py, llm_review.py
│   │   ├── parsers/            # pdf_parser.py, csv_parser.py
│   │   └── main.py             # FastAPI app + router registration
│   ├── migrations/             # Alembic migrations
│   ├── seed.py                 # First-run admin seeder
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── api/client.ts       # Axios client + all API calls
│   │   ├── components/
│   │   │   ├── ui/             # Button, Badge, Card, Modal, Input, etc.
│   │   │   └── layout/         # AppLayout (sidebar + topbar)
│   │   ├── pages/              # Dashboard, Login, Projects, Jobs, JobDetail, Review, Schemas, Users
│   │   ├── store/auth.ts       # Zustand auth store
│   │   ├── types/index.ts      # All TypeScript types
│   │   └── App.tsx             # Router
│   ├── vercel.json
│   └── .env.example
│
├── docker-compose.yml
├── railway.toml
└── README.md
```

---

## Deployment

### Backend → Railway

1. Create a new Railway project
2. Add a **PostgreSQL** plugin → copy the `DATABASE_URL`
3. Add a **Redis** plugin → copy the `REDIS_URL`
4. Connect your GitHub repo
5. Set environment variables (copy from `backend/.env.example`, fill in values):
   - `DATABASE_URL`
   - `REDIS_URL` / `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND`
   - `SECRET_KEY` (generate: `python -c "import secrets; print(secrets.token_hex(32))"`)
   - `ANTHROPIC_API_KEY`
   - `CORS_ORIGINS` → `["https://your-app.vercel.app"]`
6. Railway auto-detects `railway.toml` — it runs `alembic upgrade head` before starting
7. Add a second Railway service for the **Celery worker** using the same repo + env vars,  
   with start command: `celery -A app.tasks.celery_app worker --loglevel=info -Q extraction,llm -c 4`

### Alternative: Supabase for Postgres

1. Create a project at https://supabase.com
2. Go to **Settings → Database → Connection string (URI)**
3. Use that as your `DATABASE_URL`
4. Supabase handles backups, connection pooling, and the Postgres dashboard

### Frontend → Vercel

```bash
cd frontend
npx vercel --prod
```

Set environment variable in Vercel dashboard:
- `VITE_API_URL` → `https://your-railway-api.up.railway.app/api/v1`

The `vercel.json` handles SPA routing (all paths → `index.html`).

---

## API Reference

Interactive docs at `/api/docs` (Swagger UI) and `/api/redoc`.

### Auth endpoints
```
POST /api/v1/auth/login          Login → access + refresh token
POST /api/v1/auth/refresh        Rotate tokens
GET  /api/v1/auth/me             Current user
```

### Core endpoints
```
GET/POST   /api/v1/projects                     List / create projects
GET/PATCH  /api/v1/projects/:id                 Get / update project
POST       /api/v1/projects/:id/members         Add member

GET        /api/v1/jobs                         List jobs (filterable)
POST       /api/v1/jobs/:projectId/upload       Upload file + start extraction
GET        /api/v1/jobs/:id                     Job detail
GET        /api/v1/jobs/:id/history             State history

GET        /api/v1/records?job_id=...           List records (filterable)
GET        /api/v1/records/:id                  Single record
POST       /api/v1/records/:id/review           Approve / reject / skip / escalate
POST       /api/v1/records/bulk-review          Bulk approve / reject

GET/POST   /api/v1/schemas                      List / create schemas
GET/POST   /api/v1/schemas/:id/versions         Schema versions

POST       /api/v1/jobs/:id/submit              Submit → JSON download
GET        /api/v1/stats/dashboard              Dashboard stats
GET        /api/v1/notifications                User notifications
```

---

## Extraction Pipeline

When a file is uploaded:

```
Upload → QUEUED
  └─ Celery: extraction task
       ├─ PDF → PDFParser (pdfplumber, column detection, category tracking)
       ├─ CSV → CSVParser (pandas, auto-header)
       └─ EXTRACTING → entities grouped by schema.grouping_key
            └─ LLM_REVIEW
                 ├─ Claude verifies each field vs raw text
                 ├─ PASS → green badge in review queue
                 ├─ REVIEW → amber badge with field flags
                 └─ REJECT → quarantine queue
                      └─ READY_FOR_REVIEW → human reviewers
```

---

## User Roles

| Role | What they can do |
|---|---|
| `org_admin` | Everything — users, projects, schemas, all jobs |
| `project_admin` | Manage schemas and team for assigned projects |
| `qa_lead` | Review + access quarantine queue |
| `pipeline_operator` | Upload files and trigger jobs |
| `reviewer` | Review, approve, reject, submit |
| `read_only` | View only |

---

## Adding a New Project (no code required)

1. **Create project** → Projects → New Project
2. **Create schema** → Schemas → New Schema → paste JSON definition
3. **Assign members** → Project detail → add reviewers
4. **Upload document** → Jobs → New Extraction Job → select project + schema + file
5. **Review** → Job detail → Open Review Interface
6. **Submit** → Job detail → Submit N Records → JSON downloaded

---

## Extending the Platform

### Add a new file parser
Implement the `SourceParser` interface in `backend/app/parsers/`:
```python
class ExcelParser:
    def parse(self, file_path: str) -> list[dict]:
        ...
```
Register in `backend/app/tasks/extraction.py` in the `ext → parser` map.

### Add a new submission destination
Implement `SubmissionAdapter` in `backend/app/services/`:
```python
class Neo4jAdapter:
    def submit(self, records, config) -> SubmissionReceipt:
        ...
```
Register in `backend/app/api/v1/routes/submission.py`.

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✓ | Postgres connection string |
| `SECRET_KEY` | ✓ | JWT signing key (32+ chars) |
| `ANTHROPIC_API_KEY` | ✓ | Claude API key |
| `REDIS_URL` | ✓ | Redis connection string |
| `CELERY_BROKER_URL` | ✓ | Usually same as REDIS_URL |
| `CELERY_RESULT_BACKEND` | ✓ | Redis DB 1 (change `/0` to `/1`) |
| `CORS_ORIGINS` | ✓ | JSON array of allowed origins |
| `S3_ENDPOINT_URL` | — | Cloudflare R2 / AWS S3 endpoint |
| `S3_ACCESS_KEY_ID` | — | S3 access key |
| `S3_SECRET_ACCESS_KEY` | — | S3 secret |
| `S3_BUCKET_NAME` | — | Default: `xtrium-uploads` |
| `SENTRY_DSN` | — | Error tracking |
| `ENVIRONMENT` | — | `development` / `production` |

---

## Roadmap (v1.1)

- [ ] Excel parser
- [ ] QA Lead and Pipeline Operator roles in UI
- [ ] Email notifications (SendGrid / Resend)
- [ ] Neo4j submission destination
- [ ] LLM enrichment mode (fill null fields)
- [ ] Cross-job deduplication with merge UI
- [ ] Bulk JSON import (skip extraction, go straight to review)
- [ ] Per-job system statistics dashboard
- [ ] Re-extraction preserving valid human review actions
- [ ] Audit log export (CSV/NDJSON)
