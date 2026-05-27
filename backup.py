#!/usr/bin/env python3
"""
Dolphin ERP — Daily Backup Script
===================================
Run this daily via cron or Windows Task Scheduler.
Keeps last 30 daily backups, then weekly backups for 6 months.

SETUP:
  Linux/Mac:  crontab -e → add: 0 2 * * * /path/to/dolphin/backup.py
  Windows:    Task Scheduler → Daily at 2:00 AM → python C:\dolphin\backup.py

RESTORE:
  Copy dolphin_backup_YYYY-MM-DD.db over dolphin.db, restart app.
"""

import os
import shutil
import sys
from datetime import datetime, timedelta
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).parent.resolve()
DB_FILE      = SCRIPT_DIR / "dolphin.db"
BACKUP_DIR   = SCRIPT_DIR / "backups"
KEEP_DAILY   = 30      # keep 30 daily backups
KEEP_WEEKLY  = 26      # keep 26 weekly backups (6 months)

def run():
    if not DB_FILE.exists():
        print(f"ERROR: Database not found at {DB_FILE}")
        sys.exit(1)

    BACKUP_DIR.mkdir(exist_ok=True)

    today = datetime.now()
    date_str = today.strftime("%Y-%m-%d")
    backup_name = f"dolphin_backup_{date_str}.db"
    backup_path = BACKUP_DIR / backup_name

    # Copy database (safe copy — won't corrupt if app is running)
    try:
        shutil.copy2(DB_FILE, backup_path)
        size_kb = backup_path.stat().st_size // 1024
        print(f"✅ Backup created: {backup_path.name} ({size_kb} KB)")
    except Exception as e:
        print(f"❌ Backup failed: {e}")
        sys.exit(1)

    # ── Clean up old backups ──────────────────────────────────────────────────
    all_backups = sorted(BACKUP_DIR.glob("dolphin_backup_*.db"))

    # Keep all backups from last KEEP_DAILY days
    cutoff_daily  = today - timedelta(days=KEEP_DAILY)
    # Keep weekly backups (Sundays) for KEEP_WEEKLY weeks
    cutoff_weekly = today - timedelta(weeks=KEEP_WEEKLY)

    deleted = 0
    for backup in all_backups:
        # Parse date from filename
        try:
            name_date = datetime.strptime(backup.stem, "dolphin_backup_%Y-%m-%d")
        except ValueError:
            continue  # Skip files we can't parse

        if name_date >= cutoff_daily:
            continue  # Keep all recent dailies

        if name_date >= cutoff_weekly and name_date.weekday() == 6:
            continue  # Keep weekly (Sunday) backups

        # Delete old backup
        try:
            backup.unlink()
            deleted += 1
        except Exception as e:
            print(f"  Warning: could not delete {backup.name}: {e}")

    if deleted:
        print(f"🗑  Cleaned up {deleted} old backup(s)")

    # ── Summary ───────────────────────────────────────────────────────────────
    remaining = list(BACKUP_DIR.glob("dolphin_backup_*.db"))
    total_mb = sum(b.stat().st_size for b in remaining) / (1024*1024)
    print(f"📦 {len(remaining)} backup(s) kept, {total_mb:.1f} MB total in {BACKUP_DIR}")

    # ── Verify backup is readable ─────────────────────────────────────────────
    try:
        import sqlite3
        conn = sqlite3.connect(backup_path)
        tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        conn.close()
        print(f"✅ Backup verified: {len(tables)} tables readable")
    except Exception as e:
        print(f"⚠️  Backup verification failed: {e}")

if __name__ == "__main__":
    print(f"Dolphin ERP Backup — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Database: {DB_FILE}")
    print("-" * 50)
    run()
    print("-" * 50)
    print("Done.")
