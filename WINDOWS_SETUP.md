# Data Extraction Platform — Windows Setup Guide
# Run every command in VS Code Terminal (PowerShell)

=======================================================
STEP 1 — EXTRACT THE ZIP
=======================================================

1. Find the downloaded zip:  xtrium-platform.zip
2. Right-click it → "Extract All"
3. Choose a folder, e.g.:   C:\Projects\xtrium-platform
4. Open VS Code
5. File → Open Folder → select C:\Projects\xtrium-platform
6. Open Terminal in VS Code:  Ctrl + ` (backtick)
   Make sure it says "powershell" at the top of the terminal


=======================================================
STEP 2 — INSTALL PYTHON (if not installed)
=======================================================

Check if you have Python:
    python --version

If you see "Python 3.11" or "3.12" → skip to Step 3.

If not installed:
1. Go to https://www.python.org/downloads/
2. Download Python 3.12 (latest)
3. Run the installer
   ✅ CHECK "Add Python to PATH" at the bottom
4. Click Install Now
5. Close and reopen VS Code terminal
6. Run again:  python --version


=======================================================
STEP 3 — INSTALL NODE.JS (if not installed)
=======================================================

Check if you have Node:
    node --version

If you see "v18" or higher → skip to Step 4.

If not installed:
1. Go to https://nodejs.org
2. Download the LTS version (left button)
3. Run the installer, click Next through all steps
4. Close and reopen VS Code terminal
5. Run again:  node --version


=======================================================
STEP 4 — INSTALL REDIS (Windows)
=======================================================

Option A — Use Memurai (easiest, free for dev):
1. Go to https://www.memurai.com/get-memurai
2. Download and install
3. It runs automatically as a Windows service
4. Test: open a new terminal tab and run:
       memurai-cli ping
   You should see: PONG

Option B — Use WSL (if you have Windows Subsystem for Linux):
    wsl sudo apt install redis-server -y
    wsl redis-server --daemonize yes

Option C — Use Upstash (cloud Redis, no install needed):
1. Go to https://upstash.com → Sign up free
2. Create a Redis database
3. Copy the "REDIS_URL" shown in the dashboard
4. Use that URL in your .env file (Step 7)


=======================================================
STEP 5 — SET UP THE BACKEND
=======================================================

In your VS Code terminal, run these one at a time:

--- Move into the backend folder ---
    cd backend

--- Create a Python virtual environment ---
    python -m venv venv

--- Activate the virtual environment ---
    venv\Scripts\activate

You should now see (venv) at the start of your terminal line.
If you get a permissions error, run this first:
    Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
Then try activating again.

--- Upgrade pip ---
    python -m pip install --upgrade pip

--- Install all backend packages ---
    pip install fastapi==0.115.0 "uvicorn[standard]==0.30.6" sqlalchemy==2.0.35 alembic==1.13.3 psycopg2-binary==2.9.9 "python-jose[cryptography]==3.3.0" "passlib[bcrypt]==1.7.4" bcrypt==4.0.1 python-multipart==0.0.12 pydantic-settings==2.5.2 "pydantic[email]==2.9.2" email-validator==2.2.0 celery==5.4.0 redis==5.1.1 anthropic==0.40.0 pdfplumber==0.11.4 pandas==2.2.3 python-dotenv==1.0.1 httpx==0.27.2

This takes about 2 minutes. You will see packages downloading.

--- Verify packages installed ---
    python -c "import fastapi, sqlalchemy, anthropic, pdfplumber; print('All packages OK')"

You should see: All packages OK


=======================================================
STEP 6 — GET YOUR API KEYS
=======================================================

You need two things before starting:

A) ANTHROPIC API KEY
   1. Go to https://console.anthropic.com
   2. Sign in / create account
   3. Click "API Keys" → "Create Key"
   4. Copy the key — it starts with sk-ant-...
   Keep this safe, you will paste it in Step 7.

B) DATABASE — TWO OPTIONS:

   Option 1: SQLite (easiest, works immediately, good for testing)
   → No setup needed, just use:
     DATABASE_URL=sqlite:///./xtrium_dev.db

   Option 2: Supabase Postgres (recommended for real use)
   1. Go to https://supabase.com → Sign up free
   2. Click "New Project" → give it a name → set a password
   3. Wait ~2 minutes for it to provision
   4. Go to Settings → Database → Connection String → URI tab
   5. Copy the URL (replace [YOUR-PASSWORD] with your project password)
   → It looks like: postgresql://postgres:yourpassword@db.xxxx.supabase.co:5432/postgres


=======================================================
STEP 7 — CREATE THE .ENV FILE
=======================================================

Make sure you are in the backend folder:
    cd C:\Projects\xtrium-platform\backend

Create the .env file:
    copy .env.example .env

Now open the .env file in VS Code (click it in the file explorer on the left).
Replace the contents with this — fill in YOUR values:

------------------------------------------------------------
SECRET_KEY=replace-this-with-any-long-random-string-32chars
ENVIRONMENT=development
DEBUG=true

# Use SQLite for local testing (easiest):
DATABASE_URL=sqlite:///./xtrium_dev.db

# OR use Supabase (paste your URL here):
# DATABASE_URL=postgresql://postgres:yourpassword@db.xxxx.supabase.co:5432/postgres

# Redis — use localhost if Memurai is installed, or paste Upstash URL:
REDIS_URL=redis://localhost:6379/0
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/1

# Paste your Anthropic API key here:
ANTHROPIC_API_KEY=sk-ant-YOUR-KEY-HERE

CORS_ORIGINS=["http://localhost:3000","http://localhost:5173"]
------------------------------------------------------------

Save the file (Ctrl+S).


=======================================================
STEP 8 — CREATE DATABASE TABLES
=======================================================

Still in the backend folder with (venv) active:

    python -c "
import sys; sys.path.insert(0,'.')
from app.db.session import Base, engine
import app.models.all_models
Base.metadata.create_all(bind=engine)
print('All tables created successfully')
"

You should see: All tables created successfully


=======================================================
STEP 9 — CREATE YOUR FIRST ADMIN USER
=======================================================

    python seed.py --email admin@xtrium.ai --name "Xtrium Admin" --password "Admin1234!"

You should see: ✓ Created Org Admin: admin@xtrium.ai

You can change the email and password to anything you like.
Write down what you set — you will use it to log in.


=======================================================
STEP 10 — START THE BACKEND API
=======================================================

    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

You should see:
    INFO:     Uvicorn running on http://0.0.0.0:8000
    INFO:     Application startup complete.

Leave this terminal running.
Open your browser and go to: http://localhost:8000/health
You should see: {"status":"ok","version":"1.0.0"}

Also open the API docs: http://localhost:8000/api/docs
You will see the full interactive API explorer.


=======================================================
STEP 11 — SET UP THE FRONTEND
=======================================================

Open a NEW terminal in VS Code:
Press the + button at the top right of the terminal panel.

--- Move into frontend folder ---
    cd C:\Projects\xtrium-platform\frontend

--- Install Node packages ---
    npm install

This takes 1-2 minutes.

--- Create frontend .env ---
    copy .env.example .env.local

Open .env.local and make sure it contains:
    VITE_API_URL=http://localhost:8000/api/v1

--- Start the frontend ---
    npm run dev

You should see:
    VITE v5.x.x  ready in xxx ms
    ➜  Local:   http://localhost:5173/

Open your browser and go to: http://localhost:5173
You should see the Xtrium login page.


=======================================================
STEP 12 — LOG IN AND TEST
=======================================================

1. Go to http://localhost:5173
2. Enter the email and password you set in Step 9
   Default: admin@xtrium.ai / Admin1234!
3. You should land on the Dashboard

First things to do:
→ Projects → New Project → create "BGS DMQ Test"
→ Schemas → New Schema → select your project → create a schema
→ Jobs → New Extraction Job → upload a PDF or CSV → watch it process


=======================================================
STEP 13 — START THE CELERY WORKER (for extraction to run)
=======================================================

The Celery worker is what actually processes your uploaded files.
Without it, files upload but don't get extracted.

Open a THIRD terminal in VS Code (press + again).

Make sure you are in the backend folder with venv active:
    cd C:\Projects\xtrium-platform\backend
    venv\Scripts\activate

Start the worker:
    celery -A app.tasks.celery_app worker --loglevel=info -Q extraction,llm -c 2 --pool=solo

Note: --pool=solo is needed on Windows (Windows doesn't support the default worker pool).

You should see:
    [tasks]
      . app.tasks.extraction.run_extraction
      . app.tasks.llm_review.run_llm_review
    [config]
      .> broker: redis://localhost:6379/0
    [queues]
      .> extraction    exchange=extraction(direct)
      .> llm           exchange=llm(direct)
    Ready.


=======================================================
SUMMARY — WHAT SHOULD BE RUNNING
=======================================================

Terminal 1 (backend):   uvicorn app.main:app --reload --port 8000
Terminal 2 (frontend):  npm run dev  (inside frontend/)
Terminal 3 (worker):    celery -A app.tasks.celery_app worker --pool=solo

URLs:
  Frontend:   http://localhost:5173
  API:        http://localhost:8000
  API Docs:   http://localhost:8000/api/docs
  Health:     http://localhost:8000/health

Login:
  Email:    admin@xtrium.ai   (or whatever you set in Step 9)
  Password: Admin1234!        (or whatever you set in Step 9)


=======================================================
TROUBLESHOOTING
=======================================================

Problem: "(venv) not appearing after activate"
Fix: Run this first, then activate again:
    Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

Problem: "python is not recognized"
Fix: Python not on PATH. Reinstall Python and CHECK "Add to PATH".
Or use: py --version  (Windows launcher)
Then replace "python" with "py" in all commands.

Problem: "pip install fails on psycopg2-binary"
Fix: You are using SQLite so you don't need it. Skip with:
    pip install psycopg2-binary --ignore-requires-python
Or just remove it and proceed — SQLite works fine for local dev.

Problem: "Redis connection refused"
Fix: Memurai is not running. Open Windows Services (search "Services"),
find Memurai, right-click → Start.
Or use Upstash cloud Redis (no install needed).

Problem: "CORS error in browser"
Fix: Make sure CORS_ORIGINS in .env includes http://localhost:5173

Problem: "Module not found" errors
Fix: Make sure (venv) is active in your terminal.
If not, run: venv\Scripts\activate

Problem: Celery won't start on Windows
Fix: Always use --pool=solo flag on Windows:
    celery -A app.tasks.celery_app worker --pool=solo --loglevel=info

Problem: Frontend shows blank page
Fix: Check browser console (F12). Usually means VITE_API_URL is wrong.
Make sure frontend/.env.local has:
    VITE_API_URL=http://localhost:8000/api/v1
