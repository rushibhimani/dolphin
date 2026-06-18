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
    preferred_worker_id      = Column(Integer, nullable=True)   # FK to workers.id (soft ref — avoids circular)
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
    worker_type   = Column(String, default="shop_floor")  # shop_floor | office
    skills        = relationship("WorkCenter", secondary=worker_skills, back_populates="skilled_workers")
    leaves        = relationship("WorkerLeave", back_populates="worker", cascade="all, delete-orphan")
    scheduled_ops = relationship("ScheduledOp", back_populates="worker")
    assigned_tasks= relationship("StaffTask", back_populates="assigned_to", foreign_keys="StaffTask.assigned_to_id")


class WorkerLeave(Base):
    __tablename__ = "worker_leaves"
    id             = Column(Integer, primary_key=True)
    worker_id      = Column(Integer, ForeignKey("workers.id"), nullable=False)
    leave_date     = Column(Date, nullable=False)
    leave_date_end = Column(Date, nullable=True)   # if set, leave spans date → leave_date_end
    leave_type     = Column(String, default="full") # full, morning, afternoon, hours
    start_time     = Column(String, nullable=True)
    end_time       = Column(String, nullable=True)
    reason         = Column(String, nullable=True)
    created_at     = Column(DateTime, default=now_ist)
    worker         = relationship("Worker", back_populates="leaves")


class StaffTask(Base):
    __tablename__ = "staff_tasks"
    id                = Column(Integer, primary_key=True)
    title             = Column(String,  nullable=False)
    description       = Column(Text,    nullable=True)
    category          = Column(String,  nullable=True)
    priority          = Column(String,  default="normal")
    status            = Column(String,  default="pending")
    assigned_to_id    = Column(Integer, ForeignKey("workers.id"), nullable=True)   # primary assignee (kept for compat)
    assigned_to_name  = Column(String,  nullable=True)
    created_by_id     = Column(Integer, nullable=True)
    created_by_name   = Column(String,  nullable=True)
    due_date          = Column(Date,    nullable=True)
    due_time          = Column(String,  nullable=True)
    notes             = Column(Text,    nullable=True)
    completed_at      = Column(DateTime,nullable=True)
    created_at        = Column(DateTime,default=now_ist)
    assigned_to       = relationship("Worker", back_populates="assigned_tasks", foreign_keys=[assigned_to_id])
    files             = relationship("TaskFile",     back_populates="task", cascade="all, delete-orphan")
    assignees         = relationship("TaskAssignee", back_populates="task", cascade="all, delete-orphan")
    activities        = relationship("TaskActivity", back_populates="task", cascade="all, delete-orphan",
                                     order_by="TaskActivity.created_at")


class TaskAssignee(Base):
    """Additional assignees beyond the primary assigned_to — supports multi-user tasks."""
    __tablename__ = "task_assignees"
    task_id      = Column(Integer, ForeignKey("staff_tasks.id"), primary_key=True)
    worker_id    = Column(Integer, ForeignKey("workers.id"),     primary_key=True)
    worker_name  = Column(String,  nullable=True)
    assigned_at  = Column(DateTime, nullable=True)
    task         = relationship("StaffTask", back_populates="assignees")
    worker       = relationship("Worker")


class TaskActivity(Base):
    """Immutable audit log — every action on a task by any user."""
    __tablename__ = "task_activities"
    id          = Column(Integer,  primary_key=True)
    task_id     = Column(Integer,  ForeignKey("staff_tasks.id"), nullable=False)
    actor_id    = Column(Integer,  nullable=True)
    actor_name  = Column(String,   nullable=True)
    action      = Column(String,   nullable=False)  # started|paused|done|reopened|comment|file_added|assigned
    note        = Column(Text,     nullable=True)
    created_at  = Column(DateTime, nullable=True)
    task        = relationship("StaffTask", back_populates="activities")


