import json
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, func, or_, and_
from sqlalchemy.orm import sessionmaker
from datetime import datetime, timedelta, date
from models import (Base, WorkCenter, Worker, WorkerLeave, worker_skills,
                    Customer, Routing, Operation, SubOperation, Job, ScheduledOp,
                    JobCounter, CustomerOrder, OrderCounter, User, StaffTask, TaskFile,
                    TaskAssignee, TaskActivity, Quotation, QuoteCounter, CompanySetting,
                    OrderComponent, AssemblyStep, Notification, WorkerDailyReport,
                    ProductType, ProductAttribute, ProductAttributeValue, ActivityLog, now_ist)
import json, os, subprocess, sys
from auth import (
    create_token, verify_token, hash_password, verify_password,
    hash_pin, verify_pin, get_current_user, require_roles,
    require_admin, require_manager, require_any, ensure_admin_user, PERMISSIONS, resolve_permissions
)

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
            print("⚠ Alembic issue, using create_all fallback")
            Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"⚠ Migration warning: {e}, using create_all fallback")
        Base.metadata.create_all(bind=engine)

run_migrations()

# Bootstrap: create default admin user if none exist
try:
    _boot_db = SessionLocal()
    ensure_admin_user(_boot_db)
    _boot_db.close()
except Exception as _e:
    print(f"⚠  Auth bootstrap error: {_e}")

# ─────────────────────────────────────────────────────────────────────────────
# PARSING HELPERS
# ─────────────────────────────────────────────────────────────────────────────
def parse_dt(s):
    if not s: return None
    s = s.strip().replace("Z","").replace("T"," ")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try: return datetime.strptime(s, fmt)
        except ValueError: continue
    try: return datetime.fromisoformat(s)
    except: return None

from contextlib import contextmanager
@contextmanager
def get_db():
    """Context manager for safe db session — always closes even on exception."""
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ═════════════════════════════════════════════════════════════════════════════
# NOTIFICATION ENGINE
# ═════════════════════════════════════════════════════════════════════════════

def _notify(db, event_type: str, title: str, body: str,
            link: str = None, job_id: int = None,
            order_id: int = None, wc_id: int = None,
            target_role: str = None, target_user_id: int = None,
            target_worker_id: int = None):
    """
    Create a notification. Deduplicates: won't create same event_type + same
    reference + same target more than once per hour (prevents spam).

    Targeting:
      all None → visible to manager/admin only (backward compat)
      target_role="operator" → all operators see it
      target_worker_id=5 → only the user linked to worker 5
      target_user_id=3 → only user 3
    """
    one_hour_ago = now_ist() - timedelta(hours=1)
    existing = db.query(Notification).filter(
        Notification.event_type == event_type,
        Notification.is_read    == False,
        Notification.created_at >= one_hour_ago,
    )
    if job_id:            existing = existing.filter(Notification.job_id   == job_id)
    if order_id:          existing = existing.filter(Notification.order_id == order_id)
    if wc_id:             existing = existing.filter(Notification.wc_id    == wc_id)
    if target_worker_id:  existing = existing.filter(Notification.target_worker_id == target_worker_id)
    if target_user_id:    existing = existing.filter(Notification.target_user_id   == target_user_id)
    if existing.first():
        return   # already notified recently, skip

    n = Notification(
        event_type       = event_type,
        title            = title,
        body             = body,
        link             = link,
        is_read          = False,
        created_at       = now_ist(),
        job_id           = job_id,
        order_id         = order_id,
        wc_id            = wc_id,
        target_role      = target_role,
        target_user_id   = target_user_id,
        target_worker_id = target_worker_id,
    )
    db.add(n)
    # No commit here — caller commits


def _notify_worker(db, worker_id: int, event_type: str, title: str, body: str,
                   link: str = None, job_id: int = None):
    """Convenience: send a notification targeted to a specific worker."""
    _notify(db, event_type, title, body, link=link, job_id=job_id,
            target_worker_id=worker_id)


def _check_job_urgency(db, job):
    """Notify if job just became urgent (CR < 0.5)."""
    if job.status in ("completed", "pending"):
        return
    try:
        cr = critical_ratio(job, db)
        if cr < 0.5:
            _notify(db,
                event_type = "job_urgent",
                title      = f"🚨 Urgent: {job.job_number}",
                body       = f"{job.customer_name} — {job.product_type} {job.product_size}. CR={cr:.2f}",
                link       = f"/jobs/{job.id}",
                job_id     = job.id,
                order_id   = job.order_id,
            )
    except Exception:
        pass


def _check_order_due_soon(db, order):
    """Notify if order due in <= 2 days with pending/scheduled jobs."""
    if order.status == "completed":
        return
    try:
        days_left = (order.due_date - now_ist()).total_seconds() / 86400
        if 0 < days_left <= 2:
            pending = sum(1 for j in order.jobs if j.status not in ("completed",))
            if pending > 0:
                _notify(db,
                    event_type = "order_due_soon",
                    title      = f"⏰ Due Soon: {order.order_number}",
                    body       = f"{order.customer_name} — due in {days_left:.0f} day(s), {pending} job(s) still pending",
                    link       = f"/orders/{order.id}",
                    order_id   = order.id,
                )
    except Exception:
        pass

def parse_date(s):
    if not s: return None
    try: return date.fromisoformat(s[:10])
    except: return None

# ─────────────────────────────────────────────────────────────────────────────
# NUMBER GENERATORS
# ─────────────────────────────────────────────────────────────────────────────
def next_job_number(db):
    year = now_ist().year
    counter = db.query(JobCounter).filter(JobCounter.year == year).first()
    if not counter:
        counter = JobCounter(year=year, seq=0)
        db.add(counter); db.flush()
    counter.seq += 1; db.flush()
    return f"DL-{year}-{counter.seq:03d}"

def next_order_number(db):
    year = now_ist().year
    counter = db.query(OrderCounter).filter(OrderCounter.year == year).first()
    if not counter:
        counter = OrderCounter(year=year, seq=0)
        db.add(counter); db.flush()
    counter.seq += 1; db.flush()
    return f"ORD-{year}-{counter.seq:03d}"

# ─────────────────────────────────────────────────────────────────────────────
# SHIFT SETTINGS  — stored in shift_settings.json, editable from Settings page
# ─────────────────────────────────────────────────────────────────────────────

SHIFT_SETTINGS_FILE = os.path.join(os.path.dirname(__file__), "shift_settings.json")

DAYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]

DEFAULT_SHIFT_SETTINGS = {
    "monday":    {"working": True,  "start": "08:00", "end": "20:00", "lunch_start": "12:00", "lunch_end": "14:00"},
    "tuesday":   {"working": True,  "start": "08:00", "end": "20:00", "lunch_start": "12:00", "lunch_end": "14:00"},
    "wednesday": {"working": True,  "start": "08:00", "end": "14:00", "lunch_start": "12:00", "lunch_end": "14:00"},
    "thursday":  {"working": True,  "start": "08:00", "end": "20:00", "lunch_start": "12:00", "lunch_end": "14:00"},
    "friday":    {"working": True,  "start": "08:00", "end": "20:00", "lunch_start": "12:00", "lunch_end": "14:00"},
    "saturday":  {"working": False, "start": "08:00", "end": "20:00", "lunch_start": "12:00", "lunch_end": "14:00"},
    "sunday":    {"working": False, "start": "08:00", "end": "20:00", "lunch_start": None,    "lunch_end": None},
}

_shift_cache: dict = {}

def load_shift_settings() -> dict:
    global _shift_cache
    if _shift_cache:
        return _shift_cache
    try:
        if os.path.exists(SHIFT_SETTINGS_FILE):
            with open(SHIFT_SETTINGS_FILE, "r") as f:
                loaded = json.load(f)
            # Merge with defaults so new keys are always present
            merged = {d: {**DEFAULT_SHIFT_SETTINGS[d], **loaded.get(d, {})} for d in DAYS}
            _shift_cache = merged
            return merged
    except Exception:
        pass
    _shift_cache = DEFAULT_SHIFT_SETTINGS.copy()
    return _shift_cache

def save_shift_settings(data: dict):
    global _shift_cache
    _shift_cache = {}  # clear cache so next call reloads
    with open(SHIFT_SETTINGS_FILE, "w") as f:
        json.dump(data, f, indent=2)

def _parse_time(d: date, t: str | None) -> datetime | None:
    if not t: return None
    h, m = map(int, t.split(":"))
    return datetime(d.year, d.month, d.day, h, m)

HOLIDAY_DATES: set = set()

def get_shift(d):
    """Return (shift_start, shift_end, lunch_start, lunch_end) for date d.
    All values from shift_settings.json — fully configurable.
    Returns zero-length window on non-working days so callers skip them.
    """
    cfg = load_shift_settings()
    day_name = DAYS[d.weekday()]   # 0=monday … 6=sunday
    day_cfg  = cfg.get(day_name, DEFAULT_SHIFT_SETTINGS[day_name])

    if not day_cfg.get("working", True) or d in HOLIDAY_DATES:
        midnight = datetime(d.year, d.month, d.day, 0, 0)
        return midnight, midnight, None, None

    shift_s = _parse_time(d, day_cfg.get("start", "08:00"))
    shift_e = _parse_time(d, day_cfg.get("end",   "20:00"))
    lunch_s = _parse_time(d, day_cfg.get("lunch_start"))
    lunch_e = _parse_time(d, day_cfg.get("lunch_end"))

    # If lunch window covers or exceeds shift end, ignore it
    if lunch_s and lunch_e and lunch_s >= shift_e:
        lunch_s = lunch_e = None
    # Clamp lunch end to shift end
    if lunch_e and lunch_e > shift_e:
        lunch_e = shift_e

    return shift_s, shift_e, lunch_s, lunch_e


def next_shift_start(dt):
    d = dt.date() + timedelta(days=1)
    for _ in range(14):                            # skip over consecutive non-working days
        s, e, _, _ = get_shift(d)
        if s != e:
            return s
        d += timedelta(days=1)
    return datetime(d.year, d.month, d.day, 8, 0)

def add_working_hours(start: datetime, work_hours: float) -> datetime:
    remaining = work_hours
    current   = start
    for _ in range(2000):
        if remaining <= 0:
            break
        shift_s, shift_e, lunch_s, lunch_e = get_shift(current.date())
        if shift_s == shift_e:                     # non-working day — skip
            current = next_shift_start(current)
            continue
        if current < shift_s:
            current = shift_s
            continue
        if current >= shift_e:
            current = next_shift_start(current)
            continue
        if lunch_s and lunch_e and lunch_s <= current < lunch_e:
            current = lunch_e
            continue
        if lunch_s and current < lunch_s:
            avail = (lunch_s - current).total_seconds() / 3600
            if avail >= remaining:
                current += timedelta(hours=remaining); remaining = 0
            else:
                remaining -= avail; current = lunch_e
        else:
            avail = (shift_e - current).total_seconds() / 3600
            if avail >= remaining:
                current += timedelta(hours=remaining); remaining = 0
            else:
                remaining -= avail; current = next_shift_start(current)
    return current

def snap_to_shift(dt: datetime) -> datetime:
    for _ in range(21):
        shift_s, shift_e, lunch_s, lunch_e = get_shift(dt.date())
        if shift_s == shift_e:                     # non-working day
            dt = next_shift_start(dt); continue
        if dt < shift_s:
            dt = shift_s; break
        if dt >= shift_e:
            dt = next_shift_start(dt); continue
        if lunch_s and lunch_e and lunch_s <= dt < lunch_e:
            dt = lunch_e; break
        break
    return dt

# ─────────────────────────────────────────────────────────────────────────────
# WORKER AVAILABILITY
# ─────────────────────────────────────────────────────────────────────────────
def get_worker_blocked_periods(db, worker_id, from_dt, to_dt):
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
            blocked.append((shift_s, datetime(d.year, d.month, d.day, 12, 0)))
        elif lv.leave_type == "afternoon":
            blocked.append((datetime(d.year, d.month, d.day, 14, 0), shift_e))
        elif lv.leave_type == "hours" and lv.start_time and lv.end_time:
            sh, sm = map(int, lv.start_time.split(":"))
            eh, em = map(int, lv.end_time.split(":"))
            blocked.append((datetime(d.year, d.month, d.day, sh, sm),
                            datetime(d.year, d.month, d.day, eh, em)))
    return blocked

def is_worker_available(db, worker_id, start, end):
    for bs, be in get_worker_blocked_periods(db, worker_id, start, end):
        if bs < end and be > start:
            return False
    conflict = db.query(ScheduledOp).filter(
        ScheduledOp.worker_id == worker_id,
        ScheduledOp.scheduled_end > start,
        ScheduledOp.scheduled_start < end,
        ScheduledOp.status.in_(["scheduled", "in_progress"])
    ).first()
    return conflict is None

