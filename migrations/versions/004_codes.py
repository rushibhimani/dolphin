"""Add machine codes, worker codes, machine status

Revision ID: 004_codes
Revises: 003_customers
Create Date: 2026-05-10 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '004_codes'
down_revision = '003_customers'
branch_labels = None
depends_on = None


def col_exists(table, col):
    return col in [c['name'] for c in inspect(op.get_bind()).get_columns(table)]


def upgrade():
    if not col_exists('work_centers', 'code'):
        with op.batch_alter_table('work_centers') as b:
            b.add_column(sa.Column('code', sa.String(), nullable=True))

    if not col_exists('work_centers', 'status'):
        with op.batch_alter_table('work_centers') as b:
            b.add_column(sa.Column('status', sa.String(), nullable=True, server_default='active'))

    if not col_exists('workers', 'code'):
        with op.batch_alter_table('workers') as b:
            b.add_column(sa.Column('code', sa.String(), nullable=True))


def downgrade():
    with op.batch_alter_table('work_centers') as b:
        if col_exists('work_centers', 'status'): b.drop_column('status')
        if col_exists('work_centers', 'code'):   b.drop_column('code')
    with op.batch_alter_table('workers') as b:
        if col_exists('workers', 'code'): b.drop_column('code')
