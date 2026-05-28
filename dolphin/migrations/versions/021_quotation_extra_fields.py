"""021 — extra fields on quotations: message, delivery_time, payment_terms, pan_no, packing_cost, bank_details"""
revision = '021_quotation_extra_fields'
down_revision = '020_quotations'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa

def col_exists(table, col):
    from sqlalchemy import inspect, create_engine
    import os
    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'dolphin.db')
    return col in [c['name'] for c in inspect(create_engine(f'sqlite:///{db_path}')).get_columns(table)]

def upgrade():
    with op.batch_alter_table('quotations') as b:
        for col, typ in [
            ('message',        sa.Text),
            ('delivery_time',  sa.String),
            ('payment_terms',  sa.String),
            ('pan_no',         sa.String),
            ('packing_cost',   sa.String),
            ('bank_details',   sa.Text),
        ]:
            if not col_exists('quotations', col):
                b.add_column(sa.Column(col, typ, nullable=True))

def downgrade():
    with op.batch_alter_table('quotations') as b:
        for col in ['message','delivery_time','payment_terms','pan_no','packing_cost','bank_details']:
            b.drop_column(col)