def find_qualified_workers(db, work_center_id, for_start=None, preferred_worker_id=None):
    """
    Return qualified workers sorted by priority:
    1. Preferred worker (if set on machine and available and qualified)
    2. Order-affinity worker (passed in as preferred_worker_id)
    3. Scoring: skill match + load balance + continuity bonus
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
    shift_hours = 10.0

    # Build lookup by id
    qual_ids = {w.id: w for w in qualified}

    # Determine priority worker: affinity first, then machine preferred_worker
    priority_id = preferred_worker_id or getattr(wc, 'preferred_worker_id', None)

    def worker_score(w):
        wl = getattr(w, 'skill_level', 1) or 1
        # Priority worker gets a massive bonus — goes to front of queue
        if priority_id and w.id == priority_id:
            return -1000
        if machine_level >= 3:
            skill_score = (3 - wl) * 30
        elif machine_level == 2:
            skill_score = abs(wl - 2) * 25
        else:
            skill_score = wl * 20
        booked = db.query(ScheduledOp).filter(
            ScheduledOp.worker_id == w.id,
            ScheduledOp.scheduled_start >= today_start,
            ScheduledOp.scheduled_start <= today_end,
            ScheduledOp.status.in_(["scheduled", "in_progress"])
        ).all()
        load_hrs = sum(
            (s.scheduled_end - s.scheduled_start).total_seconds() / 3600
            for s in booked if s.scheduled_start and s.scheduled_end
        )
        load_score = min(50, (load_hrs / shift_hours) * 50)
        last_op = db.query(ScheduledOp).filter(
            ScheduledOp.worker_id == w.id,
            ScheduledOp.work_center_id == work_center_id,
            ScheduledOp.scheduled_end <= now,
            ScheduledOp.status == "completed"
        ).order_by(ScheduledOp.scheduled_end.desc()).first()
        continuity_bonus = 0
        if last_op and last_op.scheduled_end:
            gap = (now - last_op.scheduled_end).total_seconds() / 3600
            threshold = getattr(wc, 'continuity_hours', 2.0) or 2.0
            if gap < threshold:
                continuity_bonus = -40
        return skill_score + load_score + continuity_bonus

    qualified.sort(key=worker_score)
    return qualified


def get_order_affinity_worker(db, job, work_center_id, op_sequence):
    """
    For piece 2+ of an order: find which worker did the same op (same sequence)
    on piece 1 of the same order.  Returns worker_id or None.
    """
    if not job.order_id or not job.piece_number or job.piece_number <= 1:
        return None
    # Find piece 1 of this order
    piece1 = db.query(Job).filter(
        Job.order_id == job.order_id,
        Job.piece_number == 1
    ).first()
    if not piece1:
        return None
    # Find the scheduled op on piece1 at the same sequence on the same machine
    op1 = db.query(ScheduledOp).filter(
        ScheduledOp.job_id == piece1.id,
        ScheduledOp.work_center_id == work_center_id,
        ScheduledOp.sequence == op_sequence,
    ).first()
    return op1.worker_id if op1 and op1.worker_id else None

def should_waive_machine_setup(db, worker_id, work_center_id, start_time):
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

def find_next_slot_with_worker(db, work_center_id, total_duration_hrs,
                                job_setup_hrs, machine_setup_hrs, start_after,
                                preferred_worker_id=None):
    """
    Returns (start, end, worker, waived).

    Worker assignment priority:
    1. If preferred_worker_id set — try that worker first at every candidate slot.
       If the preferred worker is busy at a slot but the machine is free, SKIP that
       slot and look for the next slot where BOTH machine and preferred worker are free.
       After PATIENCE_DAYS of waiting, fall back to any qualified worker.
    2. No preferred worker — use scoring order (skill + load + continuity).
    """
    PATIENCE_DAYS = 2   # wait up to 2 days for preferred worker before falling back

    wc = db.query(WorkCenter).filter(WorkCenter.id == work_center_id).first()
    if wc and getattr(wc, 'status', 'active') not in ('active', None, ''):
        raise ValueError(f"Machine '{wc.name}' is {wc.status}")

    qualified = find_qualified_workers(db, work_center_id, start_after, preferred_worker_id)
    search_start = snap_to_shift(start_after)
    search_limit = search_start + timedelta(days=90)
    patience_limit = search_start + timedelta(days=PATIENCE_DAYS)

    machine_booked = db.query(ScheduledOp).filter(
        ScheduledOp.work_center_id == work_center_id,
        ScheduledOp.scheduled_end > search_start,
        ScheduledOp.status.in_(["scheduled", "in_progress"])
    ).order_by(ScheduledOp.scheduled_start).all()

    candidates = sorted({search_start} | {
        snap_to_shift(b.scheduled_end)
        for b in machine_booked
        if b.scheduled_end and b.scheduled_end > search_start
    })

    def machine_free(slot_start, slot_end):
        for b in machine_booked:
            if not b.scheduled_start or not b.scheduled_end:
                continue
            b_start = (b.actual_start if b.status == "in_progress" and b.actual_start
                       else b.scheduled_start)
            if b_start < slot_end and b.scheduled_end > slot_start:
                return False
        return True

    # Find preferred worker object once
    preferred_worker = None
    if preferred_worker_id:
        preferred_worker = next((w for w in qualified if w.id == preferred_worker_id), None)

    for candidate in candidates:
        if candidate > search_limit:
            break
        candidate = snap_to_shift(candidate)

        if not qualified:
            # No workers assigned — schedule machine-only
            dur = job_setup_hrs + machine_setup_hrs + (total_duration_hrs - job_setup_hrs - machine_setup_hrs)
            slot_end = add_working_hours(candidate, dur)
            if machine_free(candidate, slot_end):
                return candidate, slot_end, None, False
            continue

        # Determine which workers to try at this candidate
        if preferred_worker and candidate <= patience_limit:
            # Strict mode: only try preferred worker
            # If machine is free but preferred worker is busy → skip slot,
            # add preferred worker's next-free time as candidate
            waive = should_waive_machine_setup(db, preferred_worker.id, work_center_id, candidate)
            m_setup = 0.0 if waive else machine_setup_hrs
            actual_dur = job_setup_hrs + m_setup + max(
                total_duration_hrs - job_setup_hrs - machine_setup_hrs, 0.0
            )
            actual_dur = max(actual_dur, job_setup_hrs + 0.083)
            slot_end = add_working_hours(candidate, actual_dur)

            if machine_free(candidate, slot_end):
                if is_worker_available(db, preferred_worker.id, candidate, slot_end):
                    return candidate, slot_end, preferred_worker, waive
                else:
                    # Machine free, preferred worker busy — find when preferred worker is next free
                    next_pref_free = db.query(ScheduledOp).filter(
                        ScheduledOp.worker_id == preferred_worker.id,
                        ScheduledOp.scheduled_end > candidate,
                        ScheduledOp.status.in_(["scheduled", "in_progress"])
                    ).order_by(ScheduledOp.scheduled_end).first()
                    if next_pref_free and next_pref_free.scheduled_end:
                        candidates = sorted(set(candidates) | {snap_to_shift(next_pref_free.scheduled_end)})
                    # Don't fall through to other workers — wait for preferred
                    continue
            # Machine busy — add next machine-free slot and continue
        else:
            # Fallback mode (past patience or no preferred) — try all workers in score order
            for worker in qualified:
                waive = should_waive_machine_setup(db, worker.id, work_center_id, candidate)
                m_setup = 0.0 if waive else machine_setup_hrs
                actual_dur = job_setup_hrs + m_setup + max(
                    total_duration_hrs - job_setup_hrs - machine_setup_hrs, 0.0
                )
                actual_dur = max(actual_dur, job_setup_hrs + 0.083)
                slot_end = add_working_hours(candidate, actual_dur)
                if machine_free(candidate, slot_end) and is_worker_available(db, worker.id, candidate, slot_end):
                    return candidate, slot_end, worker, waive

        # Add next machine-free candidate
        next_free = min(
            (snap_to_shift(b.scheduled_end) for b in machine_booked
             if b.scheduled_end and b.scheduled_end > candidate),
            default=None
        )
        if next_free:
            candidates = sorted(set(candidates) | {next_free})
        candidates = sorted(set(candidates) | {
            next_shift_start(datetime(candidate.year, candidate.month, candidate.day, 20, 0))
        })

    raise ValueError(
        f"No slot found within 90 days on machine {wc.name if wc else work_center_id}"
    )

# ─────────────────────────────────────────────────────────────────────────────
# ACTIVITY LOG HELPER
# ─────────────────────────────────────────────────────────────────────────────
def _audit_log(db, request_or_user, action: str,
                  entity_type: str = None, entity_id: int = None,
                  entity_label: str = None, details: dict = None):
    """Write one row to activity_log.  `request_or_user` is either a
    Starlette Request (reads .state.user) or a plain dict with sub/username."""
    user = None
    if hasattr(request_or_user, 'state'):
        user = getattr(request_or_user.state, 'user', None)
    elif isinstance(request_or_user, dict):
        user = request_or_user
    uid   = int(user.get("sub", 0)) if user else None
    uname = (user.get("username") or "system") if user else "system"
    db.add(ActivityLog(
        timestamp    = now_ist(),
        user_id      = uid,
        username     = uname,
        action       = action,
        entity_type  = entity_type,
        entity_id    = entity_id,
        entity_label = entity_label,
        details      = json.dumps(details) if details else None,
    ))


# ─────────────────────────────────────────────────────────────────────────────
# CRITICAL RATIO
# ─────────────────────────────────────────────────────────────────────────────
def critical_ratio(job, db):
    if job.priority_flag:
        return -999.0
    now = now_ist()
    days_due = (job.due_date - now).total_seconds() / 86400

    # BUG-FIX #8: use actual remaining time for in-progress ops
    remaining_hrs = 0.0
    if job.scheduled_ops:
        for s in job.scheduled_ops:
            if s.status == "completed":
                continue
            if s.status == "in_progress" and s.actual_start:
                elapsed = (now - s.actual_start).total_seconds() / 3600
                remaining = max(0.0, s.work_time_hrs - elapsed)
                remaining_hrs += (s.setup_time_mins / 60) + remaining
            else:
                remaining_hrs += (s.setup_time_mins / 60) + s.work_time_hrs
    else:
        routing = db.query(Routing).filter(Routing.id == job.routing_id).first()
        if not routing:
            return 999.0
        remaining_hrs = sum(
            (op.setup_time_mins / 60) + op.work_time_hrs
            for op in routing.operations
        )
    return days_due / max(remaining_hrs / 10.0, 0.01)

def get_finish(job):
    ops = [s for s in job.scheduled_ops if s.scheduled_end]
    return max((s.scheduled_end for s in ops), default=None)


# ─────────────────────────────────────────────────────────────────────────────
# FLAG-AND-WAIT HEALTH  (no rescheduling — just project + flag)
# ─────────────────────────────────────────────────────────────────────────────
# When an op runs long, we do NOT cascade a reschedule. We recompute where the
# job is now trending to finish (projected_end), compare it to the FROZEN
# promised_date, and flag it. The supervisor decides whether to replan.
#
# "At risk" vs "late":
#   late     — projected_end is already past the promise.
#   at_risk  — not yet past, but an in-progress op is overrunning, or the
#              projected finish is within a small buffer of the promise.
AT_RISK_BUFFER_HRS = 8.0   # projected finish within this of promise → at risk

# Auto-preemption: pausing a running op to free a worker for an urgent job.
# OFF for custom mould/die shops — an in-progress cut can't be paused without
# scrapping the part. The dashboard still shows advisory preemption alerts.
ENABLE_AUTO_PREEMPTION = False

def _project_job_finish(job, now=None):
    """
    Where is this job actually trending to finish, given real progress?

    Returns (projected_end, reason_or_None). Read-only — no DB writes, no
    rescheduling. For an in-progress op already running past its planned
    duration, we push the remaining tail of the schedule out by the overrun,
    so the projection reflects reality rather than the stale plan.
    """
    now = now or now_ist()
    ops = list(job.scheduled_ops)
    if not ops:
        return None, None

    # Baseline projection = latest planned end across all not-yet-completed ops
    # (completed ops use their actual_end). This is the plan's own answer.
    planned_end = max(
        (s.actual_end or s.scheduled_end
         for s in ops if (s.actual_end or s.scheduled_end)),
        default=None
    )
    if planned_end is None:
        return None, None

    overrun_hrs = 0.0
    overrun_reason = None

    # Account for an in-progress op that's already past its planned duration.
    for s in ops:
        if s.status == "in_progress" and s.actual_start and s.scheduled_end:
            planned_dur = (s.scheduled_end - s.scheduled_start).total_seconds() / 3600 if s.scheduled_start else (s.work_time_hrs or 0)
            elapsed = (now - s.actual_start).total_seconds() / 3600
            if elapsed > planned_dur > 0:
                over = elapsed - planned_dur
                if over > overrun_hrs:
                    overrun_hrs = over
                    overrun_reason = f"{s.op_name or 'an operation'} running {over:.1f}h over"

    # Account for the most recent completed op that overran its plan — its
    # tail pushes everything after it (we don't reschedule, but the projection
    # should reflect the slip that already happened).
    for s in ops:
        if s.status == "completed" and s.actual_end and s.scheduled_end:
            slip = (s.actual_end - s.scheduled_end).total_seconds() / 3600
            # Only count slip if there are still downstream ops not yet done
            has_downstream = any(
                o.sequence and s.sequence and o.sequence > s.sequence and o.status != "completed"
                for o in ops
            )
            if slip > overrun_hrs and has_downstream:
                overrun_hrs = slip
                overrun_reason = f"{s.op_name or 'an operation'} ran {slip:.1f}h over"

    projected = add_working_hours(planned_end, overrun_hrs) if overrun_hrs > 0 else planned_end
    return projected, overrun_reason


def _refresh_job_health(db, job, now=None):
    """
    Recompute projected_end + schedule_health + health_reason for a job and
    write them. Does NOT reschedule. Returns the health string.

    Call this whenever a job's schedule or real progress changes:
    after scheduling, after an op is marked started/done, after an override.
    """
    now = now or now_ist()

    if job.status == "completed":
        job.projected_end   = job.completed_at or get_finish(job)
        promise = job.promised_date or job.due_date
        if job.projected_end and promise and job.projected_end > promise:
            job.schedule_health = "late"
            job.health_reason   = "Completed after promised date"
        else:
            job.schedule_health = "on_track"
            job.health_reason   = None
        return job.schedule_health

    projected, reason = _project_job_finish(job, now)
    job.projected_end = projected

    promise = job.promised_date or job.due_date
    if projected is None or promise is None:
        job.schedule_health = "unknown"
        job.health_reason   = None
        return job.schedule_health

    if projected > promise:
        job.schedule_health = "late"
        slip_hrs = (projected - promise).total_seconds() / 3600
        job.health_reason = reason or f"Projected to finish {slip_hrs:.0f}h past promise"
    else:
        margin_hrs = (promise - projected).total_seconds() / 3600
        if reason or margin_hrs < AT_RISK_BUFFER_HRS:
            job.schedule_health = "at_risk"
            job.health_reason   = reason or f"Only {margin_hrs:.0f}h of slack before promise"
        else:
            job.schedule_health = "on_track"
            job.health_reason   = None
    return job.schedule_health


def _refresh_order_health(db, order):
    """An order is as healthy as its worst piece. Rolls piece-job health up."""
    jobs = list(order.jobs)
    if not jobs:
        return "unknown"
    rank = {"late": 3, "at_risk": 2, "unknown": 1, "on_track": 0, None: 0}
    worst = max(jobs, key=lambda j: rank.get(j.schedule_health, 0))
    return worst.schedule_health or "unknown"

def check_preemption(db, new_job):
    cr = critical_ratio(new_job, db)
    if cr >= 0.5 or not new_job.routing_id:
        return []
    routing = db.query(Routing).filter(Routing.id == new_job.routing_id).first()
    if not routing:
        return []
    ops = sorted(routing.operations, key=lambda o: o.sequence)
    now = now_ist()
    result = []
    for op in ops[:1]:
        for worker in find_qualified_workers(db, op.work_center_id, now):
            cur = db.query(ScheduledOp).filter(
                ScheduledOp.worker_id == worker.id,
                ScheduledOp.status == "in_progress"
            ).first()
            if cur and critical_ratio(cur.job, db) > 2.0:
                result.append({
                    "op_id": cur.id,
                    "worker_name": worker.name,
                    "job_number": cur.job.job_number,
                    "other_cr": round(critical_ratio(cur.job, db), 2),
                    "urgent_job": new_job.job_number,
                    "urgent_cr": round(cr, 2),
                })
    return result

# ─────────────────────────────────────────────────────────────────────────────
# REACTIVE RESCHEDULE
# ─────────────────────────────────────────────────────────────────────────────
def _reactive_reschedule(db, work_center_id, worker_id, freed_at):
    try:
        next_ops = db.query(ScheduledOp).filter(
            ScheduledOp.work_center_id == work_center_id,
            ScheduledOp.scheduled_start > freed_at,
            ScheduledOp.status == "scheduled",
        ).order_by(ScheduledOp.scheduled_start).limit(3).all()
        for nxt in next_ops:
            if not nxt.scheduled_start:
                continue
            gap = (nxt.scheduled_start - freed_at).total_seconds() / 3600
            if gap < 0.5:
                continue
            duration = (nxt.scheduled_end - nxt.scheduled_start).total_seconds() / 3600
            new_start = snap_to_shift(freed_at)
            new_end   = add_working_hours(new_start, duration)
            conflict = db.query(ScheduledOp).filter(
                ScheduledOp.work_center_id == work_center_id,
                ScheduledOp.scheduled_start < new_end,
                ScheduledOp.scheduled_end > new_start,
                ScheduledOp.id != nxt.id,
                ScheduledOp.status.in_(["scheduled", "in_progress"])
            ).first()
            if conflict:
                continue
            if nxt.worker_id:
                wc = db.query(ScheduledOp).filter(
                    ScheduledOp.worker_id == nxt.worker_id,
                    ScheduledOp.scheduled_start < new_end,
                    ScheduledOp.scheduled_end > new_start,
                    ScheduledOp.id != nxt.id,
                    ScheduledOp.status.in_(["scheduled", "in_progress"])
                ).first()
                if wc:
                    continue
            nxt.scheduled_start = new_start
            nxt.scheduled_end   = new_end
            break
        db.commit()
    except Exception:
        pass

# ─────────────────────────────────────────────────────────────────────────────
# CORE SCHEDULER
# ─────────────────────────────────────────────────────────────────────────────
def _ops_for_job(db, j):
    """
    Return a list of op-dicts for scheduling, from either:
      - the linked Routing (standard)
      - j.inline_ops JSON (custom job)
    Each dict: {name, work_center_id, machine_setup_mins, job_setup_mins,
                setup_time_mins, work_time_hrs, is_optional, operation_id}
    """
    overrides = {}
    if j.op_overrides:
        try:
            for ov in json.loads(j.op_overrides):
                overrides[ov.get("operation_id")] = ov
        except Exception:
            pass

    ops = []

    if j.routing_id:
        routing = db.query(Routing).filter(Routing.id == j.routing_id).first()
        if not routing:
            return []
        # BUG-FIX #6: deduplicate sequence numbers before sorting
        seen_seq = {}
        for op in routing.operations:
            seen_seq.setdefault(op.sequence, []).append(op)
        sorted_ops = []
        for seq in sorted(seen_seq):
            sorted_ops.extend(seen_seq[seq])   # stable within same sequence

        for op in sorted_ops:
            ov = overrides.get(op.id, {})
            if not ov.get("included", True):
                continue
            m_setup = float(ov.get("machine_setup_mins", op.machine_setup_mins or 0))
            j_setup = float(ov.get("job_setup_mins",     op.job_setup_mins     or 0))

            # Work time priority:
            # 1. override from order (work_time_mins/hrs)
            # 2. sub-ops sum (if sub-ops defined and no override)
            # 3. op.work_time_hrs (plain value)
            if ov.get("work_time_mins") is not None and float(ov.get("work_time_mins", 0)) > 0:
                work = float(ov["work_time_mins"]) / 60.0
            elif ov.get("work_time_hrs") is not None and float(ov.get("work_time_hrs", 0)) > 0:
                work = float(ov["work_time_hrs"])
            elif op.sub_operations:
                # Sum sub-ops — respect included flags from override's sub_op_overrides
                sub_overrides = {s.get("sub_op_id"): s for s in ov.get("sub_op_overrides", [])}
                sub_total = 0.0
                for s in op.sub_operations:
                    s_ov = sub_overrides.get(s.id, {})
                    if s_ov.get("included") is False:
                        continue  # excluded by order-level override
                    if s.is_optional and not s_ov.get("included", False):
                        continue  # optional sub-op not included by default
                    sub_total += s_ov.get("work_time_hrs") or (s.work_time_mins or 0) / 60.0
                work = sub_total
            else:
                work = float(op.work_time_hrs or 0)

            transit_days = getattr(op, "outside_transit_days", None)
            op_type = getattr(op, "op_type", "inhouse") or "inhouse"
            # For outside ops: work_time_hrs = transit days * 24 (calendar hours)
            if op_type == "outside" and transit_days:
                work = float(transit_days) * 24.0
            ops.append({
                "name":                 op.name,
                "work_center_id":       op.work_center_id,
                "machine_setup_mins":   m_setup,
                "job_setup_mins":       j_setup,
                "setup_time_mins":      m_setup + j_setup,
                "work_time_hrs":        work,
                "is_optional":          op.is_optional,
                "operation_id":         op.id,
                "has_sub_ops":          bool(op.sub_operations),
                "op_type":              op_type,
                "outside_vendor":       getattr(op, "outside_vendor", None) or "",
                "outside_transit_days": transit_days,
            })

    elif j.inline_ops:
        try:
            raw = json.loads(j.inline_ops)
        except Exception:
            return []
        for i, op in enumerate(raw):
            m_setup = float(op.get("machine_setup_mins", op.get("setup_time_mins", 0)) or 0)
            j_setup = float(op.get("job_setup_mins", 0) or 0)

            op_type = (op.get("op_type") or "inhouse")
            transit_days = op.get("outside_transit_days")

            sub_ops = op.get("sub_operations") or []
            if sub_ops:
                # Sum included sub-ops' work time, same rule as routing ops:
                # optional sub-ops are excluded by default.
                work = sum(
                    float(s.get("work_time_mins") or 0) / 60.0
                    for s in sub_ops
                    if not s.get("is_optional", False)
                )
            elif op_type == "outside" and transit_days:
                # Outside ops: duration is calendar transit time, not work time
                work = float(transit_days) * 24.0
            else:
                work = float(op.get("work_time_hrs", 0) or (float(op.get("work_time_mins", 0) or 0) / 60.0))

            ops.append({
                "name":              op.get("name", f"Step {i+1}"),
                "work_center_id":    int(op["work_center_id"]) if op.get("work_center_id") else None,
                "machine_setup_mins": m_setup if op_type != "outside" else 0,
                "job_setup_mins":     j_setup if op_type != "outside" else 0,
                "setup_time_mins":    (m_setup + j_setup) if op_type != "outside" else 0,
                "work_time_hrs":      work,
                "is_optional":        bool(op.get("is_optional", False)),
                "operation_id":       None,   # no DB operation row for inline
                "has_sub_ops":        bool(sub_ops),
                "op_type":            op_type,
                "outside_vendor":     op.get("outside_vendor") or "",
                "outside_transit_days": transit_days,
            })

    return ops


def _do_schedule(db, j):
    """
    Schedule a single job.  All bug-fixes applied:
    #1  — 4-value unpack from find_next_slot_with_worker
    #2  — setup waiving actually reduces scheduled duration
    #3  — machine_setup_waived written to ScheduledOp
    #4  — routing is_active set on creation (fixed in create_routing endpoint)
    #5  — current_start advances even when machine is blocked
    #6  — duplicate sequence numbers handled in _ops_for_job
    #7  — partially-done jobs reschedule remaining ops (handled in schedule-all)
    #8  — CR uses actual remaining time (fixed in critical_ratio)
    #9  — find_next_slot_with_worker raises instead of silent phantom
    #11 — Sundays/holidays skipped by get_shift
    """
    ops = _ops_for_job(db, j)
    if not ops:
        return False

    # Note: pending/scheduled ops are cleared in batch by schedule_all before calling _do_schedule.
    # For single-job scheduling (schedule_job endpoint), clear here.
    if not getattr(j, '_batch_cleared', False):
        for s in list(j.scheduled_ops):
            if s.status in ("pending", "scheduled"):
                db.delete(s)
        db.flush()

    # Determine start — respect not_before and material_ready_date
    now = now_ist()
    candidates = [now]
    if j.not_before:         candidates.append(j.not_before)
    if j.material_ready_date: candidates.append(j.material_ready_date)

    # BUG-FIX #7: for partially-done jobs, start after last completed op
    last_completed = max(
        (s.actual_end or s.scheduled_end
         for s in j.scheduled_ops if s.status == "completed" and (s.actual_end or s.scheduled_end)),
        default=None
    )
    if last_completed:
        candidates.append(last_completed)

    current_start = snap_to_shift(max(candidates))

    # Skip ops already completed
    completed_op_ids = {s.operation_id for s in j.scheduled_ops if s.status == "completed"}

    for op in ops:
        if op["operation_id"] and op["operation_id"] in completed_op_ids:
            continue   # already done — skip silently

        m_setup_hrs = op["machine_setup_mins"] / 60.0
        j_setup_hrs = op["job_setup_mins"]     / 60.0
        work_hrs    = op["work_time_hrs"]
        total_hrs   = j_setup_hrs + m_setup_hrs + work_hrs

        if total_hrs <= 0:
            continue

        wc = db.query(WorkCenter).filter(WorkCenter.id == op["work_center_id"]).first()
        wc_name = wc.name if wc else str(op["work_center_id"])

        # Order affinity: use same worker as piece 1 for this machine+sequence
        seq = ops.index(op) + 1
        affinity_worker_id = get_order_affinity_worker(db, j, op["work_center_id"], seq)

        # Outside ops: block calendar time, never compete for machine slots
        if op.get("op_type") == "outside":
            cal_hrs      = work_hrs if work_hrs > 0 else 24.0
            from datetime import timedelta as _td
            est_end      = current_start + _td(hours=cal_hrs)
            transit_days = op.get("outside_transit_days")
            vendor_name  = op.get("outside_vendor") or "Outside"
            display_name = f"{op['name']} → {vendor_name}"
            if transit_days:
                display_name += f" ({transit_days:.0f}d)"
            # Use a real wc_id for FK integrity, but worker=None (no machine slot blocked)
            wc_id_for_fk = op["work_center_id"] or (db.query(WorkCenter).first().id if db.query(WorkCenter).first() else 1)
            db.add(ScheduledOp(
                job_id=j.id,
                operation_id=op["operation_id"],
                work_center_id=wc_id_for_fk,
                worker_id=None, worker_name=None,
                sequence=ops.index(op) + 1,
                op_name=display_name,
                wc_name=vendor_name,
                machine_setup_mins=0,
                job_setup_mins=0,
                setup_time_mins=0,
                work_time_hrs=work_hrs,
                work_time_mins=round(work_hrs*60, 1),
                machine_setup_waived=False,
                scheduled_start=current_start, scheduled_end=est_end,
                op_type="outside",
                outside_vendor=vendor_name,
                status="scheduled",
            ))
            current_start = snap_to_shift(est_end)
            continue

        try:
            start, end, worker, waived = find_next_slot_with_worker(
                db,
                op["work_center_id"],
                total_hrs,
                j_setup_hrs,
                m_setup_hrs,
                current_start,
                preferred_worker_id=affinity_worker_id,
            )
        except ValueError as e:
            # BUG-FIX #5: advance current_start even when machine blocked
            db.add(ScheduledOp(
                job_id=j.id,
                operation_id=op["operation_id"],
                work_center_id=op["work_center_id"],
                worker_id=None, worker_name=None,
                sequence=ops.index(op) + 1,
                op_name=op["name"], wc_name=wc_name,
                machine_setup_mins=op["machine_setup_mins"],
                job_setup_mins=op["job_setup_mins"],
                setup_time_mins=op["setup_time_mins"],
                work_time_hrs=work_hrs,
                machine_setup_waived=False,
                scheduled_start=None, scheduled_end=None,
                status="pending",
            ))
            continue

        # BUG-FIX #3: write machine_setup_waived
        actual_m_setup = 0.0 if waived else op["machine_setup_mins"]
        db.add(ScheduledOp(
            job_id=j.id,
            operation_id=op["operation_id"],
            work_center_id=op["work_center_id"],
            worker_id=worker.id   if worker else None,
            worker_name=worker.name if worker else None,
            sequence=ops.index(op) + 1,
            op_name=op["name"], wc_name=wc_name,
            machine_setup_mins=actual_m_setup,
            job_setup_mins=op["job_setup_mins"],
            setup_time_mins=actual_m_setup + op["job_setup_mins"],
            work_time_hrs=work_hrs,
            machine_setup_waived=waived,
            scheduled_start=start, scheduled_end=end,
            status="scheduled",
        ))
        current_start = end

    j.status = "scheduled"
    db.commit()
    return True


def _update_order_status(db, order_id):
    """Recompute and persist order status from its piece jobs."""
    if not order_id:
        return
    order = db.query(CustomerOrder).filter(CustomerOrder.id == order_id).first()
    if not order:
        return
    jobs = list(order.jobs)
    if not jobs:
        order.status = "draft"
    else:
        statuses = {j.status for j in jobs}
        if statuses and all(s == "completed" for s in statuses):
            order.status = "completed"
        elif any(s == "in_progress" for s in statuses):
            order.status = "in_progress"
        elif any(s == "scheduled" for s in statuses):
            order.status = "in_progress"
        else:
            order.status = "pending"
    db.commit()

# ─────────────────────────────────────────────────────────────────────────────
# APP
# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="Dolphin ERP")
import os as _os
_ALLOWED_ORIGINS = _os.environ.get("ALLOWED_ORIGINS", "").split(",")
_ALLOWED_ORIGINS = [o.strip() for o in _ALLOWED_ORIGINS if o.strip()] or ["*"]
app.add_middleware(CORSMiddleware, allow_origins=_ALLOWED_ORIGINS,
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ── Security headers middleware ────────────────────────────────────────────────
from starlette.middleware.base import BaseHTTPMiddleware as _BaseHTTPMiddleware
from starlette.responses import Response as _Response

class SecurityHeadersMiddleware(_BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        # Only add HSTS if site is served over HTTPS (set HTTPS=1 env var)
        if _os.environ.get("HTTPS") == "1":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

app.add_middleware(SecurityHeadersMiddleware)

# ── Auth Middleware ────────────────────────────────────────────────────────────
# Protects ALL /api/ routes except the public allowlist below.
# Permission enforcement is based on resolved page_levels (from custom_permissions or role defaults).
PUBLIC_PATHS = {"/api/health", "/api/auth/login", "/api/auth/pin-login", "/api/auth/pin-users"}

# Map URL path prefixes → page id for permission check
# Ordered longest-first so more specific prefixes match first
_PATH_TO_PAGE = [
    ("/api/users",              "users"),
    ("/api/shift-settings",     "settings"),
    ("/api/company-settings",   "settings"),
    ("/api/workcenters",        "machines"),
    ("/api/machines",           "machines"),
    ("/api/workers",            "workers"),
    ("/api/leaves",             "workers"),
    ("/api/routings",           "routings"),
    ("/api/customers",          "customers"),
    ("/api/tasks",              "tasks"),
    ("/api/task-files",         "tasks"),
    ("/api/quotations",         "quotations"),
    ("/api/jobs",               "jobs"),
    ("/api/schedule",           "jobs"),
    ("/api/ops",                "today"),
    ("/api/scheduled-ops",      "today"),
    ("/api/orders",             "orders"),
    ("/api/gantt",              "schedule"),
    ("/api/heatmap",            "capacity"),
    ("/api/capacity",           "capacity"),
    ("/api/today",              "today"),
    ("/api/past-work",          "past-work"),
    ("/api/upcoming",           "upcoming"),
    ("/api/reports",            "reports"),
    ("/api/estimate",           "quote"),
    ("/api/punch-calc",         "quote"),
    ("/api/product-types",      "routings"),
    ("/api/preemption-alerts",  "schedule"),
    ("/api/notifications",      "dashboard"),
    ("/api/pull-forward",       "today"),
    ("/api/dispatch",           "today"),
    ("/api/company-logo",       "dashboard"),
    # Product schema read is needed by anyone who creates jobs — tie it to
    # the "jobs" page. The Schema admin (writes) is a separate page; write
    # methods will be checked against the "schema" page level via the alias
    # system in js/app.js.
    ("/api/product-schema",     "jobs"),
    ("/api/product-types",      "jobs"),
    ("/api/activity-log",       "activity-log"),
    ("/api/schedule-all",       "jobs"),
]

# Read-only (GET) methods are allowed at level >= 1; write methods require level >= 2
_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

def _page_for_path(path: str) -> str | None:
    """Return the page id for an API path, or None if no match."""
    for prefix, page in _PATH_TO_PAGE:
        if path == prefix or path.startswith(prefix + "/") or path.startswith(prefix + "?"):
            return page
    return None

def _page_level_for_user(perms: dict, page: str) -> int:
    """Return numeric access level for this page from resolved permissions."""
    pl = perms.get("page_levels") or {}
    if isinstance(pl, dict) and page in pl:
        return int(pl[page])
    # Fallback: legacy pages list = level 3
    pages = perms.get("pages") or []
    return 3 if page in pages else 0

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

def _sanitize_filename(name: str) -> str:
    """Sanitize filename for Content-Disposition header to prevent header injection."""
    import re
    # Remove any characters that could break the header: quotes, newlines, semicolons
    safe = re.sub(r'[\r\n"\';<>|]', '_', name or 'file')
    return safe[:200]  # cap length


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path   = request.url.path
        method = request.method.upper()

        # Allow non-API paths (static files, frontend)
        if not path.startswith("/api/"):
            return await call_next(request)

        # Allow public API paths
        if path in PUBLIC_PATHS:
            return await call_next(request)

        # Extract and verify token
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)
        try:
            claims = verify_token(auth[7:])
        except Exception:
            return JSONResponse({"detail": "Invalid or expired token"}, status_code=401)

        role = claims.get("role", "operator")

        # Always-allowed endpoints for any authenticated user
        always_allowed = {"/api/auth/me", "/api/auth/change-password"}
        if path in always_allowed:
            request.state.user = claims
            return await call_next(request)

        # Load resolved permissions from DB to get page_levels
        # (JWT only carries role, not custom page_levels)
        try:
            _db = SessionLocal()
            _u  = _db.query(User).filter(User.id == int(claims["sub"])).first()
            perms = resolve_permissions(role, getattr(_u, "custom_permissions", None) if _u else None)
            _db.close()
        except Exception:
            perms = resolve_permissions(role, None)

        # Attach resolved permissions to request state for route handlers
        request.state.user  = claims
        request.state.perms = perms

        # Determine which page this path maps to
        page = _page_for_path(path)

        if page is None:
            # Unknown path — allow (debug/seed/misc endpoints handled below)
            return await call_next(request)

        level = _page_level_for_user(perms, page)

        # No access at all
        if level == 0:
            return JSONResponse({"detail": f"Access denied — no permission for '{page}'"}, status_code=403)

        # View-only: block all write operations
        if level == 1 and method in _WRITE_METHODS:
            return JSONResponse({"detail": f"Access denied — view-only permission for '{page}'"}, status_code=403)

        # Modify (level 2): block DELETE operations
        if level == 2 and method == "DELETE":
            return JSONResponse({"detail": f"Access denied — cannot delete (modify-only permission for '{page}')"}, status_code=403)

        # Operators: restrict to own ops only (additional check per op in route handler)
        if role == "operator" and path.startswith("/api/ops/") and method in _WRITE_METHODS:
            pass  # enforced inside the route handler with worker_id check

        return await call_next(request)

app.add_middleware(AuthMiddleware)

# Serve css/ and js/ as static directories
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse

class NoCacheStaticMiddleware(BaseHTTPMiddleware):
    """Force no-cache on all /js and /css responses so deploys take effect immediately."""
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/js/") or path.startswith("/css/"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"]        = "no-cache"
            response.headers["Expires"]       = "0"
        return response

app.add_middleware(NoCacheStaticMiddleware)
app.mount("/css", StaticFiles(directory="css"), name="css")
app.mount("/js",  StaticFiles(directory="js"),  name="js")
@app.get("/")
def root(): return FileResponse("index.html")

@app.get("/login")
def login_page(): return FileResponse("login.html")

@app.get("/api/health")
def health(): return {"status": "ok", "time_ist": now_ist().isoformat()}

# ─────────────────────────────────────────────────────────────────────────────
# AUTH ENDPOINTS (public — no token required)
# ─────────────────────────────────────────────────────────────────────────────

def _user_dict(u):
    return {
        "id": u.id, "username": u.username, "display_name": u.display_name or u.username,
        "role": u.role, "worker_id": u.worker_id,
        "worker_name": u.worker.name if u.worker else None,
        "is_active": u.is_active,
        "last_login": u.last_login.isoformat() if u.last_login else None,
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "has_pin": bool(u.pin_hash),
        "has_password": bool(u.password_hash),
        "custom_permissions": u.custom_permissions,   # raw JSON string or None
    }

@app.post("/api/auth/login")
def login(data: dict, request: Request):
    """Password login — returns JWT token. Rate-limited: 10 attempts per 15 min per IP."""
    from collections import defaultdict
    import time as _time
    # Simple in-process rate limiter — resets on server restart (acceptable for small shop)
    _login_attempts = getattr(app.state, '_login_attempts', defaultdict(list))
    app.state._login_attempts = _login_attempts
    client_ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown")
    now_ts = _time.time()
    # Keep only attempts in last 15 minutes
    _login_attempts[client_ip] = [t for t in _login_attempts[client_ip] if now_ts - t < 900]
    if len(_login_attempts[client_ip]) >= 10:
        raise HTTPException(429, "Too many login attempts. Try again in 15 minutes.")
    _login_attempts[client_ip].append(now_ts)

    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""
    if not username or not password:
        raise HTTPException(400, "Username and password required")
    db = SessionLocal()
    u = db.query(User).filter(
        User.username == username,
        User.is_active == True
    ).first()
    if not u or not u.password_hash or not verify_password(password, u.password_hash):
        db.close()
        raise HTTPException(401, "Invalid username or password")
    # Clear rate limit on success
    _login_attempts[client_ip] = []
    u.last_login = now_ist()
    db.commit()
    token = create_token(u.id, u.username, u.role, u.worker_id)
    perms = resolve_permissions(u.role, getattr(u, 'custom_permissions', None))
    result = {"token": token, "role": u.role, "username": u.username,
              "display_name": u.display_name or u.username,
              "worker_id": u.worker_id, "permissions": perms}
    db.close(); return result

@app.post("/api/auth/pin-login")
def pin_login(data: dict, request: Request):
    """PIN login for operators — rate-limited: 10 attempts per 15 min per IP."""
    from collections import defaultdict
    import time as _time
    _pin_attempts = getattr(app.state, '_pin_attempts', defaultdict(list))
    app.state._pin_attempts = _pin_attempts
    client_ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown")
    now_ts = _time.time()
    _pin_attempts[client_ip] = [t for t in _pin_attempts[client_ip] if now_ts - t < 900]
    if len(_pin_attempts[client_ip]) >= 10:
        raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")
    _pin_attempts[client_ip].append(now_ts)

    pin = str(data.get("pin") or "").strip()
    worker_id = data.get("worker_id")
    if not pin:
        raise HTTPException(400, "PIN required")
    db = SessionLocal()
    q = db.query(User).filter(User.is_active == True, User.pin_hash != None)
    if worker_id:
        q = q.filter(User.worker_id == worker_id)
    candidates = q.all()
    matched = None
    for u in candidates:
        if verify_pin(pin, u.pin_hash):
            matched = u; break
    if not matched:
        db.close()
        raise HTTPException(401, "Invalid PIN")
    _pin_attempts[client_ip] = []
    matched.last_login = now_ist()
    db.commit()
    token = create_token(matched.id, matched.username, matched.role, matched.worker_id)
    perms = resolve_permissions(matched.role, getattr(matched, 'custom_permissions', None))
    result = {"token": token, "role": matched.role, "username": matched.username,
              "display_name": matched.display_name or matched.username,
              "worker_id": matched.worker_id, "permissions": perms}
    db.close(); return result

@app.get("/api/auth/pin-users")
def pin_users():
    """Public endpoint — returns list of users with PINs set (for worker picker on login screen).
    Only exposes: id, username, display_name, worker_id. No hashes or sensitive data."""
    db = SessionLocal()
    users = db.query(User).filter(
        User.is_active == True,
        User.pin_hash != None,
    ).order_by(User.display_name).all()
    result = [
        {"id": u.id, "username": u.username,
         "display_name": u.display_name or u.username,
         "worker_id": u.worker_id}
        for u in users
    ]
    db.close()
    return {"users": result}

@app.get("/api/auth/me")
def get_me(user: dict = Depends(get_current_user)):
    """Return current user info with fresh permissions (including any custom overrides)."""
    db = SessionLocal()
    u = db.query(User).filter(User.id == int(user.get("sub", 0))).first()
    custom = getattr(u, 'custom_permissions', None) if u else None
    db.close()
    perms = resolve_permissions(user.get("role", "operator"), custom)
    return {"user": user, "permissions": perms}

# ─────────────────────────────────────────────────────────────────────────────
# USER MANAGEMENT (admin only)
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/users")
def list_users(user: dict = Depends(require_admin)):
    db = SessionLocal()
    users = db.query(User).order_by(User.role, User.username).all()
    result = [_user_dict(u) for u in users]
    db.close(); return result

@app.post("/api/users")
def create_user(data: dict, user: dict = Depends(require_admin)):
    username = (data.get("username") or "").strip().lower()
    if not username:
        raise HTTPException(400, "Username required")
    role = data.get("role", "operator")
    if role not in ("admin", "manager", "staff", "operator"):
        raise HTTPException(400, "Invalid role")
    db = SessionLocal()
    existing = db.query(User).filter(User.username == username).first()
    if existing:
        db.close(); raise HTTPException(400, "Username already taken")

    u = User(
        username           = username,
        display_name       = data.get("display_name", "").strip() or username.title(),
        role               = role,
        worker_id          = int(data["worker_id"]) if data.get("worker_id") else None,
        is_active          = True,
        created_at         = now_ist(),
        custom_permissions = data.get("custom_permissions") or None,
    )
    if data.get("password"):
        u.password_hash = hash_password(data["password"])
    if data.get("pin"):
        pin = str(data["pin"]).strip()
        if not (pin.isdigit() and 4 <= len(pin) <= 6):
            db.close(); raise HTTPException(400, "PIN must be 4-6 digits")
        u.pin_hash = hash_pin(pin)
    db.add(u); db.commit(); db.refresh(u)
    result = _user_dict(u); db.close(); return result

@app.put("/api/users/{user_id}")
def update_user(user_id: int, data: dict, user: dict = Depends(require_admin)):
    db = SessionLocal()
    u = db.query(User).filter(User.id == user_id).first()
    if not u: db.close(); raise HTTPException(404, "User not found")

    # Prevent removing admin role from last admin
    if u.role == "admin" and data.get("role") not in ("admin", None):
        admin_count = db.query(User).filter(User.role == "admin", User.is_active == True).count()
        if admin_count <= 1:
            db.close(); raise HTTPException(400, "Cannot remove the last admin")

    if "display_name" in data: u.display_name = data["display_name"].strip()
    if "role" in data:
        if data["role"] not in ("admin", "manager", "staff", "operator"):
            db.close(); raise HTTPException(400, "Invalid role")
        u.role = data["role"]
    if "worker_id" in data:
        u.worker_id = int(data["worker_id"]) if data.get("worker_id") else None
    if "is_active" in data: u.is_active = bool(data["is_active"])
    # custom_permissions: None = clear (revert to role defaults), string = set override
    if "custom_permissions" in data:
        u.custom_permissions = data["custom_permissions"] or None

    if data.get("password"):
        u.password_hash = hash_password(data["password"])
    if data.get("clear_password"): u.password_hash = None
    if data.get("pin"):
        pin = str(data["pin"]).strip()
        if not (pin.isdigit() and 4 <= len(pin) <= 6):
            db.close(); raise HTTPException(400, "PIN must be 4-6 digits")
        u.pin_hash = hash_pin(pin)
    if data.get("clear_pin"): u.pin_hash = None

    db.commit(); result = _user_dict(u); db.close(); return result

@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, user: dict = Depends(require_admin)):
    db = SessionLocal()
    u = db.query(User).filter(User.id == user_id).first()
    if not u: db.close(); raise HTTPException(404, "User not found")
    if str(u.id) == str(user.get("sub")):
        db.close(); raise HTTPException(400, "Cannot delete your own account")
    if u.role == "admin":
        count = db.query(User).filter(User.role == "admin", User.is_active == True).count()
        if count <= 1:
            db.close(); raise HTTPException(400, "Cannot delete the last admin")
    db.delete(u); db.commit(); db.close()
    return {"ok": True}

@app.post("/api/auth/change-password")
def change_password(data: dict, user: dict = Depends(get_current_user)):
    """Any logged-in user can change their own password."""
    current_pw = data.get("current_password","")
    new_pw     = data.get("new_password","")
    if len(new_pw) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    db = SessionLocal()
    u = db.query(User).filter(User.id == int(user["sub"])).first()
    if not u: db.close(); raise HTTPException(404, "User not found")
    if u.password_hash and not verify_password(current_pw, u.password_hash):
        db.close(); raise HTTPException(401, "Current password incorrect")
    u.password_hash = hash_password(new_pw)
    db.commit(); db.close()
    return {"ok": True, "message": "Password changed successfully"}

@app.get("/api/shift-settings")
def get_shift_settings_endpoint():
    s = load_shift_settings()
    result = {}
    for day in DAYS:
        cfg = s[day]
        if not cfg["working"]:
            effective = 0.0
        else:
            sh, sm = map(int, (cfg.get("start","08:00")).split(":"))
            eh, em = map(int, (cfg.get("end",  "20:00")).split(":"))
            total = (eh*60+em) - (sh*60+sm)
            ls, le = cfg.get("lunch_start"), cfg.get("lunch_end")
            if ls and le:
                lsh, lsm = map(int, ls.split(":"))
                leh, lem = map(int, le.split(":"))
                total -= max(0, (leh*60+lem) - (lsh*60+lsm))
            effective = round(total / 60, 2)
        result[day] = {**cfg, "effective_hours": effective}
    return result

@app.put("/api/shift-settings")
def put_shift_settings(data: dict):
    def parse_t(t):
        if not t: return None
        h, m = map(int, t.split(":")); return h*60+m
    validated = {}
    for day in DAYS:
        cfg   = data.get(day, DEFAULT_SHIFT_SETTINGS[day])
        working = bool(cfg.get("working", True))
        start = cfg.get("start", "08:00"); end = cfg.get("end", "20:00")
        ls = cfg.get("lunch_start") or None; le = cfg.get("lunch_end") or None
        if (parse_t(end) or 1200) <= (parse_t(start) or 480):
            raise HTTPException(400, f"{day}: end time must be after start time")
        if ls and le and (parse_t(le) or 0) <= (parse_t(ls) or 0):
            raise HTTPException(400, f"{day}: lunch end must be after lunch start")
        validated[day] = {"working": working, "start": start, "end": end,
                          "lunch_start": ls, "lunch_end": le}
    save_shift_settings(validated)
    return {"ok": True, "settings": validated}

# ─────────────────────────────────────────────────────────────────────────────
# WORK CENTERS
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/workcenters")
def list_wc():
    db = SessionLocal()
    wcs = db.query(WorkCenter).order_by(WorkCenter.machine_type, WorkCenter.name).all()
    # Build worker lookup for preferred worker names
    all_workers = {w.id: w.name for w in db.query(Worker).all()}
    result = [{"id": w.id, "name": w.name, "machine_type": w.machine_type,
               "is_bottleneck": w.is_bottleneck,
               "code": w.code or "",
               "status": w.status or "active",
               "skill_level": w.skill_level or 1,
               "continuity_hours": w.continuity_hours or 2.0,
               "preferred_worker_id": w.preferred_worker_id,
               "preferred_worker_name": all_workers.get(w.preferred_worker_id) if w.preferred_worker_id else None,
               "skilled_worker_ids":   [sw.id   for sw in w.skilled_workers],
               "skilled_worker_names": [sw.name for sw in w.skilled_workers if sw.is_active]}
              for w in wcs]
    db.close(); return result

@app.post("/api/workcenters")
def create_wc(data: dict):
    db = SessionLocal()
    code = (data.get("code") or "").strip()
    if not code:
        last = db.query(WorkCenter).order_by(WorkCenter.id.desc()).first()
        n = (last.id + 1) if last else 1
        code = f"M{n}"
        while db.query(WorkCenter).filter(WorkCenter.code == code).first():
            n += 1; code = f"M{n}"
    wc = WorkCenter(name=data["name"], machine_type=data["machine_type"],
                    is_bottleneck=data.get("is_bottleneck", False),
                    code=code, status=data.get("status", "active"),
                    skill_level=int(data.get("skill_level", 1)))
    db.add(wc); db.commit(); db.refresh(wc)
    r = {"id": wc.id, "name": wc.name, "machine_type": wc.machine_type,
         "is_bottleneck": wc.is_bottleneck, "code": wc.code,
         "skilled_worker_ids": [], "skilled_worker_names": []}
    db.close(); return r

@app.put("/api/workcenters/{wc_id}")
def update_wc(wc_id: int, data: dict):
    db = SessionLocal()
    wc = db.query(WorkCenter).filter(WorkCenter.id == wc_id).first()
    if not wc: raise HTTPException(404, "Not found")
    wc.name = data.get("name", wc.name)
    wc.machine_type = data.get("machine_type", wc.machine_type)
    wc.is_bottleneck = data.get("is_bottleneck", wc.is_bottleneck)
    if "status" in data:
        old_status = wc.status
        wc.status  = data["status"]
        if data["status"] == "breakdown" and old_status != "breakdown":
            affected = db.query(ScheduledOp).filter(
                ScheduledOp.work_center_id == wc.id,
                ScheduledOp.status.in_(["scheduled","pending"])
            ).count()
            _notify(db,
                event_type = "machine_breakdown",
                title      = f"🔴 Breakdown: {wc.name}",
                body       = f"{affected} scheduled operation(s) affected. Reschedule needed.",
                link       = "/machines",
                wc_id      = wc.id,
            )
    if "skill_level" in data: wc.skill_level = int(data["skill_level"])
    if "continuity_hours" in data: wc.continuity_hours = float(data["continuity_hours"])
    if "preferred_worker_id" in data:
        pw = data["preferred_worker_id"]
        wc.preferred_worker_id = int(pw) if pw else None
    db.commit(); db.refresh(wc)
    pw_name = None
    if wc.preferred_worker_id:
        pw = db.query(Worker).filter(Worker.id == wc.preferred_worker_id).first()
        pw_name = pw.name if pw else None
    r = {"id": wc.id, "name": wc.name, "machine_type": wc.machine_type,
         "is_bottleneck": wc.is_bottleneck,
         "preferred_worker_id": wc.preferred_worker_id,
         "preferred_worker_name": pw_name,
         "skilled_worker_ids":   [sw.id   for sw in wc.skilled_workers],
         "skilled_worker_names": [sw.name for sw in wc.skilled_workers]}
    db.close(); return r

@app.delete("/api/workcenters/{wc_id}")
def delete_wc(wc_id: int):
    db = SessionLocal()
    wc = db.query(WorkCenter).filter(WorkCenter.id == wc_id).first()
    if not wc: raise HTTPException(404, "Not found")
    db.delete(wc); db.commit(); db.close(); return {"ok": True}

# ─────────────────────────────────────────────────────────────────────────────
# WORKERS
# ─────────────────────────────────────────────────────────────────────────────
def worker_dict(w, db):
    return {"id": w.id, "name": w.name, "role": w.role, "phone": w.phone,
            "code": w.code or "", "skill_level": w.skill_level or 1,
            "is_active": w.is_active,
            "worker_type": getattr(w, "worker_type", "shop_floor") or "shop_floor",
            "skill_ids":   [s.id   for s in w.skills],
            "skill_names": [s.name for s in w.skills]}

@app.get("/api/workers")
def list_workers():
    db = SessionLocal()
    ws = db.query(Worker).order_by(Worker.name).all()
    result = [worker_dict(w, db) for w in ws]; db.close(); return result

@app.get("/api/workers/availability")
def worker_availability():
    db = SessionLocal()
    workers = db.query(Worker).filter(Worker.is_active == True).all()
    today = now_ist().date()
    result = []
    for w in workers:
        leaves = db.query(WorkerLeave).filter(
            WorkerLeave.worker_id == w.id,
            WorkerLeave.leave_date >= today,
            WorkerLeave.leave_date <= today + timedelta(days=14)
        ).all()
        on_leave = any(lv.leave_date == today for lv in leaves)
        ops_count = db.query(ScheduledOp).filter(
            ScheduledOp.worker_id == w.id,
            ScheduledOp.scheduled_start >= datetime.combine(today, datetime.min.time()),
            ScheduledOp.scheduled_start <= datetime.combine(today + timedelta(days=7), datetime.max.time()),
            ScheduledOp.status.in_(["scheduled", "in_progress"])
        ).count()
        result.append({
            "id": w.id, "name": w.name, "role": w.role,
            "on_leave_today": on_leave,
            "leave_dates_next14": [lv.leave_date.isoformat() for lv in leaves],
            "ops_next7days": ops_count,
            "skill_names": [s.name for s in w.skills]
        })
    db.close(); return result

@app.get("/api/workers/{worker_id}")
def get_worker(worker_id: int):
    db = SessionLocal()
    w = db.query(Worker).filter(Worker.id == worker_id).first()
    if not w: raise HTTPException(404, "Not found")
    data = worker_dict(w, db)
    today = now_ist().date()
    leaves = db.query(WorkerLeave).filter(
        WorkerLeave.worker_id == worker_id,
        WorkerLeave.leave_date >= today
    ).order_by(WorkerLeave.leave_date).all()
    data["upcoming_leaves"] = [{"id": lv.id, "date": lv.leave_date.isoformat(),
                                 "type": lv.leave_type, "start_time": lv.start_time,
                                 "end_time": lv.end_time, "reason": lv.reason}
                                for lv in leaves]
    fmt = lambda dt: dt.isoformat() if dt else None
    ops = db.query(ScheduledOp).filter(
        ScheduledOp.worker_id == worker_id,
        ScheduledOp.scheduled_end >= now_ist(),
        ScheduledOp.status.in_(["scheduled", "in_progress"])
    ).order_by(ScheduledOp.scheduled_start).limit(10).all()
    data["upcoming_ops"] = [{"op_name": s.op_name, "wc_name": s.wc_name,
                              "job_number": s.job.job_number if s.job else "",
                              "scheduled_start": fmt(s.scheduled_start),
                              "scheduled_end":   fmt(s.scheduled_end),
                              "status": s.status} for s in ops]
    db.close(); return data

@app.post("/api/workers")
def create_worker(data: dict):
    db = SessionLocal()
    wcode = (data.get("code") or "").strip()
    if not wcode:
        last = db.query(Worker).order_by(Worker.id.desc()).first()
        n = (last.id + 1) if last else 1
        wcode = f"W{n:02d}"
        while db.query(Worker).filter(Worker.code == wcode).first():
            n += 1; wcode = f"W{n:02d}"
    w = Worker(name=data["name"], role=data.get("role",""), phone=data.get("phone",""),
               is_active=True, code=wcode, skill_level=int(data.get("skill_level",1)),
               worker_type=data.get("worker_type","shop_floor"))
    db.add(w); db.flush()
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
    if "skill_level" in data: w.skill_level = int(data["skill_level"])
    if "worker_type" in data: w.worker_type = data["worker_type"]
    if "skill_ids" in data:
        w.skills = []; db.flush()
        for wc_id in data["skill_ids"]:
            wc = db.query(WorkCenter).filter(WorkCenter.id == wc_id).first()
            if wc: w.skills.append(wc)
    db.commit(); result = worker_dict(w, db); db.close(); return result

@app.delete("/api/workers/{worker_id}")
def delete_worker(worker_id: int):
    db = SessionLocal()
    w = db.query(Worker).filter(Worker.id == worker_id).first()
    if not w: raise HTTPException(404, "Not found")
    w.is_active = False; db.commit(); db.close(); return {"ok": True}

# Worker Leave endpoints
@app.get("/api/workers/{worker_id}/leaves")
def get_worker_leaves(worker_id: int):
    db = SessionLocal()
    leaves = db.query(WorkerLeave).filter(
        WorkerLeave.worker_id == worker_id
    ).order_by(WorkerLeave.leave_date.desc()).all()
    result = [{"id": lv.id, "date": lv.leave_date.isoformat(),
               "type": lv.leave_type, "start_time": lv.start_time,
               "end_time": lv.end_time, "reason": lv.reason} for lv in leaves]
    db.close(); return result

@app.post("/api/workers/{worker_id}/leaves")
def add_leave(worker_id: int, data: dict):
    db = SessionLocal()
    w = db.query(Worker).filter(Worker.id == worker_id).first()
    if not w: raise HTTPException(404, "Worker not found")

    start_date = parse_date(data["date"])
    end_date   = parse_date(data.get("date_end") or data["date"])  # range or single
    leave_type = data.get("type", "full")

    # Generate one row per day in the range
    created = []
    current = start_date
    while current <= end_date:
        lv = WorkerLeave(
            worker_id      = worker_id,
            leave_date     = current,
            leave_date_end = end_date if end_date != start_date else None,
            leave_type     = leave_type,
            start_time     = data.get("start_time") if leave_type == "hours" else None,
            end_time       = data.get("end_time")   if leave_type == "hours" else None,
            reason         = data.get("reason", "")
        )
        db.add(lv)
        created.append(lv)
        current = current + timedelta(days=1)

    db.commit()
    result = [{"id": lv.id, "date": lv.leave_date.isoformat(),
               "type": lv.leave_type, "reason": lv.reason} for lv in created]
    db.close()
    return {"created": len(result), "leaves": result}

@app.delete("/api/leaves/{leave_id}")
def delete_leave(leave_id: int):
    db = SessionLocal()
    lv = db.query(WorkerLeave).filter(WorkerLeave.id == leave_id).first()
    if not lv: raise HTTPException(404, "Not found")
    db.delete(lv); db.commit(); db.close(); return {"ok": True}

@app.get("/api/leaves/today")
def get_today_leaves():
    db = SessionLocal()
    today = now_ist().date()
    leaves = db.query(WorkerLeave).filter(WorkerLeave.leave_date == today).all()
    result = [{"worker_id": lv.worker_id,
               "worker_name": lv.worker.name if lv.worker else "",
               "type": lv.leave_type, "reason": lv.reason} for lv in leaves]
    db.close(); return result

@app.post("/api/workers/{worker_id}/absent-today")
def mark_absent_today(worker_id: int):
    db = SessionLocal()
    w = db.query(Worker).filter(Worker.id == worker_id).first()
    if not w: raise HTTPException(404, "Not found")
    today = now_ist().date()
    existing = db.query(WorkerLeave).filter(
        WorkerLeave.worker_id == worker_id,
        WorkerLeave.leave_date == today
    ).first()
    if not existing:
        db.add(WorkerLeave(worker_id=worker_id, leave_date=today,
                           leave_type="full", reason="Absent today")); db.flush()
    t_start = datetime(today.year, today.month, today.day, 0, 0)
    t_end   = datetime(today.year, today.month, today.day, 23, 59)
    ops = db.query(ScheduledOp).filter(
        ScheduledOp.worker_id == worker_id,
        ScheduledOp.scheduled_start >= t_start,
        ScheduledOp.scheduled_start <= t_end,
        ScheduledOp.status.in_(["scheduled","in_progress"])
    ).all()
    reassigned = unassigned = 0
    for op in ops:
        replaced = False
        for candidate in [q for q in find_qualified_workers(db, op.work_center_id) if q.id != worker_id]:
            if is_worker_available(db, candidate.id, op.scheduled_start, op.scheduled_end):
                op.worker_id = candidate.id; op.worker_name = candidate.name
                replaced = True; reassigned += 1; break
        if not replaced:
            op.worker_id = None; op.worker_name = None; unassigned += 1
    db.commit()
    worker_name = w.name   # capture before session closes
    db.close()
    return {"reassigned": reassigned, "unassigned": unassigned,
            "total_ops": len(ops), "worker_name": worker_name}

@app.post("/api/workers/{worker_id}/reschedule-after-leave")
def reschedule_after_leave(worker_id: int):
    db = SessionLocal()
    w = db.query(Worker).filter(Worker.id == worker_id).first()
    if not w: raise HTTPException(404, "Not found")
    now = now_ist()
    future_ops = db.query(ScheduledOp).filter(
        ScheduledOp.worker_id == worker_id,
        ScheduledOp.scheduled_start > now,
        ScheduledOp.status == "scheduled"
    ).order_by(ScheduledOp.scheduled_start).all()
    rescheduled = 0
    for op in future_ops:
        blocks = get_worker_blocked_periods(db, worker_id, op.scheduled_start, op.scheduled_end)
        if not any(bs < op.scheduled_end and be > op.scheduled_start for bs, be in blocks):
            continue
        replaced = False
        for candidate in [q for q in find_qualified_workers(db, op.work_center_id) if q.id != worker_id]:
            if is_worker_available(db, candidate.id, op.scheduled_start, op.scheduled_end):
                op.worker_id = candidate.id; op.worker_name = candidate.name
                replaced = True; rescheduled += 1; break
        if not replaced:
            op.worker_id = None; op.worker_name = None; rescheduled += 1
    db.commit(); db.close()
    return {"rescheduled": rescheduled}

# ─────────────────────────────────────────────────────────────────────────────
# STAFF TASKS
# ─────────────────────────────────────────────────────────────────────────────

def task_dict(t):
    # All assignees = primary + extra (deduplicated by worker_id)
    extra_ids = {a.worker_id for a in (t.assignees or [])}
    all_assignees = []
    if t.assigned_to_id:
        all_assignees.append({"worker_id": t.assigned_to_id, "worker_name": t.assigned_to_name or ""})
    for a in (t.assignees or []):
        if a.worker_id != t.assigned_to_id:
            all_assignees.append({"worker_id": a.worker_id, "worker_name": a.worker_name or ""})

    return {
        "id":               t.id,
        "title":            t.title,
        "description":      t.description or "",
        "category":         t.category or "Other",
        "priority":         t.priority or "normal",
        "status":           t.status or "pending",
        "assigned_to_id":   t.assigned_to_id,
        "assigned_to_name": t.assigned_to_name or "",
        "all_assignees":    all_assignees,
        "created_by_id":    t.created_by_id,
        "created_by_name":  t.created_by_name or "",
        "due_date":         t.due_date.isoformat() if t.due_date else None,
        "due_time":         t.due_time or "",
        "notes":            t.notes or "",
        "completed_at":     t.completed_at.isoformat() if t.completed_at else None,
        "created_at":       t.created_at.isoformat() if t.created_at else None,
        "files": [{"id": f.id, "filename": f.filename, "file_size": f.file_size,
                   "mime_type": f.mime_type, "uploaded_by": f.uploaded_by,
                   "note": f.note, "created_at": f.created_at.isoformat() if f.created_at else None}
                  for f in (t.files or [])],
        "activities": [{"id": a.id, "actor_name": a.actor_name or "", "action": a.action,
                        "note": a.note or "", "created_at": a.created_at.isoformat() if a.created_at else None}
                       for a in (t.activities or [])],
    }

def _log_activity(db, task_id, actor_id, actor_name, action, note=""):
    """Add an entry to the task activity log."""
    db.add(TaskActivity(
        task_id    = task_id,
        actor_id   = actor_id,
        actor_name = actor_name,
        action     = action,
        note       = note or "",
        created_at = now_ist(),
    ))

# ── Task file storage directory ───────────────────────────────────────────────
TASK_FILES_DIR = os.path.join(os.path.dirname(__file__), "task_uploads")
os.makedirs(TASK_FILES_DIR, exist_ok=True)

@app.get("/api/tasks")
def get_tasks(status: str = None, assigned_to: int = None, priority: str = None):
    db = SessionLocal()
    q = db.query(StaffTask)
    if status:      q = q.filter(StaffTask.status == status)
    if assigned_to: q = q.filter(StaffTask.assigned_to_id == assigned_to)
    if priority:    q = q.filter(StaffTask.priority == priority)
    tasks = q.order_by(StaffTask.due_date.asc().nullslast(), StaffTask.created_at.desc()).all()
    result = [task_dict(t) for t in tasks]
    db.close(); return result

@app.post("/api/tasks")
def create_task(data: dict, user: dict = Depends(require_any)):
    db = SessionLocal()
    t = StaffTask(
        title            = data["title"],
        description      = data.get("description", ""),
        category         = data.get("category", "Other"),
        priority         = data.get("priority", "normal"),
        status           = "pending",
        assigned_to_id   = data.get("assigned_to_id"),
        assigned_to_name = data.get("assigned_to_name", ""),
        created_by_id    = user.get("worker_id"),
        created_by_name  = user.get("username", ""),
        due_date         = parse_date(data["due_date"]) if data.get("due_date") else None,
        due_time         = data.get("due_time", ""),
        created_at       = now_ist(),
    )
    db.add(t); db.flush()

    # Extra assignees (multi-user)
    for a in data.get("extra_assignees", []):
        db.add(TaskAssignee(task_id=t.id, worker_id=a["worker_id"],
                            worker_name=a.get("worker_name",""), assigned_at=now_ist()))

    # Log creation
    _log_activity(db, t.id, user.get("worker_id"), user.get("username",""),
                  "created", f"Task created by {user.get('username','')}")

    # ── Notify assignees ──
    assignee_worker_ids = set()
    if t.assigned_to_id:
        assignee_worker_ids.add(int(t.assigned_to_id))
    for a in data.get("extra_assignees", []):
        if a.get("worker_id"):
            assignee_worker_ids.add(int(a["worker_id"]))
    creator_wid = user.get("worker_id")
    for wid in assignee_worker_ids:
        if creator_wid and int(wid) == int(creator_wid):
            continue  # don't notify the creator about their own task
        _notify_worker(db, wid, "task_assigned",
                       f"📋 Task: {t.title[:60]}",
                       f"Assigned by {user.get('username','')}",
                       link="/tasks")

    db.commit(); db.refresh(t)
    result = task_dict(t); db.close(); return result

@app.get("/api/tasks/{task_id}")
def get_task(task_id: int):
    db = SessionLocal()
    t = db.query(StaffTask).filter(StaffTask.id == task_id).first()
    if not t: raise HTTPException(404, "Task not found")
    result = task_dict(t); db.close(); return result

@app.put("/api/tasks/{task_id}")
def update_task(task_id: int, data: dict, user: dict = Depends(require_any)):
    db = SessionLocal()
    t = db.query(StaffTask).filter(StaffTask.id == task_id).first()
    if not t: raise HTTPException(404, "Task not found")

    actor_id   = user.get("worker_id")
    actor_name = user.get("username", "")

    for field in ("title", "description", "category", "priority",
                  "assigned_to_id", "assigned_to_name", "due_time", "notes"):
        if field in data: setattr(t, field, data[field])
    if "due_date" in data:
        t.due_date = parse_date(data["due_date"]) if data["due_date"] else None

    # Update extra assignees if provided
    if "extra_assignees" in data:
        db.query(TaskAssignee).filter(TaskAssignee.task_id == task_id).delete()
        for a in data["extra_assignees"]:
            if a["worker_id"] != t.assigned_to_id:  # don't duplicate primary
                db.add(TaskAssignee(task_id=t.id, worker_id=a["worker_id"],
                                    worker_name=a.get("worker_name",""), assigned_at=now_ist()))
        # Log reassignment
        names = [a.get("worker_name","") for a in data["extra_assignees"]]
        if names:
            _log_activity(db, task_id, actor_id, actor_name, "assigned",
                          f"Additional assignees: {', '.join(names)}")

    # Status change — always logged
    if "status" in data:
        old_status = t.status
        t.status = data["status"]
        if data["status"] == "done":
            if not t.completed_at: t.completed_at = now_ist()
            _log_activity(db, task_id, actor_id, actor_name, "done",
                          data.get("notes") or "")
        elif data["status"] == "in_progress" and old_status != "in_progress":
            _log_activity(db, task_id, actor_id, actor_name, "started", "")
        elif data["status"] == "paused":
            _log_activity(db, task_id, actor_id, actor_name, "paused", "")
        elif data["status"] == "pending" and old_status == "done":
            t.completed_at = None
            _log_activity(db, task_id, actor_id, actor_name, "reopened", "")

    db.commit(); result = task_dict(t); db.close(); return result


@app.post("/api/tasks/{task_id}/comment")
def add_task_comment(task_id: int, data: dict, user: dict = Depends(require_any)):
    """Add a comment/progress note to a task without changing its status."""
    db = SessionLocal()
    t = db.query(StaffTask).filter(StaffTask.id == task_id).first()
    if not t: raise HTTPException(404, "Task not found")
    note = (data.get("note") or "").strip()
    if not note: raise HTTPException(400, "Comment cannot be empty")
    _log_activity(db, task_id, user.get("worker_id"), user.get("username",""), "comment", note)
    # ── Notify other assignees about the comment ──
    assignee_wids = set()
    if t.assigned_to_id: assignee_wids.add(int(t.assigned_to_id))
    for a in t.assignees:
        if a.worker_id: assignee_wids.add(int(a.worker_id))
    my_wid = user.get("worker_id")
    for wid in assignee_wids:
        if my_wid and int(wid) == int(my_wid): continue
        _notify_worker(db, wid, "task_comment",
                       f"💬 {t.title[:50]}",
                       f"{user.get('username','')}: {note[:80]}",
                       link="/tasks")
    db.commit(); db.close()
    return {"ok": True}


@app.put("/api/tasks/{task_id}/assignees")
def update_task_assignees(task_id: int, data: dict, user: dict = Depends(require_any)):
    """Replace the full assignee list for a task."""
    db = SessionLocal()
    t = db.query(StaffTask).filter(StaffTask.id == task_id).first()
    if not t: raise HTTPException(404, "Task not found")
    # Update primary assignee
    if "assigned_to_id" in data:
        t.assigned_to_id   = data["assigned_to_id"]
        t.assigned_to_name = data.get("assigned_to_name", "")
    # Replace extra assignees
    db.query(TaskAssignee).filter(TaskAssignee.task_id == task_id).delete()
    names = []
    for a in data.get("assignees", []):
        if a["worker_id"] != t.assigned_to_id:
            db.add(TaskAssignee(task_id=t.id, worker_id=a["worker_id"],
                                worker_name=a.get("worker_name",""), assigned_at=now_ist()))
            names.append(a.get("worker_name",""))
    _log_activity(db, task_id, user.get("worker_id"), user.get("username",""), "assigned",
                  f"Assignees updated: {t.assigned_to_name or ''}" +
                  (f", {', '.join(names)}" if names else ""))
    # ── Notify new assignees ──
    all_wids = set()
    if t.assigned_to_id: all_wids.add(int(t.assigned_to_id))
    for a in data.get("assignees", []):
        if a.get("worker_id"): all_wids.add(int(a["worker_id"]))
    my_wid = user.get("worker_id")
    for wid in all_wids:
        if my_wid and int(wid) == int(my_wid): continue
        _notify_worker(db, wid, "task_assigned",
                       f"📋 Task: {t.title[:60]}",
                       f"Assigned by {user.get('username','')}",
                       link="/tasks")
    db.commit(); result = task_dict(t); db.close(); return result

@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: int):
    db = SessionLocal()
    t = db.query(StaffTask).filter(StaffTask.id == task_id).first()
    if not t: raise HTTPException(404, "Task not found")
    db.delete(t); db.commit(); db.close(); return {"ok": True}

@app.get("/api/tasks/summary/counts")
def task_summary():
    db = SessionLocal()
    from sqlalchemy import func
    counts = db.query(StaffTask.status, func.count(StaffTask.id)).group_by(StaffTask.status).all()
    today  = now_ist().date()
    overdue = db.query(StaffTask).filter(
        StaffTask.due_date < today,
        StaffTask.status.notin_(["done", "cancelled"])
    ).count()
    result = {r[0]: r[1] for r in counts}
    result["overdue"] = overdue
    db.close(); return result

# ── Task File Upload / Download / Delete ──────────────────────────────────────
import uuid, shutil
from fastapi import UploadFile, File, Form
from fastapi.responses import FileResponse as FastFileResponse

@app.post("/api/tasks/{task_id}/files")
async def upload_task_file(
    task_id: int,
    file: UploadFile = File(...),
    note: str = Form(""),
    user: dict = Depends(require_any)
):
    db = SessionLocal()
    t = db.query(StaffTask).filter(StaffTask.id == task_id).first()
    if not t: db.close(); raise HTTPException(404, "Task not found")

    # Validate file size (max 20 MB)
    MAX_SIZE = 20 * 1024 * 1024
    content = await file.read()
    if len(content) > MAX_SIZE:
        db.close(); raise HTTPException(400, "File too large (max 20 MB)")

    # Validate file extension — only allow safe document/image types
    ALLOWED_EXTENSIONS = {
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
        '.txt', '.csv', '.jpg', '.jpeg', '.png', '.gif', '.webp',
        '.mp4', '.mov', '.zip', '.rar', '.7z', '.dwg', '.dxf', '.step', '.stp',
    }
    ext = os.path.splitext(file.filename or "file")[1].lower()
    if ext and ext not in ALLOWED_EXTENSIONS:
        db.close()
        raise HTTPException(400, f"File type '{ext}' not allowed. Allowed types: documents, images, CAD files.")
    stored = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(TASK_FILES_DIR, stored)
    with open(path, "wb") as f_out:
        f_out.write(content)

    tf = TaskFile(
        task_id     = task_id,
        filename    = file.filename or "file",
        stored_name = stored,
        file_size   = len(content),
        mime_type   = file.content_type or "application/octet-stream",
        uploaded_by = user.get("username", ""),
        note        = note.strip() or None,
        created_at  = now_ist(),
    )
    db.add(tf); db.commit(); db.refresh(tf)
    _log_activity(db, task_id, None, user.get("username",""), "file_added",
                  f"Uploaded: {file.filename}")
    db.commit()
    result = {"id": tf.id, "filename": tf.filename, "file_size": tf.file_size,
              "mime_type": tf.mime_type, "uploaded_by": tf.uploaded_by,
              "note": tf.note, "created_at": tf.created_at.isoformat()}
    db.close(); return result

@app.get("/api/task-files/{file_id}/download")
def download_task_file(file_id: int, user: dict = Depends(require_any)):
    db = SessionLocal()
    tf = db.query(TaskFile).filter(TaskFile.id == file_id).first()
    if not tf: db.close(); raise HTTPException(404, "File not found")
    path = os.path.join(TASK_FILES_DIR, tf.stored_name)
    filename = tf.filename
    mime = tf.mime_type or "application/octet-stream"
    db.close()
    if not os.path.exists(path):
        raise HTTPException(404, "File missing from server")
    safe_name = _sanitize_filename(filename)
    return FastFileResponse(path, media_type=mime,
                            headers={"Content-Disposition": f'attachment; filename="{safe_name}"'})

@app.delete("/api/task-files/{file_id}")
def delete_task_file(file_id: int, user: dict = Depends(require_any)):
    db = SessionLocal()
    tf = db.query(TaskFile).filter(TaskFile.id == file_id).first()
    if not tf: db.close(); raise HTTPException(404, "Not found")
    path = os.path.join(TASK_FILES_DIR, tf.stored_name)
    db.delete(tf); db.commit(); db.close()
    if os.path.exists(path):
        os.remove(path)
    return {"ok": True}

@app.post("/api/pull-forward")
def pull_forward(user: dict = Depends(require_manager)):
    """Pull all future scheduled ops forward after today's ops completed early."""
    db = SessionLocal()
    now = now_ist()
    # Find all scheduled ops that start in the future
    future_ops = db.query(ScheduledOp).filter(
        ScheduledOp.status == "scheduled",
        ScheduledOp.scheduled_start > now,
    ).order_by(ScheduledOp.scheduled_start).all()

    pulled = 0
    # Group by machine, pull each machine's queue forward
    by_machine = {}
    for op in future_ops:
        by_machine.setdefault(op.work_center_id, []).append(op)

    for wc_id, ops in by_machine.items():
        # Find when this machine is free (last completed/in-progress op)
        last_active = db.query(ScheduledOp).filter(
            ScheduledOp.work_center_id == wc_id,
            ScheduledOp.status.in_(["completed", "in_progress"]),
        ).order_by(ScheduledOp.actual_end.desc().nullslast(),
                   ScheduledOp.scheduled_end.desc()).first()

        free_from = now
        if last_active:
            free_from = last_active.actual_end or last_active.scheduled_end or now
        free_from = max(free_from, now)
        free_from = snap_to_shift(free_from)

        for op in sorted(ops, key=lambda x: x.scheduled_start):
            duration_hrs = (op.scheduled_end - op.scheduled_start).total_seconds() / 3600
            new_start = free_from
            new_end   = add_working_hours(new_start, duration_hrs)
            # Only pull forward (never push later)
            if new_start < op.scheduled_start:
                op.scheduled_start = new_start
                op.scheduled_end   = new_end
                pulled += 1
            free_from = new_end

    db.commit(); db.close()
    return {"pulled": pulled, "message": f"Pulled {pulled} operations forward"}


