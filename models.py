from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean, Text, Date, Table
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime, timedelta

Base = declarative_base()

IST_OFFSET = timedelta(hours=5, minutes=30)

def now_ist():
    return datetime.utcnow() + IST_OFFSET


# Many-to-many: Worker <-> WorkCenter (skills)
worker_skills = Table(
    'worker_skills', Base.metadata,
    Column('worker_id', Integer, ForeignKey('workers.id'), primary_key=True),
    Column('work_center_id', Integer, ForeignKey('work_centers.id'), primary_key=True),
)


class WorkCenter(Base):
    __tablename__ = "work_centers"
    id                       = Column(Integer, primary_key=True)
    code                     = Column(String, nullable=True)
    name                     = Column(String, unique=True, nullable=False)
    machine_type             = Column(String, nullable=False)
    is_bottleneck            = Column(Boolean, default=False)
    status                   = Column(String, default="active")   # active, maintenance, breakdown
    continuity_hours         = Column(Float, default=2.0)
    continuity_threshold_hrs = Column(Float, default=2.0)
    skill_level              = Column(Integer, default=1)
    skilled_workers          = relationship("Worker", secondary=worker_skills, back_populates="skills")


class Worker(Base):
    __tablename__ = "workers"
    id            = Column(Integer, primary_key=True)
    code          = Column(String, nullable=True)
    name          = Column(String, nullable=False)
    role          = Column(String, nullable=True)
    phone         = Column(String, nullable=True)
    is_active     = Column(Boolean, default=True)
    skill_level   = Column(Integer, default=1)
    skills        = relationship("WorkCenter", secondary=worker_skills, back_populates="skilled_workers")
    leaves        = relationship("WorkerLeave", back_populates="worker", cascade="all, delete-orphan")
    scheduled_ops = relationship("ScheduledOp", back_populates="worker")


class WorkerLeave(Base):
    __tablename__ = "worker_leaves"
    id          = Column(Integer, primary_key=True)
    worker_id   = Column(Integer, ForeignKey("workers.id"), nullable=False)
    leave_date  = Column(Date, nullable=False)
    leave_type  = Column(String, default="full")   # full, morning, afternoon, hours
    start_time  = Column(String, nullable=True)
    end_time    = Column(String, nullable=True)
    reason      = Column(String, nullable=True)
    created_at  = Column(DateTime, default=now_ist)
    worker      = relationship("Worker", back_populates="leaves")


class Customer(Base):
    __tablename__ = "customers"
    id             = Column(Integer, primary_key=True)
    name           = Column(String, unique=True, nullable=False)
    phone          = Column(String, nullable=True)
    contact_person = Column(String, nullable=True)
    notes          = Column(Text, nullable=True)
    is_active      = Column(Boolean, default=True)
    created_at     = Column(DateTime, default=now_ist)
    jobs           = relationship("Job", back_populates="customer")
    orders         = relationship("CustomerOrder", back_populates="customer")


class Routing(Base):
    __tablename__ = "routings"
    id                 = Column(Integer, primary_key=True)
    name               = Column(String, nullable=False)
    product_type       = Column(String, nullable=False)
    description        = Column(Text, nullable=True)
    material_lead_days = Column(Float, default=2.0)
    is_active          = Column(Boolean, default=True)
    operations         = relationship(
        "Operation", back_populates="routing",
        cascade="all, delete-orphan", order_by="Operation.sequence"
    )


class Operation(Base):
    __tablename__ = "operations"
    id                 = Column(Integer, primary_key=True)
    routing_id         = Column(Integer, ForeignKey("routings.id"), nullable=False)
    sequence           = Column(Integer, nullable=False)
    name               = Column(String, nullable=False)
    work_center_id     = Column(Integer, ForeignKey("work_centers.id"), nullable=False)
    machine_setup_mins = Column(Float, default=0)   # waived for consecutive same-worker ops
    job_setup_mins     = Column(Float, default=0)   # always required per job
    work_time_hrs      = Column(Float, default=0)
    is_optional        = Column(Boolean, default=False)
    setup_time_mins    = Column(Float, default=0)   # legacy = machine + job
    routing            = relationship("Routing", back_populates="operations")
    work_center        = relationship("WorkCenter")


