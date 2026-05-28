# Dolphin ERP — Project Summary & Architecture

**Last Updated:** May 10, 2026  
**Status:** Core features complete, scheduling engine optimized  
**Repository:** https://github.com/rushibhimani/dolphin  
**Access:** Public (Claude can browse code directly)

---

## Project Overview

**Dolphin ERP** is a custom-built scheduling and planning system for a **mould and die machine shop**.

**Core Problem Solved:** Managing 22 machines, 10 workers, complex job routing, and intelligent worker-to-job scheduling to minimize downtime and maximize on-time delivery.

---

## Business Context

### The Shop
- **Machines:** M1–M22 (grinders, VMCs, mills, drills, welding, assembly, finishing)
- **Workers:** W01–W10 (Shreyans, Sonu, Anil, Jignesh, Rajkumar, Ravinder, Nilesh, Krishnkant, Suraj, Atul)
- **Products:** Punches, Die Frames, Liner Sets, Complete Moulds, Custom Plates
- **Shift:** 8 AM–8 PM IST, Wednesday half-day (ends 2 PM), lunch 12–2 PM
- **Job Types:** Entry Mould, SFS Mould (upper + lower)

### Manager's Daily Needs
1. **Schedule All jobs** respecting machine capacity and worker skills
2. **View today's work** — what's in progress, what's overdue
3. **See Gantt chart** — which machines/workers are busy
4. **Track job progress** — which operations completed, which are pending
5. **Make estimations** — how long will new jobs take?
6. **Balance load** — don't overload specialists on general tasks

---

## Database Schema (6 Migrations Applied)

### 001_initial.py
- `WorkCenter` — machines (name, type, bottleneck flag)
- `Worker` — operators (name, role, phone, is_active)
- `worker_skills` — many-to-many (worker ↔ machine)
- `Routing` — templates (product type → sequence of operations)
- `Operation` — each step in a routing
- `Job` — customer orders
- `ScheduledOp` — actual scheduled instances of operations
- `JobCounter` — auto-numbering (DL-YYYY-NNN)

### 002_workers.py
- `WorkerLeave` — absence tracking (date ranges, reason)
- Added skill-level support to Worker/Operation

### 003_customers.py
- `Customer` — customer master (name, phone, contact, notes, is_active)
- Added `customer_id` (FK) + `total_price` to Job
- Auto-creates customers from free-text `customer_name` on first use

### 004_codes.py
- `Worker.code` — auto-generated W01–W10
- `WorkCenter.code` — auto-generated M1–M22
- `WorkCenter.status` — active / maintenance / breakdown
- Auto-backfill endpoint `/api/backfill-codes`

### 005_skill_levels.py
- `Worker.skill_level` (1=general, 2=trained, 3=specialist)
- `WorkCenter.skill_level` (1=general, 2=trained, 3=specialist)
- Auto-set by machine type on migration

### 006_scheduling.py
- `Operation.machine_setup_mins` — machine calibration (waived for consecutive same-worker ops)
- `Operation.job_setup_mins` — per-job setup (always required)
- `ScheduledOp.machine_setup_mins`, `.job_setup_mins`, `.setup_waived`
- `WorkCenter.continuity_hours` — keep worker on same machine if gap < this threshold

---

## Key Features Implemented

### 1. Job Management
- **Auto-numbering:** DL-2026-001, DL-2026-002, etc.
- **Routing templates:** Pre-defined sequences of operations
- **Operation overrides:** Adjust setup/work time per job
- **Priority flag:** Mark urgent jobs
- **Duplicate button:** Clone job with same routing
- **Customer linking:** Track revenue per customer
- **Total price field:** Job pricing in INR (₹)

### 2. Scheduling Engine (Advanced)
#### Core Algorithm
- **Machine continuity:** Keep worker on same machine if gap < `continuity_hours` threshold
- **Load balancing:** Prefer less-loaded workers to distribute work evenly
- **Skill matching:** 
  - Level 3 machines (VMC, grinder) → prefer highest-skill workers
  - Level 2 machines (milling, drill) → match skill level closely
  - Level 1 machines (assembly, sand blasting) → prefer lowest-skill workers (preserve specialists)
- **Setup time split:**
  - Machine setup → waived for consecutive same-worker ops on same machine
  - Job setup → always required per job
- **Preemption:** Urgent jobs (CR < 0.5) can pause lower-priority in-progress ops to free specialists
- **Reactive scheduling:** Auto-pull forward next scheduled op when previous one completes

