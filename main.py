from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import create_engine, and_, or_
from sqlalchemy.orm import sessionmaker
from datetime import datetime, timedelta, date
from models import (Base, WorkCenter, Worker, WorkerLeave, worker_skills,
                    Customer, Routing, Operation, Job, ScheduledOp, JobCounter, now_ist)
import json, os, subprocess, sys

DATABASE_URL = "sqlite:///./dolphin.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)

def run_migrations():
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            capture_output=True, text=True, cwd=script_dir
        )
        if result.returncode == 0:
            print("✓ Database migrations applied")
        else:
            print("⚠ Alembic not found, using create_all fallback")
            Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"⚠ Migration warning: {e}, using create_all fallback")
        Base.metadata.create_all(bind=engine)

run_migrations()

IST_OFFSET = timedelta(hours=5, minutes=30)

def parse_dt(s):
    if not s: return None
    s = s.strip().replace("Z", "").replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try: return datetime.strptime(s, fmt)
        except ValueError: continue
    try: return datetime.fromisoformat(s)
    except: return None

def parse_date(s):
    if not s: return None
    try: return date.fromisoformat(s[:10])
    except: return None

# ── JOB NUMBER ──
def next_job_number(db):
    year = now_ist().year
    counter = db.query(JobCounter).filter(JobCounter.year == year).first()
    if not counter:
        counter = JobCounter(year=year, seq=0)
        db.add(counter); db.flush()
    counter.seq += 1; db.flush()
    return f"DL-{year}-{counter.seq:03d}"

# ─────────────────────────────────────────────
# SHIFT HELPERS (all times IST naive)
# ─────────────────────────────────────────────
def get_shift(d):
    dow = d.weekday()
    s = datetime(d.year, d.month, d.day, 8, 0)
    if dow == 2:  # Wednesday half day
        return s, datetime(d.year, d.month, d.day, 14, 0), None, None
    return (s, datetime(d.year, d.month, d.day, 20, 0),
            datetime(d.year, d.month, d.day, 12, 0),
            datetime(d.year, d.month, d.day, 14, 0))

def next_shift_start(dt):
    d = dt.date() + timedelta(days=1)
    return get_shift(d)[0]

def add_working_hours(start: datetime, work_hours: float) -> datetime:
    remaining = work_hours; current = start
    for _ in range(1000):
        if remaining <= 0: break
        shift_s, shift_e, lunch_s, lunch_e = get_shift(current.date())
        if current < shift_s: current = shift_s; continue
        if current >= shift_e: current = next_shift_start(current); continue
        if lunch_s and lunch_e and lunch_s <= current < lunch_e: current = lunch_e; continue
        if lunch_s and current < lunch_s:
            avail = (lunch_s - current).total_seconds() / 3600
            if avail >= remaining: current += timedelta(hours=remaining); remaining = 0
            else: remaining -= avail; current = lunch_e
        else:
            avail = (shift_e - current).total_seconds() / 3600
            if avail >= remaining: current += timedelta(hours=remaining); remaining = 0
            else: remaining -= avail; current = next_shift_start(current)
    return current

def snap_to_shift(dt: datetime) -> datetime:
    for _ in range(14):
        shift_s, shift_e, lunch_s, lunch_e = get_shift(dt.date())
        if dt < shift_s: dt = shift_s; break
        if dt >= shift_e: dt = next_shift_start(dt); continue
        if lunch_s and lunch_e and lunch_s <= dt < lunch_e: dt = lunch_e; break
        break
    return dt

# ─────────────────────────────────────────────
# WORKER AVAILABILITY HELPERS
# ─────────────────────────────────────────────
def get_worker_blocked_periods(db, worker_id: int, from_dt: datetime, to_dt: datetime):
    """
    Returns list of (block_start, block_end) when this worker is unavailable
    due to approved leave, within the given datetime range.
    """
    leaves = db.query(WorkerLeave).filter(
        WorkerLeave.worker_id == worker_id,
        WorkerLeave.leave_date >= from_dt.date(),
        WorkerLeave.leave_date <= to_dt.date()
    ).all()

    blocked = []
    for lv in leaves:
        d = lv.leave_date
        shift_s, shift_e, _, _ = get_shift(d)

        if lv.leave_type == "full":
            blocked.append((shift_s, shift_e))
        elif lv.leave_type == "morning":
            # Morning = 8 AM to 12 PM
            blocked.append((shift_s, datetime(d.year, d.month, d.day, 12, 0)))
        elif lv.leave_type == "afternoon":
            # Afternoon = 2 PM to shift end
            blocked.append((datetime(d.year, d.month, d.day, 14, 0), shift_e))
        elif lv.leave_type == "hours" and lv.start_time and lv.end_time:
            sh, sm = map(int, lv.start_time.split(":"))
            eh, em = map(int, lv.end_time.split(":"))
            blocked.append((
                datetime(d.year, d.month, d.day, sh, sm),
                datetime(d.year, d.month, d.day, eh, em)
            ))
    return blocked

def is_worker_available(db, worker_id: int, start: datetime, end: datetime) -> bool:
    """Check if a worker is free (no leave, no other scheduled op) during start→end."""
    # Check leave blocks
    blocks = get_worker_blocked_periods(db, worker_id, start, end)
    for bs, be in blocks:
        if bs < end and be > start:  # overlap
            return False

    # Check already assigned scheduled ops
    conflict = db.query(ScheduledOp).filter(
        ScheduledOp.worker_id == worker_id,
        ScheduledOp.scheduled_end > start,
        ScheduledOp.scheduled_start < end,
        ScheduledOp.status.in_(["scheduled", "in_progress"])
    ).first()
    return conflict is None

def find_qualified_workers(db, work_center_id: int, for_start: datetime = None) -> list:
    """
    Return active workers who can operate this machine, sorted by composite score:
    - Skill match to machine level
    - Load balance (prefer less-loaded workers)
    - Machine continuity (prefer worker already on this machine)
    """
    wc = db.query(WorkCenter).filter(WorkCenter.id == work_center_id).first()
    if not wc:
        return []
    qualified = [w for w in wc.skilled_workers if w.is_active]
    if not qualified:
        return []

    machine_level = getattr(wc, 'skill_level', 1) or 1
    now = for_start or now_ist()
    today_start = datetime(now.year, now.month, now.day, 0, 0)
    today_end   = datetime(now.year, now.month, now.day, 23, 59)
    shift_hours = 10.0  # Standard shift hours

    def worker_score(w):
        w_level = getattr(w, 'skill_level', 1) or 1

        # 1. Skill match score (0-100, lower = better fit)
        if machine_level >= 3:
            # Specialist machine: prefer highest skill
            skill_score = (3 - w_level) * 30
        elif machine_level == 2:
            # Trained machine: prefer exact match
            skill_score = abs(w_level - 2) * 25
        else:
            # General machine: prefer lowest skill (preserve specialists)
            skill_score = w_level * 20

        # 2. Load balance (0-50, lower = less loaded = better)
        booked_today = db.query(ScheduledOp).filter(
            ScheduledOp.worker_id == w.id,
            ScheduledOp.scheduled_start >= today_start,
            ScheduledOp.scheduled_start <= today_end,
            ScheduledOp.status.in_(["scheduled", "in_progress"])
        ).all()
        load_hours = sum(
            (s.scheduled_end - s.scheduled_start).total_seconds() / 3600
            for s in booked_today if s.scheduled_start and s.scheduled_end
        )
        load_score = min(50, (load_hours / shift_hours) * 50)

        # 3. Machine continuity bonus (0 = already on this machine = great)
        # Check if worker's last op was on this machine
        last_op = db.query(ScheduledOp).filter(
            ScheduledOp.worker_id == w.id,
            ScheduledOp.work_center_id == work_center_id,
            ScheduledOp.scheduled_end <= now,
            ScheduledOp.status == "completed"
        ).order_by(ScheduledOp.scheduled_end.desc()).first()

        continuity_bonus = 0
        if last_op and last_op.scheduled_end:
            gap_hours = (now - last_op.scheduled_end).total_seconds() / 3600
            threshold = getattr(wc, 'continuity_hours', 2.0) or 2.0
            if gap_hours < threshold:
                continuity_bonus = -40  # Strong bonus for staying on machine

        return skill_score + load_score + continuity_bonus

    qualified.sort(key=worker_score)
    return qualified


def should_waive_machine_setup(db, worker_id: int, work_center_id: int,
                                 start_time: datetime, threshold_hours: float = 2.0) -> bool:
    """
    Returns True if machine setup should be waived.
    Condition: same worker did their LAST op on this SAME machine
    and the gap is less than threshold_hours.
    Job setup is ALWAYS required regardless.
    """
    if not worker_id:
        return False
    last_op = db.query(ScheduledOp).filter(
        ScheduledOp.worker_id == worker_id,
        ScheduledOp.work_center_id == work_center_id,
        ScheduledOp.status.in_(["completed", "in_progress"]),
        ScheduledOp.scheduled_end <= start_time,
    ).order_by(ScheduledOp.scheduled_end.desc()).first()

    if not last_op or not last_op.scheduled_end:
        return False
    gap = (start_time - last_op.scheduled_end).total_seconds() / 3600
    wc = db.query(WorkCenter).filter(WorkCenter.id == work_center_id).first()
    threshold = getattr(wc, 'continuity_hours', 2.0) or 2.0
    return gap < threshold