# ── NEW: Customer Order (quantity of pieces) ──────────────────────────────────
class CustomerOrder(Base):
    """
    One customer order = N identical pieces flowing independently through the shop.
    Each piece becomes a Job. The scheduler treats them as independent jobs
    competing by Critical Ratio — so an urgent small order naturally jumps
    ahead of a large low-urgency order on contested machines.
    """
    __tablename__ = "customer_orders"
    id              = Column(Integer, primary_key=True)
    order_number    = Column(String, unique=True, nullable=False)  # ORD-2026-001
    customer_id     = Column(Integer, ForeignKey("customers.id"), nullable=True)
    customer_name   = Column(String, nullable=False)
    product_type    = Column(String, nullable=False)
    product_size    = Column(String, nullable=True)
    product_variant = Column(String, nullable=True)
    routing_id      = Column(Integer, ForeignKey("routings.id"), nullable=True)
    inline_ops      = Column(Text, nullable=True)   # JSON — used when no routing
    quantity        = Column(Integer, nullable=False, default=1)
    due_date        = Column(DateTime, nullable=False)
    notes           = Column(Text, nullable=True)
    total_price     = Column(Float, nullable=True)  # total for all pieces
    status          = Column(String, default="pending")  # pending/in_progress/completed
    created_at      = Column(DateTime, default=now_ist)
    customer        = relationship("Customer", back_populates="orders")
    routing         = relationship("Routing")
    jobs            = relationship("Job", back_populates="order",
                                   cascade="all, delete-orphan",
                                   order_by="Job.piece_number")


class Job(Base):
    __tablename__ = "jobs"
    id                  = Column(Integer, primary_key=True)
    job_number          = Column(String, unique=True, nullable=False)
    customer_id         = Column(Integer, ForeignKey("customers.id"), nullable=True)
    customer_name       = Column(String, nullable=False)
    po_number           = Column(String, nullable=True)
    product_type        = Column(String, nullable=False)
    product_size        = Column(String, nullable=False)
    product_variant     = Column(String, nullable=True)
    due_date            = Column(DateTime, nullable=False)
    not_before          = Column(DateTime, nullable=True)
    material_ready_date = Column(DateTime, nullable=True)
    priority_flag       = Column(Boolean, default=False)
    status              = Column(String, default="pending")
    notes               = Column(Text, nullable=True)
    total_price         = Column(Float, nullable=True)
    routing_id          = Column(Integer, ForeignKey("routings.id"), nullable=True)
    inline_ops          = Column(Text, nullable=True)   # JSON array of op dicts (no routing needed)
    op_overrides        = Column(Text, nullable=True)   # JSON per-op time overrides
    # ── Order linkage (null = standalone job) ───────────────────────────────
    order_id            = Column(Integer, ForeignKey("customer_orders.id"), nullable=True)
    piece_number        = Column(Integer, nullable=True)   # 1-based within order
    # ────────────────────────────────────────────────────────────────────────
    created_at          = Column(DateTime, default=now_ist)
    completed_at        = Column(DateTime, nullable=True)
    customer            = relationship("Customer", back_populates="jobs")
    order               = relationship("CustomerOrder", back_populates="jobs")
    scheduled_ops       = relationship(
        "ScheduledOp", back_populates="job",
        cascade="all, delete-orphan"
    )


class ScheduledOp(Base):
    __tablename__ = "scheduled_ops"
    id                   = Column(Integer, primary_key=True)
    job_id               = Column(Integer, ForeignKey("jobs.id"), nullable=False)
    operation_id         = Column(Integer, ForeignKey("operations.id"), nullable=True)  # nullable for inline ops
    work_center_id       = Column(Integer, ForeignKey("work_centers.id"), nullable=False)
    worker_id            = Column(Integer, ForeignKey("workers.id"), nullable=True)
    sequence             = Column(Integer, default=0)
    op_name              = Column(String, nullable=False)
    wc_name              = Column(String, nullable=False)
    worker_name          = Column(String, nullable=True)
    machine_setup_mins   = Column(Float, default=0)
    job_setup_mins       = Column(Float, default=0)
    setup_time_mins      = Column(Float, default=0)
    machine_setup_waived = Column(Boolean, default=False)
    work_time_hrs        = Column(Float, default=0)
    scheduled_start      = Column(DateTime, nullable=True)
    scheduled_end        = Column(DateTime, nullable=True)
    actual_start         = Column(DateTime, nullable=True)
    actual_end           = Column(DateTime, nullable=True)
    status               = Column(String, default="pending")
    job                  = relationship("Job", back_populates="scheduled_ops")
    worker               = relationship("Worker", back_populates="scheduled_ops")


class JobCounter(Base):
    __tablename__ = "job_counter"
    id   = Column(Integer, primary_key=True)
    year = Column(Integer, nullable=False)
    seq  = Column(Integer, nullable=False, default=0)


# ── NEW: Order number counter ─────────────────────────────────────────────────
class OrderCounter(Base):
    __tablename__ = "order_counter"
    id   = Column(Integer, primary_key=True)
    year = Column(Integer, nullable=False)
    seq  = Column(Integer, nullable=False, default=0)