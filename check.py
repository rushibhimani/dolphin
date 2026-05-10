"""
Run this to diagnose why the server won't start.
python check.py
"""
import sys, os
print(f"Python: {sys.version}")
print(f"Working dir: {os.getcwd()}")
print()

errors = []

# 1. Check packages
packages = ['fastapi', 'uvicorn', 'sqlalchemy', 'pydantic', 'alembic']
for pkg in packages:
    try:
        mod = __import__(pkg)
        ver = getattr(mod, '__version__', '?')
        print(f"  ✓ {pkg} {ver}")
    except ImportError as e:
        print(f"  ✗ {pkg} MISSING — {e}")
        errors.append(f"Missing: {pkg}")

print()

# 2. Check files exist
files = ['main.py', 'models.py', 'alembic.ini', 'migrations/env.py',
         'migrations/versions/001_initial.py', 'migrations/versions/002_workers.py']
for f in files:
    exists = os.path.exists(f)
    print(f"  {'✓' if exists else '✗'} {f}")
    if not exists:
        errors.append(f"Missing file: {f}")

print()

# 3. Try importing models
try:
    import models
    print("  ✓ models.py imports OK")
except Exception as e:
    print(f"  ✗ models.py failed: {e}")
    errors.append(str(e))

# 4. Try importing main (without running)
try:
    import importlib.util
    spec = importlib.util.spec_from_file_location("main_check", "main.py")
    # Just check syntax
    with open('main.py') as f:
        source = f.read()
    compile(source, 'main.py', 'exec')
    print("  ✓ main.py syntax OK")
except SyntaxError as e:
    print(f"  ✗ main.py syntax error: {e}")
    errors.append(str(e))
except Exception as e:
    print(f"  ✗ main.py check: {e}")

# 5. Check database
if os.path.exists('dolphin.db'):
    import sqlite3
    conn = sqlite3.connect('dolphin.db')
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [r[0] for r in cur.fetchall()]
    conn.close()
    print(f"\n  DB tables: {tables}")
    missing_tables = [t for t in ['jobs','work_centers','workers','routings'] if t not in tables]
    if missing_tables:
        print(f"  ⚠ Missing tables: {missing_tables}")
        print("  → Run: python migrate.py")
else:
    print("\n  ⚠ dolphin.db does not exist")
    print("  → Run: python migrate.py")

print()
if errors:
    print("❌ ERRORS FOUND:")
    for e in errors:
        print(f"   • {e}")
    print()
    if any('Missing:' in e for e in errors):
        print("FIX: Run this command:")
        print("     pip install fastapi uvicorn sqlalchemy pydantic alembic python-multipart")
else:
    print("✅ Everything looks OK — try: python main.py")
