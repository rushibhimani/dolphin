"""Activity log for audit trail — who did what, when."""

revision = "032_activity_log"
down_revision = "031_promised_projection"

from alembic import op
import sqlalchemy as sa

def upgrade():
    op.create_table(
        "activity_log",
        sa.Column("id",           sa.Integer, primary_key=True),
        sa.Column("timestamp",    sa.DateTime, nullable=False),
        sa.Column("user_id",      sa.Integer,  nullable=True),
        sa.Column("username",     sa.String,   nullable=True),
        sa.Column("action",       sa.String,   nullable=False),
        sa.Column("entity_type",  sa.String,   nullable=True),
        sa.Column("entity_id",    sa.Integer,  nullable=True),
        sa.Column("entity_label", sa.String,   nullable=True),
        sa.Column("details",      sa.Text,     nullable=True),
    )
    op.create_index("ix_activity_log_timestamp", "activity_log", ["timestamp"])
    op.create_index("ix_activity_log_action",    "activity_log", ["action"])

def downgrade():
    op.drop_table("activity_log")