class TaskFile(Base):
    __tablename__ = "task_files"
    id           = Column(Integer, primary_key=True)
    task_id      = Column(Integer, ForeignKey("staff_tasks.id"), nullable=False)
    filename     = Column(String,  nullable=False)   # original filename shown to user
    stored_name  = Column(String,  nullable=False)   # UUID filename on disk
    file_size    = Column(Integer, nullable=True)     # bytes
    mime_type    = Column(String,  nullable=True)
    uploaded_by  = Column(String,  nullable=True)
    note         = Column(String,  nullable=True)
    created_at   = Column(DateTime, nullable=True)
    task         = relationship("StaffTask", back_populates="files")


class Customer(Base):
    __tablename__ = "customers"
    id             = Column(Integer, primary_key=True)
    name           = Column(String, unique=True, nullable=False)
    phone          = Column(String, nullable=True)
    contact_person = Column(String, nullable=True)
    address        = Column(Text, nullable=True)
    gstin          = Column(String, nullable=True)
    email          = Column(String, nullable=True)
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
    is_custom          = Column(Boolean, default=False)   # True = per-job throwaway routing, hidden from templates list
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
    machine_setup_mins = Column(Float, default=0)
    job_setup_mins     = Column(Float, default=0)
    work_time_hrs      = Column(Float, default=0)
    work_time_mins     = Column(Float, default=0)
    is_optional           = Column(Boolean, default=False)
    op_type               = Column(String, default="inhouse")  # inhouse | outside
    outside_vendor        = Column(String, nullable=True)
    outside_transit_days  = Column(Float, nullable=True)   # calendar days away (e.g. 3.0 = 3 days)
    setup_time_mins       = Column(Float, default=0)
    # ── Formula-based time calculation ──────────────────────────────────────
    # formula_type: none | volume_milling | area | perimeter_side | perimeter_weld | fixed
    formula_type       = Column(String, nullable=True)
    mrr                = Column(Float, nullable=True)    # material removal rate
    feed_rate          = Column(Float, nullable=True)    # feed rate mm/min (for perimeter milling, step milling)
    depth_mm           = Column(Float, nullable=True)    # depth or passes
    dim_x_source       = Column(String, nullable=True)   # length | width | thickness
    dim_y_source       = Column(String, nullable=True)   # length | width | thickness
    # ────────────────────────────────────────────────────────────────────────
    routing            = relationship("Routing", back_populates="operations")
    sub_operations     = relationship("SubOperation", back_populates="operation",
                                      cascade="all, delete-orphan",
                                      order_by="SubOperation.sequence")
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
    order_type      = Column(String, default="simple")   # simple | assembly
    status          = Column(String, default="pending")  # pending/in_progress/completed
    created_at      = Column(DateTime, default=now_ist)
    customer        = relationship("Customer", back_populates="orders")
    routing         = relationship("Routing")
    jobs            = relationship("Job", back_populates="order",
                                   cascade="all, delete-orphan",
                                   order_by="Job.piece_number")
    components      = relationship("OrderComponent", back_populates="order",
                                   cascade="all, delete-orphan",
                                   order_by="OrderComponent.assembly_step")
    assembly_steps  = relationship("AssemblyStep", back_populates="order",
                                   cascade="all, delete-orphan",
                                   order_by="AssemblyStep.step_number")


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
    product_attrs       = Column(Text, nullable=True)   # JSON dict of {attr_name: value}
    due_date            = Column(DateTime, nullable=False)
    not_before          = Column(DateTime, nullable=True)
    material_ready_date = Column(DateTime, nullable=True)
    priority_flag       = Column(Boolean, default=False)
    is_frozen           = Column(Boolean, default=False)   # skip in schedule-all (schedule kept intact)
    is_on_hold          = Column(Boolean, default=False)   # schedule cleared, paused until released
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


