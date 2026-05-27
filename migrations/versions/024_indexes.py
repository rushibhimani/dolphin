"""024 — performance indexes on high-frequency query columns"""
revision = '024_indexes'
down_revision = '023_assembly_orders'
branch_labels = None
depends_on = None

from alembic import op

def index_exists(name):
    from sqlalchemy import inspect, text
    conn = op.get_bind()
    result = conn.execute(text(f"SELECT name FROM sqlite_master WHERE type='index' AND name='{name}'"))
    return result.fetchone() is not None

def upgrade():
    # scheduled_ops — most queried table (today, gantt, scheduling)
    if not index_exists('ix_sched_job_id'):
        op.create_index('ix_sched_job_id',    'scheduled_ops', ['job_id'])
    if not index_exists('ix_sched_status'):
        op.create_index('ix_sched_status',    'scheduled_ops', ['status'])
    if not index_exists('ix_sched_start'):
        op.create_index('ix_sched_start',     'scheduled_ops', ['scheduled_start'])
    if not index_exists('ix_sched_wc'):
        op.create_index('ix_sched_wc',        'scheduled_ops', ['work_center_id'])
    if not index_exists('ix_sched_worker'):
        op.create_index('ix_sched_worker',    'scheduled_ops', ['worker_id'])

    # jobs — filtered by status, customer, order constantly
    if not index_exists('ix_job_status'):
        op.create_index('ix_job_status',      'jobs', ['status'])
    if not index_exists('ix_job_customer'):
        op.create_index('ix_job_customer',    'jobs', ['customer_id'])
    if not index_exists('ix_job_order'):
        op.create_index('ix_job_order',       'jobs', ['order_id'])
    if not index_exists('ix_job_created'):
        op.create_index('ix_job_created',     'jobs', ['created_at'])
    if not index_exists('ix_job_due'):
        op.create_index('ix_job_due',         'jobs', ['due_date'])
    if not index_exists('ix_job_routing'):
        op.create_index('ix_job_routing',     'jobs', ['routing_id'])

    # customer_orders
    if not index_exists('ix_ord_customer'):
        op.create_index('ix_ord_customer',    'customer_orders', ['customer_id'])
    if not index_exists('ix_ord_status'):
        op.create_index('ix_ord_status',      'customer_orders', ['status'])
    if not index_exists('ix_ord_due'):
        op.create_index('ix_ord_due',         'customer_orders', ['due_date'])

    # order_components
    if not index_exists('ix_comp_order'):
        op.create_index('ix_comp_order',      'order_components', ['order_id'])
    if not index_exists('ix_comp_job'):
        op.create_index('ix_comp_job',        'order_components', ['job_id'])
    if not index_exists('ix_comp_status'):
        op.create_index('ix_comp_status',     'order_components', ['status'])

    # assembly_steps
    if not index_exists('ix_asm_order'):
        op.create_index('ix_asm_order',       'assembly_steps', ['order_id'])
    if not index_exists('ix_asm_status'):
        op.create_index('ix_asm_status',      'assembly_steps', ['status'])

    # worker_leaves
    if not index_exists('ix_leave_worker'):
        op.create_index('ix_leave_worker',    'worker_leaves', ['worker_id'])
    if not index_exists('ix_leave_date'):
        op.create_index('ix_leave_date',      'worker_leaves', ['leave_date'])

    # operations
    if not index_exists('ix_op_routing'):
        op.create_index('ix_op_routing',      'operations', ['routing_id'])

def downgrade():
    pass
