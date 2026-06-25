"""030 — add product_attrs to customer_orders

Mirrors Job.product_attrs (added in 029). The Order editor now renders the
same dynamic, schema-driven attribute inputs as the Job editor, so an order
needs somewhere to store the structured {attr_name: value} map too — not
just the flattened product_size / product_variant strings.

Revision ID: 030_order_product_attrs
Revises: 029_product_schema
"""
revision = '030_order_product_attrs'
down_revision = '029_product_schema'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


def col_exists(table, col):
    return col in [c['name'] for c in inspect(op.get_bind()).get_columns(table)]


def upgrade():
    if not col_exists('customer_orders', 'product_attrs'):
        with op.batch_alter_table('customer_orders') as b:
            b.add_column(sa.Column('product_attrs', sa.Text(), nullable=True))


def downgrade():
    if col_exists('customer_orders', 'product_attrs'):
        with op.batch_alter_table('customer_orders') as b:
            b.drop_column('product_attrs')
