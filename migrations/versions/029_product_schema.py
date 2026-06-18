"""029 — product schema: customizable product types, attributes & values

Replaces the hardcoded product types / sizes / variants with a fully
user-configurable schema. Three new tables:

  product_types          one row per product (Punch, Die Frame, etc.)
  product_attributes     one row per attribute on a product (Size, Type, Mounting...)
  product_attribute_values   one row per allowed value for an attribute

Jobs continue to store product_type / product_size / product_variant as plain
strings (preserves historical records when schema entries are renamed or
removed). A new `product_attrs` JSON column on Job holds the structured
attribute map (e.g. {"Type":"Plain","Mounting":"Upper","Cavities":"4"}).

Also flags certain Routings as `is_custom` — one-shot per-job routings created
when the user defines ops inline. Filtered out of the routings list view.

Seeded with the current Yukeng setup:
  Punch       → Size, Type (Plain/Panel/Rustic/Isostatic), Mounting (Upper/Lower)
  Die Frame   → Size, Cavities (2/3/4), Liner Type (Hardening/Carbide/Wire Cut), Type (Lower/Upper/Entry)
  Liner Set   → Size, Cavities, Liner Type
  Complete Mould → Type (Entry/SFS), Half (Upper/Lower)

Revision ID: 029_product_schema
Revises: 028_job_on_hold
"""
revision = '029_product_schema'
down_revision = '028_job_on_hold'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


def col_exists(table, col):
    return col in [c['name'] for c in inspect(op.get_bind()).get_columns(table)]


def table_exists(table):
    return inspect(op.get_bind()).has_table(table)


# Default seed data — mirrors the Yukeng_Setup.txt the user provided.
# After this migration runs, the user can edit any of this through the
# Product Schema admin page; this is just a sensible starting point.
SEED = [
    {
        "name": "Punch",
        "order": 1,
        "attrs": [
            {"name": "Size", "required": True, "order": 1,
             "values": ["600×600","600×900","600×1200","900×900","900×1200","1200×1200"]},
            {"name": "Type", "required": False, "order": 2,
             "values": ["Plain","Panel","Rustic","Isostatic"]},
            {"name": "Mounting", "required": False, "order": 3,
             "values": ["Upper","Lower"]},
        ],
    },
    {
        "name": "Die Frame",
        "order": 2,
        "attrs": [
            {"name": "Size", "required": True, "order": 1,
             "values": ["600×600","600×900","600×1200","900×900","900×1200","1200×1200"]},
            {"name": "Cavities", "required": False, "order": 2,
             "values": ["2","3","4","6","8"]},
            {"name": "Liner Type", "required": False, "order": 3,
             "values": ["Hardening","Carbide","Wire Cut"]},
            {"name": "Type", "required": False, "order": 4,
             "values": ["Lower","Upper","Entry"]},
        ],
    },
    {
        "name": "Liner Set",
        "order": 3,
        "attrs": [
            {"name": "Size", "required": True, "order": 1,
             "values": ["600×600","600×900","600×1200","900×900","900×1200","1200×1200"]},
            {"name": "Cavities", "required": False, "order": 2,
             "values": ["2","3","4","6","8"]},
            {"name": "Liner Type", "required": False, "order": 3,
             "values": ["Hardening","Carbide","Wire Cut"]},
        ],
    },
    {
        "name": "Complete Mould",
        "order": 4,
        "attrs": [
            {"name": "Type", "required": True, "order": 1,
             "values": ["Entry","SFS"]},
            {"name": "Half", "required": False, "order": 2,
             "values": ["Upper","Lower"]},
            {"name": "Size", "required": False, "order": 3,
             "values": ["600×600","600×900","600×1200","900×900","900×1200","1200×1200"]},
        ],
    },
    {
        "name": "Custom Plate",
        "order": 5,
        "attrs": [
            {"name": "Size", "required": False, "order": 1,
             "values": ["600×600","600×900","600×1200","900×900","900×1200","1200×1200"]},
        ],
    },
]