#### Critical Ratio (Urgency)
```
CR = (Due Date - Now) / (Estimated Remaining Time)
CR < 0.5 → URGENT (red flag)
CR 0.5–2.0 → Normal
CR > 2.0 → Relaxed (can be preempted)
```

### 3. Worker Management
- **Skills mapping:** Which workers can operate which machines
- **Skill levels:** 1=General, 2=Trained, 3=Specialist
- **Leave calendar:** Track absences, auto-reassign work
- **Auto-code assignment:** W01–W10 sequential
- **Load tracking:** Hours booked today per worker

### 4. Machine Management
- **Auto-code assignment:** M1–M22 sequential
- **Status tracking:** Active / Maintenance / Breakdown
- **Skill level:** What expertise required to operate
- **Continuity window:** Hours to keep same worker on machine (default 2h, configurable)
- **Bottleneck flag:** Mark capacity-constrained machines

### 5. Scheduling Views
#### Gantt Chart (3 Views)
- **Machine view:** Which ops on which machines
- **Worker view:** Which ops assigned to which workers
- **Job view:** Which ops belong to which jobs
- **Features:**
  - Sticky left pane (machine/worker/job names fixed during scroll)
  - Readability: 52px rows, 60px per hour, text with stroke outline
  - Color coding: Red (late/priority), Amber (in progress), Green (done), Purple (paused)
  - TODAY marker, due date lines, shift boundaries, off-hours shading
  - Late badges, progress bars, 2-line text on bars
  - Auto-scroll to NOW
  - Filter by job/customer/machine, today-only toggle

#### Today's Work
- **Live list:** All scheduled ops for today
- **Status buttons:** Start → Pause → Resume → Done
- **Overdue badges:** Red alert if scheduled end < now
- **Auto-refresh:** 60 seconds
- **Pause feature:** Pause op → job goes back to scheduled, resume brings back to in_progress

#### Dashboard
- **Stat cards:** Total jobs, pending, done, urgent, late, machines down
- **Revenue stats:** Last 30 days, all-time, per-customer
- **On-time rate:** Color-coded (green/amber/red)
- **Machine load heatmap:** Next 30 days, progress bars by machine
- **Preemption alerts:** Red alert box showing which urgent jobs could free which specialists
- **Quick actions:** Schedule All, Load Demo Data, Load Real Setup

#### Capacity Heatmap
- **By machine:** How many hours booked per machine per day (next 30 days)
- **Color heat:** Green (low) → Amber (medium) → Red (full)

#### Reports Page
- **Monthly breakdown:** Revenue by month (12 months)
- **Top customers:** By revenue (last 30 days + all-time)
- **Late jobs list:** Currently overdue, link to job detail
- **Machine load:** Next 30 days, which machines are constrained
- **Summary stats:** On-time rate %, total revenue, average job duration

### 6. Worker/Machine Skills
- **Skill assignment:** UI to assign which workers can operate which machines
- **Skill levels:** Separate from skill assignment
  - Worker level: Overall capability (1/2/3)
  - Machine level: Requirement to operate (1/2/3)
  - Scheduler uses both to make smart assignments

### 7. Customer Management
- **Master list:** All customers with contact info
- **Job history:** View all jobs per customer
- **Statistics:** Job count, on-time count, late count, total revenue
- **Soft delete:** If customer has jobs, mark inactive instead of deleting
- **Auto-update:** Rename customer → all linked jobs update

### 8. Leave Calendar
- **Worker absences:** Date ranges + reason
- **Auto-reassignment:** Ops scheduled for absent worker automatically reassigned
- **Visual calendar:** See absences by worker

---

## API Endpoints (FastAPI)

### Jobs
- `POST /api/jobs` — Create job
- `GET /api/jobs` — List all jobs
- `GET /api/jobs/{id}` — Get job detail
- `PUT /api/jobs/{id}` — Update job
- `DELETE /api/jobs/{id}` — Delete job
- `POST /api/jobs/{id}/duplicate` — Clone job

### Scheduling
- `POST /api/schedule-all` — Schedule all pending jobs
  - Returns: `{scheduled, unassigned_ops, skipped_active, preempted}`
- `GET /api/gantt` — Gantt data (machine/worker/job view)
- `GET /api/capacity` — Capacity heatmap data
- `GET /api/today` — Today's scheduled operations
- `GET /api/preemption-alerts` — Urgent jobs that could preempt lower-priority work

