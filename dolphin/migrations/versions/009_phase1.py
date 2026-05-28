"""Phase 1: pause tracking, work_time_mins, time unit normalization

Revision ID: 009_phase1
Revises: 008_orders
Create Date: 2026-05-19 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '009_phase1'
down_revision = '008_orders'
branch_labels = None
depends_on = None


def col_exists(table, col):
    return col in [c['name'] for c in inspect(op.get_bind()).get_columns(table)]


def upgrade():
    bind = op.get_bind()

    # scheduled_ops — pause tracking + manual time entry fields
    with op.batch_alter_table('scheduled_ops') as b:
        if not col_exists('scheduled_ops', 'pause_reason'):
            b.add_column(sa.Column('pause_reason', sa.String(), nullable=True))
        if not col_exists('scheduled_ops', 'pause_notes'):
            b.add_column(sa.Column('pause_notes', sa.Text(), nullable=True))
        if not col_exists('scheduled_ops', 'work_time_mins'):
            b.add_column(sa.Column('work_time_mins', sa.Float(), nullable=True, server_default='0'))

    # operations — add work_time_mins alongside work_time_hrs
    with op.batch_alter_table('operations') as b:
        if not col_exists('operations', 'work_time_mins'):
            b.add_column(sa.Column('work_time_mins', sa.Float(), nullable=True, server_default='0'))

    # Backfill work_time_mins from work_time_hrs (1 hr = 60 mins)
    bind.execute(sa.text("""
        UPDATE operations
        SET work_time_mins = ROUND(work_time_hrs * 60, 1)
        WHERE work_time_hrs > 0 AND (work_time_mins IS NULL OR work_time_mins = 0)
    """))
    bind.execute(sa.text("""
        UPDATE scheduled_ops
        SET work_time_mins = ROUND(work_time_hrs * 60, 1)
        WHERE work_time_hrs > 0 AND (work_time_mins IS NULL OR work_time_mins = 0)
    """))


def downgrade():
    with op.batch_alter_table('scheduled_ops') as b:
        for col in ('pause_reason', 'pause_notes', 'work_time_mins'):
            if col_exists('scheduled_ops', col):
                b.drop_column(col)
    with op.batch_alter_table('operations') as b:
        if col_exists('operations', 'work_time_mins'):
            b.drop_column('work_time_mins')
