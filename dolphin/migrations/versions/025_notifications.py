"""025 — notifications table"""
revision = '025_notifications'
down_revision = '024_indexes'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa

def upgrade():
    from sqlalchemy import inspect
    if 'notifications' not in inspect(op.get_bind()).get_table_names():
        op.create_table('notifications',
            sa.Column('id',         sa.Integer(),  primary_key=True),
            sa.Column('event_type', sa.String(),   nullable=False),
            sa.Column('title',      sa.String(),   nullable=False),
            sa.Column('body',       sa.String(),   nullable=False),
            sa.Column('link',       sa.String(),   nullable=True),
            sa.Column('is_read',    sa.Boolean(),  nullable=True, server_default='0'),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('job_id',     sa.Integer(),  nullable=True),
            sa.Column('order_id',   sa.Integer(),  nullable=True),
            sa.Column('wc_id',      sa.Integer(),  nullable=True),
        )
        op.create_index('ix_notif_read',    'notifications', ['is_read'])
        op.create_index('ix_notif_created', 'notifications', ['created_at'])

def downgrade():
    pass
