"""008_orders — CustomerOrder table + Job order linkage + inline_ops

Revision ID: 008_orders
Revises: 006_scheduling
Create Date: 2026-05-15

NOTE: SQLite batch_alter_table does not support inline ForeignKey constraints
on add_column. Columns are added as plain integers — SQLite doesn't enforce
FK constraints anyway, and SQLAlchemy handles the relationships in Python.
"""
from alembic import op
import sqlalchemy as sa

revision      = '008_orders'
down_revision = '006_scheduling'
branch_labels = None
depends_on    = None


def upgrade():
    # 1. order_counter table
    op.create_table(
        'order_counter',
        sa.Column('id',   sa.Integer(), primary_key=True),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('seq',  sa.Integer(), nullable=False, default=0),
    )

    # 2. customer_orders table (plain Integer FK columns, no constraint objects)
    op.create_table(
        'customer_orders',
        sa.Column('id',              sa.Integer(),  primary_key=True),
        sa.Column('order_number',    sa.String(),   nullable=False, unique=True),
        sa.Column('customer_id',     sa.Integer(),  nullable=True),
        sa.Column('customer_name',   sa.String(),   nullable=False),
        sa.Column('product_type',    sa.String(),   nullable=False),
        sa.Column('product_size',    sa.String(),   nullable=True),
        sa.Column('product_variant', sa.String(),   nullable=True),
        sa.Column('routing_id',      sa.Integer(),  nullable=True),
        sa.Column('inline_ops',      sa.Text(),     nullable=True),
        sa.Column('quantity',        sa.Integer(),  nullable=False, default=1),
        sa.Column('due_date',        sa.DateTime(), nullable=False),
        sa.Column('notes',           sa.Text(),     nullable=True),
        sa.Column('total_price',     sa.Float(),    nullable=True),
        sa.Column('status',          sa.String(),   default='pending'),
        sa.Column('created_at',      sa.DateTime(), nullable=True),
    )

    # 3. Add columns to jobs — recreate='always' avoids FK constraint naming issues
    with op.batch_alter_table('jobs', recreate='always') as batch:
        batch.add_column(sa.Column('order_id',     sa.Integer(), nullable=True))
        batch.add_column(sa.Column('piece_number', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('inline_ops',   sa.Text(),    nullable=True))

    # 4. Make operation_id nullable on scheduled_ops
    with op.batch_alter_table('scheduled_ops', recreate='always') as batch:
        batch.alter_column('operation_id',
                           existing_type=sa.Integer(),
                           nullable=True)


def downgrade():
    with op.batch_alter_table('scheduled_ops', recreate='always') as batch:
        batch.alter_column('operation_id',
                           existing_type=sa.Integer(),
                           nullable=False)

    with op.batch_alter_table('jobs', recreate='always') as batch:
        batch.drop_column('inline_ops')
        batch.drop_column('piece_number')
        batch.drop_column('order_id')

    op.drop_table('customer_orders')
    op.drop_table('order_counter')