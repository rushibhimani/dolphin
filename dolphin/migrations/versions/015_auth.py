"""015_auth — users table for authentication"""
revision = '015_auth'
down_revision = '014_sub_operations'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa

def upgrade():
    op.create_table('users',
        sa.Column('id',           sa.Integer,  primary_key=True),
        sa.Column('username',     sa.String,   nullable=False, unique=True),
        sa.Column('display_name', sa.String,   nullable=True),
        sa.Column('password_hash',sa.String,   nullable=True),   # pbkdf2 hash:salt
        sa.Column('pin_hash',     sa.String,   nullable=True),   # pbkdf2 hash:salt for 4-6 digit PIN
        sa.Column('role',         sa.String,   nullable=False, server_default='operator'),
        sa.Column('worker_id',    sa.Integer,  sa.ForeignKey('workers.id'), nullable=True),
        sa.Column('is_active',    sa.Boolean,  server_default='1'),
        sa.Column('last_login',   sa.DateTime, nullable=True),
        sa.Column('created_at',   sa.DateTime, nullable=True),
    )

def downgrade():
    op.drop_table('users')
