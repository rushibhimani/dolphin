import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker
from datetime import datetime, timedelta, date
from models import (Base, WorkCenter, Worker, WorkerLeave, worker_skills,
                    Customer, Routing, Operation, Job, ScheduledOp,
                    JobCounter, CustomerOrder, OrderCounter, now_ist)
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
            print("⚠ Alembic issue, using create_all fallback")
            Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"⚠ Migration warning: {e}, using create_all fallback")
        Base.metadata.create_all(bind=engine)

run_migrations()

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
            # work time: prefer work_time_mins override, else work_time_hrs, then op default
            if ov.get("work_time_mins") is not None and float(ov.get("work_time_mins",0)) > 0:
                work = float(ov["work_time_mins"]) / 60.0
            elif ov.get("work_time_hrs") is not None:
                work = float(ov["work_time_hrs"])
            else:
                work = float(op.work_time_hrs or 0)
            ops.append({
                "name":              op.name,
                "work_center_id":    op.work_center_id,
                "machine_setup_mins": m_setup,
                "job_setup_mins":     j_setup,
                "setup_time_mins":    m_setup + j_setup,
                "work_time_hrs":      work,
                "is_optional":        op.is_optional,
                "operation_id":       op.id,
            })

    elif j.inline_ops:
        try:
            raw = json.loads(j.inline_ops)
        except Exception:
            return []
        for i, op in enumerate(raw):
            m_setup = float(op.get("machine_setup_mins", op.get("setup_time_mins", 0)))
            j_setup = float(op.get("job_setup_mins", 0))
            work    = float(op.get("work_time_hrs", 0))
            ops.append({
                "name":              op.get("name", f"Step {i+1}"),
                "work_center_id":    int(op["work_center_id"]),
                "machine_setup_mins": m_setup,
                "job_setup_mins":     j_setup,
                "setup_time_mins":    m_setup + j_setup,
                "work_time_hrs":      work,
                "is_optional":        bool(op.get("is_optional", False)),
                "operation_id":       None,   # no DB operation row for inline
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
            # Leave this op as unscheduled pending, continue chain from same time
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
            # BUG-FIX #5: do NOT freeze current_start — keep advancing
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
    statuses = {j.status for j in order.jobs}
    if all(s == "completed" for s in statuses):
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
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/")
def root(): return FileResponse("index.html")

@app.get("/api/health")
def health(): return {"status": "ok", "time_ist": now_ist().isoformat()}

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
    if "status" in data: wc.status = data["status"]
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
               is_active=True, code=wcode, skill_level=int(data.get("skill_level",1)))
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
    lv = WorkerLeave(worker_id=worker_id, leave_date=parse_date(data["date"]),
                     leave_type=data.get("type","full"),
                     start_time=data.get("start_time"), end_time=data.get("end_time"),
                     reason=data.get("reason",""))
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
# CUSTOMERS
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
def routing_dict(r, db=None):
    ops = [{"id": o.id, "sequence": o.sequence, "name": o.name,
            "work_center_id": o.work_center_id,
            "work_center_name": o.work_center.name if o.work_center else "",
            "machine_type": o.work_center.machine_type if o.work_center else "",
            "machine_setup_mins": o.machine_setup_mins,
            "job_setup_mins": o.job_setup_mins,
            "setup_time_mins": o.setup_time_mins,
            "work_time_hrs": o.work_time_hrs,
            "work_time_mins": o.work_time_mins if o.work_time_mins else round(o.work_time_hrs * 60, 1),
            "is_optional": o.is_optional,
            "formula_type":  o.formula_type,
            "mrr":           o.mrr,
            "depth_mm":      o.depth_mm,
            "feed_rate":     getattr(o, 'feed_rate', None),
            "dim_x_source":  o.dim_x_source,
            "dim_y_source":  o.dim_y_source,
            } for o in r.operations]
    total_hrs = sum((o.machine_setup_mins + o.job_setup_mins) / 60 + o.work_time_hrs
                    for o in r.operations)
    res = {"id": r.id, "name": r.name, "product_type": r.product_type,
           "description": r.description, "material_lead_days": r.material_lead_days,
           "is_active": r.is_active, "operations": ops,
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
def list_routings(include_inactive: bool = False):
    db = SessionLocal()
    q = db.query(Routing)
    if not include_inactive: q = q.filter(Routing.is_active == True)
    rs = q.order_by(Routing.product_type, Routing.name).all()
    result = [routing_dict(r, db) for r in rs]; db.close(); return result

@app.get("/api/routings/{rid}")
def get_routing(rid: int):
    db = SessionLocal()
    r = db.query(Routing).filter(Routing.id == rid).first()
    if not r: raise HTTPException(404, "Not found")
    result = routing_dict(r, db); db.close(); return result

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
        wc_id = int(op["work_center_id"])
        if not db.query(WorkCenter).filter(WorkCenter.id == wc_id).first():
            db.rollback(); db.close()
            raise HTTPException(400, f"Step {i+1}: machine {wc_id} not found")
        m_s = float(op.get("machine_setup_mins", op.get("setup_time_mins", 0)) or 0)
        j_s = float(op.get("job_setup_mins", 0) or 0)
        # Accept work_time_mins (preferred) or work_time_hrs (legacy)
        if op.get("work_time_mins") is not None and float(op.get("work_time_mins",0)) > 0:
            w_mins = float(op["work_time_mins"])
            w_hrs  = w_mins / 60.0
        else:
            w_hrs  = float(op.get("work_time_hrs", 0) or 0)
            w_mins = round(w_hrs * 60, 1)
        db.add(Operation(routing_id=r.id, sequence=i+1,
                         name=(op.get("name") or "").strip(),
                         work_center_id=wc_id,
                         machine_setup_mins=m_s, job_setup_mins=j_s,
                         setup_time_mins=m_s+j_s,
                         work_time_hrs=w_hrs, work_time_mins=w_mins,
                         is_optional=bool(op.get("is_optional", False)),
                         formula_type=op.get("formula_type") or None,
                         mrr=float(op["mrr"]) if op.get("mrr") else None,
                         depth_mm=float(op["depth_mm"]) if op.get("depth_mm") else None,
                         feed_rate=float(op["feed_rate"]) if op.get("feed_rate") else None,
                         dim_x_source=op.get("dim_x_source") or None,
                         dim_y_source=op.get("dim_y_source") or None,
                         ))
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
            wc_id = int(op["work_center_id"])
            m_s = float(op.get("machine_setup_mins", op.get("setup_time_mins", 0)) or 0)
            j_s = float(op.get("job_setup_mins", 0) or 0)
            if op.get("work_time_mins") is not None and float(op.get("work_time_mins",0)) > 0:
                w_mins = float(op["work_time_mins"])
                w_hrs  = w_mins / 60.0
            else:
                w_hrs  = float(op.get("work_time_hrs", 0) or 0)
                w_mins = round(w_hrs * 60, 1)
            db.add(Operation(routing_id=r.id, sequence=i+1,
                             name=(op.get("name") or "").strip(),
                             work_center_id=wc_id,
                             machine_setup_mins=m_s, job_setup_mins=j_s,
                             setup_time_mins=m_s+j_s,
                             work_time_hrs=w_hrs, work_time_mins=w_mins,
                             is_optional=bool(op.get("is_optional", False)),
                             formula_type=op.get("formula_type") or None,
                             mrr=float(op["mrr"]) if op.get("mrr") else None,
                             depth_mm=float(op["depth_mm"]) if op.get("depth_mm") else None,
                             feed_rate=float(op["feed_rate"]) if op.get("feed_rate") else None,
                             dim_x_source=op.get("dim_x_source") or None,
                             dim_y_source=op.get("dim_y_source") or None,
                             ))
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
        db.add(Operation(routing_id=nr.id, sequence=op.sequence, name=op.name,
                         work_center_id=op.work_center_id,
                         machine_setup_mins=op.machine_setup_mins,
                         job_setup_mins=op.job_setup_mins,
                         setup_time_mins=op.setup_time_mins,
                         work_time_hrs=op.work_time_hrs,
                         is_optional=op.is_optional))
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
        actual_totals = []
        for j in completed_jobs:
            sops = db.query(ScheduledOp).filter(
                ScheduledOp.job_id == j.id,
                ScheduledOp.actual_start.isnot(None),
                ScheduledOp.actual_end.isnot(None),
            ).all()
            if sops:
                actual_totals.append(sum(
                    (s.actual_end - s.actual_start).total_seconds() / 3600 for s in sops
                ))
        avg_actual = sum(actual_totals) / len(actual_totals) if actual_totals else None
        variance = round(((avg_actual - est_total) / est_total * 100), 1) if avg_actual and est_total > 0 else None
        results.append({
            "id": r.id, "name": r.name, "product_type": r.product_type,
            "estimated_total_hours": round(est_total, 2),
            "avg_actual_total_hours": round(avg_actual, 2) if avg_actual else None,
            "sample_count": len(actual_totals), "variance_pct": variance,
            "operations": [{"sequence": op.sequence, "name": op.name,
                            "estimated_hours": round((op.machine_setup_mins + op.job_setup_mins) / 60 + op.work_time_hrs, 2)}
                           for op in r.operations],
        })
    db.close(); return {"routings": results}

@app.get("/api/product-types")
def list_product_types():
    db = SessionLocal()
    rows = db.query(Routing.product_type).distinct().all()
    in_use = sorted({r[0] for r in rows if r[0]})
    defaults = ["Punch","Die Frame","Liner Set","Entry Mould","SFS Mould",
                "Custom Plate","Base Plate","Ejector Plate","Addon Plate",
                "Complete Mould","SFS Lower","SFS Upper"]
    db.close()
    return {"product_types": sorted(set(in_use + defaults)), "in_use": in_use}

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
    return {
        "id": o.id, "order_number": o.order_number,
        "customer_id": o.customer_id, "customer_name": o.customer_name,
        "product_type": o.product_type, "product_size": o.product_size,
        "product_variant": o.product_variant,
        "routing_id": o.routing_id,
        "quantity": o.quantity, "due_date": fmt(o.due_date),
        "notes": o.notes, "total_price": o.total_price,
        "status": o.status, "created_at": fmt(o.created_at),
        "pieces_done": done, "pieces_inprog": inprog,
        "pieces_scheduled": sched,
        "pieces_pending": o.quantity - done - inprog - sched,
        "est_finish": est_finish,
        "is_late": bool(est_finish and o.due_date and
                        max(finishes) > o.due_date) if finishes else False,
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

    order_num = next_order_number(db)
    order = CustomerOrder(
        order_number  = order_num,
        customer_id   = customer_id,
        customer_name = customer_name,
        product_type  = data.get("product_type", ""),
        product_size  = data.get("product_size", ""),
        product_variant = data.get("product_variant", ""),
        routing_id    = routing_id,
        inline_ops    = json.dumps(data.get("inline_ops", [])) if data.get("inline_ops") else None,
        quantity      = quantity,
        due_date      = due_date,
        notes         = data.get("notes", ""),
        total_price   = float(data["total_price"]) if data.get("total_price") else None,
        status        = "pending",
    )
    db.add(order); db.flush()

    # Generate piece jobs — each is an independent schedulable unit
    piece_price  = (order.total_price / quantity) if order.total_price else None
    op_overrides = json.dumps(data.get("op_overrides", [])) if data.get("op_overrides") else None
    for i in range(1, quantity + 1):
        job_num = next_job_number(db)
        j = Job(
            job_number     = job_num,
            customer_id    = customer_id,
            customer_name  = customer_name,
            po_number      = data.get("po_number", ""),
            product_type   = order.product_type,
            product_size   = order.product_size or "",
            product_variant= order.product_variant or "",
            due_date       = due_date,
            routing_id     = routing_id,
            inline_ops     = order.inline_ops,
            priority_flag  = bool(data.get("priority_flag", False)),
            notes          = f"Piece {i}/{quantity} of {order_num}",
            total_price    = piece_price,
            order_id       = order.id,
            piece_number   = i,
            status         = "pending",
            op_overrides   = op_overrides,
        )
        db.add(j)

    db.commit(); db.refresh(order)
    result = order_dict(order, db); db.close(); return result

@app.put("/api/orders/{order_id}")
def update_order(order_id: int, data: dict):
    db = SessionLocal()
    o = db.query(CustomerOrder).filter(CustomerOrder.id == order_id).first()
    if not o: raise HTTPException(404, "Order not found")
    if "due_date" in data:
        new_due = parse_dt(data["due_date"])
        if new_due:
            o.due_date = new_due
            # Propagate to all piece jobs
            for j in o.jobs:
                j.due_date = new_due
    if "notes"       in data: o.notes       = data["notes"]
    if "total_price" in data: o.total_price = float(data["total_price"]) if data["total_price"] else None
    if "priority_flag" in data:
        for j in o.jobs:
            j.priority_flag = bool(data["priority_flag"])
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
        "priority_flag": j.priority_flag, "is_frozen": bool(getattr(j, "is_frozen", False)), "status": j.status,
        "routing_id": j.routing_id,
        "has_inline_ops": bool(j.inline_ops),
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
def create_job(data: dict):
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
    j = Job(
        job_number=job_num, customer_name=customer_name, customer_id=customer_id,
        po_number=data.get("po_number",""), product_type=data["product_type"],
        product_size=data.get("product_size",""), product_variant=data.get("product_variant",""),
        total_price=float(data["total_price"]) if data.get("total_price") else None,
        due_date=due_date, not_before=parse_dt(data.get("not_before")),
        material_ready_date=parse_dt(data.get("material_ready_date")),
        routing_id=data.get("routing_id"),
        inline_ops=json.dumps(inline_ops_raw) if inline_ops_raw else None,
        priority_flag=bool(data.get("priority_flag", False)),
        notes=data.get("notes",""),
        op_overrides=json.dumps(data.get("op_overrides",[])),
    )
    db.add(j); db.commit(); db.refresh(j)
    result = {"id": j.id, "job_number": j.job_number, "status": j.status}
    db.close(); return result

@app.put("/api/jobs/{job_id}")
def update_job(job_id: int, data: dict):
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


@app.post("/api/jobs/{job_id}/duplicate")
def duplicate_job(job_id: int):
    db = SessionLocal()
    j = db.query(Job).filter(Job.id == job_id).first()
    if not j: raise HTTPException(404, "Not found")
    new_num = next_job_number(db)
    nj = Job(job_number=new_num, customer_name=j.customer_name, customer_id=j.customer_id,
             po_number=j.po_number, product_type=j.product_type,
             product_size=j.product_size, product_variant=j.product_variant,
             due_date=j.due_date, routing_id=j.routing_id,
             inline_ops=j.inline_ops, priority_flag=False,
             status="pending", notes=j.notes, op_overrides=j.op_overrides)
    db.add(nj); db.commit(); db.refresh(nj)
    result = {"id": nj.id, "job_number": nj.job_number}
    db.close(); return result

@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: int):
    db = SessionLocal()
    j = db.query(Job).filter(Job.id == job_id).first()
    if not j: raise HTTPException(404, "Not found")
    order_id = j.order_id
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
        m_s = float(op.get("machine_setup_mins", op.get("setup_time_mins", 0)) or 0)
        j_s = float(op.get("job_setup_mins", 0) or 0)
        if op.get("work_time_mins") is not None and float(op.get("work_time_mins", 0)) > 0:
            w_mins = float(op["work_time_mins"])
            w_hrs  = w_mins / 60.0
        else:
            w_hrs  = float(op.get("work_time_hrs", 0) or 0)
            w_mins = round(w_hrs * 60, 1)
        db.add(Operation(routing_id=r.id, sequence=i+1,
                         name=(op.get("name") or f"Step {i+1}"),
                         work_center_id=int(op["work_center_id"]),
                         machine_setup_mins=m_s, job_setup_mins=j_s,
                         setup_time_mins=m_s+j_s,
                         work_time_hrs=w_hrs, work_time_mins=w_mins,
                         is_optional=bool(op.get("is_optional", False))))
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
    if not j.routing_id and not j.inline_ops:
        raise HTTPException(400, "Job has no routing or inline ops")
    ok = _do_schedule(db, j)
    if j.order_id: _update_order_status(db, j.order_id)
    db.close()
    if not ok: raise HTTPException(400, "Scheduling failed")
    return {"ok": True}

@app.post("/api/schedule-all")
def schedule_all():
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
        if getattr(j, 'is_frozen', False):
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
    for j in jobs:
        if not j.routing_id and not j.inline_ops:
            continue
        if j.id in frozen_set:
            skipped += 1; continue
        if j.id in has_active:
            skipped += 1; continue
        cr = critical_ratio(j, db)
        if cr < 0.5:
            for pc in check_preemption(db, j):
                op_to_pause = db.query(ScheduledOp).filter(ScheduledOp.id == pc["op_id"]).first()
                if op_to_pause and op_to_pause.status == "in_progress":
                    op_to_pause.status = "paused"; preempted += 1
        try:
            _do_schedule(db, j); count += 1
        except Exception:
            count += 1
        for s in j.scheduled_ops:
            if s.worker_id is None and s.scheduled_start is not None:
                unassigned += 1

    order_ids = {j.order_id for j in jobs if j.order_id}
    for oid in order_ids:
        _update_order_status(db, oid)
    db.close()
    return {"scheduled": count, "unassigned_ops": unassigned,
            "skipped_active": skipped, "preempted": preempted,
            "frozen_count": len(frozen_set)}

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
def get_today():
    db = SessionLocal()
    today = now_ist().date()
    t_start = datetime(today.year, today.month, today.day, 0, 0)
    t_end   = datetime(today.year, today.month, today.day, 23, 59)
    # Include scheduled + in_progress ops for today, AND any paused ops (regardless of date)
    today_ops = db.query(ScheduledOp).filter(
        ScheduledOp.status.in_(["scheduled","in_progress"]),
        ScheduledOp.scheduled_start != None,
        ScheduledOp.scheduled_end   != None,
    ).order_by(ScheduledOp.scheduled_start).all()
    paused_ops = db.query(ScheduledOp).filter(
        ScheduledOp.status == "paused"
    ).order_by(ScheduledOp.scheduled_start).all()

    ops = [s for s in today_ops
           if s.scheduled_start <= t_end and s.scheduled_end >= t_start]
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
            "actual_start": fmt(s.actual_start), "actual_end": fmt(s.actual_end),
            "status": s.status,
            "pause_reason": s.pause_reason, "pause_notes": s.pause_notes,
            "priority": j.priority_flag, "due_date": fmt(j.due_date),
        })
    db.close(); return result


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
def debug_today():
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
def update_op_status(op_id: int, data: dict):
    db = SessionLocal()
    s = db.query(ScheduledOp).filter(ScheduledOp.id == op_id).first()
    if not s: raise HTTPException(404, "Not found")
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

    elif new_status == "paused":
        # Store pause reason and notes
        if data.get("pause_reason"): s.pause_reason = data["pause_reason"]
        if data.get("pause_notes"):  s.pause_notes  = data["pause_notes"]
        all_paused = all(op.status in ("paused","completed","pending","scheduled")
                         for op in j.scheduled_ops)
        if all_paused and j.status == "in_progress":
            j.status = "scheduled"

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
        elif not any_inprog:
            j.status = "in_progress"
        _reactive_reschedule(db, s.work_center_id, s.worker_id, s.actual_end or now)
        if j.order_id: _update_order_status(db, j.order_id)

    db.commit(); db.close()
    return {"ok": True}