def find_next_slot_with_worker(db, work_center_id: int, duration_hrs: float,
                                start_after: datetime, job_setup_hrs: float = 0,
                                machine_setup_hrs: float = 0):
    """
    Find next slot where BOTH machine AND qualified worker are free.
    Returns (start, end, worker, machine_setup_waived).
    Accounts for machine continuity and load balancing.
    """
    wc = db.query(WorkCenter).filter(WorkCenter.id == work_center_id).first()
    if wc and getattr(wc, 'status', 'active') not in ('active', None, ''):
        raise ValueError(f"Machine '{wc.name}' is currently {wc.status} — cannot schedule")

    qualified = find_qualified_workers(db, work_center_id, start_after)

    if not qualified:
        # No workers — schedule machine-only
        current = snap_to_shift(start_after)
        booked = db.query(ScheduledOp).filter(
            ScheduledOp.work_center_id == work_center_id,
            ScheduledOp.scheduled_end > current,
            ScheduledOp.status.in_(["scheduled", "in_progress"])
        ).order_by(ScheduledOp.scheduled_start).all()
        for b in booked:
            if not b.scheduled_start or not b.scheduled_end: continue
            b_start = b.actual_start if (b.status=="in_progress" and b.actual_start) else b.scheduled_start
            if current < b_start:
                cend = add_working_hours(current, duration_hrs)
                if cend <= b_start:
                    return current, cend, None, False
            if b.scheduled_end > current:
                current = snap_to_shift(b.scheduled_end)
        return current, add_working_hours(current, duration_hrs), None, False

    search_start  = snap_to_shift(start_after)
    search_limit  = search_start + timedelta(days=60)

    machine_booked = db.query(ScheduledOp).filter(
        ScheduledOp.work_center_id == work_center_id,
        ScheduledOp.scheduled_end > search_start,
        ScheduledOp.status.in_(["scheduled", "in_progress"])
    ).order_by(ScheduledOp.scheduled_start).all()

    candidates = [search_start]
    for b in machine_booked:
        if b.scheduled_end and b.scheduled_end > search_start:
            candidates.append(snap_to_shift(b.scheduled_end))

    for candidate in sorted(set(candidates)):
        if candidate > search_limit:
            break
        candidate = snap_to_shift(candidate)

        # Check machine free
        machine_conflict = any(
            (b.actual_start if (b.status=="in_progress" and b.actual_start) else b.scheduled_start) < add_working_hours(candidate, duration_hrs)
            and b.scheduled_end > candidate
            for b in machine_booked
            if b.scheduled_start and b.scheduled_end
        )
        if machine_conflict:
            continue

        # Try each worker (already sorted by composite score)
        for worker in qualified:
            waive_setup = should_waive_machine_setup(
                db, worker.id, work_center_id, candidate
            )
            # If setup waived, actual duration is shorter
            actual_dur = job_setup_hrs + (0 if waive_setup else machine_setup_hrs) + (duration_hrs - job_setup_hrs - machine_setup_hrs)
            actual_dur = max(actual_dur, job_setup_hrs + 0.1)  # minimum job setup

            cend = add_working_hours(candidate, actual_dur)

            if is_worker_available(db, worker.id, candidate, cend):
                return candidate, cend, worker, waive_setup

        # No worker free — try next machine slot
        next_free = None
        for b in machine_booked:
            if b.scheduled_end and b.scheduled_end > candidate:
                nxt = snap_to_shift(b.scheduled_end)
                if next_free is None or nxt < next_free:
                    next_free = nxt
        if next_free:
            candidates.append(next_free)
        candidates.append(next_shift_start(
            datetime(candidate.year, candidate.month, candidate.day, 20, 0)
        ))
        candidates = sorted(set(candidates))

    # Fallback
    current = snap_to_shift(start_after)
    return current, add_working_hours(current, duration_hrs), None, False


def check_preemption(db, new_job: 'Job') -> list:
    """
    Check if a high-priority job (CR < 0.5) can preempt lower-priority work.
    Returns list of (scheduled_op, reason) that should be paused.
    Only preempts if:
    1. New job CR < 0.5 (genuinely urgent)
    2. Worker is occupied on a job with CR > 2.0 (not urgent at all)
    3. New job cannot be scheduled within 4 hours without preemption
    """
    cr = critical_ratio(new_job, db)
    if cr >= 0.5:  # Not urgent enough to preempt
        return []

    preempt_list = []
    if not new_job.routing_id:
        return []

    routing = db.query(Routing).filter(Routing.id == new_job.routing_id).first()
    if not routing:
        return []

    ops = sorted(routing.operations, key=lambda o: o.sequence)
    now = now_ist()
    four_hours_later = now + timedelta(hours=4)

    for op in ops[:1]:  # Check just first operation
        qualified = find_qualified_workers(db, op.work_center_id, now)
        for worker in qualified:
            # Is this worker currently on a low-priority job?
            current_op = db.query(ScheduledOp).filter(
                ScheduledOp.worker_id == worker.id,
                ScheduledOp.status == "in_progress"
            ).first()
            if not current_op:
                continue
            other_job = current_op.job
            other_cr = critical_ratio(other_job, db)
            if other_cr > 2.0:  # Other job is not urgent
                preempt_list.append({
                    "op_id": current_op.id,
                    "worker_name": worker.name,
                    "job_number": other_job.job_number,
                    "other_cr": round(other_cr, 2),
                    "urgent_job": new_job.job_number,
                    "urgent_cr": round(cr, 2),
                })
    return preempt_list


def critical_ratio(job, db):
    if job.priority_flag: return -999.0
    now = now_ist()
    days_due = (job.due_date - now).total_seconds() / 86400
    if job.scheduled_ops:
        remaining = [s for s in job.scheduled_ops if s.status != "completed"]
        total_hrs = sum((s.setup_time_mins / 60) + s.work_time_hrs for s in remaining)
    else:
        routing = db.query(Routing).filter(Routing.id == job.routing_id).first()
        if not routing: return 999.0
        total_hrs = sum((op.setup_time_mins / 60) + op.work_time_hrs for op in routing.operations)
    return days_due / max(total_hrs / 10.0, 0.01)

def get_finish(job):
    ops = [s for s in job.scheduled_ops if s.scheduled_end]
    return max((s.scheduled_end for s in ops), default=None)

# ── APP ──
app = FastAPI(title="Dolphin ERP")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/")
def root(): return FileResponse("index.html")

# ── WORK CENTERS ──
@app.get("/api/workcenters")
def list_wc():
    db = SessionLocal()
    wcs = db.query(WorkCenter).order_by(WorkCenter.machine_type, WorkCenter.name).all()
    result = [{"id": w.id, "name": w.name, "machine_type": w.machine_type,
               "is_bottleneck": w.is_bottleneck,
               "code": getattr(w,"code","") or "",
               "status": getattr(w,"status","active") or "active",
               "skill_level": getattr(w,"skill_level",1) or 1,
               "skilled_worker_ids": [sw.id for sw in w.skilled_workers],
               "skilled_worker_names": [sw.name for sw in w.skilled_workers if sw.is_active]}
              for w in wcs]
    db.close(); return result

@app.post("/api/workcenters")
def create_wc(data: dict):
    db = SessionLocal()
    # Auto-generate machine code if not provided (M1, M2, ...)
    code = (data.get("code") or "").strip()
    if not code:
        last = db.query(WorkCenter).order_by(WorkCenter.id.desc()).first()
        next_num = (last.id + 1) if last else 1
        code = f"M{next_num}"
        # Ensure uniqueness
        while db.query(WorkCenter).filter(WorkCenter.code == code).first():
            next_num += 1
            code = f"M{next_num}"
    wc = WorkCenter(name=data["name"], machine_type=data["machine_type"],
                    is_bottleneck=data.get("is_bottleneck", False),
                    code=code,
                    status=data.get("status","active"),
                    skill_level=int(data.get("skill_level", 1)))
    db.add(wc); db.commit(); db.refresh(wc)
    r = {"id": wc.id, "name": wc.name, "machine_type": wc.machine_type,
         "is_bottleneck": wc.is_bottleneck, "skilled_worker_ids": [], "skilled_worker_names": []}
    db.close(); return r

@app.put("/api/workcenters/{wc_id}")
def update_wc(wc_id: int, data: dict):
    db = SessionLocal()
    wc = db.query(WorkCenter).filter(WorkCenter.id == wc_id).first()
    if not wc: raise HTTPException(404, "Not found")
    wc.name = data.get("name", wc.name)
    wc.machine_type = data.get("machine_type", wc.machine_type)
    wc.is_bottleneck = data.get("is_bottleneck", wc.is_bottleneck)
    if "status" in data: wc.status = data["status"]
    if "skill_level" in data: wc.skill_level = int(data["skill_level"])
    if "continuity_hours" in data: wc.continuity_hours = float(data["continuity_hours"])
    db.commit(); db.refresh(wc)
    r = {"id": wc.id, "name": wc.name, "machine_type": wc.machine_type,
         "is_bottleneck": wc.is_bottleneck,
         "skilled_worker_ids": [sw.id for sw in wc.skilled_workers],
         "skilled_worker_names": [sw.name for sw in wc.skilled_workers]}
    db.close(); return r

