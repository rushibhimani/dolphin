"""Add customers and pricing

Revision ID: 003_customers
Revises: 002_workers
Create Date: 2026-05-08 14:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '003_customers'
down_revision = '002_workers'
branch_labels = None
depends_on = None


def table_exists(name):
    return inspect(op.get_bind()).has_table(name)


def column_exists(table, col):
    bind = op.get_bind()
    cols = [c['name'] for c in inspect(bind).get_columns(table)]
    return col in cols


def upgrade():
    if not table_exists('customers'):
        op.create_table('customers',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('name', sa.String(), nullable=False),
            sa.Column('phone', sa.String(), nullable=True),
            sa.Column('contact_person', sa.String(), nullable=True),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('is_active', sa.Boolean(), default=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('name'),
        )

    # Add customer_id and total_price to jobs
    if not column_exists('jobs', 'customer_id'):
        with op.batch_alter_table('jobs') as batch_op:
            batch_op.add_column(sa.Column('customer_id', sa.Integer(), nullable=True))

    if not column_exists('jobs', 'total_price'):
        with op.batch_alter_table('jobs') as batch_op:
            batch_op.add_column(sa.Column('total_price', sa.Float(), nullable=True))

    # Backfill: create customer records from existing customer_name values
    bind = op.get_bind()
    existing_names = bind.execute(sa.text(
        "SELECT DISTINCT customer_name FROM jobs WHERE customer_name IS NOT NULL AND customer_name != ''"
    )).fetchall()

    for row in existing_names:
        name = row[0]
        # Check if already exists
        already = bind.execute(sa.text(
            "SELECT id FROM customers WHERE name = :name"
        ), {"name": name}).fetchone()
        if not already:
            bind.execute(sa.text(
                "INSERT INTO customers (name, is_active) VALUES (:name, 1)"
            ), {"name": name})

    # Link existing jobs to newly created customers
    bind.execute(sa.text("""
        UPDATE jobs
        SET customer_id = (SELECT id FROM customers WHERE customers.name = jobs.customer_name)
        WHERE customer_id IS NULL
    """))


def downgrade():
    if column_exists('jobs', 'total_price'):
        with op.batch_alter_table('jobs') as batch_op:
            batch_op.drop_column('total_price')
    if column_exists('jobs', 'customer_id'):
        with op.batch_alter_table('jobs') as batch_op:
            batch_op.drop_column('customer_id')
    if table_exists('customers'):
        op.drop_table('customers')