@app.put("/api/ops/{op_id}/assign-worker")
def assign_worker_to_op(op_id: int, data: dict):
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
    "Perimeter Milling Single Side": "side_cutting",    # uses dim_x (L) * depth / MRR; dim_y = W applies for side 2
    "Perimeter Milling Full":        "step_milling_full",
    "Perimeter Side Milling":        "edge_sizing",
    "Perimeter Milling":             "radius_milling",
    "Perimeter Welding":             "welding",
    "Surface Grinding":              "surface_grinding",
    "Sandblasting":                  "sand_blasting",
    "Fixed":                         "fixed",
}

DIM_SOURCES = ["length", "width", "thickness"]


def calc_op_time(formula_type, mrr, depth_mm,
                 dim_x_source, dim_y_source,
                 length, width, thickness,
                 feed_rate=None) -> float:
    """Return machining time in MINUTES.
    Accepts both internal keys ('volume_milling') and Excel display names ('Volume Milling').
    All formulas verified cell-by-cell against punch_lead_time.xlsx.
    feed_rate: mm/min used by Perimeter Milling Full and Perimeter Side Milling.
    """
    # Resolve Excel display name → internal key
    ft = FORMULA_TYPE_ALIAS.get(formula_type, formula_type)

    L, W, T, D = length, width, thickness, float(depth_mm or 0.0)

    if ft == "volume_milling":
        # Volume = DimX * DimY * Depth, Time = Volume / MRR
        # DimX/DimY come from the routing operation (length/width by default)
        R = mrr or 35000.0
        return (L * W * D) / R

    elif ft == "side_cutting":
        # Perimeter Milling Single Side (L direction): L * Depth / MRR
        # Excel: DimX=670(L), DimY=35(T), Total Volume=DimX*DimY*Depth, MRR=6300
        R = mrr or 6300.0
        return (L * D * T) / R

    elif ft == "side_cutting_w":
        # Perimeter Milling Single Side (W direction): W * Depth / MRR
        R = mrr or 6300.0
        return (W * D * T) / R

    elif ft == "welding":
        # Perimeter Welding: 2*(L+W) / welding_speed(200 mm/min)
        return 2.0 * (L + W) / 200.0

    elif ft == "surface_grinding":
        # Surface Grinding: Total_Passes * time_per_pass
        # Passes = (DimX + 50) * Depth * 2 / (25 * 0.1)  [spark-out passes * step]
        # time_per = (DimY + 250) / 20000
        # Excel: DimX=L, DimY=L (square), Depth=2
        passes   = (W + 50) * D * 2 / (25 * 0.1)
        time_per = (L + 250) / 20000.0
        return passes * time_per

    elif ft == "edge_grinding":
        # Edge Grinding Side 1 (L direction) — same formula as surface grinding but DimX=T, DimY=L
        # Excel: DimX=670(L), DimY=35(T), Depth=5, Passes=DimX*Depth*2/2.5, time_per=(DimY+250)/20000
        passes   = (L + 50) * D * 2 / (25 * 0.1)
        time_per = (T + 250) / 20000.0
        return passes * time_per

    elif ft == "edge_grinding_w":
        # Edge Grinding Side 2 (W direction)
        passes   = (W + 50) * D * 2 / (25 * 0.1)
        time_per = (T + 250) / 20000.0
        return passes * time_per

    elif ft == "step_milling_full":
        # Perimeter Milling Full (Big punch Step Milling):
        # Excel: Total_Passes = 2*(L+W) / step_over * (T-8)
        #        step_over = 0.3mm, feed = 1000 mm/min (configurable)
        # Verified: 2*(670+1200)/0.3*(35-8)/1000 = 336.6 min ✓
        # Depth = T-8 (auto from thickness), NOT stored
        step_over = 0.3
        feed = feed_rate or 1000.0
        return 2.0 * (L + W) / step_over * (T - 8) / feed

    elif ft == "edge_sizing":
        # Perimeter Side Milling (Edge Sizing for big punch):
        # Total_Length = 2*(L+W) * Passes, Feed = configurable (default 250 mm/min)
        # Excel: 670x1200, Passes=10, Feed=250, Time=149.6 min ✓
        passes = depth_mm or 10.0
        feed = feed_rate or 250.0
        return 2.0 * (L + W) * passes / feed

    elif ft == "step_milling_side":
        # Step Milling Single Side L (Small punch): L * Depth / MRR
        R = mrr or 6300.0
        return (L * D * T) / R

    elif ft == "step_milling_side_w":
        # Step Milling Single Side W (Small punch): W * Depth / MRR
        R = mrr or 6300.0
        return (W * D * T) / R

    elif ft == "iso_depth_milling":
        # Iso Depth Milling: L*W*Depth / MRR  (MRR = 56250)
        R = mrr or 56250.0
        return (L * W * D) / R

    elif ft == "rubber_milling":
        # Rubber Depth Milling: L*W*Depth / MRR  (MRR = 9375)
        # Excel: 670x670, Depth=0.5, Volume=224450, MRR=9375, Time=23.94
        R = mrr or 9375.0
        return (L * W * D) / R

    elif ft == "radius_milling":
        # Perimeter Milling (Radius Milling): 2*(L+W)*3 / Feed
        # Excel: 670x670, Total_Length=8040=2*(L+W)*3, Feed=250, Time=32.16 ✓
        feed = feed_rate or 250.0
        return 2.0 * (L + W) * 3.0 / feed

    elif ft == "sand_blasting":
        # Sandblasting: Total_Area / MRR  (MRR = 12000)
        # Excel: 670x670=448900, MRR=12000, Time=37.41
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

            if ft_key == "fixed":
                work_mins = mach_fixed
            else:
                work_mins = round(calc_op_time(ftype, mrr, depth, None, None,
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
    routing_id = data.get("routing_id")
    quantity   = max(1, min(int(data.get("quantity", 1)), 50))
    start_dt   = parse_dt(data.get("start_date")) or now_ist()
    start_dt   = snap_to_shift(start_dt)
    overrides  = {o.get("operation_id"): o for o in data.get("op_overrides", []) if o.get("operation_id")}

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

    def machine_free_sim(wc_id, slot_start, slot_end):
        real = db.query(ScheduledOp).filter(
            ScheduledOp.work_center_id == wc_id,
            ScheduledOp.scheduled_end  > slot_start,
            ScheduledOp.scheduled_start < slot_end,
            ScheduledOp.status.in_(["scheduled","in_progress"])
        ).first()
        if real: return False
        for bs, be in sim_booked.get(wc_id, []):
            if bs < slot_end and be > slot_start:
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
                # advance to next shift or after blocking slot
                next_candidates = [next_shift_start(search)]
                for bs, be in sim_booked.get(wc_id, []):
                    if be > search: next_candidates.append(snap_to_shift(be))
                real_blocks = db.query(ScheduledOp).filter(
                    ScheduledOp.work_center_id == wc_id,
                    ScheduledOp.scheduled_end  > search,
                    ScheduledOp.status.in_(["scheduled","in_progress"])
                ).order_by(ScheduledOp.scheduled_start).first()
                if real_blocks and real_blocks.scheduled_end:
                    next_candidates.append(snap_to_shift(real_blocks.scheduled_end))
                search = min(next_candidates)
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
def backfill_codes():
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
def seed_real():
    db = SessionLocal()
    if db.query(Worker).count() > 0 or db.query(WorkCenter).count() > 0:
        db.close(); return {"msg": "Already has data — clear first"}
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
def seed_punch_routings():
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
    # Tuple: (name, machine_key, setup_mins, formula_type, mrr, depth_mm, feed_rate, mach_fixed_mins)
    # formula_type: Excel display name — resolved to internal key at calc time
    # feed_rate: mm/min — for Perimeter Milling Full (default 1000) and Perimeter Side Milling (default 250)
    # mach_fixed_mins: only used for formula_type="Fixed"
    # ─────────────────────────────────────────────────────────────────────────

    # Shared ops (same across all 8 variants)
    #                                                                     mrr    depth feed  fixed
    LIFTING = ("Lifting Holes",    "radial_drill",  20, "Fixed",                   None,  None, None, 30)
    FACING  = ("Facing",           "dc_vmc",        20, "Volume Milling",           35000, 5,    None, 0)
    SIDE1   = ("Side Cutting 1",   "big_edge_mill", 20, "Perimeter Milling Single Side", 6300, 10, None, 0)
    SIDE2   = ("Side Cutting 2",   "big_edge_mill", 20, "Perimeter Milling Single Side", 6300, 10, None, 0)
    WELD    = ("Welding",          "welding",       20, "Perimeter Welding",        None,  None, None, 0)
    SURF_GR = ("Surface Grinding", "dc_surface",    10, "Surface Grinding",         None,  2,    None, 0)
    SAND_S  = ("Sandblasting",     "sandblasting",  20, "Sandblasting",             12000, None, None, 0)
    RUB_FIN = ("Rubberizing",      "rubberizing",   20, "Fixed",                    None,  None, None, 40)

    # Non-Iso Small ops
    EDGEGR1   = ("Edge Grinding Side 1",  "edge_grinder", 10, "Surface Grinding",              None,  5,    None, 0)
    EDGEGR2   = ("Edge Grinding Side 2",  "edge_grinder", 10, "Surface Grinding",              None,  5,    None, 0)
    STEP_L1_S = ("Step Milling Side 1",   "edge_mill",    20, "Perimeter Milling Single Side", 6300,  4,    None, 0)
    STEP_U1_S = ("Step Milling Side 1",   "edge_mill",    20, "Perimeter Milling Single Side", 6300,  2,    None, 0)
    STEP_L2_S = ("Step Milling Side 2",   "edge_mill",    20, "Perimeter Milling Single Side", 6300,  4,    None, 0)
    STEP_U2_S = ("Step Milling Side 2",   "edge_mill",    20, "Perimeter Milling Single Side", 6300,  2,    None, 0)
    RUB_MILL_S= ("Rubber Depth Milling",  "kafo_vmc",     20, "Volume Milling",                9375,  0.5,  None, 0)
    RAD_S     = ("Radius Milling",        "kafo_vmc",      5, "Perimeter Milling",             None,  None, 250,  0)
    RMOV      = ("Removal Slot",          "univ_mill2",   20, "Fixed",                         None,  None, None, 30)

    # Non-Iso Big ops
    STEP_FULL = ("Step Milling",          "dc_vmc",       10, "Perimeter Milling Full",        None,  None, 1000, 0)  # depth=T-8 auto
    EDGE_SIZ  = ("Edge Sizing",           "kafo_vmc",     10, "Perimeter Side Milling",        None,  10,   250,  0)
    RUB_MILL_B= ("Rubber Depth Milling",  "kafo_vmc",     20, "Volume Milling",                9375,  0.5,  None, 0)
    RAD_B     = ("Radius Milling",        "kafo_vmc",      5, "Perimeter Milling",             None,  None, 250,  0)
    SAND_B    = ("Sandblasting",          "sandblasting", 20, "Sandblasting",                  12000, None, None, 0)

    # Iso-only op
    ISO_MILL  = ("Iso Depth Milling",     "dc_vmc",       20, "Volume Milling",                56250, 11, None, 0)

    def make_ops(ops_list):
        """Assign sequential numbers as first element (seq_no, name, mkey, setup, ftype, mrr, depth, feed_rate, mach_fixed)."""
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
            seq_no, name, mkey, setup, ftype, mrr, depth, feed_rate_val, mach_fixed = op_tuple
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
                dim_x_source=None, dim_y_source=None,
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)