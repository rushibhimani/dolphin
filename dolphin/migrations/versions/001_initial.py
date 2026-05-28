"""Initial schema

Revision ID: 001_initial
Revises: 
Create Date: 2026-01-01 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '001_initial'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect
    def tex(name):
        bind = op.get_bind()
        return inspect(bind).has_table(name)

    if tex('work_centers'): return  # Already applied, skip all

    op.create_table('work_centers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('machine_type', sa.String(), nullable=False),
        sa.Column('is_bottleneck', sa.Boolean(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )
    op.create_index('ix_work_centers_id', 'work_centers', ['id'], unique=False)

    op.create_table('routings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('product_type', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('material_lead_days', sa.Float(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_routings_id', 'routings', ['id'], unique=False)

    op.create_table('operations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('routing_id', sa.Integer(), nullable=False),
        sa.Column('sequence', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('work_center_id', sa.Integer(), nullable=False),
        sa.Column('setup_time_mins', sa.Float(), nullable=True),
        sa.Column('work_time_hrs', sa.Float(), nullable=True),
        sa.Column('is_optional', sa.Boolean(), nullable=True),
        sa.ForeignKeyConstraint(['routing_id'], ['routings.id'], ),
        sa.ForeignKeyConstraint(['work_center_id'], ['work_centers.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_operations_id', 'operations', ['id'], unique=False)

    op.create_table('jobs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('job_number', sa.String(), nullable=False),
        sa.Column('customer_name', sa.String(), nullable=False),
        sa.Column('po_number', sa.String(), nullable=True),
        sa.Column('product_type', sa.String(), nullable=False),
        sa.Column('product_size', sa.String(), nullable=False),
        sa.Column('product_variant', sa.String(), nullable=True),
        sa.Column('due_date', sa.DateTime(), nullable=False),
        sa.Column('not_before', sa.DateTime(), nullable=True),
        sa.Column('material_ready_date', sa.DateTime(), nullable=True),
        sa.Column('priority_flag', sa.Boolean(), nullable=True),
        sa.Column('status', sa.String(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('routing_id', sa.Integer(), nullable=True),
        sa.Column('op_overrides', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['routing_id'], ['routings.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('job_number'),
    )
    op.create_index('ix_jobs_id', 'jobs', ['id'], unique=False)

    op.create_table('scheduled_ops',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('job_id', sa.Integer(), nullable=False),
        sa.Column('operation_id', sa.Integer(), nullable=False),
        sa.Column('work_center_id', sa.Integer(), nullable=False),
        sa.Column('sequence', sa.Integer(), nullable=True),
        sa.Column('op_name', sa.String(), nullable=False),
        sa.Column('wc_name', sa.String(), nullable=False),
        sa.Column('setup_time_mins', sa.Float(), nullable=True),
        sa.Column('work_time_hrs', sa.Float(), nullable=True),
        sa.Column('scheduled_start', sa.DateTime(), nullable=True),
        sa.Column('scheduled_end', sa.DateTime(), nullable=True),
        sa.Column('actual_start', sa.DateTime(), nullable=True),
        sa.Column('actual_end', sa.DateTime(), nullable=True),
        sa.Column('status', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['job_id'], ['jobs.id'], ),
        sa.ForeignKeyConstraint(['operation_id'], ['operations.id'], ),
        sa.ForeignKeyConstraint(['work_center_id'], ['work_centers.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_scheduled_ops_id', 'scheduled_ops', ['id'], unique=False)

    op.create_table('job_counter',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('seq', sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_job_counter_id', 'job_counter', ['id'], unique=False)


def downgrade() -> None:
    op.drop_table('job_counter')
    op.drop_table('scheduled_ops')
    op.drop_table('jobs')
    op.drop_table('operations')
    op.drop_table('routings')
    op.drop_table('work_centers')
