"""Add sub_operations table — sub-ops within an operation share machine/setup

Revision ID: 014_sub_operations
Revises: 013_feed_rate
Create Date: 2026-05-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '014_sub_operations'
down_revision = '013_feed_rate'
branch_labels = None
depends_on = None


def table_exists(name):
    return name in inspect(op.get_bind()).get_table_names()


def upgrade():
    if not table_exists('sub_operations'):
        op.create_table('sub_operations',
            sa.Column('id',           sa.Integer(),     nullable=False, primary_key=True),
            sa.Column('operation_id', sa.Integer(),     sa.ForeignKey('operations.id', ondelete='CASCADE'), nullable=False),
            sa.Column('sequence',     sa.Integer(),     nullable=False, default=1),
            sa.Column('name',         sa.String(200),   nullable=False),
            sa.Column('formula_type', sa.String(100),   nullable=True),
            sa.Column('mrr',          sa.Float(),       nullable=True),
            sa.Column('depth_mm',     sa.Float(),       nullable=True),
            sa.Column('feed_rate',    sa.Float(),       nullable=True),
            sa.Column('dim_x_source', sa.String(20),   nullable=True),
            sa.Column('dim_y_source', sa.String(20),   nullable=True),
            sa.Column('work_time_mins', sa.Float(),     nullable=True, default=0),
            sa.Column('work_time_hrs',  sa.Float(),     nullable=True, default=0),
            sa.Column('is_optional',  sa.Boolean(),     nullable=True, default=False),
        )


def downgrade():
    op.drop_table('sub_operations')