class SubOperation(Base):
    """
    Sub-operations within a parent Operation.
    All sub-ops share the parent's machine and setup time.
    Scheduler sums sub-op work_time_hrs for the total block duration.
    Sub-ops have independent formula types, MRR, depth, dim sources.
    """
    __tablename__ = 'sub_operations'
    id           = Column(Integer, primary_key=True)
    operation_id = Column(Integer, ForeignKey('operations.id', ondelete='CASCADE'), nullable=False)
    sequence     = Column(Integer, nullable=False, default=1)
    name         = Column(String(200), nullable=False)
    formula_type = Column(String(100), nullable=True)
    mrr          = Column(Float, nullable=True)
    depth_mm     = Column(Float, nullable=True)
    feed_rate    = Column(Float, nullable=True)
    dim_x_source = Column(String(20), nullable=True)
    dim_y_source = Column(String(20), nullable=True)
    work_time_mins = Column(Float, nullable=True, default=0)
    work_time_hrs  = Column(Float, nullable=True, default=0)
    is_optional  = Column(Boolean, default=False)

    operation = relationship('Operation', back_populates='sub_operations')


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
    work_time_mins       = Column(Float, default=0)   # canonical — always = work_time_hrs * 60
    scheduled_start      = Column(DateTime, nullable=True)
    scheduled_end        = Column(DateTime, nullable=True)
    actual_start         = Column(DateTime, nullable=True)
    actual_end           = Column(DateTime, nullable=True)
    status               = Column(String, default="pending")
    op_type              = Column(String, default="inhouse")  # inhouse | outside
    outside_vendor       = Column(String, nullable=True)
    sent_out_at          = Column(DateTime, nullable=True)
    received_back_at     = Column(DateTime, nullable=True)
    pause_reason         = Column(String, nullable=True)   # waiting_material, machine_down, worker_absent, rework, other
    pause_notes          = Column(Text, nullable=True)
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


class User(Base):
    __tablename__ = "users"
    id                 = Column(Integer, primary_key=True)
    username           = Column(String, unique=True, nullable=False)
    display_name       = Column(String, nullable=True)
    password_hash      = Column(String, nullable=True)
    pin_hash           = Column(String, nullable=True)
    role               = Column(String, default="operator")
    worker_id          = Column(Integer, ForeignKey("workers.id"), nullable=True)
    is_active          = Column(Boolean, default=True)
    last_login         = Column(DateTime, nullable=True)
    created_at         = Column(DateTime, default=now_ist)
    custom_permissions = Column(Text, nullable=True)   # JSON override; None = use role defaults
    worker             = relationship("Worker", foreign_keys=[worker_id])

class QuoteCounter(Base):
    __tablename__ = "quote_counter"
    id   = Column(Integer, primary_key=True)
    year = Column(Integer, nullable=False)
    seq  = Column(Integer, default=0)


class CompanySetting(Base):
    __tablename__ = "company_settings"
    key   = Column(String, primary_key=True)
    value = Column(Text, nullable=True)


class Quotation(Base):
    __tablename__ = "quotations"
    id               = Column(Integer, primary_key=True)
    quote_number     = Column(String, unique=True, nullable=False)
    customer_id      = Column(Integer, ForeignKey("customers.id"), nullable=True)
    customer_name    = Column(String, nullable=False)
    customer_address = Column(Text, nullable=True)
    customer_gstin   = Column(String, nullable=True)
    customer_email   = Column(String, nullable=True)
    customer_phone   = Column(String, nullable=True)
    line_items       = Column(Text, nullable=True)   # JSON: [{desc, qty, unit, unit_price, amount}]
    subtotal         = Column(Float, nullable=True)
    discount_pct     = Column(Float, default=0)
    discount_amt     = Column(Float, default=0)
    tax_pct          = Column(Float, default=18)
    tax_amt          = Column(Float, nullable=True)
    total            = Column(Float, nullable=True)
    currency         = Column(String, default='INR')
    validity_days    = Column(Integer, default=30)
    valid_until      = Column(Date, nullable=True)
    notes            = Column(Text, nullable=True)
    terms            = Column(Text, nullable=True)
    message          = Column(Text, nullable=True)   # personal message to customer
    delivery_time    = Column(String, nullable=True)
    payment_terms    = Column(String, nullable=True)
    pan_no           = Column(String, nullable=True)
    packing_cost     = Column(String, nullable=True)
    bank_details     = Column(Text, nullable=True)
    status           = Column(String, default='draft')
    order_id         = Column(Integer, ForeignKey("customer_orders.id"), nullable=True)
    created_at       = Column(DateTime, nullable=True)
    sent_at          = Column(DateTime, nullable=True)
    accepted_at      = Column(DateTime, nullable=True)
    customer         = relationship("Customer")