@app.delete("/api/workcenters/{wc_id}")
def delete_wc(wc_id: int):
    db = SessionLocal()
    wc = db.query(WorkCenter).filter(WorkCenter.id == wc_id).first()
    if not wc: raise HTTPException(404, "Not found")
    db.delete(wc); db.commit(); db.close(); return {"ok": True}

# ── WORKERS ──
def worker_dict(w, db):
    skill_ids = [s.id for s in w.skills]
    skill_names = [s.name for s in w.skills]
    return {"id": w.id, "name": w.name, "role": w.role, "phone": w.phone,
            "code": getattr(w,"code","") or "",
            "skill_level": getattr(w,"skill_level",1) or 1,
            "is_active": w.is_active, "skill_ids": skill_ids, "skill_names": skill_names}

@app.get("/api/workers")
def list_workers():
    db = SessionLocal()
    workers = db.query(Worker).order_by(Worker.name).all()
    result = [worker_dict(w, db) for w in workers]
    db.close(); return result

@app.get("/api/workers/availability")
def worker_availability():
    """Get worker availability summary for next 14 days."""
    db = SessionLocal()
    workers = db.query(Worker).filter(Worker.is_active == True).all()
    today = now_ist().date()
    result = []
    for w in workers:
        leaves_next14 = db.query(WorkerLeave).filter(
            WorkerLeave.worker_id == w.id,
            WorkerLeave.leave_date >= today,
            WorkerLeave.leave_date <= today + timedelta(days=14)
        ).all()
        leave_dates = [lv.leave_date.isoformat() for lv in leaves_next14]
        # Count assigned ops next 7 days
        ops_count = db.query(ScheduledOp).filter(
            ScheduledOp.worker_id == w.id,
            ScheduledOp.scheduled_start >= datetime.combine(today, datetime.min.time()),
            ScheduledOp.scheduled_start <= datetime.combine(today + timedelta(days=7), datetime.max.time()),
            ScheduledOp.status.in_(["scheduled", "in_progress"])
        ).count()
        # Is on leave today
        on_leave_today = any(lv.leave_date == today for lv in leaves_next14)
        result.append({
            "id": w.id, "name": w.name, "role": w.role,
            "on_leave_today": on_leave_today,
            "leave_dates_next14": leave_dates,
            "ops_next7days": ops_count,
            "skill_names": [s.name for s in w.skills]
        })
    db.close(); return result


# ── CUSTOMERS ──
def customer_dict(c, db):
    job_count = db.query(Job).filter(Job.customer_id == c.id).count()
    on_time = db.query(Job).filter(
        Job.customer_id == c.id,
        Job.status == "completed",
        Job.completed_at <= Job.due_date
    ).count()
    late = db.query(Job).filter(
        Job.customer_id == c.id,
        Job.status == "completed",
        Job.completed_at > Job.due_date
    ).count()
    total_revenue = db.query(Job).filter(Job.customer_id == c.id).all()
    revenue = sum(j.total_price or 0 for j in total_revenue)
    return {
        "id": c.id, "name": c.name, "phone": c.phone,
        "contact_person": c.contact_person, "notes": c.notes,
        "is_active": c.is_active,
        "job_count": job_count,
        "on_time_count": on_time,
        "late_count": late,
        "total_revenue": round(revenue, 2),
    }

@app.get("/api/customers")
def list_customers():
    db = SessionLocal()
    customers = db.query(Customer).filter(Customer.is_active == True).order_by(Customer.name).all()
    result = [customer_dict(c, db) for c in customers]
    db.close(); return result

@app.get("/api/customers/{customer_id}")
def get_customer(customer_id: int):
    db = SessionLocal()
    c = db.query(Customer).filter(Customer.id == customer_id).first()
    if not c: raise HTTPException(404, "Customer not found")
    data = customer_dict(c, db)
    # Include job list
    jobs = db.query(Job).filter(Job.customer_id == customer_id).order_by(Job.created_at.desc()).all()
    fmt = lambda dt: dt.isoformat() if dt else None
    data["jobs"] = [{
        "id": j.id, "job_number": j.job_number, "product_type": j.product_type,
        "product_size": j.product_size, "due_date": fmt(j.due_date),
        "status": j.status, "total_price": j.total_price,
        "completed_at": fmt(j.completed_at), "is_late": bool(j.completed_at and j.completed_at > j.due_date),
    } for j in jobs]
    db.close(); return data

@app.post("/api/customers")
def create_customer(data: dict):
    db = SessionLocal()
    name = (data.get("name") or "").strip()
    if not name: raise HTTPException(400, "Customer name is required")
    existing = db.query(Customer).filter(Customer.name == name).first()
    if existing:
        db.close(); raise HTTPException(400, f"Customer '{name}' already exists")
    c = Customer(
        name=name,
        phone=(data.get("phone") or "").strip(),
        contact_person=(data.get("contact_person") or "").strip(),
        notes=(data.get("notes") or "").strip(),
        is_active=True,
    )
    db.add(c); db.commit(); db.refresh(c)
    result = customer_dict(c, db); db.close(); return result

@app.put("/api/customers/{customer_id}")
def update_customer(customer_id: int, data: dict):
    db = SessionLocal()
    c = db.query(Customer).filter(Customer.id == customer_id).first()
    if not c: raise HTTPException(404, "Customer not found")
    if "name" in data and data["name"].strip() != c.name:
        new_name = data["name"].strip()
        existing = db.query(Customer).filter(Customer.name == new_name, Customer.id != customer_id).first()
        if existing:
            db.close(); raise HTTPException(400, f"Customer '{new_name}' already exists")
        # Update all jobs that referenced old name
        db.query(Job).filter(Job.customer_id == customer_id).update({"customer_name": new_name})
        c.name = new_name
    c.phone = data.get("phone", c.phone)
    c.contact_person = data.get("contact_person", c.contact_person)
    c.notes = data.get("notes", c.notes)
    if "is_active" in data: c.is_active = data["is_active"]
    db.commit(); result = customer_dict(c, db); db.close(); return result

@app.delete("/api/customers/{customer_id}")
def delete_customer(customer_id: int):
    db = SessionLocal()
    c = db.query(Customer).filter(Customer.id == customer_id).first()
    if not c: raise HTTPException(404, "Customer not found")
    job_count = db.query(Job).filter(Job.customer_id == customer_id).count()
    if job_count > 0:
        c.is_active = False  # soft delete to preserve job history
        db.commit(); db.close()
        return {"ok": True, "soft_deleted": True, "job_count": job_count}
    db.delete(c); db.commit(); db.close()
    return {"ok": True, "soft_deleted": False}

# ── ROUTINGS ──
def routing_dict(r):
    ops = [{"id": o.id, "sequence": o.sequence, "name": o.name,
            "work_center_id": o.work_center_id,
            "work_center_name": o.work_center.name if o.work_center else "",
            "machine_type": o.work_center.machine_type if o.work_center else "",
            "setup_time_mins": o.setup_time_mins, "work_time_hrs": o.work_time_hrs,
            "is_optional": o.is_optional} for o in r.operations]
    return {"id": r.id, "name": r.name, "product_type": r.product_type,
            "description": r.description, "material_lead_days": r.material_lead_days,
            "operations": ops}


@app.get("/api/workers/{worker_id}")
def get_worker(worker_id: int):
    db = SessionLocal()
    w = db.query(Worker).filter(Worker.id == worker_id).first()
    if not w: raise HTTPException(404, "Not found")
    data = worker_dict(w, db)
    # Add leave info
    today = now_ist().date()
    leaves = db.query(WorkerLeave).filter(
        WorkerLeave.worker_id == worker_id,
        WorkerLeave.leave_date >= today
    ).order_by(WorkerLeave.leave_date).all()
    data["upcoming_leaves"] = [{"id": lv.id, "date": lv.leave_date.isoformat(),
                                 "type": lv.leave_type, "start_time": lv.start_time,
                                 "end_time": lv.end_time, "reason": lv.reason}
                                for lv in leaves]
    # Add current assignments
    ops = db.query(ScheduledOp).filter(
        ScheduledOp.worker_id == worker_id,
        ScheduledOp.scheduled_end >= now_ist(),
        ScheduledOp.status.in_(["scheduled", "in_progress"])
    ).order_by(ScheduledOp.scheduled_start).limit(10).all()
    fmt = lambda dt: dt.isoformat() if dt else None
    data["upcoming_ops"] = [{"op_name": s.op_name, "wc_name": s.wc_name,
                              "job_number": s.job.job_number if s.job else "",
                              "scheduled_start": fmt(s.scheduled_start),
                              "scheduled_end": fmt(s.scheduled_end),
                              "status": s.status} for s in ops]
    db.close(); return data

