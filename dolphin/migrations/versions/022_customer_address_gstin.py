"""022 — add address, gstin, email to customers"""
revision = '022_customer_address_gstin'
down_revision = '021_quotation_extra_fields'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa

def col_exists(table, col):
    from sqlalchemy import inspect
    bind = op.get_bind()
    return col in [c['name'] for c in inspect(bind).get_columns(table)]

def upgrade():
    if not col_exists('customers', 'address'):
        op.add_column('customers', sa.Column('address', sa.Text(), nullable=True))
    if not col_exists('customers', 'gstin'):
        op.add_column('customers', sa.Column('gstin', sa.String(), nullable=True))
    if not col_exists('customers', 'email'):
        op.add_column('customers', sa.Column('email', sa.String(), nullable=True))

def downgrade():
    pass