# ── Assembly Order Components ─────────────────────────────────────────────────

class OrderComponent(Base):
    """
    One component within an assembly order.
    type = "make"     → auto-creates a Job; job_id is set after creation
    type = "outside"  → sent to external vendor; track sent/received dates
    type = "purchase" → bought item; track ordered/received dates
    assembly_step     → which assembly step this component unlocks (1,2,3...)
                        Assembly step N can only start when all components
                        with assembly_step <= N are done/received.
    """
    __tablename__ = "order_components"
    id               = Column(Integer, primary_key=True)
    order_id         = Column(Integer, ForeignKey("customer_orders.id"), nullable=False)
    name             = Column(String, nullable=False)       # e.g. "Lower Die Frame"
    component_type   = Column(String, default="make")      # make | outside | purchase
    assembly_step    = Column(Integer, default=1)           # which assembly step needs this
    quantity         = Column(Integer, default=1)
    notes            = Column(Text, nullable=True)
    # "make" fields
    routing_id       = Column(Integer, ForeignKey("routings.id"), nullable=True)
    job_id           = Column(Integer, ForeignKey("jobs.id"), nullable=True)  # created job
    # "outside" fields
    vendor_name      = Column(String, nullable=True)
    sent_date        = Column(Date, nullable=True)
    expected_back    = Column(Date, nullable=True)
    received_date    = Column(Date, nullable=True)
    # "purchase" fields — shared with outside (ordered_date / received_date)
    ordered_date     = Column(Date, nullable=True)
    # status — computed or manually set
    status           = Column(String, default="pending")    # pending|in_progress|done|sent|received
    created_at       = Column(DateTime, default=now_ist)
    order            = relationship("CustomerOrder", back_populates="components")
    routing          = relationship("Routing")
    job              = relationship("Job", foreign_keys=[job_id])


class AssemblyStep(Base):
    """
    Ordered steps in the assembly sequence for an order.
    step_number = 1, 2, 3 ...
    Requires all OrderComponents with assembly_step <= step_number to be done
    before this step can begin.
    """
    __tablename__ = "assembly_steps"
    id             = Column(Integer, primary_key=True)
    order_id       = Column(Integer, ForeignKey("customer_orders.id"), nullable=False)
    step_number    = Column(Integer, nullable=False)
    name           = Column(String, nullable=False)   # e.g. "Fix base plate and columns"
    description    = Column(Text, nullable=True)
    est_hours      = Column(Float, nullable=True)
    worker_id      = Column(Integer, ForeignKey("workers.id"), nullable=True)
    worker_name    = Column(String, nullable=True)
    status         = Column(String, default="waiting")  # waiting|ready|in_progress|done
    started_at     = Column(DateTime, nullable=True)
    completed_at   = Column(DateTime, nullable=True)
    notes          = Column(Text, nullable=True)
    order          = relationship("CustomerOrder", back_populates="assembly_steps")
    worker         = relationship("Worker")