# ─────────────────────────────────────────────────────────────────────────────
# QUOTATIONS
# ─────────────────────────────────────────────────────────────────────────────

import io, json as _json
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

def _next_quote_number(db):
    yr = now_ist().year
    qc = db.query(QuoteCounter).filter(QuoteCounter.year == yr).first()
    if not qc:
        qc = QuoteCounter(year=yr, seq=0)
        db.add(qc)
    qc.seq += 1
    return f"QUO-{yr}-{str(qc.seq).zfill(3)}"

def _get_setting(db, key, default=""):
    s = db.query(CompanySetting).filter(CompanySetting.key == key).first()
    return s.value if s else default

def _set_setting(db, key, value):
    s = db.query(CompanySetting).filter(CompanySetting.key == key).first()
    if s: s.value = value
    else: db.add(CompanySetting(key=key, value=value))

def _quote_dict(q):
    try:    items = _json.loads(q.line_items) if q.line_items else []
    except: items = []
    return {
        "id": q.id, "quote_number": q.quote_number, "status": q.status,
        "customer_id": q.customer_id, "customer_name": q.customer_name,
        "customer_address": q.customer_address or "",
        "customer_gstin": q.customer_gstin or "",
        "customer_email": q.customer_email or "",
        "customer_phone": q.customer_phone or "",
        "line_items": items,
        "subtotal": q.subtotal or 0, "discount_pct": q.discount_pct or 0,
        "discount_amt": q.discount_amt or 0, "tax_pct": q.tax_pct or 18,
        "tax_amt": q.tax_amt or 0, "total": q.total or 0,
        "currency": q.currency or "INR", "validity_days": q.validity_days or 30,
        "valid_until": q.valid_until.isoformat() if q.valid_until else None,
        "notes": q.notes or "", "terms": q.terms or "",
        "message":       q.message       or "",
        "delivery_time": q.delivery_time or "",
        "payment_terms": q.payment_terms or "",
        "pan_no":        q.pan_no        or "",
        "packing_cost":  q.packing_cost  or "",
        "bank_details":  q.bank_details  or "",
        "order_id": q.order_id,
        "created_at": q.created_at.isoformat() if q.created_at else None,
        "sent_at": q.sent_at.isoformat() if q.sent_at else None,
        "accepted_at": q.accepted_at.isoformat() if q.accepted_at else None,
    }

@app.get("/api/quotations")
def list_quotations(status: str = None, user: dict = Depends(require_any)):
    db = SessionLocal()
    q = db.query(Quotation).order_by(Quotation.created_at.desc())
    if status: q = q.filter(Quotation.status == status)
    result = [_quote_dict(x) for x in q.all()]
    db.close(); return result

@app.post("/api/quotations")
def create_quotation(data: dict, user: dict = Depends(require_any)):
    db = SessionLocal()
    qn = _next_quote_number(db)
    items = data.get("line_items", [])
    subtotal  = sum(float(i.get("amount", 0)) for i in items)
    disc_pct  = float(data.get("discount_pct", 0))
    disc_amt  = round(subtotal * disc_pct / 100, 2)
    tax_pct   = float(data.get("tax_pct", 18))
    tax_base  = subtotal - disc_amt
    tax_amt   = round(tax_base * tax_pct / 100, 2)
    total     = round(tax_base + tax_amt, 2)
    validity  = int(data.get("validity_days", 30))
    valid_until = (now_ist().date() + timedelta(days=validity))
    q = Quotation(
        quote_number=qn, status="draft",
        customer_id=data.get("customer_id"), customer_name=data.get("customer_name",""),
        customer_address=data.get("customer_address",""),
        customer_gstin=data.get("customer_gstin",""),
        customer_email=data.get("customer_email",""),
        customer_phone=data.get("customer_phone",""),
        line_items=_json.dumps(items), subtotal=subtotal,
        discount_pct=disc_pct, discount_amt=disc_amt,
        tax_pct=tax_pct, tax_amt=tax_amt, total=total,
        currency=data.get("currency","INR"),
        validity_days=validity, valid_until=valid_until,
        notes=data.get("notes",""), terms=data.get("terms",""),
        message=data.get("message",""),
        delivery_time=data.get("delivery_time",""),
        payment_terms=data.get("payment_terms",""),
        pan_no=data.get("pan_no",""),
        packing_cost=data.get("packing_cost",""),
        bank_details=data.get("bank_details",""),
        created_at=now_ist(),
    )
    db.add(q); db.commit(); db.refresh(q)
    result = _quote_dict(q); db.close(); return result

@app.get("/api/quotations/{qid}")
def get_quotation(qid: int, user: dict = Depends(require_any)):
    db = SessionLocal()
    q = db.query(Quotation).filter(Quotation.id == qid).first()
    if not q: db.close(); raise HTTPException(404, "Not found")
    result = _quote_dict(q); db.close(); return result

@app.put("/api/quotations/{qid}")
def update_quotation(qid: int, data: dict, user: dict = Depends(require_any)):
    db = SessionLocal()
    q = db.query(Quotation).filter(Quotation.id == qid).first()
    if not q: db.close(); raise HTTPException(404, "Not found")
    for f in ("customer_id","customer_name","customer_address","customer_gstin",
              "customer_email","customer_phone","notes","terms","currency","status",
              "message","delivery_time","payment_terms","pan_no","packing_cost","bank_details"):
        if f in data: setattr(q, f, data[f])
    if "line_items" in data:
        q.line_items = _json.dumps(data["line_items"])
        q.subtotal   = sum(float(i.get("amount",0)) for i in data["line_items"])
    if "discount_pct"  in data: q.discount_pct  = float(data["discount_pct"])
    if "tax_pct"       in data: q.tax_pct        = float(data["tax_pct"])
    if "validity_days" in data:
        q.validity_days = int(data["validity_days"])
        q.valid_until   = now_ist().date() + timedelta(days=q.validity_days)
    disc_amt = round((q.subtotal or 0) * (q.discount_pct or 0) / 100, 2)
    tax_base = (q.subtotal or 0) - disc_amt
    q.discount_amt = disc_amt
    q.tax_amt      = round(tax_base * (q.tax_pct or 18) / 100, 2)
    q.total        = round(tax_base + q.tax_amt, 2)
    if data.get("status") == "sent"     and not q.sent_at:     q.sent_at     = now_ist()
    if data.get("status") == "accepted" and not q.accepted_at: q.accepted_at = now_ist()
    db.commit(); result = _quote_dict(q); db.close(); return result

@app.delete("/api/quotations/{qid}")
def delete_quotation(qid: int, user: dict = Depends(require_manager)):
    db = SessionLocal()
    q = db.query(Quotation).filter(Quotation.id == qid).first()
    if not q: db.close(); raise HTTPException(404, "Not found")
    db.delete(q); db.commit(); db.close(); return {"ok": True}

@app.get("/api/company-settings")
def get_company_settings(user: dict = Depends(require_any)):
    db = SessionLocal()
    rows = db.query(CompanySetting).all()
    result = {r.key: r.value for r in rows}
    db.close(); return result

@app.put("/api/company-settings")
def update_company_settings(data: dict, user: dict = Depends(require_manager)):
    db = SessionLocal()
    for k, v in data.items():
        _set_setting(db, k, str(v) if v is not None else "")
    db.commit(); db.close(); return {"ok": True}

# ── PDF Generation ────────────────────────────────────────────────────────────
@app.get("/api/quotations/{qid}/pdf")
def generate_quote_pdf(qid: int, user: dict = Depends(require_any)):
    from fastapi.responses import StreamingResponse
    db = SessionLocal()
    q = db.query(Quotation).filter(Quotation.id == qid).first()
    if not q: db.close(); raise HTTPException(404, "Not found")
    co_name    = _get_setting(db, "company_name",    "Yukeng Mould & Die")
    co_addr    = _get_setting(db, "company_address",  "")
    co_gstin   = _get_setting(db, "company_gstin",    "")
    co_email   = _get_setting(db, "company_email",    "")
    co_phone   = _get_setting(db, "company_phone",    "")
    co_website = _get_setting(db, "company_website",  "")
    try:    items = _json.loads(q.line_items) if q.line_items else []
    except: items = []
    db.close()
    buf = io.BytesIO()
    _draw_quote_pdf(buf, q, items, co_name, co_addr, co_gstin, co_email, co_phone, co_website)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{_sanitize_filename(q.quote_number)}.pdf"'})


