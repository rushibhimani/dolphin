"""Notification targeting — per-user, per-worker, per-role delivery."""

revision = "033_notification_targeting"
down_revision = "032_activity_log"

from alembic import op
import sqlalchemy as sa

def _col_exists(table, col):
    from sqlalchemy import inspect as sa_inspect
    bind = op.get_bind()
    insp = sa_inspect(bind)
    return any(c["name"] == col for c in insp.get_columns(table))

def upgrade():
    with op.batch_alter_table("notifications") as b:
        if not _col_exists("notifications", "target_role"):
            b.add_column(sa.Column("target_role",      sa.String, nullable=True))
        if not _col_exists("notifications", "target_user_id"):
            b.add_column(sa.Column("target_user_id",   sa.Integer, nullable=True))
        if not _col_exists("notifications", "target_worker_id"):
            b.add_column(sa.Column("target_worker_id", sa.Integer, nullable=True))

def downgrade():
    with op.batch_alter_table("notifications") as b:
        b.drop_column("target_role")
        b.drop_column("target_user_id")
        b.drop_column("target_worker_id")