@app.post("/api/workers")
def create_worker(data: dict):
    db = SessionLocal()
    # Auto-generate worker code if not provided (W01, W02, ...)
    wcode = (data.get("code") or "").strip()
    if not wcode:
        last = db.query(Worker).order_by(Worker.id.desc()).first()
        next_num = (last.id + 1) if last else 1
        wcode = f"W{next_num:02d}"
        while db.query(Worker).filter(Worker.code == wcode).first():
            next_num += 1
            wcode = f"W{next_num:02d}"
    w = Worker(name=data["name"], role=data.get("role", ""),
               phone=data.get("phone", ""), is_active=True,
               code=wcode,
               skill_level=int(data.get("skill_level", 1)))
    db.add(w); db.flush()
    # Assign skills
    for wc_id in data.get("skill_ids", []):
        wc = db.query(WorkCenter).filter(WorkCenter.id == wc_id).first()
        if wc: w.skills.append(wc)
    db.commit(); db.refresh(w)
    result = worker_dict(w, db); db.close(); return result

@app.put("/api/workers/{worker_id}")
def update_worker(worker_id: int, data: dict):
    db = SessionLocal()
    w = db.query(Worker).filter(Worker.id == worker_id).first()
    if not w: raise HTTPException(404, "Not found")
    w.name = data.get("name", w.name)
    w.role = data.get("role", w.role)
    w.phone = data.get("phone", w.phone)
    w.is_active = data.get("is_active", w.is_active)
    if "skill_level" in data:
        w.skill_level = int(data["skill_level"])
    if "skill_ids" in data:
        w.skills = []
        db.flush()
        for wc_id in data["skill_ids"]:
            wc = db.query(WorkCenter).filter(WorkCenter.id == wc_id).first()
            if wc: w.skills.append(wc)
    db.commit(); result = worker_dict(w, db); db.close(); return result

@app.delete("/api/workers/{worker_id}")
def delete_worker(worker_id: int):
    db = SessionLocal()
    w = db.query(Worker).filter(Worker.id == worker_id).first()
    if not w: raise HTTPException(404, "Not found")
    w.is_active = False  # soft delete
    db.commit(); db.close(); return {"ok": True}

# ── WORKER LEAVE ──
@app.get("/api/workers/{worker_id}/leaves")
def get_worker_leaves(worker_id: int):
    db = SessionLocal()
    leaves = db.query(WorkerLeave).filter(
        WorkerLeave.worker_id == worker_id
    ).order_by(WorkerLeave.leave_date.desc()).all()
    result = [{"id": lv.id, "date": lv.leave_date.isoformat(),
               "type": lv.leave_type, "start_time": lv.start_time,
               "end_time": lv.end_time, "reason": lv.reason}
              for lv in leaves]
    db.close(); return result

@app.post("/api/workers/{worker_id}/leaves")
def add_leave(worker_id: int, data: dict):
    db = SessionLocal()
    w = db.query(Worker).filter(Worker.id == worker_id).first()
    if not w: raise HTTPException(404, "Worker not found")
    lv = WorkerLeave(
        worker_id=worker_id,
        leave_date=parse_date(data["date"]),
        leave_type=data.get("type", "full"),
        start_time=data.get("start_time"),
        end_time=data.get("end_time"),
        reason=data.get("reason", "")
    )
    db.add(lv); db.commit(); db.refresh(lv)
    result = {"id": lv.id, "date": lv.leave_date.isoformat(),
              "type": lv.leave_type, "reason": lv.reason}
    db.close(); return result

@app.delete("/api/leaves/{leave_id}")
def delete_leave(leave_id: int):
    db = SessionLocal()
    lv = db.query(WorkerLeave).filter(WorkerLeave.id == leave_id).first()
    if not lv: raise HTTPException(404, "Not found")
    db.delete(lv); db.commit(); db.close(); return {"ok": True}

@app.get("/api/leaves/today")
def get_today_leaves():
    """Get all workers on leave today."""
    db = SessionLocal()
    today = now_ist().date()
    leaves = db.query(WorkerLeave).filter(WorkerLeave.leave_date == today).all()
    result = [{"worker_id": lv.worker_id,
               "worker_name": lv.worker.name if lv.worker else "",
               "type": lv.leave_type,
               "start_time": lv.start_time, "end_time": lv.end_time,
               "reason": lv.reason} for lv in leaves]
    db.close(); return result

@app.post("/api/workers/{worker_id}/absent-today")
def mark_absent_today(worker_id: int):
    """
    Mark worker absent for today and reschedule all their today's operations
    to other qualified available workers.
    """
    db = SessionLocal()
    w = db.query(Worker).filter(Worker.id == worker_id).first()
    if not w: raise HTTPException(404, "Worker not found")

    today = now_ist().date()
    # Add full day leave if not already there
    existing = db.query(WorkerLeave).filter(
        WorkerLeave.worker_id == worker_id,
        WorkerLeave.leave_date == today
    ).first()
    if not existing:
        lv = WorkerLeave(worker_id=worker_id, leave_date=today,
                         leave_type="full", reason="Absent today")
        db.add(lv); db.flush()

    # Find all their ops scheduled for today that aren't done
    today_start = datetime(today.year, today.month, today.day, 0, 0)
    today_end   = datetime(today.year, today.month, today.day, 23, 59)
    ops = db.query(ScheduledOp).filter(
        ScheduledOp.worker_id == worker_id,
        ScheduledOp.scheduled_start >= today_start,
        ScheduledOp.scheduled_start <= today_end,
        ScheduledOp.status.in_(["scheduled", "in_progress"])
    ).all()

    reassigned = 0; unassigned = 0
    for op in ops:
        # Try to find another qualified worker
        qualified = find_qualified_workers(db, op.work_center_id)
        qualified = [q for q in qualified if q.id != worker_id]
        replaced = False
        for candidate in qualified:
            if is_worker_available(db, candidate.id, op.scheduled_start, op.scheduled_end):
                op.worker_id = candidate.id
                op.worker_name = candidate.name
                replaced = True; reassigned += 1; break
        if not replaced:
            op.worker_id = None
            op.worker_name = None
            unassigned += 1

    db.commit(); db.close()
    return {"reassigned": reassigned, "unassigned": unassigned,
            "total_ops": len(ops), "worker_name": w.name}

@app.post("/api/workers/{worker_id}/reschedule-after-leave")
def reschedule_after_leave(worker_id: int):
    """
    After adding future leave for a worker, reschedule all their future ops
    that conflict with leave dates.
    """
    db = SessionLocal()
    w = db.query(Worker).filter(Worker.id == worker_id).first()
    if not w: raise HTTPException(404, "Worker not found")

    now = now_ist()
    # Get all future ops assigned to this worker
    future_ops = db.query(ScheduledOp).filter(
        ScheduledOp.worker_id == worker_id,
        ScheduledOp.scheduled_start > now,
        ScheduledOp.status == "scheduled"
    ).order_by(ScheduledOp.scheduled_start).all()

    rescheduled = 0
    for op in future_ops:
        # Check if this op overlaps with any leave
        blocks = get_worker_blocked_periods(db, worker_id, op.scheduled_start, op.scheduled_end)
        conflict = any(bs < op.scheduled_end and be > op.scheduled_start for bs, be in blocks)
        if not conflict:
            continue

        # Try other qualified workers
        qualified = find_qualified_workers(db, op.work_center_id)
        qualified = [q for q in qualified if q.id != worker_id]
        replaced = False
        for candidate in qualified:
            if is_worker_available(db, candidate.id, op.scheduled_start, op.scheduled_end):
                op.worker_id = candidate.id
                op.worker_name = candidate.name
                replaced = True; rescheduled += 1; break

        if not replaced:
            # No alternative worker — unassign, flag job
            op.worker_id = None
            op.worker_name = None
            rescheduled += 1

    db.commit(); db.close()
    return {"rescheduled": rescheduled}


@app.get("/api/routings")
def list_routings():
    db = SessionLocal()
    rs = db.query(Routing).filter(Routing.is_active == True).all()
    result = [routing_dict(r) for r in rs]; db.close(); return result

@app.get("/api/routings/{rid}")
def get_routing(rid: int):
    db = SessionLocal()
    r = db.query(Routing).filter(Routing.id == rid).first()
    if not r: raise HTTPException(404, "Not found")
    result = routing_dict(r); db.close(); return result

@app.post("/api/routings")
def create_routing(data: dict):
    db = SessionLocal()
    r = Routing(name=data["name"], product_type=data["product_type"],
                description=data.get("description", ""),
                material_lead_days=float(data.get("material_lead_days", 2.0)))
    db.add(r); db.flush()
    for i, op in enumerate(data.get("operations", [])):
        db.add(Operation(routing_id=r.id, sequence=i+1, name=op["name"],
                         work_center_id=int(op["work_center_id"]),
                         setup_time_mins=float(op.get("setup_time_mins", 0)),
                         work_time_hrs=float(op.get("work_time_hrs", 0)),
                         is_optional=bool(op.get("is_optional", False))))
    db.commit(); db.refresh(r); result = routing_dict(r); db.close(); return result