# ── Notifications ─────────────────────────────────────────────────────────────
class Notification(Base):
    """
    Real-time notification for manager/admin users.
    event_type values:
      assembly_unlocked  — assembly step is now ready to start
      job_urgent         — job CR dropped below 0.5
      machine_breakdown  — machine marked as breakdown
      outside_received   — outside operation received back
      order_due_soon     — order due in <= 2 days with pending jobs
      assembly_complete  — all assembly steps done, ready to dispatch
    """
    __tablename__ = "notifications"
    id           = Column(Integer, primary_key=True)
    event_type   = Column(String, nullable=False)
    title        = Column(String, nullable=False)
    body         = Column(String, nullable=False)
    link         = Column(String, nullable=True)   # frontend route to navigate to
    is_read      = Column(Boolean, default=False)
    created_at   = Column(DateTime, default=now_ist)
    # Optional references
    job_id       = Column(Integer, nullable=True)
    order_id     = Column(Integer, nullable=True)
    wc_id        = Column(Integer, nullable=True)

# ── Worker Daily Report ────────────────────────────────────────────────────────
class WorkerDailyReport(Base):
    """
    Snapshot of one worker's productivity for one day.
    Generated on-demand or at end of day. Stored permanently.
    One row per worker per date.
    """
    __tablename__ = "worker_daily_reports"
    id              = Column(Integer, primary_key=True)
    report_date     = Column(Date, nullable=False)
    worker_id       = Column(Integer, ForeignKey("workers.id"), nullable=False)
    worker_name     = Column(String, nullable=False)
    # Counts
    ops_scheduled   = Column(Integer, default=0)   # ops that were scheduled for this day
    ops_completed   = Column(Integer, default=0)   # ops completed (actual_end on this date)
    ops_started     = Column(Integer, default=0)   # ops started (actual_start on this date)
    ops_missed      = Column(Integer, default=0)   # ops scheduled but not started
    # Time (hours)
    est_hours       = Column(Float, default=0)     # sum of work_time_hrs for scheduled ops
    actual_hours    = Column(Float, default=0)     # sum of (actual_end - actual_start)
    efficiency_pct  = Column(Float, nullable=True) # actual / est * 100
    # Detail (JSON list of op summaries)
    ops_detail      = Column(Text, nullable=True)  # JSON: [{job_number, op_name, est_mins, actual_mins, status}]
    generated_at    = Column(DateTime, default=now_ist)
    worker          = relationship("Worker")


# ─────────────────────────────────────────────────────────────────────────────
# Product Schema (added in migration 029)
# User-configurable replacement for hardcoded product type / size / variant
# dropdowns. The manager can add new product types, attributes per product
# type, and allowed values per attribute, from the Product Schema admin page.
# Job tables continue to store the values as strings — see Job.product_attrs.
# ─────────────────────────────────────────────────────────────────────────────
class ProductType(Base):
    __tablename__ = "product_types"
    id            = Column(Integer, primary_key=True)
    name          = Column(String, nullable=False, unique=True)
    display_order = Column(Integer, default=0)
    is_active     = Column(Boolean, default=True)
    attributes    = relationship(
        "ProductAttribute", back_populates="product_type",
        cascade="all, delete-orphan",
        order_by="ProductAttribute.display_order",
    )


class ProductAttribute(Base):
    __tablename__ = "product_attributes"
    id              = Column(Integer, primary_key=True)
    product_type_id = Column(Integer, ForeignKey("product_types.id", ondelete="CASCADE"),
                             nullable=False)
    name            = Column(String, nullable=False)       # "Size", "Type", "Mounting"
    display_order   = Column(Integer, default=0)
    is_required     = Column(Boolean, default=False)
    is_active       = Column(Boolean, default=True)
    product_type    = relationship("ProductType", back_populates="attributes")
    values          = relationship(
        "ProductAttributeValue", back_populates="attribute",
        cascade="all, delete-orphan",
        order_by="ProductAttributeValue.display_order",
    )


class ProductAttributeValue(Base):
    __tablename__ = "product_attribute_values"
    id            = Column(Integer, primary_key=True)
    attribute_id  = Column(Integer, ForeignKey("product_attributes.id", ondelete="CASCADE"),
                           nullable=False)
    value         = Column(String, nullable=False)         # "600×600", "Plain", "Carbide"
    display_order = Column(Integer, default=0)
    is_active     = Column(Boolean, default=True)
    attribute     = relationship("ProductAttribute", back_populates="values")
