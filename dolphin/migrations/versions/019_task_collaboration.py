"""019 — task_assignees (multi-user) + task_activities (audit log)"""
revision = '019_task_collaboration'
down_revision = '018_task_files'
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
    # Many-to-many: task ↔ worker assignees
    if not table_exists('task_assignees'):
        op.create_table('task_assignees',
            sa.Column('task_id',   sa.Integer, sa.ForeignKey('staff_tasks.id'), nullable=False),
            sa.Column('worker_id', sa.Integer, sa.ForeignKey('workers.id'),     nullable=False),
            sa.Column('worker_name', sa.String, nullable=True),
            sa.Column('assigned_at', sa.DateTime, nullable=True),
        )

    # Activity log: every action on a task
    if not table_exists('task_activities'):
        op.create_table('task_activities',
            sa.Column('id',          sa.Integer,  primary_key=True),
            sa.Column('task_id',     sa.Integer,  sa.ForeignKey('staff_tasks.id'), nullable=False),
            sa.Column('actor_id',    sa.Integer,  nullable=True),   # worker_id of who did it
            sa.Column('actor_name',  sa.String,   nullable=True),
            sa.Column('action',      sa.String,   nullable=False),  # started|paused|done|reopened|comment|file_added
            sa.Column('note',        sa.Text,     nullable=True),   # comment text or context
            sa.Column('created_at',  sa.DateTime, nullable=True),
        )

def downgrade():
    op.drop_table('task_activities')
    op.drop_table('task_assignees')
