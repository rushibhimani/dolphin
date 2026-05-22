# Python & Development Commands — Quick Reference

**For Dolphin ERP Development**

Keep this file in your project folder: `dolphin/PYTHON_COMMANDS.md`

---

## Virtual Environment (Do First)

### Create Virtual Environment
```bash
python -m venv venv
```

Do this **once per computer** in the dolphin folder.

### Activate Virtual Environment

#### Windows
```bash
venv\Scripts\activate
```

#### Mac/Linux
```bash
source venv/bin/activate
```

You should see `(venv)` at the start of your terminal line.

### Deactivate Virtual Environment
```bash
deactivate
```

Back to normal terminal (no `(venv)` prefix).

---

## Install Dependencies

### First Time (After Cloning)
```bash
pip install -r requirements.txt
```

This installs:
- FastAPI (web framework)
- SQLAlchemy (database)
- Alembic (migrations)
- uvicorn (server)

### Add New Dependency (If Needed)
```bash
pip install package_name

# Then update requirements.txt
pip freeze > requirements.txt

# Commit the change
git add requirements.txt
git commit -m "Added new dependency: package_name"
git push origin main
```

### Upgrade All Dependencies
```bash
pip install --upgrade -r requirements.txt
```

---

## Database Migrations

### Run All Pending Migrations
```bash
python migrate.py
```

**Always do this before starting the server!**

Output should show:
```
✓ Alembic found
✓ Migration history found
Applying pending migrations...
✅ Database is up to date!
   Run: python main.py
```

### Check Migration Status
```bash
python -m alembic current
```

Shows which migration you're on.

### See All Migrations
```bash
python -m alembic history
```

---

## Run the Server

### Start Development Server
```bash
python main.py
```

Should show:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
```

Visit **http://localhost:8000** in browser.

### Stop Server
Press **Ctrl+C** in the terminal.

### Server Won't Start? Troubleshoot
```bash
# Check Python version
python --version

# Check if port 8000 is in use (Windows)
netstat -ano | findstr :8000

# Kill process using port 8000
taskkill /PID <process_id> /F
```

---

## Code Quality

### Check Python Syntax
```bash
python -m py_compile main.py
python -m py_compile models.py
```

### Format Code (Optional)
```bash
# Install formatter
pip install black

# Format main.py
black main.py
```

### Check for Errors
```bash
python -m pylint main.py
```

(If pylint not installed: `pip install pylint`)

---

## Database Management

### Backup Database
```bash
# Windows
copy dolphin.db dolphin_backup_2026-01-15.db

# Mac
cp dolphin.db dolphin_backup_2026-01-15.db
```

Keep backups before major changes!

### Reset Database (CAUTION: Deletes All Data)
```bash
# Windows
del dolphin.db

# Mac
rm dolphin.db

# Then:
python migrate.py
```

### Inspect Database
```bash
# Open SQLite viewer (if installed)
sqlite3 dolphin.db

# Then in SQLite:
.tables                    # See all tables
SELECT * FROM jobs;        # See all jobs
SELECT * FROM workers;     # See all workers
.quit                      # Exit
```

---

## Testing & Debugging

### Run a Quick Test
```bash
# Start server in one terminal
python main.py

# In another terminal, test an endpoint
curl http://localhost:8000/api/health

# Should return: {"status":"ok"}
```

### View Browser Console (Debug JavaScript)
1. Open http://localhost:8000
2. Press **F12** (or Ctrl+Shift+I)
3. Click **Console** tab
4. You'll see any JavaScript errors

### View Server Logs
Server logs appear in the terminal where you ran `python main.py`.

Look for:
- `ERROR` — something went wrong
- `INFO` — normal operation
- `POST /api/schedule-all` — which endpoints are being called

---

## File Editing

### Edit Files (Choose One)

#### VS Code (Recommended)
```bash
# Install VS Code from: https://code.visualstudio.com
# Then from terminal:
code .
```

Opens entire project in VS Code.

#### Nano (Simple, Built-in)
```bash
nano index.html
# Edit, then Ctrl+X → Y → Enter to save
```

#### Vim (Advanced, Not Recommended for Beginners)
```bash
vim main.py
# Press i to edit, Esc to stop editing, :wq to save
```

---

## Common Development Workflow

### Morning: Start Work
```bash
cd C:\Users\YOUR_NAME\Documents\dolphin
venv\Scripts\activate
python main.py
# Keep this terminal open
```

### In Another Terminal: Edit Code
```bash
code .
# Edit files in VS Code
```

### After Each Change
1. **Save the file** (Ctrl+S)
2. **Refresh browser** (F5)
3. **Check browser console** (F12) for JavaScript errors
4. **Check server terminal** for Python errors

### Evening: Save Changes
```bash
git status
git add .
git commit -m "Fixed something"
git push origin main
```

---

## Performance Tips

### Fast Development Cycle
- **Don't restart server** for HTML/CSS changes — just refresh browser
- **Do restart server** for Python changes (`Ctrl+C`, then `python main.py`)
- **Reload database** between major changes: `del dolphin.db && python migrate.py`

### Slow Server?
```bash
# Check what's running
tasklist | findstr python

# Kill any extra Python processes
taskkill /IM python.exe /F

# Start fresh
python main.py
```

---

## Emergency Fixes

### Everything Broken? Reset Everything
```bash
# Stop server (Ctrl+C)
# Deactivate venv
deactivate

# Delete virtual environment
rmdir /s venv

# Start over
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python migrate.py
python main.py
```

### Database Corrupted?
```bash
# Delete database file
del dolphin.db

# Recreate from migrations
python migrate.py

# Optionally load demo data
# Visit http://localhost:8000 → Dashboard → Load Demo Data
```

---

## Quick Copy-Paste Blocks

### First Time Setup
```bash
cd C:\Users\YOUR_NAME\Documents\dolphin
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python migrate.py
python main.py
```

### Daily Start
```bash
cd C:\Users\YOUR_NAME\Documents\dolphin
venv\Scripts\activate
python main.py
```

### Daily End
```bash
git add .
git commit -m "Your message"
git push origin main
```

### Full Fresh Start
```bash
# Stop server (Ctrl+C)
deactivate
rmdir /s venv
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
del dolphin.db
python migrate.py
python main.py
```

---

## Useful Environment Info

### Check Python Version
```bash
python --version
```

Should be **3.8 or higher**.

### Check Installed Packages
```bash
pip list
```

### Where is Python Installed?
```bash
where python
```

### Where is Your Project?
```bash
cd dolphin
pwd  # Mac
cd   # Windows (shows current path)
```

---

## Keep This Updated!

As you learn new commands, add them to this file:

```bash
git add PYTHON_COMMANDS.md
git commit -m "Docs: added new command"
git push origin main
```

---

**Made for Dolphin ERP Development**  
Print this and keep it on your desk while coding!