def _draw_quote_pdf(buf, q, items, co_name, co_addr, co_gstin, co_email, co_phone, co_website):
    """Premium A4 quotation PDF — correct row geometry, signature, T&C page breaks."""
    import os as _os
    W, H = A4
    c = rl_canvas.Canvas(buf, pagesize=A4)

    BLACK = colors.HexColor("#1d1d1f")
    GRAY1 = colors.HexColor("#6e6e73")
    GRAY2 = colors.HexColor("#aeaeb2")
    GRAY3 = colors.HexColor("#f5f5f7")

    ML = 52; MR = W - 52; MT = H - 48; MB = 48
    VALUE_X = ML + 100

    # Register Vera font — bundled with ReportLab, works cross-platform
    import reportlab as _rl_pkg
    _rl_fonts_dir = os.path.join(os.path.dirname(_rl_pkg.__file__), 'fonts')
    _vera_reg  = os.path.join(_rl_fonts_dir, 'Vera.ttf')
    _vera_bold = os.path.join(_rl_fonts_dir, 'VeraBd.ttf')
    try:
        pdfmetrics.registerFont(TTFont('Vera',   _vera_reg))
        pdfmetrics.registerFont(TTFont('VeraBd', _vera_bold))
    except Exception:
        pass
    _MF  = 'Vera'
    _MFB = 'VeraBd'
    _R   = 'Rs. '

    def hline(y, x0=ML, x1=MR, w=0.5, col=GRAY2):
        c.setStrokeColor(col); c.setLineWidth(w); c.line(x0, y, x1, y)

    def txt(x, y, s, sz=9, fn="Helvetica", col=BLACK, align="left"):
        c.setFont(fn, sz); c.setFillColor(col); s = str(s)
        if   align == "right":  c.drawRightString(x, y, s)
        elif align == "center": c.drawCentredString(x, y, s)
        else:                   c.drawString(x, y, s)

    def mtxt(x, y, v, sz=9, bold=False, col=BLACK, align="right"):
        fn = _MFB if bold else _MF
        s  = f"{_R}{float(v):,.2f}"
        c.setFont(fn, sz); c.setFillColor(col)
        if   align == "right":  c.drawRightString(x, y, s)
        elif align == "center": c.drawCentredString(x, y, s)
        else:                   c.drawString(x, y, s)

    def draw_footer(last_page=False):
        """Draw footer. Signature block only on the last page."""
        # Bottom rule
        hline(MB + 22)
        txt(ML, MB + 8, q.quote_number, sz=7.5, col=GRAY2)
        txt(MR, MB + 8, co_name,        sz=7.5, col=GRAY2, align="right")
        if not last_page:
            return
        # Signature — last page only
        sig_x  = MR - 200; sig_right = MR; sig_cx = (sig_x + sig_right) / 2
        SIG_PATH = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "signature.png")
        if _os.path.exists(SIG_PATH):
            try:
                from reportlab.lib.utils import ImageReader as _IR
                _ir = _IR(SIG_PATH)
                _iw, _ih = _ir.getSize()
                sig_h = 38
                sig_w = sig_h * (_iw / _ih)
                c.drawImage(SIG_PATH,
                            sig_cx - sig_w / 2, MB + 62,
                            width=sig_w, height=sig_h,
                            preserveAspectRatio=True, mask='auto')
            except Exception:
                pass
        hline(MB + 60, x0=sig_x, x1=sig_right, w=0.4)
        txt(sig_cx, MB + 48, "Authorised Signatory", sz=8, col=GRAY1, align="center")
        txt(sig_cx, MB + 36, co_name,               sz=8, fn="Helvetica-Bold",
            col=BLACK, align="center")

    # ── HEADER ───────────────────────────────────────────────────────────────
    y = MT
    LOGO_H = round(46 * 1.05)
    LOGO_W = LOGO_H * (945 / 1188)
    LOGO_PATH = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "logo.png")
    if _os.path.exists(LOGO_PATH):
        try:
            c.drawImage(LOGO_PATH, ML, y - LOGO_H + 12, width=LOGO_W, height=LOGO_H,
                        preserveAspectRatio=True, mask='auto')
        except Exception:
            txt(ML, y, co_name, sz=20, fn="Helvetica-Bold")
    else:
        txt(ML, y, co_name, sz=20, fn="Helvetica-Bold")

    txt(MR, MT - 2, "QUOTATION", sz=20, fn="Helvetica-Bold", align="right")
    my = MT - 24
    for lbl, val in [
        ("Quote No.",   q.quote_number),
        ("Date",        q.created_at.strftime("%d %b %Y") if q.created_at else ""),
        ("Valid Until", q.valid_until.strftime("%d %b %Y") if q.valid_until else f"{q.validity_days} days"),
    ]:
        txt(MR - 140, my, lbl + ":", sz=8, col=GRAY1)
        txt(MR, my, val, sz=8, fn="Helvetica-Bold", align="right")
        my -= 14

    y = min(y - LOGO_H - 8, my - 8)
    hline(y); y -= 22

    # ── BILL TO (left) + FROM (right) ────────────────────────────────────────
    COL_MID = ML + (MR - ML) * 0.52
    bill_y = y; from_y = y

    txt(ML, bill_y, "To", sz=7, fn="Helvetica-Bold", col=GRAY2);              bill_y -= 13
    txt(ML, bill_y, q.customer_name, sz=10, fn="Helvetica-Bold");             bill_y -= 13
    for line in (q.customer_address or "").split("\n"):
        if line.strip(): txt(ML, bill_y, line.strip(), sz=8.5, col=GRAY1);    bill_y -= 11
    if q.customer_gstin:
        txt(ML, bill_y, f"GSTIN: {q.customer_gstin}", sz=8.5, col=GRAY1);    bill_y -= 11
    contact = "  ·  ".join(filter(None, [q.customer_email, q.customer_phone]))
    if contact: txt(ML, bill_y, contact, sz=8.5, col=GRAY1);                  bill_y -= 11

    txt(COL_MID, from_y, "FROM", sz=7, fn="Helvetica-Bold", col=GRAY2);      from_y -= 13
    txt(COL_MID, from_y, co_name, sz=10, fn="Helvetica-Bold");                from_y -= 13
    co_lines = [l.strip() for l in (co_addr or "").split("\n") if l.strip()]
    if co_gstin:   co_lines.append(f"GSTIN: {co_gstin}")
    if co_email:   co_lines.append(co_email)
    if co_phone:   co_lines.append(co_phone)
    if co_website: co_lines.append(co_website)
    for d in co_lines:
        txt(COL_MID, from_y, d, sz=8.5, col=GRAY1); from_y -= 11

    y = min(bill_y, from_y) - 18
    hline(y); y -= 16

    # ── MESSAGE (below customer details, above table) ─────────────────────────
    msg = getattr(q, 'message', '') or ''
    if msg.strip():
        msg_lines = [l for l in msg.strip().split("\n") if l.strip()]
        txt(ML, y, "Message", sz=8, fn="Helvetica-Bold", col=GRAY1)
        for line in msg_lines:
            txt(ML + 70, y, line.strip(), sz=9, col=BLACK)
            y -= 13
        y -= 8
        hline(y); y -= 16

    # ── TABLE ────────────────────────────────────────────────────────────────
    # Row geometry (ReportLab Y goes UP from bottom of page):
    #   y        = top of current row
    #   y - ROW_H = bottom of current row  (separator drawn here)
    #   text baseline = vertically centred: y - (ROW_H/2) - 3
    ROW_H      = 28   # normal row height (pt)
    ROW_H_NOTE = 42   # tall row height when a note sub-line is present
    # Vertical centering: for a 9pt font, cap-height ~6pt → baseline = mid - 3
    ROW_TEXT_OFFSET  = ROW_H // 2 - 3       # main text: 11pt from top → centred
    NOTE_TEXT_OFFSET = ROW_H_NOTE // 2 - 8  # main text in tall row: upper half
    NOTE_OFFSET      = ROW_H_NOTE // 2 + 4  # sub-note text: lower half

    usable = MR - ML
    col_pcts = [0.06, 0.46, 0.10, 0.09, 0.15, 0.14]
    cw = [usable * p for p in col_pcts]
    # Fixed column left-edges — computed once, used everywhere
    col_x = []
    _xp = ML
    for _w in cw:
        col_x.append(_xp)
        _xp += _w

    hdrs       = ["#", "Description", "Qty", "Unit", "Unit Price", "Amount"]
    hdr_aligns = ["center", "left",  "right","right","right",      "right"]

    HDR_H = 26  # header row height

    def draw_table_header(top_y):
        """Draw the grey header row; top_y is the top edge of the header."""
        c.setFillColor(GRAY3); c.setStrokeColor(GRAY3)
        c.rect(ML, top_y - HDR_H, usable, HDR_H, fill=1, stroke=0)
        for i, (h, w, ha) in enumerate(zip(hdrs, cw, hdr_aligns)):
            cx = col_x[i]
            if   ha == "center": hx = cx + w / 2
            elif ha == "left":   hx = cx + 5
            else:                hx = cx + w - 6
            # vertically centre header text too
            txt(hx, top_y - HDR_H // 2 - 3, h, sz=7.5, fn="Helvetica-Bold", col=GRAY1, align=ha)
        hline(top_y,           w=0.5, col=GRAY2)
        hline(top_y - HDR_H,  w=0.5, col=GRAY2)
        return top_y - HDR_H   # y now = top of first data row

    y = draw_table_header(y)

    for idx, item in enumerate(items):
        desc   = str(item.get("desc") or item.get("description") or "")
        notes  = str(item.get("notes", ""))
        qty    = item.get("qty", item.get("quantity", 1))
        unit   = str(item.get("unit", "pcs"))
        uprice = float(item.get("unit_price", 0))
        amount = float(item.get("amount", 0))
        rh     = ROW_H_NOTE if notes else ROW_H

        # ── page break BEFORE drawing ─────────────────────────────────────
        if y - rh < MB + 110:
            draw_footer()
            c.showPage()
            y = MT - 20
            y = draw_table_header(y)

        # ── separator line FIRST (so background rect never covers it) ─────
        hline(y - rh, x0=ML, x1=MR, w=0.3, col=GRAY2)

        # ── alternating row background (no stroke so it never bleeds) ─────
        if idx % 2 == 1:
            c.setFillColor(GRAY3)
            c.rect(ML, y - rh, usable, rh, fill=1, stroke=0)

        # ── cell content ──────────────────────────────────────────────────
        text_y = y - (ROW_TEXT_OFFSET if not notes else NOTE_TEXT_OFFSET)
        note_y = y - NOTE_OFFSET

        for i, w in enumerate(cw):
            cx = col_x[i]
            if i == 0:
                txt(cx + w / 2, text_y, str(idx + 1), sz=9, align="center")
            elif i == 1:
                txt(cx + 5, text_y, desc[:65], sz=9, fn="Helvetica-Bold")
                if notes:
                    txt(cx + 5, note_y, notes[:85], sz=7.5, col=GRAY1)
            elif i == 2:
                txt(cx + w - 6, text_y, str(qty),  sz=9, align="right")
            elif i == 3:
                txt(cx + w - 6, text_y, unit,       sz=9, col=GRAY1, align="right")
            elif i == 4:
                mtxt(cx + w - 6, text_y, uprice,    sz=9)
            elif i == 5:
                mtxt(cx + w - 6, text_y, amount,    sz=9)

        y -= rh

    # thick closing rule
    hline(y, x0=ML, x1=MR, w=0.8, col=GRAY2)
    y -= 20

    # ── TOTALS ───────────────────────────────────────────────────────────────
    tx = MR - 210

    def trow(lbl, val_num, bold=False, large=False):
        sz = 11 if large else 9
        fn = "Helvetica-Bold" if bold else "Helvetica"
        txt(tx, y, lbl, sz=sz, fn=fn, col=BLACK if bold else GRAY1)
        mtxt(MR, y, val_num, sz=sz, bold=bold, col=BLACK)

    trow("Subtotal", q.subtotal);                y -= 16
    if (q.discount_pct or 0) > 0:
        trow(f"Discount ({int(q.discount_pct)}%)", q.discount_amt); y -= 16
    trow(f"GST ({int(q.tax_pct)}%)", q.tax_amt); y -= 10
    hline(y, x0=tx, w=0.5, col=GRAY2);           y -= 16
    trow("Total", q.total, bold=True, large=True); y -= 30

    # ── TERMS & CONDITIONS ────────────────────────────────────────────────────
    has_tc_extras = any(getattr(q, f, '') for f in
        ['delivery_time', 'payment_terms', 'pan_no', 'packing_cost', 'bank_details', 'notes'])

    if q.terms or has_tc_extras:
        # Estimate height needed for T&C block so we don't split it awkwardly
        # Each field = ~16 pt; header = 38 pt overhead; footer needs 100 pt
        tc_field_count = sum(1 for f in ['delivery_time','payment_terms','pan_no',
                                          'packing_cost','bank_details','notes']
                             if getattr(q, f, ''))
        if q.terms:
            tc_field_count += len([l for l in q.terms.split("\n") if l.strip()])
        tc_height_needed = 38 + tc_field_count * 16 + 100  # 100 = footer clearance

        # If the whole block won't fit, push to next page
        if y - tc_height_needed < MB:
            draw_footer()
            c.showPage()
            y = MT - 40

        y -= 8
        hline(y, w=0.8, col=colors.HexColor("#6e6e73")); y -= 20
        txt(ML, y, "TERMS & CONDITIONS", sz=8, fn="Helvetica-Bold", col=BLACK)
        y -= 18

        def tc_kv(key, val):
            nonlocal y
            if not val or not str(val).strip(): return
            if y < MB + 100:
                draw_footer(); c.showPage(); y = MT - 40
            field_lines = [l for l in str(val).strip().split("\n") if l.strip()]
            txt(ML, y, f"{key}:", sz=8.5, fn="Helvetica-Bold", col=GRAY1)
            for i, line in enumerate(field_lines):
                txt(VALUE_X, y, line.strip(), sz=8.5, col=GRAY1)
                if i < len(field_lines) - 1: y -= 13
            y -= 16

        if getattr(q, 'delivery_time', ''): tc_kv("Delivery Time",  q.delivery_time)
        if getattr(q, 'payment_terms',  ''): tc_kv("Payment Terms",  q.payment_terms)
        if getattr(q, 'pan_no',         ''): tc_kv("PAN No",         q.pan_no)
        if getattr(q, 'packing_cost',   ''): tc_kv("Packing Cost",   q.packing_cost)
        if getattr(q, 'bank_details',   ''): tc_kv("Bank Details",   q.bank_details)
        if getattr(q, 'notes',          ''): tc_kv("Notes",           q.notes)

        if q.terms:
            for line in q.terms.split("\n"):
                if line.strip():
                    txt(ML, y, line.strip(), sz=8.5, col=GRAY1); y -= 13

    # ── FOOTER + SIGNATURE on final page ─────────────────────────────────────
    draw_footer(last_page=True)
    c.save()


# ─────────────────────────────────────────────────────────────────────────────
def customer_dict(c, db):
    job_count = db.query(Job).filter(Job.customer_id == c.id).count()
    on_time = db.query(Job).filter(
        Job.customer_id == c.id, Job.status == "completed",
        Job.completed_at <= Job.due_date
    ).count()
    late = db.query(Job).filter(
        Job.customer_id == c.id, Job.status == "completed",
        Job.completed_at > Job.due_date
    ).count()
    revenue = sum(j.total_price or 0 for j in db.query(Job).filter(Job.customer_id == c.id).all())
    return {"id": c.id, "name": c.name, "phone": c.phone,
            "contact_person": c.contact_person, "notes": c.notes,
            "address": c.address or "", "gstin": c.gstin or "",
            "email": c.email or "",
            "is_active": c.is_active, "job_count": job_count,
            "on_time_count": on_time, "late_count": late,
            "total_revenue": round(revenue, 2)}

@app.get("/api/customers")
def list_customers():
    db = SessionLocal()
    cs = db.query(Customer).filter(Customer.is_active == True).order_by(Customer.name).all()
    result = [customer_dict(c, db) for c in cs]; db.close(); return result

@app.get("/api/customers/{customer_id}")
def get_customer(customer_id: int):
    db = SessionLocal()
    c = db.query(Customer).filter(Customer.id == customer_id).first()
    if not c: raise HTTPException(404, "Not found")
    data = customer_dict(c, db)
    fmt = lambda dt: dt.isoformat() if dt else None
    jobs = db.query(Job).filter(Job.customer_id == customer_id).order_by(Job.created_at.desc()).all()
    data["jobs"] = [{"id": j.id, "job_number": j.job_number, "product_type": j.product_type,
                     "product_size": j.product_size, "due_date": fmt(j.due_date),
                     "status": j.status, "total_price": j.total_price,
                     "completed_at": fmt(j.completed_at)} for j in jobs]
    db.close(); return data

@app.post("/api/customers")
def create_customer(data: dict):
    db = SessionLocal()
    name = (data.get("name") or "").strip()
    if not name: raise HTTPException(400, "Name required")
    if db.query(Customer).filter(Customer.name == name).first():
        raise HTTPException(400, f"Customer '{name}' already exists")
    c = Customer(name=name, phone=data.get("phone","").strip(),
                 contact_person=data.get("contact_person","").strip(),
                 address=data.get("address","").strip(),
                 gstin=data.get("gstin","").strip(),
                 email=data.get("email","").strip(),
                 notes=data.get("notes","").strip(), is_active=True)
    db.add(c); db.commit(); db.refresh(c)
    result = customer_dict(c, db); db.close(); return result

@app.put("/api/customers/{customer_id}")
def update_customer(customer_id: int, data: dict):
    db = SessionLocal()
    c = db.query(Customer).filter(Customer.id == customer_id).first()
    if not c: raise HTTPException(404, "Not found")
    if "name" in data and data["name"].strip() != c.name:
        new_name = data["name"].strip()
        if db.query(Customer).filter(Customer.name == new_name, Customer.id != customer_id).first():
            raise HTTPException(400, f"Customer '{new_name}' already exists")
        db.query(Job).filter(Job.customer_id == customer_id).update({"customer_name": new_name})
        c.name = new_name
    c.phone = data.get("phone", c.phone)
    c.contact_person = data.get("contact_person", c.contact_person)
    c.address = data.get("address", c.address)
    c.gstin = data.get("gstin", c.gstin)
    c.email = data.get("email", c.email)
    c.notes = data.get("notes", c.notes)
    if "is_active" in data: c.is_active = data["is_active"]
    db.commit(); result = customer_dict(c, db); db.close(); return result

@app.delete("/api/customers/{customer_id}")
def delete_customer(customer_id: int):
    db = SessionLocal()
    c = db.query(Customer).filter(Customer.id == customer_id).first()
    if not c: raise HTTPException(404, "Not found")
    job_count = db.query(Job).filter(Job.customer_id == customer_id).count()
    if job_count > 0:
        c.is_active = False; db.commit(); db.close()
        return {"ok": True, "soft_deleted": True, "job_count": job_count}
    db.delete(c); db.commit(); db.close()
    return {"ok": True, "soft_deleted": False}

# ─────────────────────────────────────────────────────────────────────────────
# ROUTINGS
# ─────────────────────────────────────────────────────────────────────────────
def sub_op_dict(s):
    """Serialize a SubOperation row."""
    return {
        "id":           s.id,
        "sequence":     s.sequence,
        "name":         s.name,
        "formula_type": s.formula_type,
        "mrr":          s.mrr,
        "depth_mm":     s.depth_mm,
        "feed_rate":    getattr(s, 'feed_rate', None),
        "dim_x_source": s.dim_x_source,
        "dim_y_source": s.dim_y_source,
        "work_time_mins": s.work_time_mins or 0,
        "work_time_hrs":  s.work_time_hrs or 0,
        "is_optional":  s.is_optional,
    }


def routing_dict(r, db=None):
    ops = []
    for o in r.operations:
        subs = sorted(o.sub_operations, key=lambda s: s.sequence) if o.sub_operations else []
        # If sub-ops exist, work_time_mins on parent = sum of included sub-ops
        if subs:
            sub_total_mins = sum(s.work_time_mins or 0 for s in subs if not s.is_optional)
            w_mins = sub_total_mins
            w_hrs  = w_mins / 60.0
        else:
            w_mins = o.work_time_mins if o.work_time_mins else round((o.work_time_hrs or 0) * 60, 1)
            w_hrs  = o.work_time_hrs or 0
        ops.append({
            "id": o.id, "sequence": o.sequence, "name": o.name,
            "work_center_id": o.work_center_id,
            "work_center_name": o.work_center.name if o.work_center else "",
            "machine_type": o.work_center.machine_type if o.work_center else "",
            "machine_setup_mins": o.machine_setup_mins,
            "job_setup_mins": o.job_setup_mins,
            "setup_time_mins": o.setup_time_mins,
            "work_time_hrs": w_hrs,
            "work_time_mins": w_mins,
            "is_optional": o.is_optional,
            "op_type":             getattr(o, "op_type", "inhouse") or "inhouse",
            "outside_vendor":      getattr(o, "outside_vendor", None) or "",
            "outside_transit_days": getattr(o, "outside_transit_days", None),
            "formula_type":  o.formula_type,
            "mrr":           o.mrr,
            "depth_mm":      o.depth_mm,
            "feed_rate":     getattr(o, 'feed_rate', None),
            "dim_x_source":  o.dim_x_source,
            "dim_y_source":  o.dim_y_source,
            "sub_operations": [sub_op_dict(s) for s in subs],
        })
    total_hrs = sum((o.machine_setup_mins + o.job_setup_mins) / 60 + o.work_time_hrs
                    for o in r.operations)
    res = {"id": r.id, "name": r.name, "product_type": r.product_type,
           "description": r.description, "material_lead_days": r.material_lead_days,
           "is_active": r.is_active,
           "is_custom": bool(getattr(r, "is_custom", False)),
           "operations": ops,
           "operation_count": len(ops),
           "total_estimated_hours": round(total_hrs, 2)}
    if db:
        res["job_count"] = db.query(Job).filter(Job.routing_id == r.id).count()
        res["active_job_count"] = db.query(Job).filter(
            Job.routing_id == r.id,
            Job.status.in_(["pending","scheduled","in_progress"])
        ).count()
    return res

@app.get("/api/routings")
def list_routings(include_inactive: bool = False, include_custom: bool = False):
    db = SessionLocal()
    q = db.query(Routing)
    if not include_inactive: q = q.filter(Routing.is_active == True)
    # Custom per-job routings (created when the user defines ops inline) are
    # hidden from the Routings list by default — they're not reusable templates.
    if not include_custom:
        q = q.filter((Routing.is_custom == False) | (Routing.is_custom == None))
    rs = q.order_by(Routing.product_type, Routing.name).all()
    result = [routing_dict(r, db) for r in rs]; db.close(); return result

@app.get("/api/routings/{rid}")
def get_routing(rid: int):
    db = SessionLocal()
    r = db.query(Routing).filter(Routing.id == rid).first()
    if not r: raise HTTPException(404, "Not found")
    result = routing_dict(r, db); db.close(); return result

def _save_sub_ops(db, operation_id, sub_ops_data):
    """Delete existing sub-ops for this operation and recreate from data."""
    db.query(SubOperation).filter(SubOperation.operation_id == operation_id).delete()
    for i, s in enumerate(sub_ops_data):
        name = (s.get("name") or "").strip()
        if not name:
            continue
        w_mins = float(s.get("work_time_mins") or 0)
        db.add(SubOperation(
            operation_id = operation_id,
            sequence     = i + 1,
            name         = name,
            formula_type = s.get("formula_type") or None,
            mrr          = float(s["mrr"])        if s.get("mrr")        else None,
            depth_mm     = float(s["depth_mm"])   if s.get("depth_mm")   else None,
            feed_rate    = float(s["feed_rate"])   if s.get("feed_rate")  else None,
            dim_x_source = s.get("dim_x_source")  or None,
            dim_y_source = s.get("dim_y_source")  or None,
            work_time_mins = w_mins,
            work_time_hrs  = w_mins / 60.0,
            is_optional  = bool(s.get("is_optional", False)),
        ))


@app.post("/api/routings")
def create_routing(data: dict):
    db = SessionLocal()
    name  = (data.get("name") or "").strip()
    ptype = (data.get("product_type") or "").strip().title()
    if not name:  raise HTTPException(400, "Name required")
    if not ptype: raise HTTPException(400, "Product type required")
    # BUG-FIX #4: always set is_active explicitly
    r = Routing(name=name, product_type=ptype,
                description=(data.get("description") or "").strip() or None,
                material_lead_days=float(data.get("material_lead_days", 2.0)),
                is_active=bool(data.get("is_active", True)))
    db.add(r); db.flush()
    for i, op in enumerate(data.get("operations", [])):
        wc_id_raw = op.get("work_center_id")
        op_type_here = op.get("op_type", "inhouse") or "inhouse"
        if not wc_id_raw and op_type_here == "outside":
            # Outside ops don't need a real machine — use first available as FK placeholder
            first_wc = db.query(WorkCenter).first()
            wc_id = first_wc.id if first_wc else None
            if not wc_id:
                db.rollback(); db.close()
                raise HTTPException(400, "No machines defined — add at least one machine first")
        else:
            wc_id = int(wc_id_raw) if wc_id_raw else None
            if wc_id and not db.query(WorkCenter).filter(WorkCenter.id == wc_id).first():
                db.rollback(); db.close()
                raise HTTPException(400, f"Step {i+1}: machine {wc_id} not found")
            if not wc_id and op_type_here != "outside":
                db.rollback(); db.close()
                raise HTTPException(400, f"Step {i+1}: machine required for in-house operations")
        m_s = float(op.get("machine_setup_mins", op.get("setup_time_mins", 0)) or 0)
        j_s = float(op.get("job_setup_mins", 0) or 0)
        # Accept work_time_mins (preferred) or work_time_hrs (legacy)
        if op.get("work_time_mins") is not None and float(op.get("work_time_mins",0)) > 0:
            w_mins = float(op["work_time_mins"])
            w_hrs  = w_mins / 60.0
        else:
            w_hrs  = float(op.get("work_time_hrs", 0) or 0)
            w_mins = round(w_hrs * 60, 1)
        op_type = op.get("op_type", "inhouse") or "inhouse"
        # For outside ops, work_time_hrs is already transit_days*24 from frontend
        # Store transit_days separately for display purposes
        transit_days = float(op["outside_transit_days"]) if op.get("outside_transit_days") else (
            round(w_hrs / 24.0, 1) if op_type == "outside" and w_hrs > 0 else None
        )
        new_op = Operation(routing_id=r.id, sequence=i+1,
                            name=(op.get("name") or "").strip(),
                            work_center_id=wc_id,
                            machine_setup_mins=m_s if op_type != "outside" else 0,
                            job_setup_mins=j_s if op_type != "outside" else 0,
                            setup_time_mins=(m_s+j_s) if op_type != "outside" else 0,
                            work_time_hrs=w_hrs, work_time_mins=w_mins,
                            is_optional=bool(op.get("is_optional", False)),
                            op_type=op_type,
                            outside_vendor=op.get("outside_vendor") or None,
                            outside_transit_days=transit_days,
                            formula_type=op.get("formula_type") or None,
                            mrr=float(op["mrr"]) if op.get("mrr") else None,
                            depth_mm=float(op["depth_mm"]) if op.get("depth_mm") else None,
                            feed_rate=float(op["feed_rate"]) if op.get("feed_rate") else None,
                            dim_x_source=op.get("dim_x_source") or None,
                            dim_y_source=op.get("dim_y_source") or None,
                            )
        db.add(new_op); db.flush()
        _save_sub_ops(db, new_op.id, op.get("sub_operations") or [])
    db.commit(); db.refresh(r)
    result = routing_dict(r, db); db.close(); return result

@app.put("/api/routings/{rid}")
def update_routing(rid: int, data: dict):
    db = SessionLocal()
    r = db.query(Routing).filter(Routing.id == rid).first()
    if not r: raise HTTPException(404, "Not found")
    active_jobs = db.query(Job).filter(
        Job.routing_id == rid,
        Job.status.in_(["pending","scheduled","in_progress"])
    ).count()
    if active_jobs > 0:
        db.close()
        raise HTTPException(400,
            f"Cannot edit: {active_jobs} active job(s) use this routing. Duplicate and edit the copy.")
    r.name = (data.get("name") or r.name).strip()
    r.product_type = (data.get("product_type") or r.product_type).strip().title()
    r.description = (data.get("description") if "description" in data else r.description) or None
    if "material_lead_days" in data: r.material_lead_days = float(data["material_lead_days"])
    if "is_active" in data: r.is_active = bool(data["is_active"])
    if "operations" in data:
        for op in list(r.operations): db.delete(op)
        db.flush()
        for i, op in enumerate(data["operations"]):
            wc_id_raw = op.get("work_center_id")
            op_type_here = op.get("op_type", "inhouse") or "inhouse"
            if not wc_id_raw and op_type_here == "outside":
                # Outside ops don't need a real machine — use first available as FK placeholder
                first_wc = db.query(WorkCenter).first()
                wc_id = first_wc.id if first_wc else None
                if not wc_id:
                    db.rollback(); db.close()
                    raise HTTPException(400, "No machines defined — add at least one machine first")
            else:
                wc_id = int(wc_id_raw) if wc_id_raw else None
                if wc_id and not db.query(WorkCenter).filter(WorkCenter.id == wc_id).first():
                    db.rollback(); db.close()
                    raise HTTPException(400, f"Step {i+1}: machine {wc_id} not found")
                if not wc_id and op_type_here != "outside":
                    db.rollback(); db.close()
                    raise HTTPException(400, f"Step {i+1}: machine required for in-house operations")
            m_s = float(op.get("machine_setup_mins", op.get("setup_time_mins", 0)) or 0)
            j_s = float(op.get("job_setup_mins", 0) or 0)
            if op.get("work_time_mins") is not None and float(op.get("work_time_mins",0)) > 0:
                w_mins = float(op["work_time_mins"])
                w_hrs  = w_mins / 60.0
            else:
                w_hrs  = float(op.get("work_time_hrs", 0) or 0)
                w_mins = round(w_hrs * 60, 1)
            op_type = op.get("op_type", "inhouse") or "inhouse"
            transit_days = float(op["outside_transit_days"]) if op.get("outside_transit_days") else (
                round(w_hrs / 24.0, 1) if op_type == "outside" and w_hrs > 0 else None
            )
            new_op = Operation(routing_id=r.id, sequence=i+1,
                               name=(op.get("name") or "").strip(),
                               work_center_id=wc_id,
                               machine_setup_mins=m_s if op_type != "outside" else 0,
                               job_setup_mins=j_s if op_type != "outside" else 0,
                               setup_time_mins=(m_s+j_s) if op_type != "outside" else 0,
                               work_time_hrs=w_hrs, work_time_mins=w_mins,
                               is_optional=bool(op.get("is_optional", False)),
                               op_type=op_type,
                               outside_vendor=op.get("outside_vendor") or None,
                               outside_transit_days=transit_days,
                               formula_type=op.get("formula_type") or None,
                               mrr=float(op["mrr"]) if op.get("mrr") else None,
                               depth_mm=float(op["depth_mm"]) if op.get("depth_mm") else None,
                               feed_rate=float(op["feed_rate"]) if op.get("feed_rate") else None,
                               dim_x_source=op.get("dim_x_source") or None,
                               dim_y_source=op.get("dim_y_source") or None,
                               )
            db.add(new_op); db.flush()
            _save_sub_ops(db, new_op.id, op.get("sub_operations") or [])
    db.commit(); result = routing_dict(r, db); db.close(); return result

@app.delete("/api/routings/{rid}")
def delete_routing(rid: int):
    db = SessionLocal()
    r = db.query(Routing).filter(Routing.id == rid).first()
    if not r: raise HTTPException(404, "Not found")
    job_count = db.query(Job).filter(Job.routing_id == rid).count()
    if job_count > 0:
        r.is_active = False; db.commit(); db.close()
        return {"ok": True, "soft_deleted": True, "job_count": job_count}
    db.delete(r); db.commit(); db.close()
    return {"ok": True, "soft_deleted": False}

@app.post("/api/routings/{rid}/duplicate")
def duplicate_routing(rid: int):
    db = SessionLocal()
    r = db.query(Routing).filter(Routing.id == rid).first()
    if not r: raise HTTPException(404, "Not found")
    base = f"{r.name} (Copy)"; new_name = base; n = 2
    while db.query(Routing).filter(Routing.name == new_name,
                                    Routing.product_type == r.product_type).first():
        new_name = f"{base} {n}"; n += 1
    nr = Routing(name=new_name, product_type=r.product_type,
                 description=r.description, material_lead_days=r.material_lead_days,
                 is_active=True)
    db.add(nr); db.flush()
    for op in r.operations:
        new_op = Operation(routing_id=nr.id, sequence=op.sequence, name=op.name,
                         work_center_id=op.work_center_id,
                         machine_setup_mins=op.machine_setup_mins,
                         job_setup_mins=op.job_setup_mins,
                         setup_time_mins=op.setup_time_mins,
                         work_time_hrs=op.work_time_hrs,
                         work_time_mins=op.work_time_mins,
                         is_optional=op.is_optional,
                         op_type=getattr(op, "op_type", "inhouse") or "inhouse",
                         outside_vendor=getattr(op, "outside_vendor", None),
                         outside_transit_days=getattr(op, "outside_transit_days", None),
                         formula_type=op.formula_type,
                         mrr=op.mrr,
                         depth_mm=op.depth_mm,
                         feed_rate=getattr(op, "feed_rate", None),
                         dim_x_source=op.dim_x_source,
                         dim_y_source=op.dim_y_source)
        db.add(new_op); db.flush()
        for s in sorted(op.sub_operations, key=lambda x: x.sequence):
            db.add(SubOperation(operation_id=new_op.id, sequence=s.sequence, name=s.name,
                                 formula_type=s.formula_type, mrr=s.mrr, depth_mm=s.depth_mm,
                                 feed_rate=s.feed_rate, dim_x_source=s.dim_x_source,
                                 dim_y_source=s.dim_y_source, work_time_mins=s.work_time_mins,
                                 work_time_hrs=s.work_time_hrs, is_optional=s.is_optional))
    db.commit(); db.refresh(nr)
    result = {"id": nr.id, "name": nr.name, "msg": f"Duplicated as '{nr.name}'"}
    db.close(); return result

@app.get("/api/routings/stats/all")
def routings_stats_all():
    db = SessionLocal()
    rs = db.query(Routing).filter(Routing.is_active == True).order_by(
        Routing.product_type, Routing.name).all()
    results = []
    for r in rs:
        est_total = sum((op.machine_setup_mins + op.job_setup_mins) / 60 + op.work_time_hrs
                        for op in r.operations)
        completed_jobs = db.query(Job).filter(Job.routing_id == r.id,
                                               Job.status == "completed").all()
        # ── Per-job actual totals ────────────────────────────────────────────
        actual_totals = []
        job_records = []   # [{job_number, completed_at, est_hrs, actual_hrs, sched_start, actual_end}]
        for j in completed_jobs:
            sops = db.query(ScheduledOp).filter(
                ScheduledOp.job_id == j.id,
                ScheduledOp.actual_start.isnot(None),
                ScheduledOp.actual_end.isnot(None),
            ).order_by(ScheduledOp.sequence).all()
            if sops:
                actual_hrs = sum(
                    (s.actual_end - s.actual_start).total_seconds() / 3600 for s in sops
                )
                actual_totals.append(actual_hrs)
                first_sched = min((s.scheduled_start for s in j.scheduled_ops if s.scheduled_start), default=None)
                last_actual  = max((s.actual_end for s in sops), default=None)
                job_records.append({
                    "job_number": j.job_number,
                    "completed_at": j.completed_at.isoformat() if j.completed_at else None,
                    "est_hrs": round(est_total, 2),
                    "actual_hrs": round(actual_hrs, 2),
                    "variance_pct": round((actual_hrs - est_total) / est_total * 100, 1) if est_total > 0 else None,
                    "sched_start": first_sched.isoformat() if first_sched else None,
                    "actual_end":  last_actual.isoformat() if last_actual else None,
                })

        # ── Per-operation actual breakdown ───────────────────────────────────
        op_stats = []
        for op in sorted(r.operations, key=lambda o: o.sequence):
            est_hrs = round((op.machine_setup_mins + op.job_setup_mins) / 60 + op.work_time_hrs, 2)
            # collect all scheduled ops for this operation across completed jobs
            sched_ops = db.query(ScheduledOp).filter(
                ScheduledOp.operation_id == op.id,
                ScheduledOp.actual_start.isnot(None),
                ScheduledOp.actual_end.isnot(None),
            ).all()
            actuals = [(s.actual_end - s.actual_start).total_seconds() / 3600 for s in sched_ops]
            avg_op  = sum(actuals) / len(actuals) if actuals else None
            var_op  = round((avg_op - est_hrs) / est_hrs * 100, 1) if avg_op and est_hrs > 0 else None
            op_stats.append({
                "sequence": op.sequence, "name": op.name,
                "wc_name": op.work_center.name if op.work_center else "",
                "estimated_hours": est_hrs,
                "avg_actual_hours": round(avg_op, 2) if avg_op else None,
                "variance_pct": var_op,
                "sample_count": len(actuals),
            })

        avg_actual = sum(actual_totals) / len(actual_totals) if actual_totals else None
        variance = round(((avg_actual - est_total) / est_total * 100), 1) if avg_actual and est_total > 0 else None
        # confidence: low<3 samples, medium<10, high>=10
        confidence = "none" if not actual_totals else ("low" if len(actual_totals) < 3 else ("medium" if len(actual_totals) < 10 else "high"))
        results.append({
            "id": r.id, "name": r.name, "product_type": r.product_type,
            "estimated_total_hours": round(est_total, 2),
            "avg_actual_total_hours": round(avg_actual, 2) if avg_actual else None,
            "sample_count": len(actual_totals), "variance_pct": variance,
            "confidence": confidence,
            "operations": op_stats,
            "job_history": sorted(job_records, key=lambda x: x["completed_at"] or "", reverse=True)[:20],
        })
    db.close(); return {"routings": results}

# ─────────────────────────────────────────────────────────────────────────────
# PRODUCT SCHEMA  (added in migration 029)
# User-configurable product types, attributes, and values. Replaces the old
# hardcoded defaults. The Schema admin page calls these endpoints.
# ─────────────────────────────────────────────────────────────────────────────

def _pt_dict(pt: "ProductType") -> dict:
    """Serialize a ProductType with all its attributes & values, ordered."""
    return {
        "id": pt.id,
        "name": pt.name,
        "display_order": pt.display_order or 0,
        "is_active": bool(pt.is_active),
        "attributes": [
            {
                "id": a.id,
                "name": a.name,
                "display_order": a.display_order or 0,
                "is_required": bool(a.is_required),
                "is_active": bool(a.is_active),
                "values": [
                    {"id": v.id, "value": v.value,
                     "display_order": v.display_order or 0,
                     "is_active": bool(v.is_active)}
                    for v in sorted(a.values, key=lambda x: (x.display_order or 0, x.id))
                    if v.is_active
                ],
            }
            for a in sorted(pt.attributes, key=lambda x: (x.display_order or 0, x.id))
            if a.is_active
        ],
    }


@app.get("/api/product-schema")
def get_product_schema(user: dict = Depends(require_any)):
    """Full product schema. Used by the Job form to render attribute inputs
    dynamically, and by the Schema admin page to display the editor."""
    db = SessionLocal()
    try:
        pts = (db.query(ProductType)
                 .filter(ProductType.is_active == True)
                 .order_by(ProductType.display_order, ProductType.id)
                 .all())
        return {"product_types": [_pt_dict(p) for p in pts]}
    finally:
        db.close()


@app.post("/api/product-schema/types")
def create_product_type(data: dict, user: dict = Depends(require_any)):
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name required")
    db = SessionLocal()
    try:
        existing = db.query(ProductType).filter(ProductType.name == name).first()
        if existing:
            # Re-activate if it was soft-deleted; otherwise it's a duplicate
            if not existing.is_active:
                existing.is_active = True
                db.commit()
                return _pt_dict(existing)
            raise HTTPException(400, f"Product type '{name}' already exists")
        pt = ProductType(
            name=name,
            display_order=data.get("display_order", 999),
            is_active=True,
        )
        db.add(pt); db.commit(); db.refresh(pt)
        return _pt_dict(pt)
    finally:
        db.close()


@app.put("/api/product-schema/types/{pt_id}")
def update_product_type(pt_id: int, data: dict, user: dict = Depends(require_any)):
    db = SessionLocal()
    try:
        pt = db.query(ProductType).filter(ProductType.id == pt_id).first()
        if not pt:
            raise HTTPException(404, "Product type not found")
        if "name" in data:
            new_name = (data["name"] or "").strip()
            if new_name and new_name != pt.name:
                if db.query(ProductType).filter(ProductType.name == new_name,
                                                ProductType.id != pt_id).first():
                    raise HTTPException(400, f"Product type '{new_name}' already exists")
                pt.name = new_name
        if "display_order" in data:
            pt.display_order = int(data["display_order"] or 0)
        if "is_active" in data:
            pt.is_active = bool(data["is_active"])
        db.commit(); db.refresh(pt)
        return _pt_dict(pt)
    finally:
        db.close()


@app.delete("/api/product-schema/types/{pt_id}")
def delete_product_type(pt_id: int, user: dict = Depends(require_any)):
    """Soft-delete: marks inactive. Hard-delete prevented if any jobs/routings
    reference this product type, to preserve historical records."""
    db = SessionLocal()
    try:
        pt = db.query(ProductType).filter(ProductType.id == pt_id).first()
        if not pt:
            raise HTTPException(404, "Product type not found")
        # Soft-delete by default — keeps cascade simple
        pt.is_active = False
        db.commit()
        return {"ok": True, "soft_deleted": True}
    finally:
        db.close()


@app.post("/api/product-schema/attributes")
def create_attribute(data: dict, user: dict = Depends(require_any)):
    pt_id = data.get("product_type_id")
    name  = (data.get("name") or "").strip()
    if not pt_id or not name:
        raise HTTPException(400, "product_type_id and name required")
    db = SessionLocal()
    try:
        if not db.query(ProductType).filter(ProductType.id == pt_id).first():
            raise HTTPException(404, "Product type not found")
        # Determine display_order if not provided: end of list
        if "display_order" not in data:
            max_order = (db.query(func.max(ProductAttribute.display_order))
                           .filter(ProductAttribute.product_type_id == pt_id).scalar() or 0)
            data["display_order"] = max_order + 1
        a = ProductAttribute(
            product_type_id=pt_id,
            name=name,
            display_order=int(data.get("display_order", 0)),
            is_required=bool(data.get("is_required", False)),
            is_active=True,
        )
        db.add(a); db.commit(); db.refresh(a)
        return {"id": a.id, "name": a.name,
                "display_order": a.display_order,
                "is_required": bool(a.is_required),
                "is_active": True, "values": []}
    finally:
        db.close()


@app.put("/api/product-schema/attributes/{attr_id}")
def update_attribute(attr_id: int, data: dict, user: dict = Depends(require_any)):
    db = SessionLocal()
    try:
        a = db.query(ProductAttribute).filter(ProductAttribute.id == attr_id).first()
        if not a:
            raise HTTPException(404, "Attribute not found")
        if "name" in data:
            new_name = (data["name"] or "").strip()
            if new_name: a.name = new_name
        if "display_order" in data:
            a.display_order = int(data["display_order"] or 0)
        if "is_required" in data:
            a.is_required = bool(data["is_required"])
        if "is_active" in data:
            a.is_active = bool(data["is_active"])
        db.commit(); db.refresh(a)
        return {"id": a.id, "name": a.name,
                "display_order": a.display_order or 0,
                "is_required": bool(a.is_required),
                "is_active": bool(a.is_active)}
    finally:
        db.close()


@app.delete("/api/product-schema/attributes/{attr_id}")
def delete_attribute(attr_id: int, user: dict = Depends(require_any)):
    db = SessionLocal()
    try:
        a = db.query(ProductAttribute).filter(ProductAttribute.id == attr_id).first()
        if not a:
            raise HTTPException(404, "Attribute not found")
        a.is_active = False
        db.commit()
        return {"ok": True, "soft_deleted": True}
    finally:
        db.close()


@app.post("/api/product-schema/values")
def create_value(data: dict, user: dict = Depends(require_any)):
    """Add a new allowed value to an attribute. Also called inline from the
    Job form when the user types a custom value that isn't in the dropdown
    yet — `auto_added: True` is honored as a hint but the behavior is the
    same: if the value already exists (active), return it; if it exists but
    inactive, re-activate; otherwise create new."""
    attr_id = data.get("attribute_id")
    value   = (data.get("value") or "").strip()
    if not attr_id or not value:
        raise HTTPException(400, "attribute_id and value required")
    db = SessionLocal()
    try:
        if not db.query(ProductAttribute).filter(ProductAttribute.id == attr_id).first():
            raise HTTPException(404, "Attribute not found")
        existing = (db.query(ProductAttributeValue)
                      .filter(ProductAttributeValue.attribute_id == attr_id,
                              ProductAttributeValue.value == value).first())
        if existing:
            if not existing.is_active:
                existing.is_active = True
                db.commit()
            return {"id": existing.id, "value": existing.value,
                    "display_order": existing.display_order or 0,
                    "is_active": True}
        if "display_order" not in data:
            max_order = (db.query(func.max(ProductAttributeValue.display_order))
                           .filter(ProductAttributeValue.attribute_id == attr_id).scalar() or 0)
            data["display_order"] = max_order + 1
        v = ProductAttributeValue(
            attribute_id=attr_id,
            value=value,
            display_order=int(data.get("display_order", 0)),
            is_active=True,
        )
        db.add(v); db.commit(); db.refresh(v)
        return {"id": v.id, "value": v.value,
                "display_order": v.display_order or 0,
                "is_active": True}
    finally:
        db.close()


@app.put("/api/product-schema/values/{val_id}")
def update_value(val_id: int, data: dict, user: dict = Depends(require_any)):
    db = SessionLocal()
    try:
        v = db.query(ProductAttributeValue).filter(ProductAttributeValue.id == val_id).first()
        if not v:
            raise HTTPException(404, "Value not found")
        if "value" in data:
            new_val = (data["value"] or "").strip()
            if new_val: v.value = new_val
        if "display_order" in data:
            v.display_order = int(data["display_order"] or 0)
        if "is_active" in data:
            v.is_active = bool(data["is_active"])
        db.commit(); db.refresh(v)
        return {"id": v.id, "value": v.value,
                "display_order": v.display_order or 0,
                "is_active": bool(v.is_active)}
    finally:
        db.close()


@app.delete("/api/product-schema/values/{val_id}")
def delete_value(val_id: int, user: dict = Depends(require_any)):
    db = SessionLocal()
    try:
        v = db.query(ProductAttributeValue).filter(ProductAttributeValue.id == val_id).first()
        if not v:
            raise HTTPException(404, "Value not found")
        v.is_active = False
        db.commit()
        return {"ok": True, "soft_deleted": True}
    finally:
        db.close()


@app.get("/api/product-types")
def list_product_types():
    """LEGACY endpoint kept for backward compat with any code that still
    reads it. Now returns the names from the new schema tables."""
    db = SessionLocal()
    try:
        pts = (db.query(ProductType.name)
                 .filter(ProductType.is_active == True)
                 .order_by(ProductType.display_order, ProductType.id)
                 .all())
        names = [n[0] for n in pts]
        # Also include any product_type strings already in use on routings
        # (defensive, in case schema is missing entries that jobs reference)
        in_use_rows = db.query(Routing.product_type).distinct().all()
        in_use = sorted({r[0] for r in in_use_rows if r[0]})
        return {"product_types": sorted(set(names + in_use)), "in_use": in_use}
    finally:
        db.close()

# ─────────────────────────────────────────────────────────────────────────────
# CUSTOMER ORDERS  (new — quantity model)
# ─────────────────────────────────────────────────────────────────────────────
def order_dict(o, db):
    fmt = lambda dt: dt.isoformat() if dt else None
    pieces = o.jobs
    done    = sum(1 for j in pieces if j.status == "completed")
    inprog  = sum(1 for j in pieces if j.status == "in_progress")
    sched   = sum(1 for j in pieces if j.status == "scheduled")
    finishes = [get_finish(j) for j in pieces if get_finish(j)]
    est_finish = max(finishes).isoformat() if finishes else None
    promise = getattr(o, "promised_date", None) or o.due_date
    # Roll worst piece-health up to the order
    rank = {"late": 3, "at_risk": 2, "unknown": 1, "on_track": 0, None: 0}
    order_health = "unknown"
    projecteds = [getattr(j, "projected_end", None) for j in pieces if getattr(j, "projected_end", None)]
    if pieces:
        worst = max(pieces, key=lambda j: rank.get(getattr(j, "schedule_health", None), 0))
        order_health = getattr(worst, "schedule_health", None) or "unknown"
    proj_finish = max(projecteds).isoformat() if projecteds else est_finish
    return {
        "id": o.id, "order_number": o.order_number,
        "customer_id": o.customer_id, "customer_name": o.customer_name,
        "po_number": getattr(o, 'po_number', None),
        "product_type": o.product_type, "product_size": o.product_size,
        "product_variant": o.product_variant,
        "product_attrs": json.loads(o.product_attrs) if o.product_attrs else None,
        "routing_id": o.routing_id,
        "order_type": getattr(o, 'order_type', 'simple') or 'simple',
        "quantity": o.quantity, "due_date": fmt(o.due_date),
        "promised_date": fmt(promise),
        "material_ready_date": fmt(pieces[0].material_ready_date) if pieces else None,
        "notes": o.notes, "total_price": o.total_price,
        "status": o.status, "created_at": fmt(o.created_at),
        "pieces_done": done, "pieces_inprog": inprog,
        "pieces_scheduled": sched,
        "pieces_pending": o.quantity - done - inprog - sched,
        "est_finish": est_finish,
        "projected_finish": proj_finish,
        "schedule_health": order_health,
        "is_late": bool(proj_finish and promise and
                        max(projecteds) > promise) if projecteds else
                   (bool(est_finish and promise and max(finishes) > promise) if finishes else False),
    }

def piece_dict(j, db):
    fmt = lambda dt: dt.isoformat() if dt else None
    finish = get_finish(j)
    cr = critical_ratio(j, db)
    return {
        "id": j.id, "job_number": j.job_number,
        "piece_number": j.piece_number,
        "status": j.status, "critical_ratio": round(cr, 2),
        "scheduled_finish": fmt(finish),
        "is_late": bool(finish and finish > j.due_date),
        "promised_date": fmt(getattr(j, "promised_date", None) or j.due_date),
        "projected_end": fmt(getattr(j, "projected_end", None) or finish),
        "schedule_health": getattr(j, "schedule_health", None) or "unknown",
        "health_reason": getattr(j, "health_reason", None),
        "ops_total": len(j.scheduled_ops),
        "ops_done":  sum(1 for s in j.scheduled_ops if s.status == "completed"),
        "ops_inprog":sum(1 for s in j.scheduled_ops if s.status == "in_progress"),
    }

@app.get("/api/orders")
def list_orders():
    db = SessionLocal()
    orders = db.query(CustomerOrder).order_by(CustomerOrder.created_at.desc()).all()
    result = [order_dict(o, db) for o in orders]; db.close(); return result

@app.get("/api/orders/{order_id}")
def get_order(order_id: int):
    db = SessionLocal()
    o = db.query(CustomerOrder).filter(CustomerOrder.id == order_id).first()
    if not o: raise HTTPException(404, "Order not found")
    data = order_dict(o, db)
    data["pieces"] = [piece_dict(j, db) for j in o.jobs]
    db.close(); return data

@app.post("/api/orders")
def create_order(data: dict):
    """
    Create a CustomerOrder and auto-generate `quantity` piece Jobs.
    Each piece gets job_number = "{order_number}-P{nn}".
    All pieces share the same routing, due_date, and customer.
    Pure-CR scheduling means urgent smaller orders naturally jump ahead.
    """
    db = SessionLocal()
    # Resolve customer
    customer_id   = data.get("customer_id")
    customer_name = (data.get("customer_name") or "").strip()
    if customer_id:
        c = db.query(Customer).filter(Customer.id == customer_id).first()
        if c: customer_name = c.name
    elif customer_name:
        c = db.query(Customer).filter(Customer.name == customer_name).first()
        if not c:
            c = Customer(name=customer_name, is_active=True)
            db.add(c); db.flush()
        customer_id = c.id
    if not customer_name:
        db.close(); raise HTTPException(400, "Customer name or ID required")

    due_date = parse_dt(data.get("due_date"))
    if not due_date:
        db.close(); raise HTTPException(400, "due_date required")

    quantity = max(1, int(data.get("quantity", 1)))
    routing_id = data.get("routing_id")

    if routing_id:
        r = db.query(Routing).filter(Routing.id == routing_id).first()
        if not r:
            db.close(); raise HTTPException(400, "Routing not found")
    # Assembly orders don't require a routing (components have their own routings)

    order_num = next_order_number(db)
    attrs_raw = data.get("product_attrs") or {}
    if isinstance(attrs_raw, str):
        try: attrs_raw = json.loads(attrs_raw)
        except (ValueError, TypeError): attrs_raw = {}
    if not isinstance(attrs_raw, dict): attrs_raw = {}
    order = CustomerOrder(
        order_number  = order_num,
        customer_id   = customer_id,
        customer_name = customer_name,
        product_type  = data.get("product_type", ""),
        product_size  = data.get("product_size", ""),
        product_variant = data.get("product_variant", ""),
        product_attrs = json.dumps(attrs_raw) if attrs_raw else None,
        routing_id    = routing_id,
        order_type    = data.get("order_type", "simple"),
        inline_ops    = json.dumps(data.get("inline_ops", [])) if data.get("inline_ops") else None,
        quantity      = quantity,
        due_date      = due_date,
        promised_date = parse_dt(data.get("promised_date")) or due_date,
        notes         = data.get("notes", ""),
        total_price   = float(data["total_price"]) if data.get("total_price") else None,
        status        = "pending",
    )
    db.add(order); db.flush()

    # Generate piece jobs — each is an independent schedulable unit
    # Assembly orders with no routing skip job generation (components create their own jobs)
    piece_price      = (order.total_price / quantity) if order.total_price else None
    op_overrides     = json.dumps(data.get("op_overrides", [])) if data.get("op_overrides") else None
    material_ready   = parse_dt(data.get("material_ready_date"))
    if not routing_id and order.order_type == "assembly":
        db.commit(); db.refresh(order)
        result = order_dict(order, db); db.close(); return result
    for i in range(1, quantity + 1):
        job_num = next_job_number(db)
        j = Job(
            job_number          = job_num,
            customer_id         = customer_id,
            customer_name       = customer_name,
            po_number           = data.get("po_number", ""),
            product_type        = order.product_type,
            product_size        = order.product_size or "",
            product_variant     = order.product_variant or "",
            product_attrs       = order.product_attrs,
            due_date            = due_date,
            promised_date       = order.promised_date or due_date,
            material_ready_date = material_ready,
            routing_id          = routing_id,
            inline_ops          = order.inline_ops,
            priority_flag       = bool(data.get("priority_flag", False)),
            notes               = f"Piece {i}/{quantity} of {order_num}",
            total_price         = piece_price,
            order_id            = order.id,
            piece_number        = i,
            status              = "pending",
            op_overrides        = op_overrides,
        )
        db.add(j)

    db.commit(); db.refresh(order)
    result = order_dict(order, db); db.close(); return result

@app.put("/api/orders/{order_id}")
def update_order(order_id: int, data: dict):
    db = SessionLocal()
    o = db.query(CustomerOrder).filter(CustomerOrder.id == order_id).first()
    if not o: raise HTTPException(404, "Order not found")

    # Customer
    if "customer_id" in data and data["customer_id"]:
        o.customer_id = int(data["customer_id"])
    if "customer_name" in data and data["customer_name"]:
        o.customer_name = data["customer_name"]
        for j in o.jobs: j.customer_name = data["customer_name"]

    # Product
    if "product_type"    in data: o.product_type    = data["product_type"]
    if "product_size"    in data: o.product_size    = data["product_size"]
    if "product_variant" in data: o.product_variant = data["product_variant"]
    if "product_attrs"   in data:
        attrs_raw = data["product_attrs"] or {}
        if isinstance(attrs_raw, str):
            try: attrs_raw = json.loads(attrs_raw)
            except (ValueError, TypeError): attrs_raw = {}
        if not isinstance(attrs_raw, dict): attrs_raw = {}
        o.product_attrs = json.dumps(attrs_raw) if attrs_raw else None
    if "routing_id"      in data and data["routing_id"]:
        o.routing_id = int(data["routing_id"])
        for j in o.jobs: j.routing_id = int(data["routing_id"])

    # PO / price / notes
    if "po_number"    in data: o.notes = o.notes  # keep notes separate
    if "notes"        in data: o.notes = data["notes"]
    if "total_price"  in data: o.total_price = float(data["total_price"]) if data["total_price"] else None

    # Dates — propagate to piece jobs too
    if "due_date" in data:
        new_due = parse_dt(data["due_date"])
        if new_due:
            o.due_date = new_due
            for j in o.jobs: j.due_date = new_due

    if "material_ready_date" in data:
        mat = parse_dt(data["material_ready_date"])
        for j in o.jobs: j.material_ready_date = mat

    if "priority_flag" in data:
        for j in o.jobs: j.priority_flag = bool(data["priority_flag"])

    # Apply op_overrides to all pending/scheduled piece jobs
    if data.get("op_overrides"):
        import json as _json
        ovs_json = _json.dumps(data["op_overrides"])
        for j in o.jobs:
            if j.status not in ("completed", "in_progress"):
                j.op_overrides = ovs_json

    db.commit(); result = order_dict(o, db); db.close(); return result

@app.delete("/api/orders/{order_id}")
def delete_order(order_id: int):
    db = SessionLocal()
    o = db.query(CustomerOrder).filter(CustomerOrder.id == order_id).first()
    if not o: raise HTTPException(404, "Order not found")
    active = [j for j in o.jobs if j.status in ("in_progress",)]
    if active:
        db.close()
        raise HTTPException(400, f"{len(active)} piece(s) in progress — cannot delete")
    db.delete(o); db.commit(); db.close()   # cascade deletes piece jobs
    return {"ok": True}

@app.post("/api/orders/{order_id}/schedule")
def schedule_order(order_id: int):
    db = SessionLocal()
    o = db.query(CustomerOrder).filter(CustomerOrder.id == order_id).first()
    if not o: raise HTTPException(404, "Order not found")
    scheduled = failed = 0
    for j in o.jobs:
        if j.status in ("completed", "in_progress"):
            continue
        try:
            if _do_schedule(db, j):
                scheduled += 1
            else:
                failed += 1
        except Exception as e:
            failed += 1
    _update_order_status(db, order_id)
    db.close()
    return {"scheduled": scheduled, "failed": failed, "order": order_id}

@app.get("/api/orders/{order_id}/progress")
def order_progress(order_id: int):
    db = SessionLocal()
    o = db.query(CustomerOrder).filter(CustomerOrder.id == order_id).first()
    if not o: raise HTTPException(404, "Order not found")
    pieces = [piece_dict(j, db) for j in o.jobs]
    db.close()
    return {"order_id": order_id, "order_number": o.order_number,
            "quantity": o.quantity, "pieces": pieces}

# ─────────────────────────────────────────────────────────────────────────────
# JOBS  (standalone jobs — order_id = null)
# ─────────────────────────────────────────────────────────────────────────────
def job_dict(j, db):
    cr = critical_ratio(j, db); finish = get_finish(j)
    fmt = lambda dt: dt.isoformat() if dt else None
    return {
        "id": j.id, "job_number": j.job_number,
        "customer_name": j.customer_name, "customer_id": j.customer_id,
        "po_number": j.po_number, "total_price": j.total_price,
        "product_type": j.product_type, "product_size": j.product_size,
        "product_variant": j.product_variant,
        "due_date": fmt(j.due_date), "not_before": fmt(j.not_before),
        "material_ready_date": fmt(j.material_ready_date),
        "priority_flag": j.priority_flag, "is_frozen": bool(getattr(j, "is_frozen", False)), "is_on_hold": bool(getattr(j, "is_on_hold", False)), "status": j.status,
        "routing_id": j.routing_id,
        "has_inline_ops": bool(j.inline_ops),
        "inline_ops": json.loads(j.inline_ops) if j.inline_ops else None,
        "notes": j.notes,
        "order_id": j.order_id, "piece_number": j.piece_number,
        "created_at": fmt(j.created_at), "completed_at": fmt(j.completed_at),
        "critical_ratio": round(cr, 2),
        "op_overrides": j.op_overrides or "[]",
        "ops_total": len(j.scheduled_ops),
        "ops_done":   sum(1 for s in j.scheduled_ops if s.status == "completed"),
        "ops_inprog": sum(1 for s in j.scheduled_ops if s.status == "in_progress"),
        "scheduled_finish": fmt(finish),
        "is_late": bool(finish and finish > j.due_date),
        # Flag-and-wait fields
        "promised_date":   fmt(getattr(j, "promised_date", None) or j.due_date),
        "projected_end":   fmt(getattr(j, "projected_end", None) or finish),
        "schedule_health": getattr(j, "schedule_health", None) or "unknown",
        "health_reason":   getattr(j, "health_reason", None),
    }

@app.get("/api/jobs")
def list_jobs(days: int = 90, include_completed: bool = True):
    """FIX 8: Limit job list to recent + active jobs to keep loadAll fast."""
    db = SessionLocal()
    cutoff = now_ist() - timedelta(days=days)
    q = db.query(Job).filter(
        (Job.status != "completed") |
        (Job.completed_at >= cutoff) |
        (Job.created_at  >= cutoff)
    ).order_by(Job.created_at.desc())
    jobs = q.all()
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
         "machine_setup_mins": s.machine_setup_mins, "job_setup_mins": s.job_setup_mins,
         "setup_time_mins": s.setup_time_mins, "work_time_hrs": s.work_time_hrs,
         "machine_setup_waived": s.machine_setup_waived,
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
def create_job(data: dict, request: Request):
    db = SessionLocal()
    provided = (data.get("job_number") or "").strip()
    if provided:
        if db.query(Job).filter(Job.job_number == provided).first():
            db.close(); raise HTTPException(400, f"Job number '{provided}' already exists")
        job_num = provided
    else:
        job_num = next_job_number(db)
    due_date = parse_dt(data.get("due_date"))
    if not due_date:
        db.close(); raise HTTPException(400, "due_date required")
    customer_id = data.get("customer_id")
    customer_name = (data.get("customer_name") or "").strip()
    if customer_id:
        c = db.query(Customer).filter(Customer.id == customer_id).first()
        if c: customer_name = c.name
    elif customer_name:
        c = db.query(Customer).filter(Customer.name == customer_name).first()
        if not c:
            c = Customer(name=customer_name, is_active=True)
            db.add(c); db.flush()
        customer_id = c.id
    if not customer_name:
        db.close(); raise HTTPException(400, "Customer required")

    inline_ops_raw = data.get("inline_ops")

    # ── Product attribute handling ────────────────────────────────────────
    # The form may send `product_attrs` as a dict like {"Type":"Plain",
    # "Mounting":"Upper", "Cavities":"4"}. We:
    #   • store it raw as JSON for future structured access (filtering, etc.)
    #   • derive a human-readable `product_variant` string ("Plain Upper 4-cav")
    #     for the dispatch sheet and other UI surfaces that display variant
    #     as a single string. If the form provided product_variant directly,
    #     that wins (back-compat).
    attrs_raw = data.get("product_attrs") or {}
    if isinstance(attrs_raw, str):
        try: attrs_raw = json.loads(attrs_raw)
        except (ValueError, TypeError): attrs_raw = {}
    if not isinstance(attrs_raw, dict): attrs_raw = {}

    derived_variant = data.get("product_variant", "")
    if not derived_variant and attrs_raw:
        # Build "Plain Upper" style label. Size is excluded since it's
        # already in its own column. Cavities get "-cav" suffix for readability.
        parts = []
        for k, v in attrs_raw.items():
            if not v or k.strip().lower() == "size":
                continue
            v_str = str(v).strip()
            if k.strip().lower() == "cavities":
                parts.append(f"{v_str}-cav")
            else:
                parts.append(v_str)
        derived_variant = " ".join(parts)

    # If size wasn't passed but is in attrs, lift it out
    derived_size = data.get("product_size", "")
    if not derived_size and attrs_raw:
        for k, v in attrs_raw.items():
            if k.strip().lower() == "size" and v:
                derived_size = str(v).strip()
                break

    j = Job(
        job_number=job_num, customer_name=customer_name, customer_id=customer_id,
        po_number=data.get("po_number",""), product_type=data["product_type"],
        product_size=derived_size, product_variant=derived_variant,
        product_attrs=json.dumps(attrs_raw) if attrs_raw else None,
        total_price=float(data["total_price"]) if data.get("total_price") else None,
        due_date=due_date, not_before=parse_dt(data.get("not_before")),
        promised_date=parse_dt(data.get("promised_date")) or due_date,
        material_ready_date=parse_dt(data.get("material_ready_date")),
        routing_id=data.get("routing_id"),
        inline_ops=json.dumps(inline_ops_raw) if inline_ops_raw else None,
        priority_flag=bool(data.get("priority_flag", False)),
        notes=data.get("notes",""),
        op_overrides=json.dumps(data.get("op_overrides",[])),
    )
    db.add(j); db.commit(); db.refresh(j)
    _audit_log(db, request, "job_created", entity_type="job",
                  entity_id=j.id, entity_label=j.job_number,
                  details={"customer": j.customer_name, "product": j.product_type})
    db.commit()
    result = {"id": j.id, "job_number": j.job_number, "status": j.status}
    db.close(); return result

@app.put("/api/jobs/{job_id}")
def update_job(job_id: int, data: dict, request: Request):
    db = SessionLocal()
    j = db.query(Job).filter(Job.id == job_id).first()
    if not j: raise HTTPException(404, "Not found")
    if "customer_id" in data and data["customer_id"]:
        c = db.query(Customer).filter(Customer.id == data["customer_id"]).first()
        if c: j.customer_id = c.id; j.customer_name = c.name
    elif "customer_name" in data and data["customer_name"]:
        name = data["customer_name"].strip()
        c = db.query(Customer).filter(Customer.name == name).first()
        if not c:
            c = Customer(name=name, is_active=True); db.add(c); db.flush()
        j.customer_id = c.id; j.customer_name = name
    dt_fields = {"due_date","not_before","material_ready_date"}
    for k, v in data.items():
        if k in {"customer_id","customer_name"}: continue
        if k in dt_fields: setattr(j, k, parse_dt(v))
        elif k == "op_overrides": j.op_overrides = json.dumps(v)
        elif k == "inline_ops":   j.inline_ops   = json.dumps(v) if v else None
        elif k == "total_price":  j.total_price  = float(v) if v else None
        else:
            try: setattr(j, k, v)
            except: pass
    _audit_log(db, request, "job_updated", entity_type="job",
                  entity_id=j.id, entity_label=j.job_number,
                  details={"fields": [k for k in data.keys() if k not in ("customer_id",)]})
    db.commit()
    result = {"id": j.id, "job_number": j.job_number, "status": j.status}
    db.close(); return result

@app.post("/api/jobs/{job_id}/toggle-freeze")
def toggle_freeze(job_id: int):
    """Toggle is_frozen on a job. Frozen jobs are skipped by schedule-all."""
    db = SessionLocal()
    j = db.query(Job).filter(Job.id == job_id).first()
    if not j: raise HTTPException(404, "Not found")
    j.is_frozen = not bool(getattr(j, 'is_frozen', False))
    db.commit()
    result = {"id": j.id, "job_number": j.job_number, "is_frozen": j.is_frozen}
    db.close(); return result


@app.post("/api/jobs/{job_id}/hold")
def hold_job(job_id: int):
    """
    Put a job on hold — clears scheduled/pending ops and marks is_on_hold=True.
    is_on_hold is separate from is_frozen:
      - is_on_hold: schedule is cleared, job paused until manually released
      - is_frozen:  schedule kept intact, just excluded from Schedule All
    Job stays in DB but disappears from Gantt and Today's Work until unhold.
    """
    db = SessionLocal()
    j = db.query(Job).filter(Job.id == job_id).first()
    if not j: db.close(); raise HTTPException(404, "Not found")
    active = [s for s in j.scheduled_ops if s.status == "in_progress"]
    if active:
        db.close()
        raise HTTPException(400, "Cannot hold a job with an operation in progress — pause it first.")
    for s in list(j.scheduled_ops):
        if s.status in ("scheduled", "pending"):
            db.delete(s)
    j.is_on_hold = True
    j.status     = "pending"
    db.commit(); db.close()
    return {"id": job_id, "status": "pending", "is_on_hold": True}


@app.post("/api/jobs/{job_id}/unhold")
def unhold_job(job_id: int):
    """Remove hold — clears is_on_hold so Schedule All picks it up again."""
    db = SessionLocal()
    j = db.query(Job).filter(Job.id == job_id).first()
    if not j: db.close(); raise HTTPException(404, "Not found")
    j.is_on_hold = False
    db.commit(); db.close()
    return {"id": job_id, "is_on_hold": False}


@app.post("/api/jobs/{job_id}/duplicate")
def duplicate_job(job_id: int):
    db = SessionLocal()
    j = db.query(Job).filter(Job.id == job_id).first()
    if not j: raise HTTPException(404, "Not found")
    new_num = next_job_number(db)
    nj = Job(job_number=new_num, customer_name=j.customer_name, customer_id=j.customer_id,
             po_number=j.po_number, product_type=j.product_type,
             product_size=j.product_size, product_variant=j.product_variant,
             due_date=j.due_date, promised_date=j.promised_date or j.due_date,
             routing_id=j.routing_id,
             inline_ops=j.inline_ops, priority_flag=False,
             status="pending", notes=j.notes, op_overrides=j.op_overrides)
    db.add(nj); db.commit(); db.refresh(nj)
    result = {"id": nj.id, "job_number": nj.job_number}
    db.close(); return result

@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: int, request: Request):
    db = SessionLocal()
    j = db.query(Job).filter(Job.id == job_id).first()
    if not j: raise HTTPException(404, "Not found")
    order_id = j.order_id
    job_number = j.job_number
    _audit_log(db, request, "job_deleted", entity_type="job",
                  entity_id=job_id, entity_label=job_number)
    db.delete(j); db.commit()
    if order_id: _update_order_status(db, order_id)
    db.close(); return {"ok": True}

