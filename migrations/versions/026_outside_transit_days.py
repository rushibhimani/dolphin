"""026 — add outside_transit_days to operations"""
revision = '026_outside_transit_days'
down_revision = '025_notifications'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa

def col_exists(table, col):
    from sqlalchemy import inspect
    return col in [c['name'] for c in inspect(op.get_bind()).get_columns(table)]

def upgrade():
    if not col_exists('operations', 'outside_transit_days'):
        op.add_column('operations',
            sa.Column('outside_transit_days', sa.Float(), nullable=True))

def downgrade():
    pass
