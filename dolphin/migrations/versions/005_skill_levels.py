"""Add skill_level to machines and workers

Revision ID: 005_skill_levels
Revises: 004_codes
Create Date: 2026-05-10 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '005_skill_levels'
down_revision = '004_codes'
branch_labels = None
depends_on = None


def col_exists(table, col):
    return col in [c['name'] for c in inspect(op.get_bind()).get_columns(table)]


def upgrade():
    if not col_exists('work_centers', 'skill_level'):
        with op.batch_alter_table('work_centers') as b:
            b.add_column(sa.Column('skill_level', sa.Integer(),
                                   nullable=True, server_default='1'))

    if not col_exists('workers', 'skill_level'):
        with op.batch_alter_table('workers') as b:
            b.add_column(sa.Column('skill_level', sa.Integer(),
                                   nullable=True, server_default='1'))

    # Set sensible defaults for existing data:
    # VMC, Grinder = skill_level 3 (specialist)
    # Milling, Drill = skill_level 2 (trained)
    # Assembly, Welding, Finishing = skill_level 1 (general)
    bind = op.get_bind()
    bind.execute(sa.text(
        "UPDATE work_centers SET skill_level=3 WHERE machine_type IN ('VMC','Grinder')"
    ))
    bind.execute(sa.text(
        "UPDATE work_centers SET skill_level=2 WHERE machine_type IN "
        "('Milling Machine','Drill','Hydraulic Press','Welding')"
    ))
    bind.execute(sa.text(
        "UPDATE work_centers SET skill_level=1 WHERE machine_type IN "
        "('Assembly','Pump','Finishing')"
    ))

    # Set worker skill levels based on their role
    bind.execute(sa.text(
        "UPDATE workers SET skill_level=3 WHERE LOWER(role) LIKE '%vmc%' "
        "OR LOWER(role) LIKE '%specialist%' OR LOWER(role) LIKE '%senior%'"
    ))
    bind.execute(sa.text(
        "UPDATE workers SET skill_level=2 WHERE LOWER(role) LIKE '%grinder%' "
        "OR LOWER(role) LIKE '%drill%' OR LOWER(role) LIKE '%milling%'"
    ))


def downgrade():
    with op.batch_alter_table('work_centers') as b:
        if col_exists('work_centers', 'skill_level'):
            b.drop_column('skill_level')
    with op.batch_alter_table('workers') as b:
        if col_exists('workers', 'skill_level'):
            b.drop_column('skill_level')