@app.post("/api/jobs/{job_id}/save-inline-as-routing")
def save_inline_as_routing(job_id: int, data: dict):
    """Save a job's inline_ops as a new reusable Routing and link the job to it."""
    db = SessionLocal()
    j = db.query(Job).filter(Job.id == job_id).first()
    if not j: raise HTTPException(404, "Not found")
    if not j.inline_ops: raise HTTPException(400, "Job has no inline ops")
    raw = json.loads(j.inline_ops)
    name  = (data.get("name") or "").strip()
    ptype = (data.get("product_type") or j.product_type or "").strip().title()
    if not name: raise HTTPException(400, "Routing name required")
    r = Routing(name=name, product_type=ptype,
                description=data.get("description",""),
                material_lead_days=float(data.get("material_lead_days", 2.0)),
                is_active=True)
    db.add(r); db.flush()
    for i, op in enumerate(raw):
        op_type_here = op.get("op_type", "inhouse") or "inhouse"
        wc_id_raw = op.get("work_center_id")
        if not wc_id_raw and op_type_here == "outside":
            first_wc = db.query(WorkCenter).first()
            wc_id = first_wc.id if first_wc else None
            if not wc_id:
                db.rollback(); db.close()
                raise HTTPException(400, "No machines defined — add at least one machine first")
        else:
            wc_id = int(wc_id_raw) if wc_id_raw else None
            if not wc_id:
                db.rollback(); db.close()
                raise HTTPException(400, f"Step {i+1}: machine required for in-house operations")
        m_s = float(op.get("machine_setup_mins", op.get("setup_time_mins", 0)) or 0)
        j_s = float(op.get("job_setup_mins", 0) or 0)
        if op.get("work_time_mins") is not None and float(op.get("work_time_mins", 0)) > 0:
            w_mins = float(op["work_time_mins"])
            w_hrs  = w_mins / 60.0
        else:
            w_hrs  = float(op.get("work_time_hrs", 0) or 0)
            w_mins = round(w_hrs * 60, 1)
        transit_days = float(op["outside_transit_days"]) if op.get("outside_transit_days") else (
            round(w_hrs / 24.0, 1) if op_type_here == "outside" and w_hrs > 0 else None
        )
        new_op = Operation(routing_id=r.id, sequence=i+1,
                         name=(op.get("name") or f"Step {i+1}"),
                         work_center_id=wc_id,
                         machine_setup_mins=m_s if op_type_here != "outside" else 0,
                         job_setup_mins=j_s if op_type_here != "outside" else 0,
                         setup_time_mins=(m_s+j_s) if op_type_here != "outside" else 0,
                         work_time_hrs=w_hrs, work_time_mins=w_mins,
                         is_optional=bool(op.get("is_optional", False)),
                         op_type=op_type_here,
                         outside_vendor=op.get("outside_vendor") or None,
                         outside_transit_days=transit_days,
                         formula_type=op.get("formula_type") or None,
                         mrr=float(op["mrr"]) if op.get("mrr") else None,
                         depth_mm=float(op["depth_mm"]) if op.get("depth_mm") else None,
                         feed_rate=float(op["feed_rate"]) if op.get("feed_rate") else None,
                         dim_x_source=op.get("dim_x_source") or None,
                         dim_y_source=op.get("dim_y_source") or None,
                         )
        db.add(new_op); db.flush()
        _save_sub_ops(db, new_op.id, op.get("sub_operations") or [])
    j.routing_id = r.id
    j.inline_ops = None
    db.commit(); db.refresh(r)
    result = {"routing_id": r.id, "routing_name": r.name,
              "msg": f"Saved as routing '{r.name}' and linked to job"}
    db.close(); return result

# ─────────────────────────────────────────────────────────────────────────────
# SCHEDULING ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/api/schedule/{job_id}")
def schedule_job(job_id: int):
    db = SessionLocal()
    j = db.query(Job).filter(Job.id == job_id).first()
    if not j: raise HTTPException(404, "Not found")
    if getattr(j, 'is_frozen', False):
        raise HTTPException(400, "Job is frozen — unfreeze it first")
    if getattr(j, 'is_on_hold', False):
        raise HTTPException(400, "Job is on hold — release hold first")
    if not j.routing_id and not j.inline_ops:
        raise HTTPException(400, "Job has no routing or inline ops")
    ok = _do_schedule(db, j)
    if ok is not False:
        _refresh_job_health(db, j)
        db.commit()
    if j.order_id: _update_order_status(db, j.order_id)
    db.close()
    if not ok: raise HTTPException(400, "Scheduling failed")
    return {"ok": True}

@app.get("/api/schedule-all/preview")
def schedule_all_preview():
    """Dry-run: count what schedule-all WOULD do without touching anything."""
    db = SessionLocal()
    jobs = db.query(Job).filter(Job.status.in_(["pending", "scheduled"])).all()
    to_schedule = []
    frozen = []
    active_protected = []
    no_routing = []
    for j in jobs:
        if getattr(j, 'is_frozen', False) or getattr(j, 'is_on_hold', False):
            frozen.append({"id": j.id, "job_number": j.job_number,
                           "reason": "frozen" if getattr(j, 'is_frozen', False) else "on hold"})
            continue
        has_active = any(s.status == "in_progress" for s in j.scheduled_ops)
        if has_active:
            active_protected.append({"id": j.id, "job_number": j.job_number})
            continue
        if not j.routing_id and not j.inline_ops:
            no_routing.append({"id": j.id, "job_number": j.job_number})
            continue
        existing_ops = sum(1 for s in j.scheduled_ops if s.status in ("pending", "scheduled"))
        to_schedule.append({
            "id": j.id, "job_number": j.job_number,
            "customer_name": j.customer_name or "",
            "has_existing_schedule": existing_ops > 0,
        })
    db.close()
    return {
        "to_schedule":      to_schedule,
        "frozen":           frozen,
        "active_protected": active_protected,
        "no_routing":       no_routing,
        "total_jobs":       len(jobs),
    }


@app.post("/api/schedule-all")
def schedule_all(request: Request):
    db = SessionLocal()
    jobs = db.query(Job).filter(Job.status.in_(["pending","scheduled"])).all()

    # Sort: most urgent first, then by order+piece_number for consistent piece ordering
    def sort_key(j):
        cr = critical_ratio(j, db)
        return (round(cr, 4), j.order_id or 0, j.piece_number or 0)
    jobs.sort(key=sort_key)

    # ── CRITICAL FIX ──
    # Clear ALL pending/scheduled ops for ALL jobs in the batch BEFORE scheduling
    # any of them.  Without this, job N sees old scheduled ops from jobs N+1..M
    # blocking machines, and ends up scheduled AFTER them even though it should go first.
    has_active = set()
    frozen_set = set()
    for j in jobs:
        if getattr(j, 'is_frozen', False) or getattr(j, 'is_on_hold', False):
            frozen_set.add(j.id)
            continue
        active = any(s.status == "in_progress" for s in j.scheduled_ops)
        if active:
            has_active.add(j.id)
            continue
        for s in list(j.scheduled_ops):
            if s.status in ("pending", "scheduled"):
                db.delete(s)
        j._batch_cleared = True   # signal to _do_schedule not to re-clear
    db.flush()

    count = unassigned = skipped = preempted = 0
    failures = []
    for j in jobs:
        if not j.routing_id and not j.inline_ops:
            continue
        if j.id in frozen_set:
            skipped += 1; continue
        if j.id in has_active:
            skipped += 1; continue
        cr = critical_ratio(j, db)
        # Auto-preemption (pausing an in-progress op to free a worker for an
        # urgent job) is DISABLED by default: in a custom mould/die shop an
        # in-progress cut cannot be paused without scrapping the part. The
        # advisory "preemption alerts" on the dashboard still surface the
        # opportunity for a human to decide — but the scheduler will never
        # auto-pause a running operation. Flip ENABLE_AUTO_PREEMPTION to re-enable.
        if ENABLE_AUTO_PREEMPTION and cr < 0.5:
            for pc in check_preemption(db, j):
                op_to_pause = db.query(ScheduledOp).filter(ScheduledOp.id == pc["op_id"]).first()
                if op_to_pause and op_to_pause.status == "in_progress":
                    op_to_pause.status = "paused"; preempted += 1
        try:
            ok = _do_schedule(db, j)
            if ok is False:
                # No ops to schedule (no routing/inline ops) — not a crash,
                # but the job did NOT get scheduled. Do not count as success.
                failures.append({"job_number": j.job_number, "reason": "no operations defined"})
            else:
                count += 1
                _refresh_job_health(db, j)
        except Exception as e:
            # Real failure (machine down, no qualified worker, no slot in 90d…).
            # Previously this was silently counted as success — now surfaced.
            failures.append({"job_number": j.job_number, "reason": str(e)[:200]})
            j.schedule_health = "unknown"
            j.health_reason   = f"Could not schedule: {str(e)[:120]}"
        for s in j.scheduled_ops:
            if s.worker_id is None and s.scheduled_start is not None:
                unassigned += 1

    order_ids = {j.order_id for j in jobs if j.order_id}
    for oid in order_ids:
        _update_order_status(db, oid)
    # NOTIFY: check urgency and due-soon after full reschedule
    for j in jobs:
        _check_job_urgency(db, j)
    for o in db.query(CustomerOrder).filter(CustomerOrder.status != "completed").all():
        _check_order_due_soon(db, o)
    # ── Audit trail ──
    _audit_log(db, request, "schedule_all", entity_type="system", details={
        "scheduled": count, "skipped": skipped, "frozen": len(frozen_set),
        "failed": len(failures), "unassigned_ops": unassigned,
    })
    # ── Notify each affected worker that their schedule changed ──
    affected_workers = {}  # worker_id → op count
    for j in jobs:
        if j.id in frozen_set or j.id in has_active:
            continue
        for s in j.scheduled_ops:
            if s.worker_id and s.status in ("pending", "scheduled"):
                affected_workers[s.worker_id] = affected_workers.get(s.worker_id, 0) + 1
    user_info = getattr(request.state, 'user', None)
    sched_by = (user_info.get("username") or "system") if user_info else "system"
    for wid, op_count in affected_workers.items():
        _notify_worker(db, wid, "schedule_changed",
                       f"📅 Schedule Updated",
                       f"{op_count} operation(s) rescheduled by {sched_by}",
                       link="/today")
    db.commit()
    db.close()
    return {"scheduled": count, "unassigned_ops": unassigned,
            "skipped_active": skipped, "preempted": preempted,
            "frozen_count": len(frozen_set),
            "failed": len(failures), "failures": failures}

# ── Bulk job operations ────────────────────────────────────────────────────────
@app.post("/api/jobs/bulk-delete")
def bulk_delete_jobs(data: dict):
    ids = [int(i) for i in data.get("ids", [])]
    if not ids: raise HTTPException(400, "No job IDs provided")
    db = SessionLocal()
    deleted = skipped = 0
    affected_orders = set()
    for jid in ids:
        j = db.query(Job).filter(Job.id == jid).first()
        if not j: continue
        if j.status == "in_progress":
            skipped += 1; continue
        if j.order_id: affected_orders.add(j.order_id)
        db.delete(j); deleted += 1
    db.flush()
    for oid in affected_orders:
        _update_order_status(db, oid)
    db.commit(); db.close()
    return {"deleted": deleted, "skipped": skipped}

@app.post("/api/jobs/bulk-schedule")
def bulk_schedule_jobs(data: dict):
    ids = [int(i) for i in data.get("ids", [])]
    if not ids: raise HTTPException(400, "No job IDs provided")
    db = SessionLocal()
    jobs = db.query(Job).filter(Job.id.in_(ids), Job.status.in_(["pending","scheduled"])).all()
    # Clear pending ops before batch scheduling
    for j in jobs:
        active = any(s.status == "in_progress" for s in j.scheduled_ops)
        if not active:
            for s in list(j.scheduled_ops):
                if s.status in ("pending","scheduled"): db.delete(s)
            j._batch_cleared = True
    db.flush()
    count = failed = 0
    failures = []
    for j in jobs:
        try:
            ok = _do_schedule(db, j)
            if ok is False:
                failed += 1
                failures.append({"job_number": j.job_number, "reason": "no operations defined"})
            else:
                count += 1
                _refresh_job_health(db, j)
        except Exception as e:
            failed += 1
            failures.append({"job_number": j.job_number, "reason": str(e)[:200]})
    order_ids = {j.order_id for j in jobs if j.order_id}
    for oid in order_ids: _update_order_status(db, oid)
    db.commit(); db.close()
    return {"scheduled": count, "failed": failed, "failures": failures}

@app.post("/api/orders/bulk-delete")
def bulk_delete_orders(data: dict):
    ids = [int(i) for i in data.get("ids", [])]
    if not ids: raise HTTPException(400, "No order IDs provided")
    db = SessionLocal()
    deleted = skipped = 0
    for oid in ids:
        o = db.query(CustomerOrder).filter(CustomerOrder.id == oid).first()
        if not o: continue
        active = any(j.status == "in_progress" for j in o.jobs)
        if active: skipped += 1; continue
        db.delete(o); deleted += 1
    db.commit(); db.close()
    return {"deleted": deleted, "skipped": skipped}

@app.post("/api/orders/bulk-schedule")
def bulk_schedule_orders(data: dict):
    ids = [int(i) for i in data.get("ids", [])]
    if not ids: raise HTTPException(400, "No order IDs provided")
    db = SessionLocal()
    orders = db.query(CustomerOrder).filter(CustomerOrder.id.in_(ids)).all()
    scheduled = failed = 0
    for o in orders:
        for j in o.jobs:
            if j.status in ("completed","in_progress"): continue
            active = any(s.status=="in_progress" for s in j.scheduled_ops)
            if not active:
                for s in list(j.scheduled_ops):
                    if s.status in ("pending","scheduled"): db.delete(s)
                j._batch_cleared = True
        db.flush()
        for j in o.jobs:
            if j.status in ("completed","in_progress"): continue
            try: _do_schedule(db, j); scheduled += 1
            except: failed += 1
        _update_order_status(db, o.id)
    db.commit(); db.close()
    return {"scheduled": scheduled, "failed": failed}


# ═══════════════════════════════════════════════════════════════════════════════
# ASSEMBLY ORDER ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

def component_dict(comp):
    fmt = lambda d: d.isoformat() if d else None
    return {
        "id":             comp.id,
        "order_id":       comp.order_id,
        "name":           comp.name,
        "component_type": comp.component_type,
        "assembly_step":  comp.assembly_step,
        "quantity":       comp.quantity,
        "notes":          comp.notes or "",
        "routing_id":     comp.routing_id,
        "job_id":         comp.job_id,
        "job_number":     comp.job.job_number if comp.job else None,
        "job_status":     comp.job.status if comp.job else None,
        "routing_name":   comp.routing.name if comp.routing else None,
        "vendor_name":    comp.vendor_name or "",
        "sent_date":      fmt(comp.sent_date),
        "expected_back":  fmt(comp.expected_back),
        "received_date":  fmt(comp.received_date),
        "ordered_date":   fmt(comp.ordered_date),
        "status":         comp.status,
    }

def assembly_step_dict(step):
    fmt = lambda d: d.isoformat() if d else None
    return {
        "id":           step.id,
        "order_id":     step.order_id,
        "step_number":  step.step_number,
        "name":         step.name,
        "description":  step.description or "",
        "est_hours":    step.est_hours,
        "worker_id":    step.worker_id,
        "worker_name":  step.worker_name or "",
        "status":       step.status,
        "started_at":   fmt(step.started_at),
        "completed_at": fmt(step.completed_at),
        "notes":        step.notes or "",
    }

def _check_assembly_step_ready(db, order_id, step_number):
    """
    An assembly step is ready when all components with assembly_step <= step_number
    are in done/received status.
    """
    components = db.query(OrderComponent).filter(
        OrderComponent.order_id == order_id,
        OrderComponent.assembly_step <= step_number
    ).all()
    if not components:
        return True
    return all(c.status in ("done", "received") for c in components)

def _sync_assembly_steps(db, order_id):
    """
    After any component status changes, unlock assembly steps + notify.
    """
    steps = db.query(AssemblyStep).filter(
        AssemblyStep.order_id == order_id,
        AssemblyStep.status == "waiting"
    ).order_by(AssemblyStep.step_number).all()
    order = db.query(CustomerOrder).filter(CustomerOrder.id == order_id).first()
    for step in steps:
        if _check_assembly_step_ready(db, order_id, step.step_number):
            step.status = "ready"
            db.flush()
            order_label = order.order_number if order else f"Order #{order_id}"
            customer    = order.customer_name if order else ""
            _notify(db,
                event_type = "assembly_unlocked",
                title      = f"🔧 Assembly Step {step.step_number} Ready — {order_label}",
                body       = f"{customer}: {step.name} can now start"
                             + (f" — assigned to {step.worker_name}" if step.worker_name else ""),
                link       = f"/orders/{order_id}/assembly",
                order_id   = order_id,
            )
    db.flush()
    # Notify if all assembly steps are done
    all_steps = db.query(AssemblyStep).filter(AssemblyStep.order_id == order_id).all()
    if all_steps and all(s.status == "done" for s in all_steps):
        order_label = order.order_number if order else f"Order #{order_id}"
        customer    = order.customer_name if order else ""
        _notify(db,
            event_type = "assembly_complete",
            title      = f"✅ Assembly Complete — {order_label}",
            body       = f"{customer}: All assembly steps finished. Ready to dispatch.",
            link       = f"/orders/{order_id}/assembly",
            order_id   = order_id,
        )