def upgrade():
    bind = op.get_bind()

    # ── product_types ────────────────────────────────────────────────────
    if not table_exists('product_types'):
        op.create_table(
            'product_types',
            sa.Column('id', sa.Integer, primary_key=True),
            sa.Column('name', sa.String, nullable=False, unique=True),
            sa.Column('display_order', sa.Integer, nullable=True, server_default='0'),
            sa.Column('is_active', sa.Boolean, nullable=True, server_default='1'),
        )

    # ── product_attributes ──────────────────────────────────────────────
    if not table_exists('product_attributes'):
        op.create_table(
            'product_attributes',
            sa.Column('id', sa.Integer, primary_key=True),
            sa.Column('product_type_id', sa.Integer,
                      sa.ForeignKey('product_types.id', ondelete='CASCADE'),
                      nullable=False),
            sa.Column('name', sa.String, nullable=False),
            sa.Column('display_order', sa.Integer, nullable=True, server_default='0'),
            sa.Column('is_required', sa.Boolean, nullable=True, server_default='0'),
            sa.Column('is_active', sa.Boolean, nullable=True, server_default='1'),
        )

    # ── product_attribute_values ────────────────────────────────────────
    if not table_exists('product_attribute_values'):
        op.create_table(
            'product_attribute_values',
            sa.Column('id', sa.Integer, primary_key=True),
            sa.Column('attribute_id', sa.Integer,
                      sa.ForeignKey('product_attributes.id', ondelete='CASCADE'),
                      nullable=False),
            sa.Column('value', sa.String, nullable=False),
            sa.Column('display_order', sa.Integer, nullable=True, server_default='0'),
            sa.Column('is_active', sa.Boolean, nullable=True, server_default='1'),
        )

    # ── Job.product_attrs (JSON dict of selected attributes) ────────────
    if not col_exists('jobs', 'product_attrs'):
        with op.batch_alter_table('jobs') as b:
            b.add_column(sa.Column('product_attrs', sa.Text(), nullable=True))

    # ── Routing.is_custom (flag for per-job throwaway routings) ─────────
    if not col_exists('routings', 'is_custom'):
        with op.batch_alter_table('routings') as b:
            b.add_column(sa.Column('is_custom', sa.Boolean(), nullable=True, server_default='0'))

    # ── Seed defaults ───────────────────────────────────────────────────
    # Only if product_types is empty (idempotent: re-running this migration
    # after data exists won't duplicate)
    res = bind.execute(sa.text("SELECT COUNT(*) FROM product_types")).scalar()
    if not res:
        for pt in SEED:
            pt_id = bind.execute(
                sa.text("INSERT INTO product_types (name, display_order, is_active) "
                        "VALUES (:n, :o, 1)"),
                {"n": pt["name"], "o": pt["order"]}
            ).lastrowid
            for attr in pt["attrs"]:
                attr_id = bind.execute(
                    sa.text("INSERT INTO product_attributes "
                            "(product_type_id, name, display_order, is_required, is_active) "
                            "VALUES (:p, :n, :o, :r, 1)"),
                    {"p": pt_id, "n": attr["name"], "o": attr["order"],
                     "r": 1 if attr["required"] else 0}
                ).lastrowid
                for i, v in enumerate(attr["values"]):
                    bind.execute(
                        sa.text("INSERT INTO product_attribute_values "
                                "(attribute_id, value, display_order, is_active) "
                                "VALUES (:a, :v, :o, 1)"),
                        {"a": attr_id, "v": v, "o": i}
                    )


def downgrade():
    if col_exists('routings', 'is_custom'):
        with op.batch_alter_table('routings') as b:
            b.drop_column('is_custom')
    if col_exists('jobs', 'product_attrs'):
        with op.batch_alter_table('jobs') as b:
            b.drop_column('product_attrs')
    if table_exists('product_attribute_values'):
        op.drop_table('product_attribute_values')
    if table_exists('product_attributes'):
        op.drop_table('product_attributes')
    if table_exists('product_types'):
        op.drop_table('product_types')
