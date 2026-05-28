"""023 — assembly orders: order_components, assembly_steps, outside ops tracking"""
revision = '023_assembly_orders'
down_revision = '022_customer_address_gstin'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa

def col_exists(table, col):
    from sqlalchemy import inspect
    return col in [c['name'] for c in inspect(op.get_bind()).get_columns(table)]

def table_exists(t):
    from sqlalchemy import inspect
    return t in inspect(op.get_bind()).get_table_names()

def upgrade():
    # ── customer_orders: add order_type ──────────────────────────────────────
    if not col_exists('customer_orders', 'order_type'):
        op.add_column('customer_orders', sa.Column('order_type', sa.String(), nullable=True, server_default='simple'))

    # ── operations: add op_type, outside_vendor ───────────────────────────────
    if not col_exists('operations', 'op_type'):
        op.add_column('operations', sa.Column('op_type', sa.String(), nullable=True, server_default='inhouse'))
    if not col_exists('operations', 'outside_vendor'):
        op.add_column('operations', sa.Column('outside_vendor', sa.String(), nullable=True))

    # ── scheduled_ops: add outside tracking ───────────────────────────────────
    if not col_exists('scheduled_ops', 'op_type'):
        op.add_column('scheduled_ops', sa.Column('op_type', sa.String(), nullable=True, server_default='inhouse'))
    if not col_exists('scheduled_ops', 'outside_vendor'):
        op.add_column('scheduled_ops', sa.Column('outside_vendor', sa.String(), nullable=True))
    if not col_exists('scheduled_ops', 'sent_out_at'):
        op.add_column('scheduled_ops', sa.Column('sent_out_at', sa.DateTime(), nullable=True))
    if not col_exists('scheduled_ops', 'received_back_at'):
        op.add_column('scheduled_ops', sa.Column('received_back_at', sa.DateTime(), nullable=True))

    # ── order_components (new table) ──────────────────────────────────────────
    if not table_exists('order_components'):
        op.create_table('order_components',
            sa.Column('id',             sa.Integer(), primary_key=True),
            sa.Column('order_id',       sa.Integer(), sa.ForeignKey('customer_orders.id'), nullable=False),
            sa.Column('name',           sa.String(),  nullable=False),
            sa.Column('component_type', sa.String(),  nullable=True, server_default='make'),
            sa.Column('assembly_step',  sa.Integer(), nullable=True, server_default='1'),
            sa.Column('quantity',       sa.Integer(), nullable=True, server_default='1'),
            sa.Column('notes',          sa.Text(),    nullable=True),
            sa.Column('routing_id',     sa.Integer(), sa.ForeignKey('routings.id'), nullable=True),
            sa.Column('job_id',         sa.Integer(), sa.ForeignKey('jobs.id'),     nullable=True),
            sa.Column('vendor_name',    sa.String(),  nullable=True),
            sa.Column('sent_date',      sa.Date(),    nullable=True),
            sa.Column('expected_back',  sa.Date(),    nullable=True),
            sa.Column('received_date',  sa.Date(),    nullable=True),
            sa.Column('ordered_date',   sa.Date(),    nullable=True),
            sa.Column('status',         sa.String(),  nullable=True, server_default='pending'),
            sa.Column('created_at',     sa.DateTime(),nullable=True),
        )

    # ── assembly_steps (new table) ────────────────────────────────────────────
    if not table_exists('assembly_steps'):
        op.create_table('assembly_steps',
            sa.Column('id',           sa.Integer(), primary_key=True),
            sa.Column('order_id',     sa.Integer(), sa.ForeignKey('customer_orders.id'), nullable=False),
            sa.Column('step_number',  sa.Integer(), nullable=False),
            sa.Column('name',         sa.String(),  nullable=False),
            sa.Column('description',  sa.Text(),    nullable=True),
            sa.Column('est_hours',    sa.Float(),   nullable=True),
            sa.Column('worker_id',    sa.Integer(), sa.ForeignKey('workers.id'), nullable=True),
            sa.Column('worker_name',  sa.String(),  nullable=True),
            sa.Column('status',       sa.String(),  nullable=True, server_default='waiting'),
            sa.Column('started_at',   sa.DateTime(),nullable=True),
            sa.Column('completed_at', sa.DateTime(),nullable=True),
            sa.Column('notes',        sa.Text(),    nullable=True),
        )

def downgrade():
    pass