def _sync_component_from_job(db, comp):
    """Sync component status from its linked job's status."""
    if not comp.job_id:
        return
    job = db.query(Job).filter(Job.id == comp.job_id).first()
    if not job:
        return
    if job.status == "completed":
        comp.status = "done"
    elif job.status in ("in_progress", "scheduled"):
        comp.status = "in_progress"
    else:
        comp.status = "pending"


@app.get("/api/orders/{order_id}/assembly")
def get_assembly_details(order_id: int):
    """Get full assembly details: components + steps with readiness info."""
    db = SessionLocal()
    o = db.query(CustomerOrder).filter(CustomerOrder.id == order_id).first()
    if not o: db.close(); raise HTTPException(404, "Order not found")

    # Sync component statuses from jobs
    for comp in o.components:
        _sync_component_from_job(db, comp)
    _sync_assembly_steps(db, order_id)
    db.commit()

    comps = [component_dict(c) for c in o.components]
    steps = [assembly_step_dict(s) for s in o.assembly_steps]

    # Annotate each step with which components it needs
    for step in steps:
        needed = [c for c in comps if c["assembly_step"] <= step["step_number"]]
        done   = [c for c in needed if c["status"] in ("done","received")]
        step["components_needed"] = len(needed)
        step["components_done"]   = len(done)
        step["is_ready"]          = len(needed) == len(done)

    db.close()
    return {"components": comps, "assembly_steps": steps}


@app.post("/api/orders/{order_id}/components")
def add_component(order_id: int, data: dict):
    """Add a component to an assembly order. If type=make, auto-creates a Job."""
    db = SessionLocal()
    o = db.query(CustomerOrder).filter(CustomerOrder.id == order_id).first()
    if not o: db.close(); raise HTTPException(404, "Order not found")

    comp = OrderComponent(
        order_id       = order_id,
        name           = data["name"],
        component_type = data.get("component_type", "make"),
        assembly_step  = int(data.get("assembly_step", 1)),
        quantity       = int(data.get("quantity", 1)),
        notes          = data.get("notes", ""),
        routing_id     = data.get("routing_id"),
        vendor_name    = data.get("vendor_name", ""),
        status         = "pending",
    )
    db.add(comp); db.flush()

    # Auto-create job for "make" components
    if comp.component_type == "make" and comp.routing_id:
        job_num = next_job_number(db)
        mat_ready = parse_dt(data.get("material_ready_date")) if data.get("material_ready_date") else None
        op_overrides = data.get("op_overrides")
        j = Job(
            job_number          = job_num,
            customer_id         = o.customer_id,
            customer_name       = o.customer_name,
            product_type        = comp.name,
            product_size        = o.product_size or "",
            due_date            = o.due_date,
            promised_date       = getattr(o, "promised_date", None) or o.due_date,
            routing_id          = comp.routing_id,
            order_id            = order_id,
            material_ready_date = mat_ready,
            op_overrides        = json.dumps(op_overrides) if op_overrides else None,
            notes               = f"Component of {o.order_number}: {comp.name}",
            status              = "pending",
        )
        db.add(j); db.flush()
        comp.job_id = j.id

    # Mark order as assembly type
    o.order_type = "assembly"
    db.commit()
    result = component_dict(comp)
    db.close()
    return result


@app.put("/api/orders/{order_id}/components/{comp_id}")
def update_component(order_id: int, comp_id: int, data: dict):
    db = SessionLocal()
    comp = db.query(OrderComponent).filter(
        OrderComponent.id == comp_id, OrderComponent.order_id == order_id
    ).first()
    if not comp: db.close(); raise HTTPException(404, "Component not found")

    if "name"           in data: comp.name           = data["name"]
    if "assembly_step"  in data: comp.assembly_step  = int(data["assembly_step"])
    if "notes"          in data: comp.notes           = data["notes"]
    if "vendor_name"    in data: comp.vendor_name     = data["vendor_name"]
    if "expected_back"  in data: comp.expected_back   = parse_dt(data["expected_back"]).date() if data["expected_back"] else None
    if "quantity"       in data: comp.quantity        = int(data["quantity"])

    # Status transitions for outside/purchase components
    if "status" in data:
        new_status = data["status"]
        comp.status = new_status
        today = now_ist().date()
        if new_status == "sent"     and comp.component_type == "outside":
            if not comp.sent_date: comp.sent_date = today
        if new_status == "received":
            if not comp.received_date: comp.received_date = today
        if new_status == "ordered"  and comp.component_type == "purchase":
            if not comp.ordered_date: comp.ordered_date = today

    _sync_assembly_steps(db, order_id)
    db.commit()
    result = component_dict(comp)
    db.close()
    return result


@app.delete("/api/orders/{order_id}/components/{comp_id}")
def delete_component(order_id: int, comp_id: int):
    db = SessionLocal()
    comp = db.query(OrderComponent).filter(
        OrderComponent.id == comp_id, OrderComponent.order_id == order_id
    ).first()
    if not comp: db.close(); raise HTTPException(404, "Component not found")
    # If it has a pending job, delete it too
    if comp.job_id:
        j = db.query(Job).filter(Job.id == comp.job_id).first()
        if j and j.status == "pending":
            db.delete(j)
    db.delete(comp)
    db.commit(); db.close()
    return {"ok": True}


@app.post("/api/orders/{order_id}/assembly-steps")
def add_assembly_step(order_id: int, data: dict):
    db = SessionLocal()
    o = db.query(CustomerOrder).filter(CustomerOrder.id == order_id).first()
    if not o: db.close(); raise HTTPException(404, "Order not found")

    worker_id   = data.get("worker_id")
    worker_name = ""
    if worker_id:
        w = db.query(Worker).filter(Worker.id == worker_id).first()
        if w: worker_name = w.name

    step_num = int(data.get("step_number", 1))
    # Default status: if all required components already done → ready
    status = "ready" if _check_assembly_step_ready(db, order_id, step_num) else "waiting"

    step = AssemblyStep(
        order_id    = order_id,
        step_number = step_num,
        name        = data["name"],
        description = data.get("description", ""),
        est_hours   = float(data["est_hours"]) if data.get("est_hours") else None,
        worker_id   = worker_id,
        worker_name = worker_name,
        status      = status,
        notes       = data.get("notes", ""),
    )
    db.add(step)
    o.order_type = "assembly"
    db.commit()
    result = assembly_step_dict(step)
    db.close()
    return result


@app.put("/api/orders/{order_id}/assembly-steps/{step_id}")
def update_assembly_step(order_id: int, step_id: int, data: dict):
    db = SessionLocal()
    step = db.query(AssemblyStep).filter(
        AssemblyStep.id == step_id, AssemblyStep.order_id == order_id
    ).first()
    if not step: db.close(); raise HTTPException(404, "Step not found")

    if "name"        in data: step.name        = data["name"]
    if "description" in data: step.description = data["description"]
    if "est_hours"   in data: step.est_hours   = float(data["est_hours"]) if data["est_hours"] else None
    if "notes"       in data: step.notes       = data["notes"]
    if "step_number" in data: step.step_number = int(data["step_number"])
    if "worker_id"   in data:
        step.worker_id = data["worker_id"]
        if data["worker_id"]:
            w = db.query(Worker).filter(Worker.id == data["worker_id"]).first()
            step.worker_name = w.name if w else ""
        else:
            step.worker_name = ""

    if "status" in data:
        new_st = data["status"]
        # Validate transition
        if new_st == "in_progress" and step.status not in ("ready","in_progress"):
            db.close(); raise HTTPException(400, f"Step not ready yet — required components not done")
        step.status = new_st
        if new_st == "in_progress" and not step.started_at:
            step.started_at = now_ist()
        if new_st == "done" and not step.completed_at:
            step.completed_at = now_ist()
            # Unlock next step if ready
            next_step = db.query(AssemblyStep).filter(
                AssemblyStep.order_id == order_id,
                AssemblyStep.step_number == step.step_number + 1
            ).first()
            if next_step and next_step.status == "waiting":
                if _check_assembly_step_ready(db, order_id, next_step.step_number):
                    next_step.status = "ready"

    db.commit()
    result = assembly_step_dict(step)
    db.close()
    return result


@app.delete("/api/orders/{order_id}/assembly-steps/{step_id}")
def delete_assembly_step(order_id: int, step_id: int):
    db = SessionLocal()
    step = db.query(AssemblyStep).filter(
        AssemblyStep.id == step_id, AssemblyStep.order_id == order_id
    ).first()
    if not step: db.close(); raise HTTPException(404, "Step not found")
    db.delete(step); db.commit(); db.close()
    return {"ok": True}


@app.put("/api/scheduled-ops/{op_id}/outside")
def update_outside_op(op_id: int, data: dict):
    """Mark an outside operation as sent-out or received-back."""
    db = SessionLocal()
    s = db.query(ScheduledOp).filter(ScheduledOp.id == op_id).first()
    if not s: db.close(); raise HTTPException(404, "Op not found")
    action = data.get("action")  # "send_out" | "receive_back"
    if action == "send_out":
        s.status       = "in_progress"
        s.sent_out_at  = now_ist()
        s.actual_start = now_ist()
    elif action == "receive_back":
        s.status            = "completed"
        s.received_back_at  = now_ist()
        s.actual_end        = now_ist()
        # Pull forward next op in same job
        next_op = db.query(ScheduledOp).filter(
            ScheduledOp.job_id   == s.job_id,
            ScheduledOp.sequence == s.sequence + 1,
            ScheduledOp.status   == "pending"
        ).first()
        if next_op:
            next_op.scheduled_start = now_ist()
        # Check if job complete
        pending = db.query(ScheduledOp).filter(
            ScheduledOp.job_id == s.job_id,
            ScheduledOp.status != "completed"
        ).count()
        if pending == 0:
            job = db.query(Job).filter(Job.id == s.job_id).first()
            if job: job.status = "completed"; job.completed_at = now_ist()
        # NOTIFY: outside op received, next work can start
        job = db.query(Job).filter(Job.id == s.job_id).first()
        if job:
            _refresh_job_health(db, job)
            _notify(db,
                event_type = "outside_received",
                title      = f"📥 Received Back: {s.op_name}",
                body       = f"{job.job_number} — {job.product_type} {job.product_size} ({job.customer_name}). Next operation can now start.",
                link       = "/today",
                job_id     = job.id,
                order_id   = job.order_id,
            )
    db.commit()
    db.close()
    return {"ok": True, "op_id": op_id, "status": s.status}


# ═════════════════════════════════════════════════════════════════════════════
# NOTIFICATION API ENDPOINTS
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/api/notifications")
def get_notifications(unread_only: bool = False, request: Request = None):
    """Get notifications visible to the current user."""
    db = SessionLocal()
    user = getattr(request.state, 'user', {}) if request else {}
    q = db.query(Notification).order_by(Notification.created_at.desc())
    q = _filter_notifs_for_user(q, user)
    if unread_only:
        q = q.filter(Notification.is_read == False)
    notifs = q.limit(50).all()
    result = [{
        "id":         n.id,
        "event_type": n.event_type,
        "title":      n.title,
        "body":       n.body,
        "link":       n.link,
        "is_read":    n.is_read,
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "job_id":     n.job_id,
        "order_id":   n.order_id,
        "wc_id":      n.wc_id,
    } for n in notifs]
    db.close()
    return result


@app.get("/api/notifications/count")
def get_notification_count(request: Request = None):
    """Unread notification count — polled by the bell icon.
    Also runs lazy checks for overdue ops and vendor-late outside ops."""
    db = SessionLocal()
    user = getattr(request.state, 'user', {}) if request else {}
    user_role = user.get("role", "operator")

    # ── Lazy checks (only for manager/admin, max once per 5 min via dedup) ──
    if user_role in ("admin", "manager"):
        _check_overdue_ops(db)
        _check_vendor_late(db)

    q = db.query(Notification).filter(Notification.is_read == False)
    q = _filter_notifs_for_user(q, user)
    count = q.count()
    db.close()
    return {"unread": count}


@app.put("/api/notifications/{notif_id}/read")
def mark_notification_read(notif_id: int):
    db = SessionLocal()
    n = db.query(Notification).filter(Notification.id == notif_id).first()
    if not n: db.close(); raise HTTPException(404, "Not found")
    n.is_read = True
    db.commit(); db.close()
    return {"ok": True}


@app.put("/api/notifications/read-all")
def mark_all_read(request: Request = None):
    db = SessionLocal()
    user = getattr(request.state, 'user', {}) if request else {}
    q = db.query(Notification).filter(Notification.is_read == False)
    q = _filter_notifs_for_user(q, user)
    for n in q.all():
        n.is_read = True
    db.commit(); db.close()
    return {"ok": True}


@app.delete("/api/notifications/clear-read")
def clear_read_notifications():
    """Remove all read notifications older than 7 days to keep table small."""
    db = SessionLocal()
    cutoff = now_ist() - timedelta(days=7)
    db.query(Notification).filter(
        Notification.is_read == True,
        Notification.created_at < cutoff
    ).delete()
    db.commit(); db.close()
    return {"ok": True}


def _filter_notifs_for_user(q, user: dict):
    """Filter notification query to only show what this user should see."""
    role      = user.get("role", "operator")
    user_id   = int(user.get("sub", 0)) if user.get("sub") else None
    worker_id = int(user.get("worker_id")) if user.get("worker_id") else None

    conditions = []
    # Global (untargeted) → manager/admin only
    if role in ("admin", "manager"):
        conditions.append(and_(
            Notification.target_role      == None,
            Notification.target_user_id   == None,
            Notification.target_worker_id == None,
        ))
    # Role-targeted
    conditions.append(Notification.target_role == role)
    # User-targeted
    if user_id:
        conditions.append(Notification.target_user_id == user_id)
    # Worker-targeted
    if worker_id:
        conditions.append(Notification.target_worker_id == worker_id)

    if conditions:
        return q.filter(or_(*conditions))
    return q.filter(False)  # no access


def _check_overdue_ops(db):
    """Create op_overdue notifications for ops past scheduled_end but not done."""
    now = now_ist()
    overdue = db.query(ScheduledOp).filter(
        ScheduledOp.scheduled_end < now,
        ScheduledOp.status.in_(["pending", "scheduled", "in_progress"]),
    ).all()
    for s in overdue:
        hrs_late = (now - s.scheduled_end).total_seconds() / 3600
        if hrs_late < 0.5:
            continue  # grace period
        j = s.job
        _notify(db,
            event_type = "op_overdue",
            title      = f"⏰ Overdue: {s.op_name}",
            body       = f"{j.job_number} on {s.wc_name} — {hrs_late:.0f}h past scheduled end",
            link       = "/today",
            job_id     = j.id,
        )
    if overdue:
        db.commit()


def _check_vendor_late(db):
    """Create vendor_late notifications for outside ops sent but not returned on time."""
    now = now_ist()
    outside = db.query(ScheduledOp).filter(
        ScheduledOp.op_type == "outside",
        ScheduledOp.sent_out_at != None,
        ScheduledOp.received_back_at == None,
        ScheduledOp.status != "completed",
    ).all()
    for s in outside:
        days_out = (now - s.sent_out_at).total_seconds() / 86400
        # Use linked operation's transit_days if available, else default 3
        expected = 3.0
        if s.operation_id:
            op = db.query(Operation).filter(Operation.id == s.operation_id).first()
            if op and getattr(op, 'outside_transit_days', None):
                expected = float(op.outside_transit_days)
        if days_out <= expected:
            continue
        j = s.job
        _notify(db,
            event_type = "vendor_late",
            title      = f"📦 Vendor Late: {s.op_name}",
            body       = f"{j.job_number} — sent {days_out:.0f} days ago"
                         f"{(' to ' + s.outside_vendor) if s.outside_vendor else ''}"
                         f", expected back in {expected:.0f}",
            link       = "/today",
            job_id     = j.id,
        )
    if outside:
        db.commit()


@app.get("/api/gantt")
def get_gantt():
    db = SessionLocal()
    week_ago = now_ist() - timedelta(days=7)
    jobs = db.query(Job).filter(
        (Job.status.in_(["scheduled","in_progress"])) |
        ((Job.status == "completed") & (Job.completed_at >= week_ago))
    ).all()
    result = []
    fmt = lambda dt: dt.isoformat() if dt else None
    for j in jobs:
        cr = critical_ratio(j, db); finish = get_finish(j)
        is_late = bool(finish and finish > j.due_date)
        # Label: include piece info if part of an order
        label = j.job_number
        if j.order_id and j.piece_number:
            order = db.query(CustomerOrder).filter(CustomerOrder.id == j.order_id).first()
            if order:
                label = f"{order.order_number} P{j.piece_number:02d}"
        for s in j.scheduled_ops:
            if s.scheduled_start and s.scheduled_end:
                result.append({
                    "job_id": j.id, "job_number": j.job_number,
                    "order_id": j.order_id, "order_label": label,
                    "piece_number": j.piece_number,
                    "customer": j.customer_name, "po_number": j.po_number,
                    "op_name": s.op_name, "wc_name": s.wc_name, "op_id": s.id,
                    "worker_name": s.worker_name,
                    "machine_setup_mins": s.machine_setup_mins,
                    "job_setup_mins": s.job_setup_mins,
                    "work_time_hrs": s.work_time_hrs,
                    "machine_setup_waived": s.machine_setup_waived,
                    "start": fmt(s.scheduled_start), "end": fmt(s.scheduled_end),
                    "actual_start": fmt(s.actual_start), "status": s.status,
                    "priority": j.priority_flag, "critical_ratio": round(cr,2),
                    "is_late": is_late, "due_date": fmt(j.due_date),
                })
    db.close(); return result

@app.get("/api/today")
def get_today(user: dict = Depends(require_any)):
    db = SessionLocal()
    today = now_ist().date()
    t_start = datetime(today.year, today.month, today.day, 0, 0)
    t_end   = datetime(today.year, today.month, today.day, 23, 59)

    # Operators only see their own assigned ops
    worker_filter_id = None
    if user.get("role") == "operator" and user.get("worker_id"):
        worker_filter_id = int(user["worker_id"])

    q = db.query(ScheduledOp).filter(
        ScheduledOp.status.in_(["scheduled","in_progress"]),
        ScheduledOp.scheduled_start != None,
        ScheduledOp.scheduled_end   != None,
    )
    if worker_filter_id:
        q = q.filter(ScheduledOp.worker_id == worker_filter_id)
    all_active_ops = q.order_by(ScheduledOp.scheduled_start).all()

    pq = db.query(ScheduledOp).filter(ScheduledOp.status == "paused")
    if worker_filter_id:
        pq = pq.filter(ScheduledOp.worker_id == worker_filter_id)
    paused_ops = pq.order_by(ScheduledOp.scheduled_start).all()

    # Only show ops scheduled for today — overdue ops go to /api/past-work
    ops = []
    for s in all_active_ops:
        is_today = s.scheduled_start <= t_end and s.scheduled_end >= t_start
        if is_today:
            ops.append(s)

    # Add paused ops not already in list
    paused_ids = {s.id for s in ops}
    for s in paused_ops:
        if s.id not in paused_ids:
            ops.append(s)

    fmt = lambda dt: dt.isoformat() if dt else None
    result = []
    for s in ops:
        j = s.job
        label = j.job_number
        if j.order_id and j.piece_number:
            order = db.query(CustomerOrder).filter(CustomerOrder.id == j.order_id).first()
            if order: label = f"{order.order_number} P{j.piece_number:02d}"
        # FIX 6: Assembly context — show component name + order if this is an assembly component job
        asm_context = ""
        if j.order_id:
            comp_link = db.query(OrderComponent).filter(OrderComponent.job_id == j.id).first()
            if comp_link:
                asm_context = f"[{label}] {comp_link.name}"

        result.append({
            "op_id": s.id, "job_id": j.id, "job_number": j.job_number,
            "order_label": label, "piece_number": j.piece_number,
            "assembly_context": asm_context,
            "customer": j.customer_name, "op_name": s.op_name, "wc_name": s.wc_name,
            "worker_id": s.worker_id, "worker_name": s.worker_name,
            "machine_setup_mins": s.machine_setup_mins, "job_setup_mins": s.job_setup_mins,
            "setup_time_mins": s.setup_time_mins,
            "work_time_hrs": s.work_time_hrs,
            "work_time_mins": s.work_time_mins if s.work_time_mins else round(s.work_time_hrs * 60, 1),
            "scheduled_start": fmt(s.scheduled_start), "scheduled_end": fmt(s.scheduled_end),
            "actual_start": fmt(s.actual_start), "actual_end": fmt(s.actual_end),
            "status": s.status,
            "op_type": getattr(s, 'op_type', 'inhouse') or 'inhouse',
            "outside_vendor": getattr(s, 'outside_vendor', None) or '',
            "sent_out_at": fmt(getattr(s, 'sent_out_at', None)),
            "received_back_at": fmt(getattr(s, 'received_back_at', None)),
            "pause_reason": s.pause_reason, "pause_notes": s.pause_notes,
            "priority": j.priority_flag, "due_date": fmt(j.due_date),
        })
    db.close(); return result


@app.get("/api/past-work")
def get_past_work(days: int = 30, user: dict = Depends(require_any)):
    """
    Return ops from past days that were never started OR are still running.
    Includes:
      - status=scheduled AND scheduled_end < today_start  (missed/unstarted)
      - status=in_progress AND scheduled_start < today_start (started in a past day, still running)
    """
    db = SessionLocal()
    today     = now_ist().date()
    t_start   = datetime(today.year, today.month, today.day, 0, 0)
    cutoff    = t_start - timedelta(days=max(1, min(days, 90)))

    worker_filter_id = None
    if user.get("role") == "operator" and user.get("worker_id"):
        worker_filter_id = int(user["worker_id"])

    q = db.query(ScheduledOp).filter(
        or_(
            # Unstarted ops whose scheduled window is entirely in the past
            (ScheduledOp.status == "scheduled") &
            (ScheduledOp.scheduled_end != None) &
            (ScheduledOp.scheduled_end < t_start) &
            (ScheduledOp.scheduled_start >= cutoff),
            # In-progress ops started before today — include ALL, no cutoff restriction
            # (a job started 5 days ago and still running must always be visible)
            (ScheduledOp.status == "in_progress") &
            (ScheduledOp.scheduled_start < t_start),
            # Paused ops from before today
            (ScheduledOp.status == "paused") &
            (ScheduledOp.scheduled_start < t_start),
        )
    )
    if worker_filter_id:
        q = q.filter(ScheduledOp.worker_id == worker_filter_id)
    past_ops = q.order_by(ScheduledOp.scheduled_start.desc()).all()

    fmt = lambda dt: dt.isoformat() if dt else None
    result = []
    for s in past_ops:
        j = s.job
        if not j: continue
        label = j.job_number
        if j.order_id and j.piece_number:
            order = db.query(CustomerOrder).filter(CustomerOrder.id == j.order_id).first()
            if order: label = f"{order.order_number} P{j.piece_number:02d}"
        asm_context = ""
        if j.order_id:
            comp_link = db.query(OrderComponent).filter(OrderComponent.job_id == j.id).first()
            if comp_link: asm_context = f"[{label}] {comp_link.name}"
        result.append({
            "op_id": s.id, "job_id": j.id, "job_number": j.job_number,
            "order_label": label, "piece_number": j.piece_number,
            "assembly_context": asm_context,
            "customer": j.customer_name, "op_name": s.op_name, "wc_name": s.wc_name,
            "worker_id": s.worker_id, "worker_name": s.worker_name,
            "setup_time_mins": s.setup_time_mins,
            "work_time_hrs": s.work_time_hrs,
            "work_time_mins": s.work_time_mins if s.work_time_mins else round(s.work_time_hrs * 60, 1),
            "scheduled_start": fmt(s.scheduled_start), "scheduled_end": fmt(s.scheduled_end),
            "actual_start": fmt(s.actual_start), "actual_end": fmt(s.actual_end),
            "status": s.status,
            "op_type": getattr(s, 'op_type', 'inhouse') or 'inhouse',
            "outside_vendor": getattr(s, 'outside_vendor', None) or '',
            "pause_reason": s.pause_reason, "pause_notes": getattr(s, 'pause_notes', None),
            "priority": j.priority_flag, "due_date": fmt(j.due_date),
        })
    db.close()
    return result


@app.get("/api/upcoming")
def get_upcoming(days: int = 7):
    """Return all scheduled ops in the next N days (default 7), excluding today."""
    db = SessionLocal()
    now = now_ist()
    today = now.date()
    t_start = datetime(today.year, today.month, today.day, 23, 59, 59)
    t_end   = t_start + timedelta(days=max(1, min(days, 90)))
    ops = db.query(ScheduledOp).filter(
        ScheduledOp.status.in_(["scheduled","in_progress"]),
        ScheduledOp.scheduled_start > t_start,
        ScheduledOp.scheduled_start <= t_end,
    ).order_by(ScheduledOp.scheduled_start).all()
    fmt = lambda dt: dt.isoformat() if dt else None
    result = []
    for s in ops:
        j = s.job
        label = j.job_number
        if j.order_id and j.piece_number:
            order = db.query(CustomerOrder).filter(CustomerOrder.id == j.order_id).first()
            if order: label = f"{order.order_number} P{j.piece_number:02d}"
        result.append({
            "op_id": s.id, "job_id": j.id, "job_number": j.job_number,
            "order_label": label, "piece_number": j.piece_number,
            "customer": j.customer_name, "op_name": s.op_name, "wc_name": s.wc_name,
            "worker_id": s.worker_id, "worker_name": s.worker_name,
            "machine_setup_mins": s.machine_setup_mins, "job_setup_mins": s.job_setup_mins,
            "setup_time_mins": s.setup_time_mins,
            "work_time_hrs": s.work_time_hrs,
            "work_time_mins": s.work_time_mins if s.work_time_mins else round(s.work_time_hrs * 60, 1),
            "scheduled_start": fmt(s.scheduled_start), "scheduled_end": fmt(s.scheduled_end),
            "status": s.status,
            "priority": j.priority_flag, "due_date": fmt(j.due_date),
        })
    db.close(); return result

@app.get("/api/debug/today")
def debug_today(user: dict = Depends(require_admin)):
    db = SessionLocal()
    today = now_ist().date()
    t_start = datetime(today.year, today.month, today.day, 0, 0)
    t_end   = datetime(today.year, today.month, today.day, 23, 59)
    all_ops = db.query(ScheduledOp).filter(
        ScheduledOp.status.in_(["scheduled","in_progress"])
    ).order_by(ScheduledOp.scheduled_start).all()
    fmt = lambda dt: dt.isoformat() if dt else None
    result = {
        "now_ist": now_ist().isoformat(), "today_ist": today.isoformat(),
        "all_ops_count": len(all_ops),
        "all_ops": [{"op_name": s.op_name, "job": s.job.job_number,
                     "start": fmt(s.scheduled_start), "end": fmt(s.scheduled_end),
                     "status": s.status,
                     "matches_today": (s.scheduled_start <= t_end and s.scheduled_end >= t_start)
                     if s.scheduled_start and s.scheduled_end else False}
                    for s in all_ops],
    }
    db.close(); return result

@app.get("/api/heatmap")
def get_heatmap():
    db = SessionLocal()
    wcs = db.query(WorkCenter).order_by(WorkCenter.machine_type, WorkCenter.name).all()
    result = {}
    for wc in wcs:
        ops = db.query(ScheduledOp).filter(
            ScheduledOp.work_center_id == wc.id,
            ScheduledOp.scheduled_start != None
        ).all()
        by_day = {}
        for op in ops:
            day = op.scheduled_start.strftime("%Y-%m-%d")
            hrs = (op.scheduled_end - op.scheduled_start).total_seconds() / 3600
            by_day[day] = round(by_day.get(day, 0) + hrs, 1)
        result[wc.name] = by_day
    db.close(); return result

@app.put("/api/ops/{op_id}/status")
def update_op_status(op_id: int, data: dict, request: Request):
    db = SessionLocal()
    s = db.query(ScheduledOp).filter(ScheduledOp.id == op_id).first()
    if not s: raise HTTPException(404, "Not found")

    # Operators can only update ops assigned to them
    user = getattr(request.state, 'user', None)
    if user and user.get('role') == 'operator':
        worker_id = user.get('worker_id')
        if not worker_id or s.worker_id != int(worker_id):
            db.close()
            raise HTTPException(403, "You can only update your own operations")
    new_status = data["status"]
    s.status = new_status
    now = now_ist()
    j = s.job

    if new_status == "in_progress":
        # Manual start time: use provided actual_start, or scheduled_start (advance start), or now
        if data.get("actual_start"):
            s.actual_start = parse_dt(data["actual_start"])
        elif data.get("use_scheduled_start") and s.scheduled_start:
            s.actual_start = s.scheduled_start
        elif not s.actual_start:
            s.actual_start = now
        if j.status in ("pending","scheduled"): j.status = "in_progress"
        # Flag-and-wait: recompute where the job is now trending (no reschedule)
        _refresh_job_health(db, j, now)

    elif new_status == "paused":
        # Store pause reason and notes
        if data.get("pause_reason"): s.pause_reason = data["pause_reason"]
        if data.get("pause_notes"):  s.pause_notes  = data["pause_notes"]
        all_paused = all(op.status in ("paused","completed","pending","scheduled")
                         for op in j.scheduled_ops)
        if all_paused and j.status == "in_progress":
            j.status = "scheduled"
        _refresh_job_health(db, j, now)

    elif new_status == "completed":
        # Manual end time; also allow retroactive actual_start correction
        if data.get("actual_start"): s.actual_start = parse_dt(data["actual_start"])
        if data.get("actual_end"):   s.actual_end   = parse_dt(data["actual_end"])
        else:                        s.actual_end    = now
        # Clear pause fields on completion
        s.pause_reason = None; s.pause_notes = None
        all_done   = all(op.status == "completed" for op in j.scheduled_ops)
        any_inprog = any(op.status == "in_progress" for op in j.scheduled_ops if op.id != s.id)
        if all_done:
            j.status = "completed"; j.completed_at = s.actual_end or now
            _notify(db,
                event_type = "job_completed",
                title      = f"✅ Completed: {j.job_number}",
                body       = f"{j.product_type} {j.product_size} ({j.customer_name})",
                link       = f"/jobs/{j.id}",
                job_id     = j.id,
                order_id   = j.order_id,
            )
        elif not any_inprog:
            j.status = "in_progress"
        _reactive_reschedule(db, s.work_center_id, s.worker_id, s.actual_end or now)
        # Flag-and-wait: recompute projection + health AFTER the reactive pull,
        # so the projected finish reflects the just-completed (possibly late) op.
        prev_health = j.schedule_health
        _refresh_job_health(db, j, now)
        # If this completion just pushed the job from on-track into late/at-risk,
        # tell the supervisor — this is the early warning the whole feature exists for.
        if (j.schedule_health in ("late", "at_risk")
                and prev_health not in ("late", "at_risk")
                and j.status != "completed"):
            promise = j.promised_date or j.due_date
            _notify(db,
                event_type = "job_at_risk",
                title      = ("🔴 Now LATE: " if j.schedule_health == "late" else "🟠 At risk: ") + j.job_number,
                body       = f"{j.product_type} {j.product_size} ({j.customer_name}) — {j.health_reason}. "
                             f"Promised {promise.strftime('%d %b') if promise else '—'}, "
                             f"now projected {j.projected_end.strftime('%d %b') if j.projected_end else '—'}.",
                link       = f"/jobs/{j.id}",
                job_id     = j.id,
                order_id   = j.order_id,
            )
        if j.order_id:
            _update_order_status(db, j.order_id)
            # FIX 1: Auto-sync assembly component status + unlock assembly steps
            if all_done:
                comp = db.query(OrderComponent).filter(OrderComponent.job_id == j.id).first()
                if comp:
                    comp.status = "done"
                    db.flush()
                    _sync_assembly_steps(db, j.order_id)

    # ── Audit trail ──
    action_map = {"in_progress": "op_started", "paused": "op_paused", "completed": "op_completed"}
    _audit_log(db, request, action_map.get(new_status, f"op_{new_status}"),
                  entity_type="scheduled_op", entity_id=op_id,
                  entity_label=f"{s.op_name} on {s.wc_name} ({j.job_number})",
                  details={"job_id": j.id, "worker": s.worker_name,
                           "pause_reason": s.pause_reason if new_status == "paused" else None})
    db.commit(); db.close()
    return {"ok": True}

@app.put("/api/ops/{op_id}/assign-worker")
def assign_worker_to_op(op_id: int, data: dict, user: dict = Depends(require_manager)):
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

@app.get("/api/activity-log")
def get_activity_log(limit: int = 50, offset: int = 0, action: str = None,
                     entity_type: str = None):
    """Paginated audit trail. Filters optional."""
    db = SessionLocal()
    q = db.query(ActivityLog).order_by(ActivityLog.timestamp.desc())
    if action:      q = q.filter(ActivityLog.action == action)
    if entity_type: q = q.filter(ActivityLog.entity_type == entity_type)
    total = q.count()
    rows = q.offset(offset).limit(min(limit, 200)).all()
    db.close()
    return {
        "total": total,
        "items": [{
            "id":           r.id,
            "timestamp":    r.timestamp.isoformat() if r.timestamp else None,
            "username":     r.username,
            "action":       r.action,
            "entity_type":  r.entity_type,
            "entity_id":    r.entity_id,
            "entity_label": r.entity_label,
            "details":      json.loads(r.details) if r.details else None,
        } for r in rows],
    }

@app.get("/api/preemption-alerts")
def get_preemption_alerts():
    db = SessionLocal()
    urgent = db.query(Job).filter(
        Job.status.in_(["pending","scheduled"]),
        Job.priority_flag == True
    ).all()
    alerts = []
    for j in urgent:
        if critical_ratio(j, db) < 0.5:
            alerts.extend(check_preemption(db, j))
    db.close(); return alerts


@app.get("/api/at-risk")
def get_at_risk():
    """
    Flag-and-wait feed: every active job whose projected finish is trending
    late or at risk against its FROZEN promised date. This is the screen the
    supervisor checks — 'what's going wrong that I need to decide about'.
    Read-only. Does not reschedule anything.
    """
    db = SessionLocal()
    jobs = db.query(Job).filter(
        Job.status.in_(["pending", "scheduled", "in_progress"]),
        Job.schedule_health.in_(["late", "at_risk"]),
    ).all()
    fmt = lambda dt: dt.isoformat() if dt else None
    rank = {"late": 0, "at_risk": 1}
    out = []
    for j in jobs:
        promise   = j.promised_date or j.due_date
        projected = j.projected_end or get_finish(j)
        slip_hrs  = ((projected - promise).total_seconds() / 3600) if (projected and promise) else None
        # The op that's the current pain point — running, or the next pending
        cur = None
        for s in sorted(j.scheduled_ops, key=lambda x: x.sequence or 0):
            if s.status == "in_progress":
                cur = s; break
        if not cur:
            for s in sorted(j.scheduled_ops, key=lambda x: x.sequence or 0):
                if s.status in ("pending", "scheduled"):
                    cur = s; break
        out.append({
            "job_id": j.id, "job_number": j.job_number,
            "customer_name": j.customer_name,
            "product_type": j.product_type, "product_size": j.product_size,
            "order_id": j.order_id, "piece_number": j.piece_number,
            "health": j.schedule_health,
            "reason": j.health_reason,
            "promised_date": fmt(promise),
            "projected_end": fmt(projected),
            "slip_hours": round(slip_hrs, 1) if slip_hrs is not None else None,
            "current_op": cur.op_name if cur else None,
            "current_machine": cur.wc_name if cur else None,
            "is_priority": bool(j.priority_flag),
        })
    # Worst first: late before at_risk, then biggest slip
    out.sort(key=lambda x: (rank.get(x["health"], 9), -(x["slip_hours"] or -999)))
    db.close()
    return out

# ─────────────────────────────────────────────────────────────────────────────
# ESTIMATE  (what-if: no DB writes)
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# FORMULA ENGINE  — updated punch_lead_time.xlsx (4-column layout)
# Verified cell-by-cell. 4 subtypes: lower_small, upper_small, lower_big, upper_big
# ─────────────────────────────────────────────────────────────────────────────

FORMULA_TYPES = {
    # Internal keys
    "volume_milling":                "Volume Milling          -- L x W x Depth / MRR",
    "side_cutting":                  "Side Cutting L           -- L x Depth / MRR",
    "side_cutting_w":                "Side Cutting W           -- W x Depth / MRR",
    "welding":                       "Perimeter Welding        -- 2*(L+W) / 200",
    "surface_grinding":              "Surface Grinding         -- passes*(L+250)/20000",
    "edge_grinding":                 "Edge Grinding Side 1     -- passes*(L+250)/20000",
    "edge_grinding_w":               "Edge Grinding Side 2     -- passes*(W+250)/20000",
    "step_milling_full":             "Step Milling Full        -- 2*(L+W)*(T-8)/0.3/1000",
    "edge_sizing":                   "Edge Sizing              -- 2*(L+W)*Passes/250",
    "step_milling_side":             "Step Milling Side L      -- L*Depth/MRR",
    "step_milling_side_w":           "Step Milling Side W      -- W*Depth/MRR",
    "iso_depth_milling":             "Iso Depth Milling        -- L*W*Depth/MRR",
    "rubber_milling":                "Rubber Depth Milling     -- L*W*Depth/MRR",
    "radius_milling":                "Radius Milling           -- 2*(L+W)*3/250",
    "sand_blasting":                 "Sand Blasting            -- L*W/MRR",
    "fixed":                         "Fixed Time               -- constant machining minutes",
    # Excel formula type name aliases (what appears in the routing formula_type field)
    "Volume Milling":                "Volume Milling          -- L x W x Depth / MRR",
    "Perimeter Milling Single Side": "Perimeter Milling Single Side -- Dim x Depth / MRR",
    "Perimeter Milling Full":        "Step Milling Full        -- 2*(L+W)*(T-8)/0.3/1000",
    "Perimeter Side Milling":        "Edge Sizing              -- 2*(L+W)*Passes/250",
    "Perimeter Milling":             "Radius Milling           -- 2*(L+W)*3/250",
    "Perimeter Welding":             "Perimeter Welding        -- 2*(L+W)/200",
    "Surface Grinding":              "Surface Grinding         -- passes*(dim+250)/20000",
    "Sandblasting":                  "Sand Blasting            -- L*W/MRR",
    "Fixed":                         "Fixed Time               -- constant machining minutes",
}

