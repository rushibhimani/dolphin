"""018 — task_files table for staff task attachments"""
revision = '018_task_files'
down_revision = '017_custom_permissions'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa

def table_exists(t):
    from sqlalchemy import inspect, create_engine
    import os
    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'dolphin.db')
    return t in inspect(create_engine(f'sqlite:///{db_path}')).get_table_names()

def upgrade():
    if not table_exists('task_files'):
        op.create_table('task_files',
            sa.Column('id',          sa.Integer, primary_key=True),
            sa.Column('task_id',     sa.Integer, sa.ForeignKey('staff_tasks.id'), nullable=False),
            sa.Column('filename',    sa.String,  nullable=False),
            sa.Column('stored_name', sa.String,  nullable=False),   # UUID filename on disk
            sa.Column('file_size',   sa.Integer, nullable=True),    # bytes
            sa.Column('mime_type',   sa.String,  nullable=True),
            sa.Column('uploaded_by', sa.String,  nullable=True),
            sa.Column('note',        sa.String,  nullable=True),    # optional description
            sa.Column('created_at',  sa.DateTime,nullable=True),
        )

def downgrade():
    op.drop_table('task_files')
