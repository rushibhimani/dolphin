"""Add feed_rate to operations — allows per-operation feed rate override

Revision ID: 013_feed_rate
Revises: 012_frozen_jobs
Create Date: 2026-05-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '013_feed_rate'
down_revision = '012_frozen_jobs'
branch_labels = None
depends_on = None


def col_exists(table, col):
    return col in [c['name'] for c in inspect(op.get_bind()).get_columns(table)]


def upgrade():
    with op.batch_alter_table('operations') as b:
        if not col_exists('operations', 'feed_rate'):
            b.add_column(sa.Column('feed_rate', sa.Float(), nullable=True))
    with op.batch_alter_table('scheduled_ops') as b:
        if not col_exists('scheduled_ops', 'feed_rate'):
            b.add_column(sa.Column('feed_rate', sa.Float(), nullable=True))


def downgrade():
    with op.batch_alter_table('operations') as b:
        b.drop_column('feed_rate')
    with op.batch_alter_table('scheduled_ops') as b:
        b.drop_column('feed_rate')