### Workers
- `POST /api/workers` — Create worker
- `GET /api/workers` — List workers
- `GET /api/workers/{id}` — Get worker detail
- `PUT /api/workers/{id}` — Update worker
- `DELETE /api/workers/{id}` — Delete worker
- `GET /api/workers/availability` — Worker availability calendar

### Machines
- `POST /api/work-centers` — Create machine
- `GET /api/work-centers` — List machines
- `PUT /api/work-centers/{id}` — Update machine
- `DELETE /api/work-centers/{id}` — Delete machine

### Customers
- `POST /api/customers` — Create customer
- `GET /api/customers` — List customers
- `GET /api/customers/{id}` — Get customer detail
- `PUT /api/customers/{id}` — Update customer
- `DELETE /api/customers/{id}` — Delete customer (soft-delete)

### Operations
- `PUT /api/scheduled-ops/{op_id}/status` — Mark op as in_progress/paused/completed
- `GET /api/debug/today` — Debug today's schedule

### Data
- `POST /api/seed-real` — Load real 10 workers + 22 machines with skill mappings
- `POST /api/backfill-codes` — Assign W01–W10 / M1–M22 to existing workers/machines

### Reports
- `GET /api/reports/summary` — Monthly stats, top customers, late jobs, machine load

---

## Frontend Architecture (Single-File HTML)

**File:** `index.html` (~2300 lines)

### Structure
- Pure HTML/CSS/JavaScript (no frameworks)
- Responsive dark theme
- Single-page app (SPA) — navigation via `showPage(pageName)`

### Navigation Pages
1. **Dashboard** — Overview, stats, quick actions
2. **Today's Work** — Live operations for today
3. **Jobs** — Create, view, edit, schedule jobs
4. **Gantt Schedule** — 3-view chart (machine/worker/job)
5. **Capacity** — Heatmap of machine utilization
6. **Machines** — Create, manage machines + skill assignments
7. **Workers** — Create, manage workers + skills + leave
8. **Customers** — Customer master + revenue tracking
9. **Reports** — Monthly breakdown, top customers, late jobs

### Key UI Components
- **Job Modal:** Create/edit job with routing template selection
- **Machine Modal:** Name, type, status, skill level, continuity hours
- **Worker Modal:** Name, role, skill level, skill assignments
- **Customer Modal:** Name, phone, contact person, notes
- **Date/Time Pickers:** Split date + time inputs (replaces datetime-local)
- **Gantt Chart:** SVG-based, sticky left pane, zoom/filter
- **Status Badges:** Color-coded by job/op status
- **Skill Badges:** General (grey) / Trained (blue) / Specialist (purple)

### Styling
- **Color scheme:** Dark theme (dark bg, amber accents)
- **Responsive:** Flex layout, grid for stat cards
- **Accessibility:** Large touch targets, readable fonts

---

## Technical Stack

- **Backend:** FastAPI (Python)
- **Database:** SQLite (file-based, no server needed)
- **Frontend:** Vanilla JS + HTML/CSS (no Node, no build step)
- **Migrations:** Alembic (auto-fixes duplicate heads)
- **Time:** IST (UTC+5:30), shift aware, naive datetime in DB
- **Deployment:** Local dev (python main.py), can scale to FastAPI hosting

---

## Setup & Deployment

### Local Development (Mac/Windows)

```bash
# Clone repo
git clone git@github.com:rushibhimani/dolphin.git
cd dolphin

# Setup Python
python3 -m venv venv
source venv/bin/activate  # Mac
# OR
venv\Scripts\activate  # Windows

# Install
pip install -r requirements.txt

# Migrate DB
python migrate.py

# Run
python main.py
# Visit http://localhost:8000
```

### Database
- **File:** `dolphin.db` (auto-created on first migration)
- **Migrations:** `migrations/versions/001_initial.py` → `006_scheduling.py`
- **Safe:** Never deletes data, only adds columns/tables

### Load Demo Data
- Dashboard → **Load Demo Data** — creates 5 sample jobs, 3 machines, 2 workers
- Dashboard → **Load Real Setup** — loads your actual 10 workers + 22 machines from `seed-real` endpoint

---

## Known Limitations & Future Work