# Map Excel formula type names to internal keys for calc_op_time
FORMULA_TYPE_ALIAS = {
    "Volume Milling":                "volume_milling",
    # "Perimeter Milling Single Side" handled directly in calc_op_time using dim_x_source
    "Perimeter Milling Full":        "step_milling_full",
    "Perimeter Side Milling":        "edge_sizing",
    "Perimeter Milling":             "radius_milling",
    "Perimeter Welding":             "welding",
    "Surface Grinding":              "surface_grinding",
    "Sandblasting":                  "sand_blasting",
    "Fixed":                         "fixed",
}

DIM_SOURCES = ["length", "width", "thickness"]


def _resolve_dim(source, L, W, T):
    """Resolve dim_x_source or dim_y_source string to actual numeric value."""
    if source == 'width':     return W
    if source == 'thickness': return T
    return L  # 'length' is default


def calc_op_time(formula_type, mrr, depth_mm,
                 dim_x_source, dim_y_source,
                 length, width, thickness,
                 feed_rate=None) -> float:
    """Return machining time in MINUTES.

    ALL formulas use dim_x_source and dim_y_source from the routing operation.
    Do NOT hardcode L/W — always resolve through _resolve_dim().
    Verified cell-by-cell against punch_lead_time.xlsx for all 8 punch variants.

    Formula → Excel interpretation:
      Volume Milling            : DimX * DimY * Depth / MRR
      Perimeter Milling Single  : DimX * DimY * Depth / MRR  (DimY=T by convention)
      Surface Grinding          : (DimY+50)*Depth*2/2.5 × (DimX+250)/20000
      Perimeter Milling Full    : 2*(L+W)/0.3*(T-8)/Feed  [Depth=T-8 auto]
      Perimeter Side Milling    : 2*(L+W)*Passes/Feed
      Perimeter Milling         : 2*(L+W)*3/Feed
      Perimeter Welding         : 2*(L+W)/200
      Sandblasting              : L*W/MRR
      Fixed                     : 0 (use stored work_time_mins)
    """
    ft = FORMULA_TYPE_ALIAS.get(formula_type, formula_type)

    L, W, T, D = length, width, thickness, float(depth_mm or 0.0)
    DX = _resolve_dim(dim_x_source, L, W, T)
    DY = _resolve_dim(dim_y_source, L, W, T)

    if ft in ("volume_milling", "iso_depth_milling", "rubber_milling"):
        # Time = DimX * DimY * Depth / MRR
        # Facing:     DimX=L, DimY=W, Depth=5,   MRR=35000 → 670*670*5/35000=64.13 ✓
        # Iso Depth:  DimX=L, DimY=W, Depth=11,  MRR=56250 → 670*670*11/56250=87.78 ✓
        # Rubber:     DimX=L, DimY=W, Depth=0.5, MRR=9375  → 670*670*0.5/9375=23.94 ✓
        defaults = {"volume_milling": 35000.0, "iso_depth_milling": 56250.0, "rubber_milling": 9375.0}
        R = mrr or defaults.get(ft, 35000.0)
        return (DX * DY * D) / R

    elif ft in ("side_cutting", "side_cutting_w", "step_milling_side", "step_milling_side_w",
                "Perimeter Milling Single Side"):
        # Time = DimX * DimY * Depth / MRR
        # Side Cut 1: DimX=L=670, DimY=T=35, Depth=10, MRR=6300 → 670*35*10/6300=37.22 ✓
        # Side Cut 2: DimX=W=670, DimY=T=35, Depth=10, MRR=6300 → 670*35*10/6300=37.22 ✓ (square)
        # Step Mill:  DimX=L=670, DimY=T=35, Depth=4,  MRR=6300 → 670*35*4/6300=14.89 ✓
        R = mrr or 6300.0
        return (DX * DY * D) / R

    elif ft in ("surface_grinding", "edge_grinding", "edge_grinding_w", "Surface Grinding"):
        # Time = (DimY+50)*Depth*2/2.5 × (DimX+250)/20000
        # Surface: DimX=L=670, DimY=W=670, D=2 → (670+50)*2*2/2.5*(670+250)/20000=52.992 ✓
        # Edge 1:  DimX=L=670, DimY=T=35,  D=5 → (35+50)*5*2/2.5*(670+250)/20000=15.64  ✓
        # Edge 2:  DimX=W=670, DimY=T=35,  D=5 → (35+50)*5*2/2.5*(670+250)/20000=15.64  ✓ (square)
        passes   = (DY + 50) * D * 2 / 2.5
        time_per = (DX + 250) / 20000.0
        return passes * time_per

    elif ft == "step_milling_full":
        # Time = 2*(L+W)/step_over*(T-8)/Feed
        # step_over=0.3mm, Feed=configurable (default 1000)
        # Big punch: 2*(670+1200)/0.3*(35-8)/1000=336.6 ✓
        # Depth = T-8 always auto-computed — never stored
        step_over = 0.3
        feed = feed_rate or 1000.0
        return 2.0 * (L + W) / step_over * (T - 8) / feed

    elif ft == "edge_sizing":
        # Time = 2*(L+W)*Passes/Feed
        # Passes stored in depth_mm field, Feed configurable (default 250)
        # Big punch: 2*(670+1200)*10/250=149.6 ✓
        passes = depth_mm or 10.0
        feed = feed_rate or 250.0
        return 2.0 * (L + W) * passes / feed

    elif ft == "radius_milling":
        # Time = 2*(L+W)*3/Feed  (3 passes fixed)
        # Feed configurable (default 250)
        # Small: 2*(670+670)*3/250=32.16 ✓
        feed = feed_rate or 250.0
        return 2.0 * (L + W) * 3.0 / feed

    elif ft == "welding":
        # Time = 2*(L+W)/200  (welding speed 200 mm/min fixed)
        # Small: 2*(670+670)/200=13.4 ✓
        return 2.0 * (L + W) / 200.0

    elif ft == "sand_blasting":
        # Time = L*W/MRR  (area/throughput)
        # Small: 670*670/12000=37.41 ✓
        R = mrr or 12000.0
        return (L * W) / R

    elif ft == "fixed":
        return 0.0

    return 0.0


# Tuple: (name, formula_type, depth_mm, setup_mins, mach_fixed, subtypes)
PUNCH_OPS = [
    # ── NON-ISO (Lower/Upper) ─────────────────────────────────────────────────
    # Op 1: Lifting Holes — Fixed
    ("Lifting Holes",        "fixed",             None, 20, 30, {"lower_small","upper_small","lower_big","upper_big"}),
    # Op 2: Facing — L*W*5/35000
    ("Facing",               "volume_milling",    5,    20, 0,  {"lower_small","upper_small","lower_big","upper_big"}),
    # Op 3: Side Cutting 1 — L*10/180
    ("Side Cutting 1",       "side_cutting",      10,   20, 0,  {"lower_small","upper_small","lower_big","upper_big"}),
    # Op 4: Side Cutting 2 — W*10/180
    ("Side Cutting 2",       "side_cutting_w",    10,   20, 0,  {"lower_small","upper_small","lower_big","upper_big"}),
    # Op 5: Welding — 2*(L+W)/200
    ("Welding",              "welding",           None, 20, 0,  {"lower_small","upper_small","lower_big","upper_big"}),
    # Op 6: Surface Grinding — (W+50)*2*2/2.5 * (L+250)/20000
    ("Surface Grinding",     "surface_grinding",  2,    10, 0,  {"lower_small","upper_small","lower_big","upper_big"}),
    # Op 7 SMALL: Edge Grinding S1
    ("Edge Grinding Side 1", "edge_grinding",     5,    10, 0,  {"lower_small","upper_small"}),
    # Op 7 BIG: Step Milling Full — 2*(L+W)*(T-8)/0.3/1000
    ("Step Milling",         "step_milling_full", None, 10, 0,  {"lower_big","upper_big"}),
    # Op 8 SMALL: Edge Grinding S2
    ("Edge Grinding Side 2", "edge_grinding_w",   5,    10, 0,  {"lower_small","upper_small"}),
    # Op 8 BIG: Edge Sizing — 2*(L+W)*10/250
    ("Edge Sizing",          "edge_sizing",       10,   10, 0,  {"lower_big","upper_big"}),
    # Op 9 SMALL: Step Milling Side 1 (lower=4mm, upper=2mm)
    ("Step Milling Side 1",  "step_milling_side", 4,    20, 0,  {"lower_small"}),
    ("Step Milling Side 1",  "step_milling_side", 2,    20, 0,  {"upper_small"}),
    # Op 9 BIG: Rubber Depth Milling
    ("Rubber Depth Milling", "rubber_milling",    None, 20, 0,  {"lower_big","upper_big"}),
    # Op 10 SMALL: Step Milling Side 2 (lower=4mm, upper=2mm)
    ("Step Milling Side 2",  "step_milling_side_w",4,   20, 0,  {"lower_small"}),
    ("Step Milling Side 2",  "step_milling_side_w",2,   20, 0,  {"upper_small"}),
    # Op 10 BIG: Radius Milling — 2*(L+W)*3/250
    ("Radius Milling",       "radius_milling",    None,  5, 0,  {"lower_big","upper_big"}),
    # Op 11 SMALL: Rubber Depth Milling
    ("Rubber Depth Milling", "rubber_milling",    None, 20, 0,  {"lower_small","upper_small"}),
    # Op 11 BIG: Sandblasting
    ("Sandblasting",         "sand_blasting",     None, 20, 0,  {"lower_big","upper_big"}),
    # Op 12 SMALL: Radius Milling
    ("Radius Milling",       "radius_milling",    None,  5, 0,  {"lower_small","upper_small"}),
    # Op 12 BIG: Rubberizing
    ("Rubberizing",          "fixed",             None, 20, 40, {"lower_big","upper_big"}),
    # Op 13 SMALL: Removal Slot
    ("Removal Slot",         "fixed",             None, 20, 30, {"lower_small","upper_small"}),
    # Op 14 SMALL: Sandblasting
    ("Sandblasting",         "sand_blasting",     None, 20, 0,  {"lower_small","upper_small"}),
    # Op 15 SMALL: Rubberizing
    ("Rubberizing",          "fixed",             None, 20, 40, {"lower_small","upper_small"}),

    # ── ISO (Lower Iso / Upper Iso) ───────────────────────────────────────────
    # Same as Non-Iso except: adds Iso Depth Milling after Side Cutting 2
    # and Radius Milling uses correct 2*(L+W)*3/250 formula
    ("Lifting Holes",        "fixed",             None, 20, 30, {"iso_lower_small","iso_upper_small","iso_lower_big","iso_upper_big"}),
    ("Facing",               "volume_milling",    5,    20, 0,  {"iso_lower_small","iso_upper_small","iso_lower_big","iso_upper_big"}),
    ("Side Cutting 1",       "side_cutting",      10,   20, 0,  {"iso_lower_small","iso_upper_small","iso_lower_big","iso_upper_big"}),
    ("Side Cutting 2",       "side_cutting_w",    10,   20, 0,  {"iso_lower_small","iso_upper_small","iso_lower_big","iso_upper_big"}),
    # Iso Depth Milling — L*W*11/56250
    ("Iso Depth Milling",    "iso_depth_milling", 11,   20, 0,  {"iso_lower_small","iso_upper_small","iso_lower_big","iso_upper_big"}),
    ("Welding",              "welding",           None, 20, 0,  {"iso_lower_small","iso_upper_small","iso_lower_big","iso_upper_big"}),
    ("Surface Grinding",     "surface_grinding",  2,    10, 0,  {"iso_lower_small","iso_upper_small","iso_lower_big","iso_upper_big"}),
    ("Edge Grinding Side 1", "edge_grinding",     5,    10, 0,  {"iso_lower_small","iso_upper_small"}),
    ("Step Milling",         "step_milling_full", None, 10, 0,  {"iso_lower_big","iso_upper_big"}),
    ("Edge Grinding Side 2", "edge_grinding_w",   5,    10, 0,  {"iso_lower_small","iso_upper_small"}),
    ("Edge Sizing",          "edge_sizing",       10,   10, 0,  {"iso_lower_big","iso_upper_big"}),
    ("Step Milling Side 1",  "step_milling_side", 4,    20, 0,  {"iso_lower_small"}),
    ("Step Milling Side 1",  "step_milling_side", 2,    20, 0,  {"iso_upper_small"}),
    ("Radius Milling",       "radius_milling",    None,  5, 0,  {"iso_lower_big","iso_upper_big"}),
    ("Step Milling Side 2",  "step_milling_side_w",4,   20, 0,  {"iso_lower_small"}),
    ("Step Milling Side 2",  "step_milling_side_w",2,   20, 0,  {"iso_upper_small"}),
    ("Radius Milling",       "radius_milling",    None,  5, 0,  {"iso_lower_small","iso_upper_small"}),
    ("Rubber Depth Milling", "rubber_milling",    None, 20, 0,  {"iso_lower_small","iso_upper_small"}),
    ("Sandblasting",         "sand_blasting",     None, 20, 0,  {"iso_lower_big","iso_upper_big"}),
    ("Rubberizing",          "fixed",             None, 20, 40, {"iso_lower_big","iso_upper_big"}),
    ("Removal Slot",         "fixed",             None, 20, 30, {"iso_lower_small","iso_upper_small"}),
    ("Sandblasting",         "sand_blasting",     None, 20, 0,  {"iso_lower_small","iso_upper_small"}),
    ("Rubberizing",          "fixed",             None, 20, 40, {"iso_lower_small","iso_upper_small"}),
]


def punch_subtype(punch_type: str, length: float, width: float) -> str:
    """Map punch_type + size to one of 8 subtypes."""
    is_large = length > 600 or width > 600
    pt = punch_type.lower()
    is_iso   = "iso" in pt
    is_upper = "upper" in pt
    if is_iso:
        if is_large: return "iso_upper_big"   if is_upper else "iso_lower_big"
        return        "iso_upper_small" if is_upper else "iso_lower_small"
    else:
        if is_large: return "upper_big"   if is_upper else "lower_big"
        return        "upper_small" if is_upper else "lower_small"


@app.post("/api/punch-calc")
def punch_calc(data: dict):
    """Calculate machining times for punch operations.

    Two modes:
    1. routing_ops provided (list of ops from the selected routing template):
       Calculate time for EACH op using its own formula_type, mrr, depth_mm.
       This is the correct mode — times fill in-place on the routing the user selected.
    2. No routing_ops (legacy): use hardcoded PUNCH_OPS list (fallback).
    """
    length    = float(data.get("length",    600))
    width     = float(data.get("width",     600))
    thickness = float(data.get("thickness",  35))
    routing_ops = data.get("routing_ops")   # list of ops from frontend orderFormOps

    if routing_ops:
        # Mode 1: calculate using the routing template's own ops + their formula types
        result = []
        for op in routing_ops:
            name       = op.get("name", "")
            ftype      = op.get("formula_type") or "fixed"
            mrr        = op.get("mrr")
            depth      = op.get("depth_mm")
            feed_rate  = op.get("feed_rate")
            setup_mins = float(op.get("setup_time_mins") or op.get("setup_mins") or 0)
            mach_fixed = float(op.get("machining_mins") or 0)
            wc_id      = op.get("work_center_id")
            op_id      = op.get("operation_id")
            included   = op.get("included", True)

            # Resolve alias
            ft_key = FORMULA_TYPE_ALIAS.get(ftype, ftype)

            dim_x = op.get("dim_x_source") or None
            dim_y = op.get("dim_y_source") or None

            # Handle sub-ops: calculate each independently, sum for parent work_time
            raw_sub_ops = op.get("sub_operations") or []
            if raw_sub_ops:
                calc_sub_ops = []
                sub_total = 0.0
                for s in raw_sub_ops:
                    s_ftype = s.get("formula_type") or "fixed"
                    s_ft_key = FORMULA_TYPE_ALIAS.get(s_ftype, s_ftype)
                    s_mrr   = s.get("mrr")
                    s_depth = s.get("depth_mm")
                    s_feed  = s.get("feed_rate")
                    s_dx    = s.get("dim_x_source") or None
                    s_dy    = s.get("dim_y_source") or None
                    s_fixed = float(s.get("work_time_mins") or 0)
                    s_opt   = s.get("is_optional", False)
                    s_inc   = s.get("included", not s_opt)  # optional = excluded by default

                    if s_ft_key == "fixed":
                        s_mins = s_fixed
                    else:
                        s_mins = round(calc_op_time(s_ftype, s_mrr, s_depth, s_dx, s_dy,
                                                    length, width, thickness, s_feed), 2)
                    calc_sub_ops.append({
                        "id":           s.get("id"),
                        "name":         s.get("name", ""),
                        "formula_type": s_ftype,
                        "mrr":          s_mrr,
                        "depth_mm":     s_depth,
                        "feed_rate":    s_feed,
                        "dim_x_source": s_dx,
                        "dim_y_source": s_dy,
                        "work_time_mins": s_mins,
                        "is_optional":  s_opt,
                        "included":     s_inc,
                        "formula_desc": FORMULA_TYPES.get(s_ftype, s_ftype),
                    })
                    if s_inc:
                        sub_total += s_mins

                work_mins = round(sub_total, 2)
            else:
                calc_sub_ops = []
                if ft_key == "fixed":
                    work_mins = mach_fixed
                else:
                    work_mins = round(calc_op_time(ftype, mrr, depth, dim_x, dim_y,
                                                   length, width, thickness, feed_rate), 2)

            result.append({
                "name":            name,
                "formula_type":    ftype,
                "depth_mm":        depth,
                "mrr":             mrr,
                "feed_rate":       feed_rate,
                "setup_time_mins": setup_mins,
                "work_time_mins":  work_mins,
                "total_mins":      round(work_mins + setup_mins, 2),
                "work_center_id":  wc_id,
                "operation_id":    op_id,
                "included":        included,
                "formula_desc":    FORMULA_TYPES.get(ftype, ftype),
                "sub_operations":  calc_sub_ops,
            })
        total = sum(r["total_mins"] for r in result if r.get("included", True))
        return {"length": length, "width": width, "thickness": thickness,
                "ops": result, "total_mins": round(total, 1), "total_hrs": round(total / 60, 2)}

    else:
        # Mode 2: legacy fallback using hardcoded PUNCH_OPS
        punch_type = data.get("punch_type", "Lower")
        machine_map = data.get("machine_map", {})
        subtype = punch_subtype(punch_type, length, width)
        result = []
        for (name, ftype, depth, setup, mach_fixed, subtypes) in PUNCH_OPS:
            if subtype not in subtypes:
                continue
            if ftype == "fixed":
                machining = float(mach_fixed)
            else:
                machining = calc_op_time(ftype, None, depth, None, None, length, width, thickness)
            work_mins  = round(machining, 2)
            total_mins = round(machining + setup, 2)
            result.append({
                "name": name, "formula_type": ftype, "depth_mm": depth,
                "setup_time_mins": setup, "work_time_mins": work_mins,
                "total_mins": total_mins, "work_center_id": machine_map.get(name),
                "formula_desc": FORMULA_TYPES.get(ftype, ftype),
            })
        total = sum(r["total_mins"] for r in result)
        return {"subtype": subtype, "length": length, "width": width, "thickness": thickness,
                "ops": result, "total_mins": round(total, 1), "total_hrs": round(total / 60, 2)}


@app.get("/api/punch-formula-types")
def get_formula_types():
    return {
        "formula_types": [{"value": k, "label": v} for k, v in FORMULA_TYPES.items()],
        "dim_sources":   DIM_SOURCES,
    }


@app.put("/api/routings/{rid}/operations/{oid}/formula")
def update_op_formula(rid: int, oid: int, data: dict):
    db = SessionLocal()
    op = db.query(Operation).filter(Operation.id == oid, Operation.routing_id == rid).first()
    if not op: db.close(); raise HTTPException(404, "Operation not found")
    op.formula_type = data.get("formula_type") or None
    op.mrr          = float(data["mrr"])        if data.get("mrr")        else None
    op.depth_mm     = float(data["depth_mm"])   if data.get("depth_mm")   else None
    op.feed_rate    = float(data["feed_rate"])   if data.get("feed_rate")  else None
    op.dim_x_source = data.get("dim_x_source") or None
    op.dim_y_source = data.get("dim_y_source") or None
    db.commit(); db.close()
    return {"ok": True}

@app.post("/api/estimate")
def estimate_order(data: dict):
    """
    Simulate scheduling for N pieces of a given routing (with optional op overrides)
    WITHOUT writing anything to the DB.  Returns estimated finish date and
    per-operation breakdown so the manager can quote a delivery date before
    committing to the order.

    Body: {
      routing_id: int,
      quantity: int,            # 1..50 — simulates this many independent pieces
      start_date: str|null,     # ISO date; defaults to today
      op_overrides: [           # optional per-op time tweaks (same format as job)
        {operation_id, setup_time_mins, work_time_mins, included}
      ]
    }
    """
    db = SessionLocal()
    routing_id      = data.get("routing_id")
    quantity        = max(1, min(int(data.get("quantity", 1)), 50))
    material_ready  = parse_dt(data.get("material_ready_date"))
    # Always simulate from NOW (IST) — never trust the frontend start_date which arrives as UTC
    # and would be misinterpreted as IST, causing the simulation to start from the wrong time
    # (e.g. 4:19 AM instead of 9:49 AM), making it ignore all jobs already scheduled today.
    requested_start = now_ist()
    # Respect material_ready_date: can't start before material arrives
    earliest_start  = max(requested_start, material_ready) if material_ready else requested_start
    start_dt        = snap_to_shift(earliest_start)
    material_blocked = bool(material_ready and material_ready > requested_start)
    overrides       = {o.get("operation_id"): o for o in data.get("op_overrides", []) if o.get("operation_id")}

    routing = db.query(Routing).filter(Routing.id == routing_id).first()
    if not routing:
        db.close(); raise HTTPException(400, "Routing not found")

    # Build op list respecting overrides
    ops = []
    for op in sorted(routing.operations, key=lambda o: o.sequence):
        ov = overrides.get(op.id, {})
        if not ov.get("included", True): continue
        m_s  = float(ov.get("machine_setup_mins", op.machine_setup_mins or 0))
        j_s  = float(ov.get("job_setup_mins",     op.job_setup_mins     or 0))
        if ov.get("work_time_mins") and float(ov.get("work_time_mins",0)) > 0:
            work = float(ov["work_time_mins"]) / 60.0
        else:
            work = float(op.work_time_hrs or 0)
        ops.append({"name": op.name, "work_center_id": op.work_center_id,
                    "wc_name": op.work_center.name if op.work_center else str(op.work_center_id),
                    "machine_setup_mins": m_s, "job_setup_mins": j_s,
                    "work_time_hrs": work, "total_hrs": (m_s + j_s)/60 + work})

    if not ops:
        db.close(); raise HTTPException(400, "Routing has no operations")

    # Simulate scheduling piece by piece (read-only: look at existing booked slots)
    # We keep a local dict of "extra blocked" slots added by this simulation
    sim_booked: dict[int, list] = {}  # work_center_id -> [(start,end)]

    def working_intervals(slot_start, slot_end):
        """Break a slot into actual working sub-intervals, skipping lunch and non-working time."""
        intervals = []
        cur = slot_start
        for _ in range(200):
            if cur >= slot_end:
                break
            shift_s, shift_e, lunch_s, lunch_e = get_shift(cur.date())
            if shift_s == shift_e or cur >= shift_e:
                cur = next_shift_start(cur); continue
            if cur < shift_s:
                cur = shift_s; continue
            seg_end = min(slot_end, shift_e)
            if lunch_s and lunch_e and cur < lunch_e and seg_end > lunch_s:
                if cur < lunch_s:
                    intervals.append((cur, min(seg_end, lunch_s)))
                cur = lunch_e
            else:
                intervals.append((cur, seg_end))
                cur = seg_end
        return intervals

    def machine_free_sim(wc_id, slot_start, slot_end):
        # Decompose simulated slot into actual working intervals (skips lunch/non-working)
        # Then check each interval against real and simulated bookings
        intervals = working_intervals(slot_start, slot_end)
        if not intervals:
            return True  # no working time in slot
        for ws, we in intervals:
            real = db.query(ScheduledOp).filter(
                ScheduledOp.work_center_id == wc_id,
                ScheduledOp.scheduled_end  > ws,
                ScheduledOp.scheduled_start < we,
                ScheduledOp.status.in_(["scheduled","in_progress"])
            ).first()
            if real: return False
            for bs, be in sim_booked.get(wc_id, []):
                if bs < we and be > ws:
                    return False
        return True

    piece_results = []
    bottlenecks   = {}  # wc_name -> total blocked hours

    for piece in range(quantity):
        current = start_dt
        piece_ops = []
        for op in ops:
            wc_id    = op["work_center_id"]
            dur_hrs  = op["total_hrs"]
            # find next free slot (simplified — no worker matching for speed)
            search = snap_to_shift(current)
            for _ in range(500):
                slot_end = add_working_hours(search, dur_hrs)
                if machine_free_sim(wc_id, search, slot_end):
                    sim_booked.setdefault(wc_id, []).append((search, slot_end))
                    piece_ops.append({
                        "op_name":  op["name"],
                        "wc_name":  op["wc_name"],
                        "start":    search.isoformat(),
                        "end":      slot_end.isoformat(),
                        "dur_mins": round(dur_hrs * 60),
                    })
                    current = slot_end
                    break
                # Find the earliest blocking interval end so we can try right after it.
                # Use working_intervals to get the actual occupied sub-ranges of our proposed slot.
                intervals = working_intervals(search, slot_end)
                earliest_block_end = None
                for ws, we in intervals:
                    # Check real DB blocks
                    real_block = db.query(ScheduledOp).filter(
                        ScheduledOp.work_center_id == wc_id,
                        ScheduledOp.scheduled_end  > ws,
                        ScheduledOp.scheduled_start < we,
                        ScheduledOp.status.in_(["scheduled","in_progress"])
                    ).order_by(ScheduledOp.scheduled_start).first()
                    if real_block and real_block.scheduled_end:
                        if earliest_block_end is None or real_block.scheduled_end < earliest_block_end:
                            earliest_block_end = real_block.scheduled_end
                    # Check sim blocks
                    for bs, be in sim_booked.get(wc_id, []):
                        if bs < we and be > ws:
                            if earliest_block_end is None or be < earliest_block_end:
                                earliest_block_end = be
                    if earliest_block_end:
                        break  # found earliest conflict, no need to check further intervals
                if earliest_block_end:
                    search = snap_to_shift(earliest_block_end)
                else:
                    search = next_shift_start(search)
            else:
                piece_ops.append({"op_name": op["name"], "wc_name": op["wc_name"],
                                   "start": None, "end": None, "dur_mins": round(dur_hrs*60)})

        finish = max((o["end"] for o in piece_ops if o["end"]), default=None)
        piece_results.append({"piece": piece+1, "ops": piece_ops,
                               "est_finish": finish})
        # track bottlenecks
        for o in piece_ops:
            bottlenecks[o["wc_name"]] = bottlenecks.get(o["wc_name"],0) + (o["dur_mins"] or 0)

    all_finishes = [r["est_finish"] for r in piece_results if r["est_finish"]]
    last_finish  = max(all_finishes) if all_finishes else None
    first_finish = min(all_finishes) if all_finishes else None

    total_mins = sum(op["total_hrs"]*60 for op in ops)
    bottleneck_sorted = sorted(bottlenecks.items(), key=lambda x: x[1], reverse=True)

    db.close()
    return {
        "routing_name":   routing.name,
        "quantity":       quantity,
        "start_date":     start_dt.isoformat(),
        "material_ready_date": material_ready.isoformat() if material_ready else None,
        "material_blocked": material_blocked,
        "est_first_finish": first_finish,
        "est_last_finish":  last_finish,
        "total_work_mins":  round(total_mins),
        "pieces":         piece_results,
        "bottlenecks":    [{"wc_name": n, "total_mins": round(m)} for n,m in bottleneck_sorted[:5]],
        "ops_summary":    [{"name": o["name"], "wc_name": o["wc_name"],
                            "dur_mins": round(o["total_hrs"]*60)} for o in ops],
    }


# ─────────────────────────────────────────────────────────────────────────────
# BULK PIECE OVERRIDE  (apply routing time changes to all pieces of an order)
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/api/orders/{order_id}/bulk-override")
def bulk_override_order(order_id: int, data: dict):
    """
    Apply op_overrides to every unstarted piece job in an order.
    Body: { op_overrides: [{operation_id, setup_time_mins, work_time_mins,
                             work_time_hrs, included}] }
    Pieces that are in_progress or completed are left untouched.
    """
    db = SessionLocal()
    order = db.query(CustomerOrder).filter(CustomerOrder.id == order_id).first()
    if not order: db.close(); raise HTTPException(404, "Order not found")

    overrides = data.get("op_overrides", [])
    if not overrides:
        db.close(); raise HTTPException(400, "op_overrides required")

    updated = skipped = 0
    for j in order.jobs:
        if j.status in ("completed", "in_progress"):
            skipped += 1; continue
        j.op_overrides = json.dumps(overrides)
        # Clear pending/scheduled ops so they get rescheduled with new times
        for s in list(j.scheduled_ops):
            if s.status in ("pending", "scheduled"):
                db.delete(s)
        j.status = "pending"
        updated += 1

    db.commit()
    db.close()
    return {"updated": updated, "skipped_active": skipped}


# ─────────────────────────────────────────────────────────────────────────────
# JOBS LIST WITH NEXT-OP  (enriched list for jobs page)
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/jobs/next-ops")
def jobs_next_ops():
    """Return next pending/scheduled op for every active job — used to show
    'Next: Facing on KAFO VMC, 21 May 10:00' on the job list row."""
    db = SessionLocal()
    jobs = db.query(Job).filter(Job.status.in_(["pending","scheduled","in_progress"])).all()
    result = {}
    fmt = lambda dt: dt.isoformat() if dt else None
    for j in jobs:
        pending = [s for s in sorted(j.scheduled_ops, key=lambda x: x.sequence)
                   if s.status in ("pending","scheduled")]
        if pending:
            nxt = pending[0]
            result[j.id] = {
                "op_name":  nxt.op_name,
                "wc_name":  nxt.wc_name,
                "worker_name": nxt.worker_name,
                "scheduled_start": fmt(nxt.scheduled_start),
                "status": nxt.status,
            }
        else:
            inprog = [s for s in j.scheduled_ops if s.status == "in_progress"]
            if inprog:
                result[j.id] = {
                    "op_name": inprog[0].op_name,
                    "wc_name": inprog[0].wc_name,
                    "worker_name": inprog[0].worker_name,
                    "scheduled_start": fmt(inprog[0].actual_start),
                    "status": "in_progress",
                }
    db.close()
    return result

# ─────────────────────────────────────────────────────────────────────────────
# REPORTS
# ─────────────────────────────────────────────────────────────────────────────
# ═════════════════════════════════════════════════════════════════════════════
# WORKER DAILY REPORT
# ═════════════════════════════════════════════════════════════════════════════

def _generate_worker_report(db, worker_id: int, report_date) -> dict:
    """
    Build (and upsert) a daily report for one worker on one date.
    Returns the report dict. Call db.commit() after.
    """
    from datetime import date as _date
    if isinstance(report_date, str):
        report_date = _date.fromisoformat(report_date[:10])

    day_start = datetime(report_date.year, report_date.month, report_date.day, 0, 0, 0)
    day_end   = datetime(report_date.year, report_date.month, report_date.day, 23, 59, 59)

    worker = db.query(Worker).filter(Worker.id == worker_id).first()
    if not worker:
        return {}

    # All ops scheduled for this worker on this date
    # "Scheduled for this day" = scheduled_start on this date
    sched_ops = db.query(ScheduledOp).filter(
        ScheduledOp.worker_id == worker_id,
        ScheduledOp.scheduled_start >= day_start,
        ScheduledOp.scheduled_start <= day_end,
    ).all()

    # Also include ops started on this day (actual_start)
    started_ops = db.query(ScheduledOp).filter(
        ScheduledOp.worker_id == worker_id,
        ScheduledOp.actual_start >= day_start,
        ScheduledOp.actual_start <= day_end,
    ).all()

    # Merge — use set of ids
    seen_ids = set()
    all_ops = []
    for s in list(sched_ops) + list(started_ops):
        if s.id not in seen_ids:
            seen_ids.add(s.id)
            all_ops.append(s)

    ops_scheduled = len(sched_ops)  # only count scheduled ops (not extras from actual_start)
    ops_completed = 0
    ops_started   = 0
    ops_missed    = 0
    est_hours     = 0.0
    actual_hours  = 0.0
    ops_detail    = []

    for s in all_ops:
        j = s.job
        est_mins    = round(s.work_time_hrs * 60, 1) if s.work_time_hrs else 0
        est_hours  += s.work_time_hrs or 0

        actual_mins = 0.0
        if s.actual_start and s.actual_end:
            actual_mins = (s.actual_end - s.actual_start).total_seconds() / 60
            actual_hours += actual_mins / 60
            ops_completed += 1
        elif s.actual_start:
            # Still in progress at report time — partial
            end_ref = now_ist() if s.actual_end is None else s.actual_end
            if end_ref > day_end: end_ref = day_end
            actual_mins = (end_ref - s.actual_start).total_seconds() / 60
            actual_hours += actual_mins / 60
            ops_started += 1
        elif s.scheduled_start and s.scheduled_start <= now_ist() and s.status == "scheduled":
            ops_missed += 1

        efficiency = round(actual_mins / est_mins * 100, 1) if est_mins > 0 and actual_mins > 0 else None

        ops_detail.append({
            "op_id":       s.id,
            "job_number":  j.job_number if j else "",
            "customer":    j.customer_name if j else "",
            "product":     f"{j.product_type} {j.product_size}".strip() if j else "",
            "op_name":     s.op_name,
            "machine":     s.wc_name,
            "status":      s.status,
            "est_mins":    est_mins,
            "actual_mins": round(actual_mins, 1),
            "efficiency":  efficiency,
            "scheduled_start": s.scheduled_start.isoformat() if s.scheduled_start else None,
            "actual_start":    s.actual_start.isoformat()    if s.actual_start    else None,
            "actual_end":      s.actual_end.isoformat()      if s.actual_end      else None,
        })

    overall_eff = round(actual_hours / est_hours * 100, 1) if est_hours > 0 and actual_hours > 0 else None

    # Upsert: delete existing report for same worker+date, then insert
    db.query(WorkerDailyReport).filter(
        WorkerDailyReport.worker_id   == worker_id,
        WorkerDailyReport.report_date == report_date,
    ).delete()

    rpt = WorkerDailyReport(
        report_date   = report_date,
        worker_id     = worker_id,
        worker_name   = worker.name,
        ops_scheduled = ops_scheduled,
        ops_completed = ops_completed,
        ops_started   = ops_started,
        ops_missed    = ops_missed,
        est_hours     = round(est_hours, 2),
        actual_hours  = round(actual_hours, 2),
        efficiency_pct= overall_eff,
        ops_detail    = json.dumps(ops_detail),
        generated_at  = now_ist(),
    )
    db.add(rpt)
    db.flush()

    return {
        "id":           rpt.id,
        "report_date":  report_date.isoformat(),
        "worker_id":    worker_id,
        "worker_name":  worker.name,
        "ops_scheduled":ops_scheduled,
        "ops_completed":ops_completed,
        "ops_started":  ops_started,
        "ops_missed":   ops_missed,
        "est_hours":    round(est_hours, 2),
        "actual_hours": round(actual_hours, 2),
        "efficiency_pct": overall_eff,
        "ops_detail":   ops_detail,
        "generated_at": rpt.generated_at.isoformat(),
    }


@app.post("/api/reports/daily/generate")
def generate_daily_reports(data: dict, user: dict = Depends(require_manager)):
    """
    Generate (or regenerate) daily reports for all workers for a given date.
    POST body: { "date": "2026-05-28" }
    If date is omitted, uses today.
    """
    from datetime import date as _date
    report_date_str = data.get("date") or now_ist().strftime("%Y-%m-%d")
    report_date = _date.fromisoformat(report_date_str[:10])

    db = SessionLocal()
    workers = db.query(Worker).filter(Worker.is_active == True).all()
    results = []
    for w in workers:
        rpt = _generate_worker_report(db, w.id, report_date)
        if rpt:
            results.append(rpt)
    db.commit(); db.close()
    return {"date": report_date_str, "reports": results, "count": len(results)}


