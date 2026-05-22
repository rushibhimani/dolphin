"""Add workers, skills, leaves

Revision ID: 002_workers
Revises: 001_initial
Create Date: 2026-05-07 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '002_workers'
down_revision = '001_initial'
branch_labels = None
depends_on = None


def table_exists(name):
    bind = op.get_bind()
    return inspect(bind).has_table(name)


def column_exists(table, col):
    bind = op.get_bind()
    cols = [c['name'] for c in inspect(bind).get_columns(table)]
    return col in cols


def upgrade():
    # Workers table — skip if already exists
    if not table_exists('workers'):
        op.create_table('workers',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('name', sa.String(), nullable=False),
            sa.Column('role', sa.String(), nullable=True),
            sa.Column('phone', sa.String(), nullable=True),
            sa.Column('is_active', sa.Boolean(), default=True),
        )

    # Worker skills join table
    if not table_exists('worker_skills'):
        op.create_table('worker_skills',
            sa.Column('worker_id', sa.Integer(), sa.ForeignKey('workers.id'), primary_key=True),
            sa.Column('work_center_id', sa.Integer(), sa.ForeignKey('work_centers.id'), primary_key=True),
        )

    # Worker leave calendar
    if not table_exists('worker_leaves'):
        op.create_table('worker_leaves',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('worker_id', sa.Integer(), sa.ForeignKey('workers.id'), nullable=False),
            sa.Column('leave_date', sa.Date(), nullable=False),
            sa.Column('leave_type', sa.String(), default='full'),
            sa.Column('start_time', sa.String(), nullable=True),
            sa.Column('end_time', sa.String(), nullable=True),
            sa.Column('reason', sa.String(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
        )

    # Add worker columns to scheduled_ops if not already there
    if not column_exists('scheduled_ops', 'worker_id'):
        with op.batch_alter_table('scheduled_ops') as batch_op:
            batch_op.add_column(sa.Column('worker_id', sa.Integer(), nullable=True))

    if not column_exists('scheduled_ops', 'worker_name'):
        with op.batch_alter_table('scheduled_ops') as batch_op:
            batch_op.add_column(sa.Column('worker_name', sa.String(), nullable=True))


def downgrade():
    if column_exists('scheduled_ops', 'worker_name') or column_exists('scheduled_ops', 'worker_id'):
        with op.batch_alter_table('scheduled_ops') as batch_op:
            if column_exists('scheduled_ops', 'worker_name'):
                batch_op.drop_column('worker_name')
            if column_exists('scheduled_ops', 'worker_id'):
                batch_op.drop_column('worker_id')
    if table_exists('worker_leaves'):
        op.drop_table('worker_leaves')
    if table_exists('worker_skills'):
        op.drop_table('worker_skills')
    if table_exists('workers'):
        op.drop_table('workers')
