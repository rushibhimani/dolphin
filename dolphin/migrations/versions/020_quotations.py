"""020 — quotations system"""
revision = '020_quotations'
down_revision = '019_task_collaboration'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa

def table_exists(t):
    from sqlalchemy import inspect, create_engine
    import os
    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'dolphin.db')
    return t in inspect(create_engine(f'sqlite:///{db_path}')).get_table_names()

def col_exists(table, col):
    from sqlalchemy import inspect, create_engine
    import os
    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'dolphin.db')
    e = create_engine(f'sqlite:///{db_path}')
    return col in [c['name'] for c in inspect(e).get_columns(table)]

def upgrade():
    if not table_exists('quotations'):
        op.create_table('quotations',
            sa.Column('id',             sa.Integer, primary_key=True),
            sa.Column('quote_number',   sa.String,  unique=True, nullable=False),  # QUO-2026-001
            sa.Column('customer_id',    sa.Integer, sa.ForeignKey('customers.id'), nullable=True),
            sa.Column('customer_name',  sa.String,  nullable=False),
            sa.Column('customer_address',sa.Text,   nullable=True),
            sa.Column('customer_gstin', sa.String,  nullable=True),
            sa.Column('customer_email', sa.String,  nullable=True),
            sa.Column('customer_phone', sa.String,  nullable=True),
            sa.Column('line_items',     sa.Text,    nullable=True),  # JSON array
            sa.Column('subtotal',       sa.Float,   nullable=True),
            sa.Column('discount_pct',   sa.Float,   default=0),
            sa.Column('discount_amt',   sa.Float,   default=0),
            sa.Column('tax_pct',        sa.Float,   default=18),   # GST %
            sa.Column('tax_amt',        sa.Float,   nullable=True),
            sa.Column('total',          sa.Float,   nullable=True),
            sa.Column('currency',       sa.String,  default='INR'),
            sa.Column('validity_days',  sa.Integer, default=30),
            sa.Column('valid_until',    sa.Date,    nullable=True),
            sa.Column('notes',          sa.Text,    nullable=True),
            sa.Column('terms',          sa.Text,    nullable=True),
            sa.Column('status',         sa.String,  default='draft'),  # draft/sent/accepted/rejected/expired
            sa.Column('order_id',       sa.Integer, sa.ForeignKey('customer_orders.id'), nullable=True),
            sa.Column('created_at',     sa.DateTime,nullable=True),
            sa.Column('sent_at',        sa.DateTime,nullable=True),
            sa.Column('accepted_at',    sa.DateTime,nullable=True),
        )
    # Quote counter
    if not table_exists('quote_counter'):
        op.create_table('quote_counter',
            sa.Column('id',   sa.Integer, primary_key=True),
            sa.Column('year', sa.Integer, nullable=False),
            sa.Column('seq',  sa.Integer, default=0),
        )
    # Company settings stored as key-value
    if not table_exists('company_settings'):
        op.create_table('company_settings',
            sa.Column('key',   sa.String, primary_key=True),
            sa.Column('value', sa.Text,   nullable=True),
        )

def downgrade():
    op.drop_table('quotations')
    op.drop_table('quote_counter')
    op.drop_table('company_settings')
