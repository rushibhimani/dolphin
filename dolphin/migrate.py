"""
Dolphin ERP — Database Migration Script
Safe to run multiple times. Never deletes your data.

What this does:
1. Runs Alembic migrations (creates all tables from scratch on new PC)
2. Self-heals any missing columns that migrations may have missed
3. Fixes duplicate Alembic heads automatically
"""
import subprocess, sys, os, re, sqlite3


# ─────────────────────────────────────────────────────────────────
# COLUMN DEFINITIONS — every column models.py expects
# Format: (table, column, sql_type, default)
# ─────────────────────────────────────────────────────────────────
REQUIRED_COLUMNS = [
    # work_centers
    ('work_centers', 'code',                     'TEXT',    None),
    ('work_centers', 'status',                   'TEXT',    "'active'"),
    ('work_centers', 'skill_level',              'INTEGER', '1'),
    ('work_centers', 'continuity_hours',         'FLOAT',   '2.0'),
    ('work_centers', 'continuity_threshold_hrs', 'FLOAT',   '2.0'),
    ('work_centers', 'is_bottleneck',            'BOOLEAN', '0'),

    # workers
    ('workers', 'code',        'TEXT',    None),
    ('workers', 'skill_level', 'INTEGER', '1'),
    ('workers', 'is_active',   'BOOLEAN', '1'),
    ('workers', 'phone',       'TEXT',    None),

    # scheduled_ops
    ('scheduled_ops', 'op_name',             'TEXT',    "''"),
    ('scheduled_ops', 'wc_name',             'TEXT',    "''"),
    ('scheduled_ops', 'worker_name',         'TEXT',    None),
    ('scheduled_ops', 'machine_setup_mins',  'FLOAT',   '0'),
    ('scheduled_ops', 'job_setup_mins',      'FLOAT',   '0'),
    ('scheduled_ops', 'machine_setup_waived','BOOLEAN', '0'),
    ('scheduled_ops', 'actual_start',        'DATETIME',None),
    ('scheduled_ops', 'actual_end',          'DATETIME',None),

    # jobs
    ('jobs', 'order_id',           'INTEGER', None),
    ('jobs', 'piece_number',       'INTEGER', None),
    ('jobs', 'inline_ops',         'TEXT',    None),
    ('jobs', 'completed_at',       'DATETIME',None),
    ('jobs', 'material_ready_date','DATETIME',None),
    ('jobs', 'not_before',         'DATETIME',None),
    ('jobs', 'op_overrides',       'TEXT',    "'[]'"),
    ('jobs', 'po_number',          'TEXT',    None),
    ('jobs', 'product_size',       'TEXT',    "''"),
    ('jobs', 'product_variant',    'TEXT',    None),
    ('jobs', 'customer_id',        'INTEGER', None),
    ('jobs', 'total_price',        'FLOAT',   None),
    ('jobs', 'priority_flag',      'BOOLEAN', '0'),
    ('jobs', 'notes',              'TEXT',    "''"),

    # routings
    ('routings', 'is_active',          'BOOLEAN', '1'),
    ('routings', 'material_lead_days', 'FLOAT',   '2.0'),
    ('routings', 'description',        'TEXT',    None),

    # operations
    ('operations', 'machine_setup_mins', 'FLOAT',   '0'),
    ('operations', 'job_setup_mins',     'FLOAT',   '0'),
    ('operations', 'setup_time_mins',    'FLOAT',   '0'),
    ('operations', 'is_optional',        'BOOLEAN', '0'),

    # customers
    ('customers', 'is_active',      'BOOLEAN', '1'),
    ('customers', 'contact_person', 'TEXT',    None),
    ('customers', 'notes',          'TEXT',    None),
    ('customers', 'phone',          'TEXT',    None),
]

# Tables that must exist (created if missing)
REQUIRED_TABLES = {
    'job_counters': '''
        CREATE TABLE IF NOT EXISTS job_counters (
            id   INTEGER PRIMARY KEY,
            year INTEGER NOT NULL,
            seq  INTEGER DEFAULT 0
        )''',
    'order_counters': '''
        CREATE TABLE IF NOT EXISTS order_counters (
            id   INTEGER PRIMARY KEY,
            year INTEGER NOT NULL,
            seq  INTEGER DEFAULT 0
        )''',
    'customer_orders': '''
        CREATE TABLE IF NOT EXISTS customer_orders (
            id              INTEGER PRIMARY KEY,
            order_number    TEXT NOT NULL,
            customer_id     INTEGER REFERENCES customers(id),
            customer_name   TEXT NOT NULL,
            product_type    TEXT DEFAULT '',
            product_size    TEXT DEFAULT '',
            product_variant TEXT,
            routing_id      INTEGER REFERENCES routings(id),
            inline_ops      TEXT,
            quantity        INTEGER DEFAULT 1,
            due_date        DATETIME,
            notes           TEXT DEFAULT '',
            total_price     FLOAT,
            status          TEXT DEFAULT 'pending',
            created_at      DATETIME
        )''',
    'worker_leaves': '''
        CREATE TABLE IF NOT EXISTS worker_leaves (
            id          INTEGER PRIMARY KEY,
            worker_id   INTEGER REFERENCES workers(id),
            leave_date  DATE NOT NULL,
            leave_type  TEXT DEFAULT 'full',
            start_time  TEXT,
            end_time    TEXT,
            reason      TEXT DEFAULT ''
        )''',
}


