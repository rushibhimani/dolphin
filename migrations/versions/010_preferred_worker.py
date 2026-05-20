"""Add preferred_worker_id to work_centers

Revision ID: 010_preferred_worker
Revises: 009_phase1
Create Date: 2026-05-19 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '010_preferred_worker'
down_revision = '009_phase1'
branch_labels = None
depends_on = None


def col_exists(table, col):
    return col in [c['name'] for c in inspect(op.get_bind()).get_columns(table)]


def upgrade():
    with op.batch_alter_table('work_centers') as b:
        if not col_exists('work_centers', 'preferred_worker_id'):
            b.add_column(sa.Column('preferred_worker_id', sa.Integer(), nullable=True))


def downgrade():
    with op.batch_alter_table('work_centers') as b:
        if col_exists('work_centers', 'preferred_worker_id'):
            b.drop_column('preferred_worker_id')