@app.get("/api/reports/daily")
def list_daily_reports(
    date: str = None,
    worker_id: int = None,
    from_date: str = None,
    to_date: str = None,
    user: dict = Depends(require_manager)
):
    """
    List saved daily reports.
    Filter by date, worker_id, or date range (from_date / to_date).
    """
    from datetime import date as _date
    db = SessionLocal()
    q = db.query(WorkerDailyReport).order_by(
        WorkerDailyReport.report_date.desc(),
        WorkerDailyReport.worker_name
    )
    if date:
        d = _date.fromisoformat(date[:10])
        q = q.filter(WorkerDailyReport.report_date == d)
    if worker_id:
        q = q.filter(WorkerDailyReport.worker_id == worker_id)
    if from_date:
        q = q.filter(WorkerDailyReport.report_date >= _date.fromisoformat(from_date[:10]))
    if to_date:
        q = q.filter(WorkerDailyReport.report_date <= _date.fromisoformat(to_date[:10]))

    reports = q.limit(500).all()
    result = [{
        "id":           r.id,
        "report_date":  r.report_date.isoformat(),
        "worker_id":    r.worker_id,
        "worker_name":  r.worker_name,
        "ops_scheduled":r.ops_scheduled,
        "ops_completed":r.ops_completed,
        "ops_started":  r.ops_started,
        "ops_missed":   r.ops_missed,
        "est_hours":    r.est_hours,
        "actual_hours": r.actual_hours,
        "efficiency_pct": r.efficiency_pct,
        "ops_detail":   json.loads(r.ops_detail) if r.ops_detail else [],
        "generated_at": r.generated_at.isoformat() if r.generated_at else None,
    } for r in reports]
    db.close()
    return result


@app.get("/api/reports/daily/worker/{worker_id}")
def worker_report_history(
    worker_id: int,
    days: int = 30,
    user: dict = Depends(require_manager)
):
    """Last N days of daily reports for one worker — for trend charts."""
    from datetime import date as _date
    db = SessionLocal()
    cutoff = now_ist().date() - timedelta(days=days)
    reports = db.query(WorkerDailyReport).filter(
        WorkerDailyReport.worker_id   == worker_id,
        WorkerDailyReport.report_date >= cutoff,
    ).order_by(WorkerDailyReport.report_date).all()
    result = [{
        "report_date":   r.report_date.isoformat(),
        "ops_completed": r.ops_completed,
        "ops_missed":    r.ops_missed,
        "est_hours":     r.est_hours,
        "actual_hours":  r.actual_hours,
        "efficiency_pct":r.efficiency_pct,
    } for r in reports]
    db.close()
    return result


@app.get("/api/reports/summary")
def reports_summary():
    db = SessionLocal()
    now = now_ist()
    all_jobs  = db.query(Job).all()
    completed = [j for j in all_jobs if j.status == "completed"]
    on_time   = [j for j in completed if j.completed_at and j.due_date and j.completed_at <= j.due_date]
    late      = [j for j in completed if j.completed_at and j.due_date and j.completed_at >  j.due_date]
    total_rev = sum(j.total_price or 0 for j in all_jobs)
    last_30   = now - timedelta(days=30)
    recent_rev= sum(j.total_price or 0 for j in completed
                    if j.completed_at and j.completed_at >= last_30)
    on_time_rate = round(len(on_time)/len(completed)*100,1) if completed else 0
    monthly = {}
    for j in all_jobs:
        if not j.created_at: continue
        key = j.created_at.strftime("%Y-%m")
        monthly.setdefault(key, {"month":key,"jobs_created":0,"jobs_completed":0,
                                  "revenue":0,"late_count":0,"on_time_count":0})
        monthly[key]["jobs_created"] += 1
    for j in completed:
        if not j.completed_at: continue
        key = j.completed_at.strftime("%Y-%m")
        monthly.setdefault(key, {"month":key,"jobs_created":0,"jobs_completed":0,
                                  "revenue":0,"late_count":0,"on_time_count":0})
        monthly[key]["jobs_completed"] += 1
        monthly[key]["revenue"] += j.total_price or 0
        if j.completed_at > j.due_date: monthly[key]["late_count"] += 1
        else: monthly[key]["on_time_count"] += 1
    monthly_list = sorted(monthly.values(), key=lambda x: x["month"], reverse=True)[:12]
    monthly_list.reverse()
    cust = {}
    for j in all_jobs:
        if not j.customer_id: continue
        cust.setdefault(j.customer_id, {"customer_id":j.customer_id,"name":j.customer_name,
                                         "jobs":0,"revenue":0,"completed":0,"late":0})
        cust[j.customer_id]["jobs"] += 1
        cust[j.customer_id]["revenue"] += j.total_price or 0
        if j.status == "completed":
            cust[j.customer_id]["completed"] += 1
            if j.completed_at and j.completed_at > j.due_date:
                cust[j.customer_id]["late"] += 1
    top_customers = sorted(cust.values(), key=lambda x: x["revenue"], reverse=True)[:10]
    late_jobs = [j for j in all_jobs if j.status != "completed" and j.due_date and j.due_date < now]
    upcoming_end = now + timedelta(days=30)
    wcs = db.query(WorkCenter).all()
    machine_load = []
    for wc in wcs:
        ops = db.query(ScheduledOp).filter(
            ScheduledOp.work_center_id == wc.id,
            ScheduledOp.scheduled_start >= now,
            ScheduledOp.scheduled_start <= upcoming_end,
            ScheduledOp.status.in_(["scheduled","in_progress"])
        ).all()
        total_hrs = sum((o.scheduled_end - o.scheduled_start).total_seconds()/3600
                        for o in ops if o.scheduled_start and o.scheduled_end)
        machine_load.append({"name":wc.name,"type":wc.machine_type,
                              "hours":round(total_hrs,1),"ops_count":len(ops)})
    machine_load.sort(key=lambda x: x["hours"], reverse=True)
    db.close()
    return {
        "totals": {
            "total_jobs": len(all_jobs), "completed_jobs": len(completed),
            "on_time_jobs": len(on_time), "late_jobs": len(late),
            "on_time_rate": on_time_rate,
            "total_revenue": round(total_rev,2), "recent_revenue_30d": round(recent_rev,2),
            "currently_late": len(late_jobs),
        },
        "monthly": monthly_list, "top_customers": top_customers,
        "late_jobs": [{"id":j.id,"job_number":j.job_number,"customer_name":j.customer_name,
                        "due_date":j.due_date.isoformat(),"days_late":(now-j.due_date).days,
                        "status":j.status} for j in late_jobs],
        "machine_load": machine_load[:15],
    }

# ─────────────────────────────────────────────────────────────────────────────
# SEED / UTILITY
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/api/backfill-codes")
def backfill_codes(user: dict = Depends(require_admin)):
    db = SessionLocal()
    updated = 0
    for wc in db.query(WorkCenter).order_by(WorkCenter.id).all():
        if not wc.code:
            wc.code = f"M{wc.id}"; updated += 1
    for w in db.query(Worker).order_by(Worker.id).all():
        if not w.code:
            w.code = f"W{w.id:02d}"; updated += 1
    db.commit(); db.close(); return {"updated": updated}

@app.post("/api/seed-real")
def seed_real(data: dict, user: dict = Depends(require_admin)):
    db = SessionLocal()
    force = data.get("force", False)
    if not force and (db.query(Worker).count() > 0 or db.query(WorkCenter).count() > 0):
        db.close()
        return {"msg": "Already has data — pass force:true to overwrite", "has_data": True}
    workers_data = [
        ("W01","Shreyans","Operator","+91"),("W02","Sonu","Operator","+91"),
        ("W03","Anil","Operator","+91"),("W04","Jignesh","Operator","+91"),
        ("W05","Rajkumar","Senior Operator","+91"),("W06","Ravinder","VMC Operator","+91"),
        ("W07","Nilesh","VMC Operator","+91"),("W08","Krishnkant","Drill Operator","+91"),
        ("W09","Suraj","Operator","+91"),("W10","Atul","Grinder Operator","+91"),
    ]
    wmap = {}
    for code,name,role,phone in workers_data:
        w = Worker(code=code,name=name,role=role,phone=phone,is_active=True)
        db.add(w); db.flush(); wmap[name]=w
    machines_data = [
        ("M1","Edge Grinder","Grinder",True,"active",["Rajkumar","Atul","Sonu"]),
        ("M2","DC Surface Grinder","Grinder",True,"active",["Atul","Sonu","Shreyans"]),
        ("M3","Edge Grinder 2","Grinder",False,"active",["Rajkumar","Atul","Sonu"]),
        ("M4","Profile Grinder","Grinder",False,"active",["Sonu"]),
        ("M5","Router CNC","VMC",False,"active",["Ravinder","Nilesh","Krishnkant"]),
        ("M6","Planar Mill","Milling Machine",False,"active",["Rajkumar","Sonu","Shreyans","Suraj","Ravinder","Anil"]),
        ("M7","Edge Mill","Milling Machine",False,"active",["Rajkumar","Sonu","Shreyans","Suraj","Ravinder","Anil"]),
        ("M8","KAFO VMC","VMC",True,"active",["Ravinder","Nilesh","Krishnkant"]),
        ("M9","DC VMC","VMC",True,"active",["Ravinder","Nilesh","Krishnkant"]),
        ("M10","Radial Drill","Drill",False,"active",["Krishnkant","Anil","Sonu"]),
        ("M11","Universal Mill 1","Milling Machine",False,"maintenance",["Rajkumar","Anil","Sonu"]),
        ("M12","Universal Mill 2","Milling Machine",False,"active",["Rajkumar","Anil","Sonu"]),
        ("M13","Universal Mill 3","Milling Machine",False,"active",["Rajkumar","Anil","Sonu"]),
        ("M14","Big Edge Mill","Milling Machine",True,"active",["Rajkumar","Sonu","Shreyans","Suraj","Ravinder"]),
        ("M15","Rubberizing","Hydraulic Press",False,"active",["Jignesh","Shreyans","Anil"]),
        ("M16","Welding","Welding",False,"active",["Anil","Sonu"]),
        ("M17","Liner Assembly","Assembly",False,"active",["Sonu"]),
        ("M18","Mould Assembly","Assembly",False,"active",["Sonu","Shreyans"]),
        ("M19","Oil Station","Pump",False,"active",["Jignesh","Shreyans","Anil"]),
        ("M20","Magnet Drill","Drill",False,"active",["Krishnkant","Anil","Sonu"]),
        ("M21","Carbide Fitting","Assembly",False,"active",["Sonu","Shreyans"]),
        ("M22","Sand Blasting","Assembly",False,"active",["Rajkumar","Sonu","Shreyans","Suraj","Ravinder","Jignesh","Anil"]),
    ]
    for code,name,mtype,bot,status,can_ops in machines_data:
        wc = WorkCenter(code=code,name=name,machine_type=mtype,is_bottleneck=bot,status=status)
        db.add(wc); db.flush()
        for wname in can_ops:
            if wname in wmap: wc.skilled_workers.append(wmap[wname])
    db.commit(); db.close()
    return {"msg":"Real data seeded","workers":len(workers_data),"machines":len(machines_data)}

@app.post("/api/seed-punch-routings")
def seed_punch_routings(user: dict = Depends(require_admin)):
    """
    Seed all 8 standard Punch routings with formula-based op times.
    Formula types, MRR, and depth values sourced from punch_lead_time.xlsx.
    Machine lookup is flexible — tries multiple name variants.
    Skips routings that already exist (safe to re-run).
    Product types match Order page: Lower Punch, Upper Punch, Iso Lower Punch, Iso Upper Punch.
    """
    db = SessionLocal()

    def find_wc(*keywords):
        for kw in keywords:
            wc = db.query(WorkCenter).filter(
                func.lower(WorkCenter.name).contains(kw.lower())
            ).first()
            if wc: return wc
        return None

    # Machine lookup matching Yukeng_Setup.txt names
    M = {
        "radial_drill":  find_wc("Radial Drill","Big Radial","Drill"),
        "dc_vmc":        find_wc("DC VMC","Double Column VMC","DCVMC"),
        "big_edge_mill": find_wc("Big Edge Mill","Big Edge","Edge Mill"),
        "welding":       find_wc("Welding"),
        "dc_surface":    find_wc("DC Surface","Double Column Surface","Surface Grinder"),
        "edge_grinder":  find_wc("Edge Grinder","Profile Grinder","Grinder"),
        "edge_mill":     find_wc("Edge Mill","Universal Milling","Step Milling","Big Edge"),
        "kafo_vmc":      find_wc("KAFO VMC","KAFO","Kafo"),
        "sandblasting":  find_wc("Sand Blasting","Sandblasting","Sand"),
        "rubberizing":   find_wc("Rubberizing","Rubber"),
        "univ_mill2":    find_wc("Universal Milling 2","Universal Mill 2","Universal Milling"),
    }

    missing = {k for k,v in M.items() if v is None}
    if missing:
        db.close()
        raise HTTPException(400,
            f"Could not find machines for: {', '.join(sorted(missing))}. "
            f"Please run 'Load Real Setup' first.")

    # ── Op definitions from punch_lead_time.xlsx ──────────────────────────────
    # Tuple: (name, machine_key, setup, ftype, mrr, depth, feed_rate, dim_x, dim_y, mach_fixed)
    # dim_x/dim_y: 'length','width','thickness' — must match Excel DimX/DimY columns
    # Surface Grinding formula: (DimY+50)*Depth*2/2.5 * (DimX+250)/20000
    # Volume/Single Side:       DimX * DimY * Depth / MRR
    # ─────────────────────────────────────────────────────────────────────────

    # Shared ops                                                       mrr    depth feed  dx          dy          fixed
    LIFTING = ("Lifting Holes",    "radial_drill",  20, "Fixed",                   None,  None, None, None,       None,        30)
    FACING  = ("Facing",           "dc_vmc",        20, "Volume Milling",           35000, 5,    None, 'length',   'width',      0)
    SIDE1   = ("Side Cutting 1",   "big_edge_mill", 20, "Perimeter Milling Single Side", 6300, 10, None, 'length',   'thickness',  0)
    SIDE2   = ("Side Cutting 2",   "big_edge_mill", 20, "Perimeter Milling Single Side", 6300, 10, None, 'width',    'thickness',  0)
    WELD    = ("Welding",          "welding",       20, "Perimeter Welding",        None,  None, None, None,       None,         0)
    SURF_GR = ("Surface Grinding", "dc_surface",    10, "Surface Grinding",         None,  2,    None, 'length',   'width',      0)
    SAND_S  = ("Sandblasting",     "sandblasting",  20, "Sandblasting",             12000, None, None, None,       None,         0)
    RUB_FIN = ("Rubberizing",      "rubberizing",   20, "Fixed",                    None,  None, None, None,       None,        40)

    # Small ops
    EDGEGR1   = ("Edge Grinding Side 1",  "edge_grinder", 10, "Surface Grinding",              None,  5,    None, 'length',   'thickness',  0)
    EDGEGR2   = ("Edge Grinding Side 2",  "edge_grinder", 10, "Surface Grinding",              None,  5,    None, 'width',    'thickness',  0)
    STEP_L1_S = ("Step Milling Side 1",   "edge_mill",    20, "Perimeter Milling Single Side", 6300,  4,    None, 'length',   'thickness',  0)
    STEP_U1_S = ("Step Milling Side 1",   "edge_mill",    20, "Perimeter Milling Single Side", 6300,  2,    None, 'length',   'thickness',  0)
    STEP_L2_S = ("Step Milling Side 2",   "edge_mill",    20, "Perimeter Milling Single Side", 6300,  4,    None, 'width',    'thickness',  0)
    STEP_U2_S = ("Step Milling Side 2",   "edge_mill",    20, "Perimeter Milling Single Side", 6300,  2,    None, 'width',    'thickness',  0)
    RUB_MILL_S= ("Rubber Depth Milling",  "kafo_vmc",     20, "Volume Milling",                9375,  0.5,  None, 'length',   'width',      0)
    RAD_S     = ("Radius Milling",        "kafo_vmc",      5, "Perimeter Milling",             None,  None, 250,  None,       None,         0)
    RMOV      = ("Removal Slot",          "univ_mill2",   20, "Fixed",                         None,  None, None, None,       None,        30)

    # Big ops
    STEP_FULL = ("Step Milling",          "dc_vmc",       10, "Perimeter Milling Full",        None,  None, 1000, None,       None,         0)
    EDGE_SIZ  = ("Edge Sizing",           "kafo_vmc",     10, "Perimeter Side Milling",        None,  10,   250,  None,       None,         0)
    RUB_MILL_B= ("Rubber Depth Milling",  "kafo_vmc",     20, "Volume Milling",                9375,  0.5,  None, 'length',   'width',      0)
    RAD_B     = ("Radius Milling",        "kafo_vmc",      5, "Perimeter Milling",             None,  None, 250,  None,       None,         0)
    SAND_B    = ("Sandblasting",          "sandblasting", 20, "Sandblasting",                  12000, None, None, None,       None,         0)

    # Iso-only op
    ISO_MILL  = ("Iso Depth Milling",     "dc_vmc",       20, "Volume Milling",                56250, 11, None, 'length', 'width', 0)

    def make_ops(ops_list):
        """Assign sequential numbers as first element (seq_no, name, mkey, setup, ftype, mrr, depth, feed_rate, dim_x, dim_y, mach_fixed)."""
        return [(i+1,)+op for i, op in enumerate(ops_list)]

    ROUTINGS = [
        # ── Non-Iso ───────────────────────────────────────────────────────────
        {"name": "Lower Punch — Small (≤ 600×600)", "product_type": "Punch",
         "description": "Non-Iso Lower Punch, small size (≤600mm).", "lead_days": 2.0,
         "ops": make_ops([LIFTING, FACING, SIDE1, SIDE2, WELD, SURF_GR,
                          EDGEGR1, EDGEGR2, STEP_L1_S, STEP_L2_S,
                          RUB_MILL_S, RAD_S, RMOV, SAND_S, RUB_FIN])},
        {"name": "Upper Punch — Small (≤ 600×600)", "product_type": "Punch",
         "description": "Non-Iso Upper Punch, small size (≤600mm).", "lead_days": 2.0,
         "ops": make_ops([LIFTING, FACING, SIDE1, SIDE2, WELD, SURF_GR,
                          EDGEGR1, EDGEGR2, STEP_U1_S, STEP_U2_S,
                          RUB_MILL_S, RAD_S, RMOV, SAND_S, RUB_FIN])},
        {"name": "Lower Punch — Big (> 600×600)", "product_type": "Punch",
         "description": "Non-Iso Lower Punch, large size (>600mm).", "lead_days": 3.0,
         "ops": make_ops([LIFTING, FACING, SIDE1, SIDE2, WELD, SURF_GR,
                          STEP_FULL, EDGE_SIZ, RUB_MILL_B, RAD_B, SAND_B, RUB_FIN])},
        {"name": "Upper Punch — Big (> 600×600)", "product_type": "Punch",
         "description": "Non-Iso Upper Punch, large size (>600mm).", "lead_days": 3.0,
         "ops": make_ops([LIFTING, FACING, SIDE1, SIDE2, WELD, SURF_GR,
                          STEP_FULL, EDGE_SIZ, RUB_MILL_B, RAD_B, SAND_B, RUB_FIN])},
        # ── Iso ──────────────────────────────────────────────────────────────
        {"name": "Iso Lower Punch — Small (≤ 600×600)", "product_type": "Punch",
         "description": "Isostatic Lower Punch, small size (≤600mm).", "lead_days": 2.0,
         "ops": make_ops([LIFTING, FACING, SIDE1, SIDE2, ISO_MILL, WELD, SURF_GR,
                          EDGEGR1, EDGEGR2, STEP_L1_S, STEP_L2_S,
                          RAD_S, RMOV, SAND_S, RUB_FIN])},
        {"name": "Iso Upper Punch — Small (≤ 600×600)", "product_type": "Punch",
         "description": "Isostatic Upper Punch, small size (≤600mm).", "lead_days": 2.0,
         "ops": make_ops([LIFTING, FACING, SIDE1, SIDE2, ISO_MILL, WELD, SURF_GR,
                          EDGEGR1, EDGEGR2, STEP_U1_S, STEP_U2_S,
                          RAD_S, RMOV, SAND_S, RUB_FIN])},
        {"name": "Iso Lower Punch — Big (> 600×600)", "product_type": "Punch",
         "description": "Isostatic Lower Punch, large size (>600mm).", "lead_days": 3.0,
         "ops": make_ops([LIFTING, FACING, SIDE1, SIDE2, ISO_MILL, WELD, SURF_GR,
                          STEP_FULL, EDGE_SIZ, RAD_B, SAND_B, RUB_FIN])},
        {"name": "Iso Upper Punch — Big (> 600×600)", "product_type": "Punch",
         "description": "Isostatic Upper Punch, large size (>600mm).", "lead_days": 3.0,
         "ops": make_ops([LIFTING, FACING, SIDE1, SIDE2, ISO_MILL, WELD, SURF_GR,
                          STEP_FULL, EDGE_SIZ, RAD_B, SAND_B, RUB_FIN])},
    ]

    created = []; skipped = []
    for rdef in ROUTINGS:
        if db.query(Routing).filter(Routing.name == rdef["name"]).first():
            skipped.append(rdef["name"]); continue

        r = Routing(name=rdef["name"],
                    product_type=rdef["product_type"],
                    description=rdef["description"],
                    material_lead_days=rdef["lead_days"],
                    is_active=True)
        db.add(r); db.flush()

        for op_tuple in rdef["ops"]:
            seq_no, name, mkey, setup, ftype, mrr, depth, feed_rate_val, dim_x, dim_y, mach_fixed = op_tuple
            wc = M[mkey]
            db.add(Operation(
                routing_id=r.id, sequence=seq_no, name=name,
                work_center_id=wc.id,
                machine_setup_mins=0, job_setup_mins=setup,
                setup_time_mins=setup,
                work_time_hrs=0, work_time_mins=0,
                is_optional=False,
                formula_type=ftype,
                mrr=float(mrr) if mrr else None,
                depth_mm=float(depth) if depth is not None else None,
                feed_rate=float(feed_rate_val) if feed_rate_val else None,
                dim_x_source=dim_x,
                dim_y_source=dim_y,
            ))

        db.flush()
        created.append(rdef["name"])

    db.commit(); db.close()
    return {
        "msg": f"Created {len(created)} Punch routing template(s). "
               f"Delete existing ones first if you want to re-seed.",
        "created": created,
        "skipped_existing": skipped,
    }




# ─────────────────────────────────────────────────────────────────────────────
# FLOOR PLAN ENDPOINTS
# NOTE: All static routes (/details, /load-today, /assignments/now) MUST be
# defined BEFORE the wildcard route /{machine_code}/today to avoid FastAPI
# routing the static segments as path parameters.
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/machines/details")
def fp_machine_details():
    """All machine metadata + floor coordinates matching actual factory layout."""
    db = SessionLocal()
    machines = db.query(WorkCenter).all()
    # Coordinates based on Yukeng factory floor plan (image provided)
    # SVG canvas: 1400 wide x 520 tall
    # Layout has 2 main rows separated by a dashed aisle line
    # Top row: M21, M7, M8, M9, M10/M20, M11, M12, M13, M14, M17, M15, M16, M22
    # Bottom row: M6/M5, Viper(M13alt), M4, M3, M2, M1/M19, M18
    coords = {
        # TOP ROW — upper section machines
        'M21': (20,  120, 80, 100),   # Carbide Fitting — far left top
        'M7':  (130, 175, 80,  80),   # Radial Drill — left top
        'M8':  (260, 155, 120, 100),  # Kafo VMC — wide machine
        'M9':  (420, 155, 120, 100),  # DC VMC
        'M10': (575, 155,  90,  60),  # Radial Drill M10
        'M20': (575, 230,  90,  55),  # Magnet Drill M20 — stacked below M10
        'M11': (690, 155,  90, 100),  # Universal Mill 1
        'M12': (800, 155,  90, 100),  # Universal Mill 2
        'M13': (910, 155,  90, 100),  # Universal Mill 3 (Viper)
        'M14': (1040,155, 140, 100),  # Big Edge Milling — wide
        'M17': (1250,155,  90, 100),  # Liner Assembly
        'M15': (1000, 35, 280,  80),  # Rubberizing Area — top right wide
        'M16': (1360, 35,  80, 180),  # Welding — far right tall
        'M22': (1360,145,  80,  80),  # Sandblasting — top far right (above M16)
        # BOTTOM ROW — lower section (below aisle)
        'M6':  (20,  340,  80, 130),  # Planer Milling — far left bottom
        'M5':  (20,  490,  80,  80),  # Router CNC — below M6
        'M4':  (260, 380, 120, 120),  # Profile Grinder
        'M3':  (420, 380, 120, 120),  # Edge Grinder 2
        'M2':  (600, 380, 170, 120),  # DC Surface Grinder — wide
        'M1':  (870, 380, 120, 120),  # Edge Grinder
        'M19': (1020,390,  90,  80),  # Oil Station
        'M18': (1250,340, 100, 100),  # Mould Assembly
    }
    result = {}
    for m in machines:
        if m.code in coords:
            x, y, w, h = coords[m.code]
        else:
            x, y, w, h = 0, 0, 80, 60
        result[m.code] = {
            'name': m.name,
            'type': m.machine_type or 'General',
            'status': m.status or 'active',
            'skill_level': m.skill_level or 1,
            'x': x, 'y': y, 'width': w, 'height': h,
        }
    db.close()
    return result


@app.get("/api/machines/load-today")
def fp_load_today():
    """Hours booked per machine today — uses work_time_hrs (correct field on ScheduledOp)."""
    db = SessionLocal()
    today = now_ist().date()
    today_start = datetime(today.year, today.month, today.day)
    today_end   = today_start + timedelta(days=1)
    rows = db.query(
        ScheduledOp.work_center_id,
        func.sum(ScheduledOp.work_time_hrs).label('hrs')
    ).filter(
        ScheduledOp.scheduled_start >= today_start,
        ScheduledOp.scheduled_start <  today_end,
        ScheduledOp.status.in_(['scheduled','in_progress','paused'])
    ).group_by(ScheduledOp.work_center_id).all()

    load_map = {}
    for r in rows:
        m = db.query(WorkCenter).filter(WorkCenter.id == r.work_center_id).first()
        if m:
            load_map[m.code] = round(float(r.hrs or 0), 1)

    all_m = db.query(WorkCenter).all()
    result = {m.code: load_map.get(m.code, 0) for m in all_m}
    db.close()
    return result


@app.get("/api/machines/status-today")
def fp_status_today():
    """Per-machine operational status for today — breakdown > maintenance > in_progress > scheduled > available.
    IMPORTANT: Must be defined BEFORE /{machine_code}/today wildcard."""
    db = SessionLocal()
    today = now_ist().date()
    today_start = datetime(today.year, today.month, today.day)
    today_end   = today_start + timedelta(days=1)

    all_m = db.query(WorkCenter).all()
    result = {}
    for m in all_m:
        # Machine-level status first
        if m.status == 'breakdown':
            result[m.code] = 'breakdown'
            continue
        if m.status == 'maintenance':
            result[m.code] = 'maintenance'
            continue
        # Check live operations
        has_running = db.query(ScheduledOp).filter(
            ScheduledOp.work_center_id == m.id,
            ScheduledOp.status == 'in_progress'
        ).first()
        if has_running:
            result[m.code] = 'in_progress'
            continue
        has_scheduled = db.query(ScheduledOp).filter(
            ScheduledOp.work_center_id == m.id,
            ScheduledOp.scheduled_start >= today_start,
            ScheduledOp.scheduled_start <  today_end,
            ScheduledOp.status.in_(['scheduled','paused'])
        ).first()
        if has_scheduled:
            result[m.code] = 'scheduled'
            continue
        result[m.code] = 'available'

    db.close()
    return result


@app.get("/api/machines/assignments/now")
def fp_assignments_now():
    """Which worker is currently on which machine (in_progress ops only).
    IMPORTANT: This must be defined BEFORE /{machine_code}/today."""
    db = SessionLocal()
    in_prog = db.query(ScheduledOp).filter(ScheduledOp.status == 'in_progress').all()
    result = {}
    for op in in_prog:
        if not (op.work_center_id and op.worker_id):
            continue
        m = db.query(WorkCenter).filter(WorkCenter.id == op.work_center_id).first()
        w = db.query(Worker).filter(Worker.id == op.worker_id).first()
        if m and w:
            j = db.query(Job).filter(Job.id == op.job_id).first()
            result[m.code] = {
                'worker_code': w.code,
                'worker_name': w.name,
                'job_number':  op.job.job_number if op.job else 'N/A',
                'op_name':     op.op_name,
                'start_time':  op.actual_start.isoformat() if op.actual_start else None,
            }
    db.close()
    return result


@app.get("/api/machines/{machine_code}/today")
def fp_machine_today(machine_code: str):
    """All ops on a specific machine for today, with job + worker info."""
    db = SessionLocal()
    m = db.query(WorkCenter).filter(WorkCenter.code == machine_code).first()
    if not m:
        db.close()
        raise HTTPException(404, f"Machine {machine_code} not found")

    today = now_ist().date()
    today_start = datetime(today.year, today.month, today.day)
    today_end   = today_start + timedelta(days=1)

    ops = db.query(ScheduledOp).filter(
        ScheduledOp.work_center_id == m.id,
        ScheduledOp.scheduled_start >= today_start,
        ScheduledOp.scheduled_start <  today_end,
        ScheduledOp.status.in_(['scheduled','in_progress','paused','completed'])
    ).order_by(ScheduledOp.scheduled_start).all()

    ops_out = []
    for op in ops:
        ops_out.append({
            'id':                 op.id,
            'job_number':         op.job.job_number if op.job else 'N/A',
            'operation_name':     op.op_name,
            'worker_code':        op.worker.code if op.worker else 'Unassigned',
            'worker_name':        op.worker_name or 'Unassigned',
            'status':             op.status,
            'scheduled_start':    op.scheduled_start.isoformat() if op.scheduled_start else None,
            'estimated_duration': round(op.work_time_hrs or 0, 2),
            'actual_duration':    round((op.actual_end - op.actual_start).total_seconds() / 3600, 2) if op.actual_start and op.actual_end else None,
        })
    db.close()
    return {'machine_code': machine_code, 'machine_name': m.name,
            'total_capacity_hours': 10, 'ops': ops_out}


# ── Company logo (base64-encoded for embedding in printable HTML) ─────────────
# Cached at module load so we read the file once, not on every request.
_LOGO_CACHE: dict = {"data_url": None, "loaded": False}

def _load_logo_data_url() -> str | None:
    """Read logo from disk and return as a `data:image/...;base64,...` string.
    Tries common filenames in priority order so it works regardless of which
    variant the user has dropped in. Result is cached for the lifetime of the
    process — restart the server to pick up a new logo file.
    """
    if _LOGO_CACHE["loaded"]:
        return _LOGO_CACHE["data_url"]
    _LOGO_CACHE["loaded"] = True

    import os, base64
    here = os.path.dirname(os.path.abspath(__file__))
    # Priority: logo.png is the canonical company logo (used by the quotation
    # PDF generator too). Transparent variants are alternates the user may have
    # dropped in. Order from most-preferred to last-resort fallback.
    candidates = [
        "logo.png",
        "logo_black_transparent.png",
        "logo_new_transparent.png",
        "logo_black_3.png",
        "logo_original.png",
    ]
    for name in candidates:
        p = os.path.join(here, name)
        if os.path.exists(p):
            try:
                with open(p, "rb") as f:
                    b = f.read()
                ext = name.rsplit(".", 1)[-1].lower()
                mime = "image/png" if ext == "png" else f"image/{ext}"
                _LOGO_CACHE["data_url"] = f"data:{mime};base64," + base64.b64encode(b).decode("ascii")
                return _LOGO_CACHE["data_url"]
            except Exception:
                continue
    return None


@app.get("/api/company-logo")
def get_company_logo(user: dict = Depends(require_any)):
    """Return the company logo as a base64 data URL for embedding in printable
    documents (dispatch sheet, etc.). Returns null if no logo file is present."""
    return {"data_url": _load_logo_data_url()}


# ── Daily Dispatch Sheet ──────────────────────────────────────────────────────
@app.get("/api/dispatch")
def get_dispatch(date: str = None, user: dict = Depends(require_any)):
    """
    Return scheduled ops for a given date (default: tomorrow) grouped by worker.
    Used by the manager at end-of-day to prepare the next day's work dispatch sheet.
    Query param: date=YYYY-MM-DD  (defaults to tomorrow IST)
    """
    db = SessionLocal()
    try:
        if date:
            try:
                target = datetime.strptime(date, "%Y-%m-%d").date()
            except ValueError:
                raise HTTPException(400, "Invalid date format, use YYYY-MM-DD")
        else:
            target = (now_ist() + timedelta(days=1)).date()

        t_start = datetime(target.year, target.month, target.day, 0, 0)
        t_end   = datetime(target.year, target.month, target.day, 23, 59)

        ops = (
            db.query(ScheduledOp)
            .filter(
                ScheduledOp.status.in_(["scheduled", "in_progress", "paused"]),
                ScheduledOp.scheduled_start != None,
                ScheduledOp.scheduled_end   != None,
                ScheduledOp.scheduled_start <= t_end,
                ScheduledOp.scheduled_end   >= t_start,
            )
            .order_by(ScheduledOp.worker_name, ScheduledOp.scheduled_start)
            .all()
        )

        fmt = lambda dt: dt.isoformat() if dt else None

        # Pre-fetch all referenced WorkCenters and CustomerOrders in single
        # queries — avoids N+1 lookups in the loop below.
        wc_ids = {s.work_center_id for s in ops if s.work_center_id}
        wc_codes_by_id = {
            wc.id: wc.code
            for wc in db.query(WorkCenter).filter(WorkCenter.id.in_(wc_ids)).all()
        } if wc_ids else {}

        order_ids = {j.order_id for j in (s.job for s in ops) if j.order_id}
        orders_by_id = {
            o.id: o
            for o in db.query(CustomerOrder).filter(CustomerOrder.id.in_(order_ids)).all()
        } if order_ids else {}

        result = []
        for s in ops:
            j = s.job

            # ── Product name: type + size + variant ────────────────────────
            # The variant (e.g. "Lower Plain", "Upper Carbide") disambiguates
            # the many sub-types of each product. Without it, "Punch 200×200"
            # is ambiguous since you make Plain/Panel/Rustic and Upper/Lower
            # variants at the same size.
            product_name = " ".join(filter(None, [
                j.product_type, j.product_size, j.product_variant
            ])).strip() or "—"

            # ── Order context: ORD-XXXX-NNN  P5/8 ──────────────────────────
            # Job code is the primary ID (unique per piece) but the order +
            # piece-position gives the worker context: "this is piece 5 of 8
            # for the Milota order".
            order_context = ""
            if j.order_id and j.order_id in orders_by_id:
                o = orders_by_id[j.order_id]
                if j.piece_number and o.quantity:
                    order_context = f"{o.order_number}  P{j.piece_number}/{o.quantity}"
                else:
                    order_context = o.order_number

            # ── Assembly context: which component within a mould this is ──
            asm_context = ""
            if j.order_id:
                comp_link = db.query(OrderComponent).filter(OrderComponent.job_id == j.id).first()
                if comp_link:
                    asm_context = comp_link.name

            # ── Machine display: "DC Surface Grinder (M14)" ────────────────
            wc_code = wc_codes_by_id.get(s.work_center_id) if s.work_center_id else None
            wc_display = f"{s.wc_name} ({wc_code})" if wc_code else (s.wc_name or "—")

            est_mins = (s.setup_time_mins or 0) + (
                s.work_time_mins if s.work_time_mins else round((s.work_time_hrs or 0) * 60, 1)
            )

            result.append({
                "op_id":         s.id,
                "job_id":        j.id,
                "job_number":    j.job_number,
                "product_name":  product_name,
                "order_context": order_context,
                "assembly_context": asm_context,
                "customer":      j.customer_name,
                "op_name":       s.op_name,
                "wc_name":       wc_display,
                "worker_id":     s.worker_id,
                "worker_name":   s.worker_name or "Unassigned",
                "est_mins":      est_mins,
                "setup_mins":    s.setup_time_mins or 0,
                "work_mins":     s.work_time_mins if s.work_time_mins else round((s.work_time_hrs or 0) * 60, 1),
                "scheduled_start": fmt(s.scheduled_start),
                "scheduled_end":   fmt(s.scheduled_end),
                "status":        s.status,
                "priority":      j.priority_flag,
                "due_date":      fmt(j.due_date),
                "op_type":       getattr(s, "op_type", "inhouse") or "inhouse",
                "outside_vendor": getattr(s, "outside_vendor", None) or "",
                "job_notes":     (j.notes or "").strip(),
                "notes":         getattr(s, "pause_notes", None) or "",
            })

        return result
    finally:
        db.close()


# ── SPA catch-all — MUST be the very last route ──────────────────────────────
# FastAPI matches routes in registration order. This must come after ALL /api/*
# routes so it only catches frontend paths like /dashboard, /jobs, /orders/123.
# FastAPI strips the leading slash: full_path = "jobs" not "/jobs"
@app.get("/{full_path:path}")
def spa_fallback(full_path: str, request: Request):
    if (full_path.startswith("api/") or full_path == "api"
            or full_path.startswith("static/")
            or full_path.endswith(".js") or full_path.endswith(".css")
            or full_path.endswith(".ico") or full_path.endswith(".png")):
        raise HTTPException(404, "Not found")
    return FileResponse("index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