@app.put("/api/routings/{rid}")
def update_routing(rid: int, data: dict):
    db = SessionLocal()
    r = db.query(Routing).filter(Routing.id == rid).first()
    if not r: raise HTTPException(404, "Not found")
    r.name = data.get("name", r.name)
    r.product_type = data.get("product_type", r.product_type)
    r.description = data.get("description", r.description)
    r.material_lead_days = float(data.get("material_lead_days", r.material_lead_days))
    if "operations" in data:
        for op in r.operations: db.delete(op)
        db.flush()
        for i, op in enumerate(data["operations"]):
            db.add(Operation(routing_id=r.id, sequence=i+1, name=op["name"],
                             work_center_id=int(op["work_center_id"]),
                             setup_time_mins=float(op.get("setup_time_mins", 0)),
                             work_time_hrs=float(op.get("work_time_hrs", 0)),
                             is_optional=bool(op.get("is_optional", False))))
    db.commit(); result = routing_dict(r); db.close(); return result

@app.delete("/api/routings/{rid}")
def delete_routing(rid: int):
    db = SessionLocal()
    r = db.query(Routing).filter(Routing.id == rid).first()
    if not r: raise HTTPException(404, "Not found")
    r.is_active = False; db.commit(); db.close(); return {"ok": True}

# ── JOBS ──
def job_dict(j, db):
    cr = critical_ratio(j, db); finish = get_finish(j)
    is_late = bool(finish and finish > j.due_date)
    fmt = lambda dt: dt.isoformat() if dt else None
    ops_done = sum(1 for s in j.scheduled_ops if s.status == "completed")
    ops_inprog = sum(1 for s in j.scheduled_ops if s.status == "in_progress")
    return {
        "id": j.id, "job_number": j.job_number, "customer_name": j.customer_name,
        "customer_id": j.customer_id, "po_number": j.po_number,
        "total_price": j.total_price, "product_type": j.product_type,
        "product_size": j.product_size, "product_variant": j.product_variant,
        "due_date": fmt(j.due_date), "not_before": fmt(j.not_before),
        "material_ready_date": fmt(j.material_ready_date),
        "priority_flag": j.priority_flag, "status": j.status,
        "routing_id": j.routing_id, "notes": j.notes,
        "created_at": fmt(j.created_at), "completed_at": fmt(j.completed_at),
        "critical_ratio": round(cr, 2),
        "op_overrides": j.op_overrides or "[]",
        "ops_total": len(j.scheduled_ops), "ops_done": ops_done, "ops_inprog": ops_inprog,
        "scheduled_finish": fmt(finish), "is_late": is_late,
    }

@app.get("/api/jobs")
def list_jobs():
    db = SessionLocal()
    jobs = db.query(Job).order_by(Job.created_at.desc()).all()
    result = [job_dict(j, db) for j in jobs]; db.close(); return result

@app.get("/api/jobs/{job_id}")
def get_job(job_id: int):
    db = SessionLocal()
    j = db.query(Job).filter(Job.id == job_id).first()
    if not j: raise HTTPException(404, "Not found")
    data = job_dict(j, db)
    fmt = lambda dt: dt.isoformat() if dt else None
    data["scheduled_ops"] = [
        {"id": s.id, "sequence": s.sequence, "op_name": s.op_name, "wc_name": s.wc_name,
         "worker_id": s.worker_id, "worker_name": s.worker_name,
         "setup_time_mins": s.setup_time_mins, "work_time_hrs": s.work_time_hrs,
         "scheduled_start": fmt(s.scheduled_start), "scheduled_end": fmt(s.scheduled_end),
         "actual_start": fmt(s.actual_start), "actual_end": fmt(s.actual_end),
         "status": s.status, "operation_id": s.operation_id}
        for s in sorted(j.scheduled_ops, key=lambda x: x.sequence)
    ]
    db.close(); return data

@app.get("/api/check-job-number/{num}")
def check_job_number(num: str):
    db = SessionLocal()
    exists = db.query(Job).filter(Job.job_number == num).first() is not None
    db.close(); return {"exists": exists}

@app.post("/api/jobs")
def create_job(data: dict):
    db = SessionLocal()
    provided = (data.get("job_number") or "").strip()
    if provided:
        existing = db.query(Job).filter(Job.job_number == provided).first()
        if existing:
            db.close(); raise HTTPException(400, f"Job number '{provided}' already exists")
        job_num = provided
    else:
        job_num = next_job_number(db)
    due_date = parse_dt(data.get("due_date"))
    if due_date is None:
        db.close(); raise HTTPException(400, "Due date is required and must be a valid date")
    # Resolve customer: by id or by name (auto-create if needed)
    customer_id = data.get("customer_id")
    customer_name = data.get("customer_name", "").strip()
    if customer_id:
        c = db.query(Customer).filter(Customer.id == customer_id).first()
        if c: customer_name = c.name
    elif customer_name:
        # Auto-create customer if not exists
        c = db.query(Customer).filter(Customer.name == customer_name).first()
        if not c:
            c = Customer(name=customer_name, is_active=True)
            db.add(c); db.flush()
        customer_id = c.id
    if not customer_name:
        db.close(); raise HTTPException(400, "Customer name or ID is required")

    j = Job(job_number=job_num, customer_name=customer_name, customer_id=customer_id,
            po_number=data.get("po_number", ""), product_type=data["product_type"],
            total_price=float(data["total_price"]) if data.get("total_price") else None,
            product_size=data["product_size"], product_variant=data.get("product_variant", ""),
            due_date=due_date, not_before=parse_dt(data.get("not_before")),
            material_ready_date=parse_dt(data.get("material_ready_date")),
            routing_id=data.get("routing_id"), priority_flag=data.get("priority_flag", False),
            notes=data.get("notes", ""), op_overrides=json.dumps(data.get("op_overrides", [])))
    db.add(j); db.commit(); db.refresh(j)
    result = {"id": j.id, "job_number": j.job_number, "status": j.status}
    db.close(); return result

@app.put("/api/jobs/{job_id}")
def update_job(job_id: int, data: dict):
    db = SessionLocal()
    j = db.query(Job).filter(Job.id == job_id).first()
    if not j: raise HTTPException(404, "Not found")
    dt_fields = {"due_date", "not_before", "material_ready_date"}
    # Handle customer change
    if "customer_id" in data and data["customer_id"]:
        c = db.query(Customer).filter(Customer.id == data["customer_id"]).first()
        if c:
            j.customer_id = c.id
            j.customer_name = c.name
    elif "customer_name" in data and data["customer_name"]:
        name = data["customer_name"].strip()
        c = db.query(Customer).filter(Customer.name == name).first()
        if not c:
            c = Customer(name=name, is_active=True)
            db.add(c); db.flush()
        j.customer_id = c.id; j.customer_name = name
    for k, v in data.items():
        if k in {"customer_id", "customer_name"}: continue
        if k in dt_fields: setattr(j, k, parse_dt(v))
        elif k == "op_overrides": j.op_overrides = json.dumps(v)
        elif k == "total_price":
            j.total_price = float(v) if v else None
        else:
            try: setattr(j, k, v)
            except: pass
    db.commit()
    result = {"id": j.id, "job_number": j.job_number, "status": j.status}
    db.close(); return result


@app.post("/api/jobs/{job_id}/duplicate")
def duplicate_job(job_id: int):
    """Duplicate a job with a new job number, resetting status to pending."""
    db = SessionLocal()
    j = db.query(Job).filter(Job.id == job_id).first()
    if not j: raise HTTPException(404, "Job not found")
    new_num = next_job_number(db)
    new_j = Job(
        job_number=new_num,
        customer_name=j.customer_name,
        po_number=j.po_number,
        product_type=j.product_type,
        product_size=j.product_size,
        product_variant=j.product_variant,
        due_date=j.due_date,
        routing_id=j.routing_id,
        priority_flag=False,
        status="pending",
        notes=j.notes,
        op_overrides=j.op_overrides,
    )
    db.add(new_j); db.commit(); db.refresh(new_j)
    result = {"id": new_j.id, "job_number": new_j.job_number}
    db.close(); return result

@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: int):
    db = SessionLocal()
    j = db.query(Job).filter(Job.id == job_id).first()
    if not j: raise HTTPException(404, "Not found")
    db.delete(j); db.commit(); db.close(); return {"ok": True}

# ── SCHEDULING ──
def _reactive_reschedule(db, work_center_id: int, worker_id: int, freed_at: datetime):
    """
    Called when an operation completes. Checks if any scheduled future ops
    on this machine/worker can be pulled earlier now that a slot opened up.
    Pulls the next pending job forward if it improves schedule.
    """
    try:
        # Find next scheduled op on this machine that hasn't started yet
        next_ops = db.query(ScheduledOp).filter(
            ScheduledOp.work_center_id == work_center_id,
            ScheduledOp.scheduled_start > freed_at,
            ScheduledOp.status == "scheduled",
        ).order_by(ScheduledOp.scheduled_start).limit(3).all()

        for next_op in next_ops:
            if not next_op.scheduled_start:
                continue
            gap = (next_op.scheduled_start - freed_at).total_seconds() / 3600
            if gap < 0.5:
                # Already very close — no benefit
                continue

            # Can this op start now (at freed_at)?
            duration = (next_op.scheduled_end - next_op.scheduled_start).total_seconds() / 3600
            new_start = snap_to_shift(freed_at)
            new_end   = add_working_hours(new_start, duration)

            # Check machine is free in new slot
            conflict = db.query(ScheduledOp).filter(
                ScheduledOp.work_center_id == work_center_id,
                ScheduledOp.scheduled_start < new_end,
                ScheduledOp.scheduled_end > new_start,
                ScheduledOp.id != next_op.id,
                ScheduledOp.status.in_(["scheduled", "in_progress"])
            ).first()
            if conflict:
                continue

            # Check worker is free
            if next_op.worker_id:
                w_conflict = db.query(ScheduledOp).filter(
                    ScheduledOp.worker_id == next_op.worker_id,
                    ScheduledOp.scheduled_start < new_end,
                    ScheduledOp.scheduled_end > new_start,
                    ScheduledOp.id != next_op.id,
                    ScheduledOp.status.in_(["scheduled", "in_progress"])
                ).first()
                if w_conflict:
                    continue

            # Pull it forward
            next_op.scheduled_start = new_start
            next_op.scheduled_end   = new_end
            break  # Only pull one op forward per reactive trigger

        db.commit()
    except Exception:
        pass  # Reactive scheduling is best-effort, never crash main flow


