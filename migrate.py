"""
Dolphin ERP — Database Migration Script
Safe to run multiple times. Never deletes your data.
"""
import subprocess, sys, os, re

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
        import sqlite3
        conn = sqlite3.connect(db_path)
        cur  = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='alembic_version'")
        has_version = cur.fetchone() is not None

        if not has_version:
            print("\n⚠ Existing database found without migration history.")
            cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
            existing = {r[0] for r in cur.fetchall()}
            conn.close()

            if 'worker_skills' in existing and 'customers' in existing:
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

    # ── Step 2: Upgrade ──
    print("\nApplying pending migrations...")
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

    if result.returncode == 0:
        print("\n✅ Database is up to date!")
        print("   Run: python main.py")
    else:
        print("\n✗ Migration failed. Full output:")
        print(result.stderr)
        sys.exit(1)


def _fix_duplicate_heads(ver_dir):
    """
    Detect and remove duplicate migration heads automatically.
    A duplicate head = two files with the same down_revision.
    We keep the one with the LATEST revision ID and delete the older one.
    """
    if not os.path.isdir(ver_dir):
        return

    files = [f for f in os.listdir(ver_dir) if f.endswith('.py') and not f.startswith('__')]

    # Parse each file
    migrations = {}  # revision -> {file, down_revision}
    for fname in files:
        path = os.path.join(ver_dir, fname)
        try:
            text = open(path).read()
            rev  = re.search(r"^revision\s*=\s*['\"]([^'\"]+)['\"]", text, re.MULTILINE)
            down = re.search(r"^down_revision\s*=\s*['\"]([^'\"]+)['\"]", text, re.MULTILINE)
            if rev:
                migrations[rev.group(1)] = {
                    'file': fname,
                    'path': path,
                    'down_revision': down.group(1) if down else None,
                }
        except Exception:
            pass

    # Find down_revisions that appear more than once
    from collections import Counter
    down_rev_counts = Counter(m['down_revision'] for m in migrations.values()
                               if m['down_revision'])
    duplicates = {dr for dr, cnt in down_rev_counts.items() if cnt > 1}

    if not duplicates:
        return  # All good

    removed = []
    for down_rev in duplicates:
        # Get all migrations branching from this down_revision
        branches = [(rev, info) for rev, info in migrations.items()
                    if info['down_revision'] == down_rev]
        # Sort by revision ID — keep the latest one (lexicographically)
        branches.sort(key=lambda x: x[0], reverse=True)
        # Remove all but the first (latest)
        for rev, info in branches[1:]:
            os.remove(info['path'])
            removed.append(info['file'])
            print(f"  ⚠ Removed duplicate migration: {info['file']} "
                  f"(kept {branches[0][1]['file']})")

    if removed:
        print(f"  Fixed {len(removed)} duplicate head(s) automatically")


if __name__ == "__main__":
    run()
