"""028 — add is_on_hold to jobs (separate from is_frozen)

is_frozen = job is excluded from Schedule All (but schedule stays intact)
is_on_hold = job schedule is cleared and job is paused until manually released

Revision ID: 028_job_on_hold
Revises: 027_worker_daily_reports
Create Date: 2026-05-28
"""
revision = '028_job_on_hold'
down_revision = '027_worker_daily_reports'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


def col_exists(table, col):
    return col in [c['name'] for c in inspect(op.get_bind()).get_columns(table)]


def upgrade():
    with op.batch_alter_table('jobs') as b:
        if not col_exists('jobs', 'is_on_hold'):
            b.add_column(sa.Column('is_on_hold', sa.Boolean(), nullable=True, server_default='0'))


def downgrade():
    with op.batch_alter_table('jobs') as b:
        b.drop_column('is_on_hold')
