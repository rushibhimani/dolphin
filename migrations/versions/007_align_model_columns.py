"""Align DB with models — add missing machine_setup_waived and continuity_threshold_hrs

Revision ID: 007_align_model_columns
Revises: 006_scheduling
Create Date: 2026-05-10 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '007_align_model_columns'
down_revision = '006_scheduling'
branch_labels = None
depends_on = None


def col_exists(table, col):
    return col in [c['name'] for c in inspect(op.get_bind()).get_columns(table)]


def upgrade():
    # scheduled_ops.machine_setup_waived — model uses this name; migration 006
    # only created `setup_waived`. Add the new column and copy values across if
    # the old one exists, so nothing is lost.
    if not col_exists('scheduled_ops', 'machine_setup_waived'):
        with op.batch_alter_table('scheduled_ops') as b:
            b.add_column(sa.Column('machine_setup_waived', sa.Boolean(),
                                   nullable=True, server_default='0'))
        if col_exists('scheduled_ops', 'setup_waived'):
            op.get_bind().execute(sa.text(
                "UPDATE scheduled_ops SET machine_setup_waived = setup_waived"
            ))

    # work_centers.continuity_threshold_hrs — model adds this alongside
    # continuity_hours. Seed it from continuity_hours if that column is present.
    if not col_exists('work_centers', 'continuity_threshold_hrs'):
        with op.batch_alter_table('work_centers') as b:
            b.add_column(sa.Column('continuity_threshold_hrs', sa.Float(),
                                   nullable=True, server_default='2.0'))
        if col_exists('work_centers', 'continuity_hours'):
            op.get_bind().execute(sa.text(
                "UPDATE work_centers SET continuity_threshold_hrs = continuity_hours"
            ))


def downgrade():
    with op.batch_alter_table('scheduled_ops') as b:
        if col_exists('scheduled_ops', 'machine_setup_waived'):
            b.drop_column('machine_setup_waived')
    with op.batch_alter_table('work_centers') as b:
        if col_exists('work_centers', 'continuity_threshold_hrs'):
            b.drop_column('continuity_threshold_hrs')
