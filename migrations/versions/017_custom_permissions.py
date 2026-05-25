"""017 — custom_permissions column on users table"""
revision = '017_custom_permissions'
down_revision = '016_staff_tasks_leave_range'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa

def col_exists(table, col):
    from sqlalchemy import inspect, create_engine
    import os
    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'dolphin.db')
    e = create_engine(f'sqlite:///{db_path}')
    return col in [c['name'] for c in inspect(e).get_columns(table)]

def upgrade():
    # JSON stored as Text in SQLite — nullable, so existing rows get NULL (= use role defaults)
    if not col_exists('users', 'custom_permissions'):
        with op.batch_alter_table('users') as b:
            b.add_column(sa.Column('custom_permissions', sa.Text, nullable=True))

def downgrade():
    with op.batch_alter_table('users') as b:
        b.drop_column('custom_permissions')