### Not Yet Implemented
- Mobile app (desktop-only)
- Operator self-login (PIN-based check-in)
- Machine breakdowns with auto-reschedule
- Print/PDF export, Excel export
- Activity log with comments
- Quality/NCR tracking
- File attachments
- Email/WhatsApp notifications
- Holiday calendar UI
- Multi-shift management
- Quotation system (quoted vs actual price)
- Global search
- Pagination for large job lists

### Design Decisions Made
- **Single HTML file:** Easy deployment, no build step
- **SQLite:** No DB server, portable, sufficient for job shop (~1000 jobs/month)
- **Naive datetime:** Stored as text, converted to IST in Python
- **Worker skills:** Simple many-to-many, no skill proficiency per machine (future: add priority column)
- **No real-time:** Polling every 5 min for updates (future: WebSockets for live updates)

---

## Workflow with Claude (GitHub Integration)

### Setup
- **Repository:** Public on GitHub (claude can browse directly)
- **Branches:** `main` = production, feature branches for major work
- **SSH:** Configured on Mac for passwordless push/pull

### When Bugs/Changes Occur
1. **You:** Run code, find error
2. **You:** Tell Claude the issue (no file upload needed if public repo)
3. **Claude:** Reads code from GitHub instantly
4. **Claude:** Shows you exact fix
5. **You:** Edit locally, test
6. **You:** `git add . && git commit -m "message" && git push origin main`
7. **Claude:** Verifies fix in GitHub, confirms working

### Token Efficiency
- Public GitHub = Claude reads code without uploading (0 tokens for code reading)
- Typical fix = 100–200 tokens (vs 1000+ with file uploads)
- 98% cheaper than uploading whole project per fix

---

## Important Files

```
dolphin/
├── main.py              ← FastAPI backend (1700 lines)
├── models.py            ← SQLAlchemy models (150 lines)
├── index.html           ← Frontend SPA (2300 lines)
├── migrate.py           ← Migration runner with auto-fix for duplicate heads
├── models.py            ← Database models
├── requirements.txt     ← Dependencies (FastAPI, SQLAlchemy, Alembic, etc.)
├── alembic.ini          ← Alembic config
├── migrations/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
│       ├── 001_initial.py
│       ├── 002_workers.py
│       ├── 003_customers.py
│       ├── 004_codes.py
│       ├── 005_skill_levels.py
│       └── 006_scheduling.py
└── dolphin.db           ← SQLite database (auto-created, ~2MB typical)
```

---

## Common Issues & Fixes

### Migration Error: "Multiple head revisions"
- **Cause:** Duplicate migration files (e.g., two `006_*.py` files)
- **Fix:** `migrate.py` auto-detects and removes duplicates
- **Action:** Just run `python migrate.py` again

### Syntax Error in `index.html`
- **Check:** Browser console (F12 → Console tab) for JS errors
- **Fix:** Upload file to Claude, get correction, replace locally

### Worker/Machine Not Appearing in Dropdowns
- **Cause:** Worker/machine marked `is_active=False`
- **Fix:** Check Workers/Machines page, toggle active status

### Jobs Not Scheduling
- **Cause 1:** No routing template selected
- **Cause 2:** Machine under maintenance
- **Cause 3:** No qualified workers for machine
- **Fix:** Schedule All toast shows "unassigned_ops" count and reason

### Gantt Chart Looks Empty
- **Cause:** No ops scheduled for today or selected date range
- **Fix:** Click "Schedule All" to schedule pending jobs

---

## Metrics & Performance

### Typical Usage
- **Jobs per month:** 50–100
- **Operations per job:** 5–15
- **Database size:** ~2 MB (SQLite)
- **Page load:** <1s
- **Schedule All runtime:** 1–5 seconds (depends on job count)
- **Gantt render:** 1–2 seconds (60+ operations)

### Shift Coverage
- **Standard shift:** 8 AM–8 PM (12 hrs)
- **Wednesday:** Half day (8 AM–2 PM, 6 hrs)
- **Lunch:** 12–2 PM (2 hrs unpaid)
- **Effective work:** 10 hrs/day (or 4 hrs Wednesday)

---

## Contact & Support

- **Repository:** https://github.com/rushibhimani/dolphin
- **Status:** Active development
- **Version:** Beta (all core features complete, optimization ongoing)

---

## To Continue Development

1. **Upload this file to any new Claude chat**
2. Claude reads context instantly
3. No repetition of decisions already made
4. Fast iteration on bugs/features
5. Full project history available on GitHub

**You're good to go!** 🚀