def _do_schedule(db, j):
    if not j.routing_id: return False
    for s in j.scheduled_ops: db.delete(s)
    db.flush()
    routing = db.query(Routing).filter(Routing.id == j.routing_id).first()
    if not routing: return False
    overrides = {}
    if j.op_overrides:
        try:
            for ov in json.loads(j.op_overrides): overrides[ov["operation_id"]] = ov
        except: pass
    ops = sorted(routing.operations, key=lambda o: o.sequence)
    now = now_ist()
    candidates = [now]
    if j.not_before: candidates.append(j.not_before)
    if j.material_ready_date: candidates.append(j.material_ready_date)
    current_start = snap_to_shift(max(candidates))

    for op in ops:
        ov = overrides.get(op.id, {})
        if not ov.get("included", True): continue
        setup = float(ov.get("setup_time_mins", op.setup_time_mins))
        work  = float(ov.get("work_time_hrs", op.work_time_hrs))
        duration = (setup / 60) + work
        if duration <= 0: continue

        try:
            start, end, worker = find_next_slot_with_worker(
                db, op.work_center_id, duration, current_start
            )
        except ValueError as e:
            # Machine unavailable (maintenance/breakdown) — skip this op
            db.add(ScheduledOp(
                job_id=j.id, operation_id=op.id,
                work_center_id=op.work_center_id,
                worker_id=None, worker_name=None,
                sequence=op.sequence, op_name=op.name,
                wc_name=op.work_center.name if op.work_center else "",
                setup_time_mins=setup, work_time_hrs=work,
                scheduled_start=None, scheduled_end=None,
                status="pending",  # left unscheduled
            ))
            current_start = current_start  # don't advance time
            continue
        db.add(ScheduledOp(
            job_id=j.id, operation_id=op.id,
            work_center_id=op.work_center_id,
            worker_id=worker.id if worker else None,
            worker_name=worker.name if worker else None,
            sequence=op.sequence, op_name=op.name,
            wc_name=op.work_center.name if op.work_center else "",
            setup_time_mins=setup, work_time_hrs=work,
            scheduled_start=start, scheduled_end=end, status="scheduled"
        ))
        current_start = end

    j.status = "scheduled"; db.commit(); return True

@app.post("/api/schedule/{job_id}")
def schedule_job(job_id: int):
    db = SessionLocal()
    j = db.query(Job).filter(Job.id == job_id).first()
    if not j: raise HTTPException(404, "Job not found")
    if not j.routing_id: raise HTTPException(400, "Job has no routing assigned")
    ok = _do_schedule(db, j); db.close()
    if not ok: raise HTTPException(400, "Scheduling failed")
    return {"ok": True}

@app.post("/api/schedule-all")
def schedule_all():
    db = SessionLocal()
    jobs = db.query(Job).filter(Job.status.in_(["pending", "scheduled"])).all()
    jobs.sort(key=lambda j: critical_ratio(j, db))
    count = 0; unassigned = 0; skipped = 0; preempted = 0
    for j in jobs:
        if not j.routing_id: continue
        has_active = any(s.status in ("completed","in_progress","paused") for s in j.scheduled_ops)
        if has_active:
            skipped += 1; continue
        cr = critical_ratio(j, db)
        if cr < 0.5:
            for pc in check_preemption(db, j):
                op_to_pause = db.query(ScheduledOp).filter(ScheduledOp.id == pc["op_id"]).first()
                if op_to_pause and op_to_pause.status == "in_progress":
                    op_to_pause.status = "paused"; preempted += 1
        _do_schedule(db, j); count += 1
        for s in j.scheduled_ops:
            if s.worker_id is None and s.scheduled_start is not None:
                unassigned += 1
    db.close()
    return {"scheduled": count, "unassigned_ops": unassigned,
            "skipped_active": skipped, "preempted": preempted}

@app.get("/api/gantt")
def get_gantt():
    db = SessionLocal()
    from datetime import timedelta
    week_ago = now_ist() - timedelta(days=7)
    jobs = db.query(Job).filter(
        (Job.status.in_(["scheduled", "in_progress"])) |
        ((Job.status == "completed") & (Job.completed_at >= week_ago))
    ).all()
    result = []
    for j in jobs:
        cr = critical_ratio(j, db); finish = get_finish(j)
        is_late = bool(finish and finish > j.due_date)
        fmt = lambda dt: dt.isoformat() if dt else None
        for s in j.scheduled_ops:
            if s.scheduled_start and s.scheduled_end:
                result.append({
                    "job_id": j.id, "job_number": j.job_number,
                    "customer": j.customer_name, "po_number": j.po_number,
                    "op_name": s.op_name, "wc_name": s.wc_name, "op_id": s.id,
                    "worker_name": s.worker_name,
                    "setup_time_mins": s.setup_time_mins, "work_time_hrs": s.work_time_hrs,
                    "start": fmt(s.scheduled_start), "end": fmt(s.scheduled_end),
                    "actual_start": fmt(s.actual_start), "status": s.status,
                    "priority": j.priority_flag, "critical_ratio": round(cr, 2),
                    "is_late": is_late, "due_date": fmt(j.due_date),
                })
    db.close(); return result

@app.get("/api/debug/today")
def debug_today():
    """Debug endpoint - shows what the today query sees."""
    db = SessionLocal()
    today = now_ist().date()
    t_start = datetime(today.year, today.month, today.day, 0, 0)
    t_end   = datetime(today.year, today.month, today.day, 23, 59)
    
    # Get ALL scheduled ops regardless of date
    all_ops = db.query(ScheduledOp).filter(
        ScheduledOp.status.in_(["scheduled", "in_progress"])
    ).order_by(ScheduledOp.scheduled_start).all()
    
    fmt = lambda dt: dt.isoformat() if dt else None
    result = {
        "now_ist": now_ist().isoformat(),
        "today_ist": today.isoformat(),
        "t_start": t_start.isoformat(),
        "t_end": t_end.isoformat(),
        "all_ops_count": len(all_ops),
        "all_ops": [{"op_name": s.op_name, "job": s.job.job_number,
                     "start": fmt(s.scheduled_start), "end": fmt(s.scheduled_end),
                     "status": s.status,
                     "matches_today": (s.scheduled_start <= t_end and s.scheduled_end >= t_start) if s.scheduled_start and s.scheduled_end else False}
                    for s in all_ops],
    }
    db.close()
    return result


@app.get("/api/today")
def get_today():
    db = SessionLocal()
    today = now_ist().date()
    t_start = datetime(today.year, today.month, today.day, 0, 0)
    t_end   = datetime(today.year, today.month, today.day, 23, 59)
    # Get all ops and filter in Python to avoid SQLite datetime comparison issues
    all_ops = db.query(ScheduledOp).filter(
        ScheduledOp.status.in_(["scheduled", "in_progress"]),
        ScheduledOp.scheduled_start != None,
        ScheduledOp.scheduled_end != None,
    ).order_by(ScheduledOp.scheduled_start).all()
    
    ops = [s for s in all_ops if s.scheduled_start <= t_end and s.scheduled_end >= t_start]
    fmt = lambda dt: dt.isoformat() if dt else None
    result = [{"op_id": s.id, "job_id": s.job.id, "job_number": s.job.job_number,
               "customer": s.job.customer_name, "po_number": s.job.po_number,
               "op_name": s.op_name, "wc_name": s.wc_name,
               "worker_id": s.worker_id, "worker_name": s.worker_name,
               "setup_time_mins": s.setup_time_mins, "work_time_hrs": s.work_time_hrs,
               "scheduled_start": fmt(s.scheduled_start), "scheduled_end": fmt(s.scheduled_end),
               "actual_start": fmt(s.actual_start), "status": s.status,
               "priority": s.job.priority_flag, "due_date": fmt(s.job.due_date)}
              for s in ops]
    db.close(); return result

