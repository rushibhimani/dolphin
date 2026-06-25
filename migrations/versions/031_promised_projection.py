"""031 — promised date + projection/health for flag-and-wait late detection

Splits the customer commitment away from the scheduler's working target:

  - promised_date : the date you gave the customer. FROZEN. Set equal to
                    due_date on creation, never moved by the scheduler. This
                    is what "late" is measured against.
  - projected_end : computed, denormalized. Where the job is actually
                    trending to finish given real progress so far. Refreshed
                    whenever ops are scheduled or an actual time comes in.
  - schedule_health : 'on_track' | 'at_risk' | 'late' | 'unknown'.
                    Derived: late if projected_end > promised_date. Stored so
                    the dashboard / notifications can query flagged jobs cheaply.
  - health_reason : short human string explaining the flag, e.g.
                    "Surface Grinding ran 3.2h over".

We DON'T auto-reschedule on overrun — we just recompute these and flag.
The supervisor decides whether to replan (that's the step-4 consequence engine).

Revision ID: 031_promised_projection
Revises: 030_order_product_attrs
"""
revision = '031_promised_projection'
down_revision = '030_order_product_attrs'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


def col_exists(table, col):
    return col in [c['name'] for c in inspect(op.get_bind()).get_columns(table)]


def upgrade():
    bind = op.get_bind()

    if not col_exists('jobs', 'promised_date'):
        with op.batch_alter_table('jobs') as b:
            b.add_column(sa.Column('promised_date', sa.DateTime(), nullable=True))
    if not col_exists('jobs', 'projected_end'):
        with op.batch_alter_table('jobs') as b:
            b.add_column(sa.Column('projected_end', sa.DateTime(), nullable=True))
    if not col_exists('jobs', 'schedule_health'):
        with op.batch_alter_table('jobs') as b:
            b.add_column(sa.Column('schedule_health', sa.String(), nullable=True))
    if not col_exists('jobs', 'health_reason'):
        with op.batch_alter_table('jobs') as b:
            b.add_column(sa.Column('health_reason', sa.String(), nullable=True))

    # Backfill: promised_date = due_date for all existing jobs (the promise
    # was implicitly the due date before this split existed).
    bind.execute(sa.text(
        "UPDATE jobs SET promised_date = due_date WHERE promised_date IS NULL"
    ))

    # Same split for orders — the order carries the customer-facing promise.
    if not col_exists('customer_orders', 'promised_date'):
        with op.batch_alter_table('customer_orders') as b:
            b.add_column(sa.Column('promised_date', sa.DateTime(), nullable=True))
        bind.execute(sa.text(
            "UPDATE customer_orders SET promised_date = due_date WHERE promised_date IS NULL"
        ))


def downgrade():
    for col in ('promised_date', 'projected_end', 'schedule_health', 'health_reason'):
        if col_exists('jobs', col):
            with op.batch_alter_table('jobs') as b:
                b.drop_column(col)
    if col_exists('customer_orders', 'promised_date'):
        with op.batch_alter_table('customer_orders') as b:
            b.drop_column('promised_date')