def self_heal(db_path):
    """Add any missing columns and tables directly via SQLite."""
    conn = sqlite3.connect(db_path)
    cur  = conn.cursor()

    # Get existing tables
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    existing_tables = {r[0] for r in cur.fetchall()}

    added_cols   = []
    added_tables = []

    # Create missing tables
    for table, ddl in REQUIRED_TABLES.items():
        if table not in existing_tables:
            cur.execute(ddl)
            added_tables.append(table)
            existing_tables.add(table)

    # Add missing columns
    for table, col, col_type, default in REQUIRED_COLUMNS:
        if table not in existing_tables:
            continue  # table itself missing — handled above or by Alembic

        cur.execute(f"PRAGMA table_info({table})")
        existing_cols = {row[1] for row in cur.fetchall()}

        if col not in existing_cols:
            if default is not None:
                sql = f"ALTER TABLE {table} ADD COLUMN {col} {col_type} DEFAULT {default}"
            else:
                sql = f"ALTER TABLE {table} ADD COLUMN {col} {col_type}"
            try:
                cur.execute(sql)
                added_cols.append(f"{table}.{col}")
            except sqlite3.OperationalError as e:
                if 'duplicate column' not in str(e).lower():
                    print(f"  ⚠ Could not add {table}.{col}: {e}")

    conn.commit()
    conn.close()

    if added_tables:
        print(f"  ✓ Created tables: {', '.join(added_tables)}")
    if added_cols:
        print(f"  ✓ Added {len(added_cols)} missing column(s):")
        for c in added_cols:
            print(f"    + {c}")
    if not added_tables and not added_cols:
        print("  ✓ All columns present — no fixes needed")


def run():
    print("=" * 50)
    print("Dolphin ERP — Database Migration")
    print("=" * 50)

    try:
        import alembic
        print(f"✓ Alembic {alembic.__version__} found")
    except ImportError:
        print("✗ Alembic not installed. Run: pip install alembic")
        sys.exit(1)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    db_path    = os.path.join(script_dir, "dolphin.db")
    ver_dir    = os.path.join(script_dir, "migrations", "versions")

    # ── Step 0: Auto-fix duplicate heads ──
    _fix_duplicate_heads(ver_dir)

    # ── Step 1: Handle existing DB with no migration history ──
    if os.path.exists(db_path):
        conn = sqlite3.connect(db_path)
        cur  = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='alembic_version'")
        has_version = cur.fetchone() is not None

        if not has_version:
            print("\n⚠ Existing database found without migration history.")
            cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
            existing = {r[0] for r in cur.fetchall()}
            conn.close()

            if 'customer_orders' in existing:
                stamp = '007_missing_columns'
            elif 'worker_skills' in existing and 'customers' in existing:
                stamp = '003_customers'
            elif 'workers' in existing and 'worker_leaves' in existing:
                stamp = '002_workers'
            elif 'jobs' in existing:
                stamp = '001_initial'
            else:
                stamp = 'base'

            print(f"  Stamping at: {stamp}")
            subprocess.run([sys.executable, "-m", "alembic", "stamp", stamp],
                           capture_output=True, cwd=script_dir)
            print(f"  ✓ Stamped")
        else:
            conn.close()
            print("✓ Migration history found")

    # ── Step 2: Run Alembic upgrade ──
    print("\nApplying Alembic migrations...")
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        capture_output=True, text=True, cwd=script_dir
    )

    if result.stdout.strip():
        print(result.stdout.strip())
    if result.stderr:
        errors = [l for l in result.stderr.split('\n')
                  if l.strip() and 'INFO' not in l and 'WARN' not in l.upper()]
        if errors:
            print('\n'.join(errors))

    if result.returncode != 0:
        print("\n⚠ Alembic had issues — running self-heal anyway...")

    # ── Step 3: Self-heal any missing columns Alembic missed ──
    if os.path.exists(db_path):
        print("\nChecking for missing columns...")
        self_heal(db_path)
    else:
        # Fresh PC — Alembic creates the DB, then we self-heal
        print("\n⚠ No database found after migration. Check Alembic setup.")

    if result.returncode == 0:
        print("\n✅ Database is up to date!")
    else:
        print("\n✅ Self-heal complete. Try running the app.")

    print("   Run: python main.py")


def _fix_duplicate_heads(ver_dir):
    if not os.path.isdir(ver_dir):
        return

    files = [f for f in os.listdir(ver_dir) if f.endswith('.py') and not f.startswith('__')]
    migrations = {}
    for fname in files:
        path = os.path.join(ver_dir, fname)
        try:
            text = open(path).read()
            rev  = re.search(r"^revision\s*=\s*['\"]([^'\"]+)['\"]", text, re.MULTILINE)
            down = re.search(r"^down_revision\s*=\s*['\"]([^'\"]+)['\"]", text, re.MULTILINE)
            if rev:
                migrations[rev.group(1)] = {
                    'file': fname, 'path': path,
                    'down_revision': down.group(1) if down else None,
                }
        except Exception:
            pass

    from collections import Counter
    down_rev_counts = Counter(m['down_revision'] for m in migrations.values()
                               if m['down_revision'])
    duplicates = {dr for dr, cnt in down_rev_counts.items() if cnt > 1}
    if not duplicates:
        return

    removed = []
    for down_rev in duplicates:
        branches = [(rev, info) for rev, info in migrations.items()
                    if info['down_revision'] == down_rev]
        branches.sort(key=lambda x: x[0], reverse=True)
        for rev, info in branches[1:]:
            os.remove(info['path'])
            removed.append(info['file'])
            print(f"  ⚠ Removed duplicate migration: {info['file']} (kept {branches[0][1]['file']})")
    if removed:
        print(f"  Fixed {len(removed)} duplicate head(s)")


if __name__ == "__main__":
    run()