@app.get("/api/heatmap")
def get_heatmap():
    db = SessionLocal()
    wcs = db.query(WorkCenter).order_by(WorkCenter.machine_type, WorkCenter.name).all()
    result = {}
    for wc in wcs:
        ops = db.query(ScheduledOp).filter(
            ScheduledOp.work_center_id == wc.id,
            ScheduledOp.scheduled_start != None).all()
        by_day = {}
        for op in ops:
            day = op.scheduled_start.strftime("%Y-%m-%d")
            hrs = (op.scheduled_end - op.scheduled_start).total_seconds() / 3600
            by_day[day] = round(by_day.get(day, 0) + hrs, 1)
        result[wc.name] = by_day
    db.close(); return result

@app.put("/api/ops/{op_id}/status")
def update_op_status(op_id: int, data: dict):
    db = SessionLocal()
    s = db.query(ScheduledOp).filter(ScheduledOp.id == op_id).first()
    if not s: raise HTTPException(404, "Not found")
    s.status = data["status"]; now = now_ist()
    j = s.job

    if data["status"] == "in_progress":
        if not s.actual_start:
            s.actual_start = now
        if j.status in ("pending", "scheduled"):
            j.status = "in_progress"

    elif data["status"] == "paused":
        # Paused — record when paused, don't clear actual_start
        s.paused_at = now if hasattr(s, 'paused_at') else now
        if j.status == "in_progress":
            # Job is paused only if ALL in_progress ops are now paused
            all_paused = all(op.status in ("paused","completed","pending","scheduled")
                             for op in j.scheduled_ops)
            if all_paused:
                j.status = "scheduled"  # back to scheduled until resumed

    elif data["status"] == "completed":
        s.actual_end = now
        all_done = all(op.status == "completed" for op in j.scheduled_ops)
        any_inprog = any(op.status == "in_progress" for op in j.scheduled_ops if op.id != s.id)
        if all_done:
            j.status = "completed"; j.completed_at = now
        elif not any_inprog:
            j.status = "in_progress"

        # ── REACTIVE SCHEDULING ──
        # When an op completes, pull forward the next pending op on this machine/worker
        # if it was scheduled with a gap (i.e. it can start now)
        _reactive_reschedule(db, s.work_center_id, s.worker_id, now)

    db.commit(); db.close()
    return {"ok": True, "reactive_triggered": data["status"] == "completed"}

@app.put("/api/ops/{op_id}/assign-worker")
def assign_worker_to_op(op_id: int, data: dict):
    """Manually reassign a worker to a specific operation."""
    db = SessionLocal()
    s = db.query(ScheduledOp).filter(ScheduledOp.id == op_id).first()
    if not s: raise HTTPException(404, "Not found")
    worker_id = data.get("worker_id")
    if worker_id:
        w = db.query(Worker).filter(Worker.id == worker_id).first()
        if not w: raise HTTPException(404, "Worker not found")
        s.worker_id = w.id; s.worker_name = w.name
    else:
        s.worker_id = None; s.worker_name = None
    db.commit(); db.close(); return {"ok": True}


# ── REPORTS ──
@app.get("/api/reports/summary")
def reports_summary():
    """Summary stats for reports dashboard."""
    db = SessionLocal()
    from datetime import timedelta
    now = now_ist()

    # All-time
    all_jobs = db.query(Job).all()
    completed = [j for j in all_jobs if j.status == "completed"]

    on_time = [j for j in completed if j.completed_at and j.due_date and j.completed_at <= j.due_date]
    late = [j for j in completed if j.completed_at and j.due_date and j.completed_at > j.due_date]

    total_revenue = sum(j.total_price or 0 for j in all_jobs)
    completed_revenue = sum(j.total_price or 0 for j in completed)

    # Last 30 days
    last_30 = now - timedelta(days=30)
    recent_completed = [j for j in completed if j.completed_at and j.completed_at >= last_30]
    recent_revenue = sum(j.total_price or 0 for j in recent_completed)

    # On-time rate
    on_time_rate = round(len(on_time) / len(completed) * 100, 1) if completed else 0

    # Monthly breakdown (last 6 months)
    monthly = {}
    for j in all_jobs:
        if not j.created_at: continue
        key = j.created_at.strftime("%Y-%m")
        if key not in monthly:
            monthly[key] = {"month": key, "jobs_created": 0, "jobs_completed": 0,
                            "revenue": 0, "late_count": 0, "on_time_count": 0}
        monthly[key]["jobs_created"] += 1

    for j in completed:
        if not j.completed_at: continue
        key = j.completed_at.strftime("%Y-%m")
        if key not in monthly:
            monthly[key] = {"month": key, "jobs_created": 0, "jobs_completed": 0,
                            "revenue": 0, "late_count": 0, "on_time_count": 0}
        monthly[key]["jobs_completed"] += 1
        monthly[key]["revenue"] += j.total_price or 0
        if j.completed_at > j.due_date:
            monthly[key]["late_count"] += 1
        else:
            monthly[key]["on_time_count"] += 1

    monthly_list = sorted(monthly.values(), key=lambda x: x["month"], reverse=True)[:12]
    monthly_list.reverse()

    # Top customers by revenue
    customer_stats = {}
    for j in all_jobs:
        if not j.customer_id: continue
        if j.customer_id not in customer_stats:
            customer_stats[j.customer_id] = {
                "customer_id": j.customer_id,
                "name": j.customer_name,
                "jobs": 0, "revenue": 0, "completed": 0, "late": 0
            }
        customer_stats[j.customer_id]["jobs"] += 1
        customer_stats[j.customer_id]["revenue"] += j.total_price or 0
        if j.status == "completed":
            customer_stats[j.customer_id]["completed"] += 1
            if j.completed_at and j.completed_at > j.due_date:
                customer_stats[j.customer_id]["late"] += 1

    top_customers = sorted(customer_stats.values(), key=lambda x: x["revenue"], reverse=True)[:10]

    # Currently late jobs (overdue, not completed)
    late_jobs = [j for j in all_jobs
                 if j.status not in ("completed",)
                 and j.due_date < now
                 and j.due_date]
    late_jobs_list = [{
        "id": j.id, "job_number": j.job_number, "customer_name": j.customer_name,
        "due_date": j.due_date.isoformat() if j.due_date else None,
        "days_late": (now - j.due_date).days,
        "status": j.status,
    } for j in late_jobs]

    # Machine utilization (top loaded next 30 days)
    upcoming_end = now + timedelta(days=30)
    wcs = db.query(WorkCenter).all()
    machine_load = []
    for wc in wcs:
        ops = db.query(ScheduledOp).filter(
            ScheduledOp.work_center_id == wc.id,
            ScheduledOp.scheduled_start >= now,
            ScheduledOp.scheduled_start <= upcoming_end,
            ScheduledOp.status.in_(["scheduled", "in_progress"])
        ).all()
        total_hrs = sum((o.scheduled_end - o.scheduled_start).total_seconds() / 3600 for o in ops if o.scheduled_start and o.scheduled_end)
        machine_load.append({"name": wc.name, "type": wc.machine_type, "hours": round(total_hrs, 1), "ops_count": len(ops)})
    machine_load.sort(key=lambda x: x["hours"], reverse=True)

    db.close()
    return {
        "totals": {
            "total_jobs": len(all_jobs),
            "completed_jobs": len(completed),
            "on_time_jobs": len(on_time),
            "late_jobs": len(late),
            "on_time_rate": on_time_rate,
            "total_revenue": round(total_revenue, 2),
            "completed_revenue": round(completed_revenue, 2),
            "recent_revenue_30d": round(recent_revenue, 2),
            "currently_late": len(late_jobs),
        },
        "monthly": monthly_list,
        "top_customers": top_customers,
        "late_jobs": late_jobs_list,
        "machine_load": machine_load[:15],
    }



@app.post("/api/backfill-codes")
def backfill_codes():
    """Assign codes to existing machines/workers that don't have one."""
    db = SessionLocal()
    updated = 0
    # Machines
    machines = db.query(WorkCenter).order_by(WorkCenter.id).all()
    for wc in machines:
        if not wc.code:
            wc.code = f"M{wc.id}"
            updated += 1
    # Workers
    workers = db.query(Worker).order_by(Worker.id).all()
    for w in workers:
        if not w.code:
            w.code = f"W{w.id:02d}"
            updated += 1
    db.commit(); db.close()
    return {"updated": updated}

