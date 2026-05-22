"""Add setup split, continuity hours, setup_waived

Revision ID: 006_scheduling
Revises: 005_skill_levels
Create Date: 2026-05-10 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '006_scheduling'
down_revision = '005_skill_levels'
branch_labels = None
depends_on = None


def col_exists(table, col):
    return col in [c['name'] for c in inspect(op.get_bind()).get_columns(table)]


def upgrade():
    # Operations table — split setup time
    if not col_exists('operations', 'machine_setup_mins'):
        with op.batch_alter_table('operations') as b:
            b.add_column(sa.Column('machine_setup_mins', sa.Float(), nullable=True, server_default='0'))
    if not col_exists('operations', 'job_setup_mins'):
        with op.batch_alter_table('operations') as b:
            b.add_column(sa.Column('job_setup_mins', sa.Float(), nullable=True, server_default='0'))

    # Scheduled_ops table — track what actually happened
    if not col_exists('scheduled_ops', 'machine_setup_mins'):
        with op.batch_alter_table('scheduled_ops') as b:
            b.add_column(sa.Column('machine_setup_mins', sa.Float(), nullable=True, server_default='0'))
    if not col_exists('scheduled_ops', 'job_setup_mins'):
        with op.batch_alter_table('scheduled_ops') as b:
            b.add_column(sa.Column('job_setup_mins', sa.Float(), nullable=True, server_default='0'))
    if not col_exists('scheduled_ops', 'setup_waived'):
        with op.batch_alter_table('scheduled_ops') as b:
            b.add_column(sa.Column('setup_waived', sa.Boolean(), nullable=True, server_default='0'))

    # Work_centers — machine continuity threshold
    if not col_exists('work_centers', 'continuity_hours'):
        with op.batch_alter_table('work_centers') as b:
            b.add_column(sa.Column('continuity_hours', sa.Float(), nullable=True, server_default='2.0'))

    # Set reasonable continuity hours by machine type
    bind = op.get_bind()
    bind.execute(sa.text(
        "UPDATE work_centers SET continuity_hours=4.0 WHERE machine_type IN ('VMC','Grinder')"
    ))
    bind.execute(sa.text(
        "UPDATE work_centers SET continuity_hours=2.0 WHERE machine_type IN "
        "('Milling Machine','Drill','Welding','Hydraulic Press')"
    ))
    bind.execute(sa.text(
        "UPDATE work_centers SET continuity_hours=1.0 WHERE machine_type IN "
        "('Assembly','Pump','Finishing')"
    ))

    # Backfill: split existing setup_time_mins into 40% machine / 60% job
    bind.execute(sa.text("""
        UPDATE operations
        SET machine_setup_mins = ROUND(setup_time_mins * 0.4, 0),
            job_setup_mins     = ROUND(setup_time_mins * 0.6, 0)
        WHERE setup_time_mins > 0
          AND (machine_setup_mins IS NULL OR machine_setup_mins = 0)
    """))
    bind.execute(sa.text("""
        UPDATE scheduled_ops
        SET machine_setup_mins = ROUND(setup_time_mins * 0.4, 0),
            job_setup_mins     = ROUND(setup_time_mins * 0.6, 0)
        WHERE setup_time_mins > 0
          AND (machine_setup_mins IS NULL OR machine_setup_mins = 0)
    """))


def downgrade():
    with op.batch_alter_table('work_centers') as b:
        if col_exists('work_centers', 'continuity_hours'):
            b.drop_column('continuity_hours')
    with op.batch_alter_table('scheduled_ops') as b:
        for col in ('setup_waived', 'job_setup_mins', 'machine_setup_mins'):
            if col_exists('scheduled_ops', col):
                b.drop_column(col)
    with op.batch_alter_table('operations') as b:
        for col in ('job_setup_mins', 'machine_setup_mins'):
            if col_exists('operations', col):
                b.drop_column(col)
