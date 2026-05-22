"""Add formula fields to operations for punch lead time calculation

Revision ID: 011_formula_ops
Revises: 010_preferred_worker
Create Date: 2026-05-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '011_formula_ops'
down_revision = '010_preferred_worker'
branch_labels = None
depends_on = None


def col_exists(table, col):
    return col in [c['name'] for c in inspect(op.get_bind()).get_columns(table)]


def upgrade():
    with op.batch_alter_table('operations') as b:
        # formula_type: volume_milling | area | perimeter_side | perimeter_weld | fixed | none
        if not col_exists('operations', 'formula_type'):
            b.add_column(sa.Column('formula_type', sa.String(), nullable=True))
        # mrr: material removal rate (mm³/min or mm²/min depending on formula)
        if not col_exists('operations', 'mrr'):
            b.add_column(sa.Column('mrr', sa.Float(), nullable=True))
        # depth_mm: depth per pass or total depth — used in Volume formulas
        if not col_exists('operations', 'depth_mm'):
            b.add_column(sa.Column('depth_mm', sa.Float(), nullable=True))
        # dim_x_source: 'length' | 'width' | 'thickness' | 'fixed'
        if not col_exists('operations', 'dim_x_source'):
            b.add_column(sa.Column('dim_x_source', sa.String(), nullable=True))
        # dim_y_source: 'length' | 'width' | 'thickness' | 'fixed'
        if not col_exists('operations', 'dim_y_source'):
            b.add_column(sa.Column('dim_y_source', sa.String(), nullable=True))


def downgrade():
    cols = ['formula_type', 'mrr', 'depth_mm', 'dim_x_source', 'dim_y_source']
    with op.batch_alter_table('operations') as b:
        for col in cols:
            if col_exists('operations', col):
                b.drop_column(col)
