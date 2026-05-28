"""Add is_frozen to jobs — frozen jobs are skipped by Schedule All

Revision ID: 012_frozen_jobs
Revises: 011_formula_ops
Create Date: 2026-05-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '012_frozen_jobs'
down_revision = '011_formula_ops'
branch_labels = None
depends_on = None


def col_exists(table, col):
    return col in [c['name'] for c in inspect(op.get_bind()).get_columns(table)]


def upgrade():
    with op.batch_alter_table('jobs') as b:
        if not col_exists('jobs', 'is_frozen'):
            b.add_column(sa.Column('is_frozen', sa.Boolean(), nullable=True, server_default='0'))


def downgrade():
    with op.batch_alter_table('jobs') as b:
        b.drop_column('is_frozen')
