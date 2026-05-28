"""016 — Staff tasks table + leave date range support"""
revision = '016_staff_tasks_leave_range'
down_revision = '015_auth'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa

def col_exists(table, col):
    from sqlalchemy import inspect, create_engine
    import os
    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'dolphin.db')
    e = create_engine(f'sqlite:///{db_path}')
    return col in [c['name'] for c in inspect(e).get_columns(table)]

def table_exists(table):
    from sqlalchemy import inspect, create_engine
    import os
    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'dolphin.db')
    e = create_engine(f'sqlite:///{db_path}')
    return table in inspect(e).get_table_names()

def upgrade():
    # 1. Add worker_type to workers (shop_floor | office)
    if not col_exists('workers', 'worker_type'):
        with op.batch_alter_table('workers') as b:
            b.add_column(sa.Column('worker_type', sa.String, server_default='shop_floor'))

    # 2. Add leave_date_end to worker_leaves for date-range leaves
    if not col_exists('worker_leaves', 'leave_date_end'):
        with op.batch_alter_table('worker_leaves') as b:
            b.add_column(sa.Column('leave_date_end', sa.Date, nullable=True))

    # 3. Create staff_tasks table
    if not table_exists('staff_tasks'):
        op.create_table('staff_tasks',
            sa.Column('id',          sa.Integer, primary_key=True),
            sa.Column('title',       sa.String,  nullable=False),
            sa.Column('description', sa.Text,    nullable=True),
            sa.Column('category',    sa.String,  nullable=True),   # Design, Admin, Quality, Other
            sa.Column('priority',    sa.String,  default='normal'), # low, normal, high, urgent
            sa.Column('status',      sa.String,  default='pending'),# pending, in_progress, done, cancelled
            sa.Column('assigned_to_id',   sa.Integer, sa.ForeignKey('workers.id'), nullable=True),
            sa.Column('assigned_to_name', sa.String,  nullable=True),
            sa.Column('created_by_id',    sa.Integer, nullable=True),
            sa.Column('created_by_name',  sa.String,  nullable=True),
            sa.Column('due_date',    sa.Date,    nullable=True),
            sa.Column('due_time',    sa.String,  nullable=True),
            sa.Column('notes',       sa.Text,    nullable=True),    # completion notes
            sa.Column('completed_at',sa.DateTime,nullable=True),
            sa.Column('created_at',  sa.DateTime,nullable=True),
        )

def downgrade():
    op.drop_table('staff_tasks')
    with op.batch_alter_table('worker_leaves') as b:
        b.drop_column('leave_date_end')
    with op.batch_alter_table('workers') as b:
        b.drop_column('worker_type')