@app.post("/api/seed-real")
def seed_real():
    """Seed actual machines and workers from Yukeng setup."""
    db = SessionLocal()
    if db.query(Worker).count() > 0 or db.query(WorkCenter).count() > 0:
        db.close(); return {"msg": "Already has data — clear first"}

    # Workers with codes
    workers_data = [
        ("W01","Shreyans",   "Operator",       "+91"),
        ("W02","Sonu",       "Operator",       "+91"),
        ("W03","Anil",       "Operator",       "+91"),
        ("W04","Jignesh",    "Operator",       "+91"),
        ("W05","Rajkumar",   "Senior Operator","+91"),
        ("W06","Ravinder",   "VMC Operator",   "+91"),
        ("W07","Nilesh",     "VMC Operator",   "+91"),
        ("W08","Krishnkant", "Drill Operator", "+91"),
        ("W09","Suraj",      "Operator",       "+91"),
        ("W10","Atul",       "Grinder Operator","+91"),
    ]
    wmap = {}
    for code,name,role,phone in workers_data:
        w = Worker(code=code,name=name,role=role,phone=phone,is_active=True)
        db.add(w); db.flush(); wmap[name]=w

    # Machines with codes and types
    machines_data = [
        ("M1", "Edge Grinder",       "Grinder",         True,  "active",  ["Rajkumar","Atul","Sonu"]),
        ("M2", "DC Surface Grinder", "Grinder",         True,  "active",  ["Atul","Sonu","Shreyans"]),
        ("M3", "Edge Grinder 2",     "Grinder",         False, "active",  ["Rajkumar","Atul","Sonu"]),
        ("M4", "Profile Grinder",    "Grinder",         False, "active",  ["Sonu"]),
        ("M5", "Router CNC",         "VMC",             False, "active",  ["Ravinder","Nilesh","Krishnkant"]),
        ("M6", "Planar Mill",        "Milling Machine", False, "active",  ["Rajkumar","Sonu","Shreyans","Suraj","Ravinder","Anil"]),
        ("M7", "Edge Mill",          "Milling Machine", False, "active",  ["Rajkumar","Sonu","Shreyans","Suraj","Ravinder","Anil"]),
        ("M8", "KAFO VMC",           "VMC",             True,  "active",  ["Ravinder","Nilesh","Krishnkant"]),
        ("M9", "DC VMC",             "VMC",             True,  "active",  ["Ravinder","Nilesh","Krishnkant"]),
        ("M10","Radial Drill",       "Drill",           False, "active",  ["Krishnkant","Anil","Sonu"]),
        ("M11","Universal Mill 1",   "Milling Machine", False, "maintenance",["Rajkumar","Anil","Sonu"]),
        ("M12","Universal Mill 2",   "Milling Machine", False, "active",  ["Rajkumar","Anil","Sonu"]),
        ("M13","Universal Mill 3",   "Milling Machine", False, "active",  ["Rajkumar","Anil","Sonu"]),
        ("M14","Big Edge Mill",      "Milling Machine", True,  "active",  ["Rajkumar","Sonu","Shreyans","Suraj","Ravinder"]),
        ("M15","Rubberizing",        "Hydraulic Press", False, "active",  ["Jignesh","Shreyans","Anil"]),
        ("M16","Welding",            "Welding",         False, "active",  ["Anil","Sonu"]),
        ("M17","Liner Assembly",     "Assembly",        False, "active",  ["Sonu"]),
        ("M18","Mould Assembly",     "Assembly",        False, "active",  ["Sonu","Shreyans"]),
        ("M19","Oil Station",        "Pump",            False, "active",  ["Jignesh","Shreyans","Anil"]),
        ("M20","Magnet Drill",       "Drill",           False, "active",  ["Krishnkant","Anil","Sonu"]),
        ("M21","Carbide Fitting",    "Assembly",        False, "active",  ["Sonu","Shreyans"]),
        ("M22","Sand Blasting",      "Assembly",        False, "active",  ["Rajkumar","Sonu","Shreyans","Suraj","Ravinder","Jignesh","Anil"]),
    ]
    for code,name,mtype,bot,status,can_ops in machines_data:
        wc = WorkCenter(code=code,name=name,machine_type=mtype,is_bottleneck=bot,status=status)
        db.add(wc); db.flush()
        for wname in can_ops:
            if wname in wmap: wc.skilled_workers.append(wmap[wname])

    db.commit(); db.close()
    return {"msg":"Real data seeded","workers":len(workers_data),"machines":len(machines_data)}


@app.get("/api/preemption-alerts")
def get_preemption_alerts():
    """Returns jobs that could be preempted to free workers for urgent jobs."""
    db = SessionLocal()
    urgent_jobs = db.query(Job).filter(
        Job.status.in_(["pending","scheduled"]),
        Job.priority_flag == True
    ).all()
    alerts = []
    for j in urgent_jobs:
        cr = critical_ratio(j, db)
        if cr < 0.5:
            candidates = check_preemption(db, j)
            for c in candidates:
                alerts.append(c)
    db.close()
    return alerts

@app.get("/api/health")
def health(): return {"status": "ok", "time_ist": now_ist().isoformat()}

@app.post("/api/seed")
def seed():
    db = SessionLocal()
    if db.query(WorkCenter).count() > 0:
        db.close(); return {"msg": "Already seeded"}
    machines = [
        ("Big Edge Milling","Milling",False), ("Universal Milling 1","Milling",False),
        ("Universal Milling 2","Milling",False), ("Step Milling","Milling",False),
        ("Planar Milling","Milling",False), ("Double Column VMC","VMC",True),
        ("KAFO VMC","VMC",True), ("Router CNC","CNC",False),
        ("Big Radial Drill","Drill",False), ("Big Radial Drill Manual","Drill",False),
        ("Profile Grinder","Grinder",False), ("Surface Grinder","Grinder",True),
        ("Double Column Surface Grinder","Grinder",True), ("Big Surface Grinder","Grinder",True),
        ("Rubberizing","Finishing",False), ("Sand Blasting","Finishing",False),
        ("Welding","Welding",False), ("Assembly Station","Assembly",False),
        ("Oil Filling Station","Assembly",False),
    ]
    wc_map = {}
    for name, mtype, bot in machines:
        wc = WorkCenter(name=name, machine_type=mtype, is_bottleneck=bot)
        db.add(wc); db.flush(); wc_map[name] = wc.id

    def mr(name, ptype, desc, lead, ops_def):
        r = Routing(name=name, product_type=ptype, description=desc, material_lead_days=lead)
        db.add(r); db.flush()
        for seq, nm, wc, setup, work, opt in ops_def:
            db.add(Operation(routing_id=r.id, sequence=seq, name=nm,
                             work_center_id=wc_map[wc], setup_time_mins=setup,
                             work_time_hrs=work, is_optional=opt))

    mr("Punch Routing (< 600x600)", "Punch", "Plain/Panel/Rustic/Isostatic", 2, [
        (1,"Facing","Double Column VMC",30,1,False), (2,"Side Cutting","Big Edge Milling",20,2,False),
        (3,"Welding","Welding",20,1,False), (4,"Surface Grinding","Big Surface Grinder",20,2,False),
        (5,"Edge Grinding","Surface Grinder",30,3,False), (6,"Step Milling","Step Milling",30,2,False),
        (7,"Radius Milling","KAFO VMC",20,2,False), (8,"Rubberizing","Rubberizing",45,1,False),
        (9,"Oil Filling","Oil Filling Station",5,0.08,True)])
    mr("Base Plate Routing", "Base Plate", "For Entry and SFS moulds", 3, [
        (1,"Facing","Double Column VMC",30,6,False), (2,"Side Cutting","Big Edge Milling",20,4,False),
        (3,"VMC Milling","KAFO VMC",20,3,False), (4,"Drilling","Big Radial Drill",20,2,True),
        (5,"Surface Grinding","Big Surface Grinder",30,4,False)])
    mr("Die Frame Routing", "Die Frame", "Die frame with liner assembly", 3, [
        (1,"Facing","Double Column VMC",30,6,False), (2,"Side Cutting","Big Edge Milling",20,4,False),
        (3,"VMC Milling","KAFO VMC",20,3,False), (4,"Drilling","Big Radial Drill",20,2,False),
        (5,"Surface Grinding","Big Surface Grinder",30,4,False),
        (6,"Liner Assembly","Assembly Station",30,5,False)])
    db.commit()

    # Seed example workers
    vmc_wc  = db.query(WorkCenter).filter(WorkCenter.name == "Double Column VMC").first()
    kafo_wc = db.query(WorkCenter).filter(WorkCenter.name == "KAFO VMC").first()
    grind_wc= db.query(WorkCenter).filter(WorkCenter.name == "Big Surface Grinder").first()
    surf_wc = db.query(WorkCenter).filter(WorkCenter.name == "Surface Grinder").first()
    mill_wc = db.query(WorkCenter).filter(WorkCenter.name == "Big Edge Milling").first()
    weld_wc = db.query(WorkCenter).filter(WorkCenter.name == "Welding").first()
    assm_wc = db.query(WorkCenter).filter(WorkCenter.name == "Assembly Station").first()
    step_wc = db.query(WorkCenter).filter(WorkCenter.name == "Step Milling").first()
    drill_wc= db.query(WorkCenter).filter(WorkCenter.name == "Big Radial Drill").first()

    workers_data = [
        ("Ramesh Kumar",   "Senior VMC Operator",  [vmc_wc, kafo_wc, step_wc]),
        ("Suresh Patel",   "VMC Operator",          [vmc_wc, kafo_wc]),
        ("Mahesh Singh",   "Grinder Operator",      [grind_wc, surf_wc]),
        ("Dinesh Sharma",  "Grinder Operator",      [grind_wc, surf_wc]),
        ("Rakesh Verma",   "Milling Operator",      [mill_wc, step_wc, drill_wc]),
        ("Ganesh Yadav",   "Welder / Assembler",    [weld_wc, assm_wc]),
    ]
    for name, role, skills in workers_data:
        w = Worker(name=name, role=role, is_active=True)
        db.add(w); db.flush()
        for skill in skills:
            if skill: w.skills.append(skill)
    db.commit()
    db.close()
    return {"msg": "Seeded", "machines": len(machines), "routings": 3, "workers": len(workers_data)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
