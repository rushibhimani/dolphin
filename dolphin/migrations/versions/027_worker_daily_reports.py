"""027 — worker_daily_reports table"""
revision = '027_worker_daily_reports'
down_revision = '026_outside_transit_days'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa

def upgrade():
    from sqlalchemy import inspect
    if 'worker_daily_reports' not in inspect(op.get_bind()).get_table_names():
        op.create_table('worker_daily_reports',
            sa.Column('id',            sa.Integer(),  primary_key=True),
            sa.Column('report_date',   sa.Date(),     nullable=False),
            sa.Column('worker_id',     sa.Integer(),  sa.ForeignKey('workers.id'), nullable=False),
            sa.Column('worker_name',   sa.String(),   nullable=False),
            sa.Column('ops_scheduled', sa.Integer(),  nullable=True, server_default='0'),
            sa.Column('ops_completed', sa.Integer(),  nullable=True, server_default='0'),
            sa.Column('ops_started',   sa.Integer(),  nullable=True, server_default='0'),
            sa.Column('ops_missed',    sa.Integer(),  nullable=True, server_default='0'),
            sa.Column('est_hours',     sa.Float(),    nullable=True, server_default='0'),
            sa.Column('actual_hours',  sa.Float(),    nullable=True, server_default='0'),
            sa.Column('efficiency_pct',sa.Float(),    nullable=True),
            sa.Column('ops_detail',    sa.Text(),     nullable=True),
            sa.Column('generated_at',  sa.DateTime(), nullable=True),
        )
        op.create_index('ix_wdr_date',   'worker_daily_reports', ['report_date'])
        op.create_index('ix_wdr_worker', 'worker_daily_reports', ['worker_id'])

def downgrade():
    pass
