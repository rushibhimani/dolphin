# DOLPHIN ERP — CHEAT SHEET (Print This!)

---

## DAILY WORKFLOW

### Morning
```bash
cd ~/Documents/dolphin
source venv/Scripts/activate    # Windows: venv\Scripts\activate
python main.py
# Keep open. Visit http://localhost:8000
```

### Edit Code
Open separate terminal:
```bash
code .
```

### Evening
```bash
git status
git add .
git commit -m "Fixed something"
git push origin main
```

---

## GIT — Most Used Commands

| Command | What it does |
|---------|------------|
| `git status` | See what changed |
| `git add .` | Add all changes |
| `git commit -m "msg"` | Save changes locally |
| `git push origin main` | Upload to GitHub |
| `git pull origin main` | Download latest |
| `git log --oneline` | See commit history |

---

## PYTHON — Most Used Commands

| Command | What it does |
|---------|------------|
| `source venv/Scripts/activate` | Activate virtual environment (Mac: `source venv/bin/activate`) |
| `pip install -r requirements.txt` | Install dependencies |
| `python migrate.py` | Update database |
| `python main.py` | Start server |
| `Ctrl+C` | Stop server |

---

## EMERGENCY FIXES

### Server Won't Start
```bash
Ctrl+C
python main.py  # Try again
```

### Everything Broken
```bash
Ctrl+C
deactivate
rmdir /s venv
python -m venv venv
source venv/Scripts/activate
pip install -r requirements.txt
python migrate.py
python main.py
```

### Database Corrupted
```bash
del dolphin.db
python migrate.py
```

---

## KEYBOARD SHORTCUTS

| Shortcut | What it does |
|----------|------------|
| `Ctrl+C` | Stop server / stop any command |
| `Ctrl+S` | Save file (in editor) |
| `F5` | Refresh browser |
| `F12` | Open browser console (for debugging) |
| `Ctrl+V` | Paste |
| `Ctrl+Z` | Undo (in editor) |

---

## BROWSER DEBUGGING

1. **F12** → Open developer tools
2. **Console** tab → See JavaScript errors
3. **F5** → Refresh page
4. Look for red error messages

---

## FILE LOCATIONS

```
C:\Users\YOUR_NAME\Documents\
└── dolphin/
    ├── main.py              ← Backend code
    ├── models.py            ← Database models
    ├── index.html           ← Frontend
    ├── venv/                ← Virtual environment
    ├── migrations/          ← Database migrations
    ├── dolphin.db           ← Database file
    ├── GIT_COMMANDS.md      ← Git commands
    ├── PYTHON_COMMANDS.md   ← Python commands
    └── WINDOWS_SETUP.md     ← Full setup guide
```

---

## GITHUB WORKFLOW

### First Time
```bash
git clone git@github.com:rushibhimani/dolphin.git
cd dolphin
```

### Every Day
```bash
git pull origin main        # Get latest
# ... make changes ...
git add .                   # Stage changes
git commit -m "Your msg"   # Commit locally
git push origin main        # Upload to GitHub
```

---

## TROUBLESHOOTING QUICK LINKS

- **Python not found?** → Reinstall Python, check "Add to PATH"
- **Git not found?** → Reinstall Git for Windows from git-scm.com
- **SSH error?** → Redo SSH setup (WINDOWS_SETUP.md, Step 4-5)
- **Port 8000 in use?** → Restart computer or kill Python process
- **Browser shows 500 error?** → Check server terminal for error message
- **Gantt chart empty?** → Click "Schedule All" on dashboard

---

## QUICK COMMANDS TO COPY-PASTE

### Start Everything
```bash
cd ~/Documents/dolphin && source venv/Scripts/activate && python main.py
```

### Commit and Push
```bash
git add . && git commit -m "Fixed something" && git push origin main
```

### See What You Changed
```bash
git diff
```

### See Commit History
```bash
git log --oneline
```

### Create Feature Branch
```bash
git checkout -b fix/my-feature
```

### Switch Back to Main
```bash
git checkout main
```

---

## DOCUMENTATION FILES

Keep these 3 files in your dolphin folder:

1. **GIT_COMMANDS.md** → All git commands with examples
2. **PYTHON_COMMANDS.md** → All python commands with examples
3. **WINDOWS_SETUP.md** → Full step-by-step setup guide

**Print all three.** Keep them on your desk while developing!

---

## PROJECT SUMMARY

Upload **dolphin_project_summary.md** to any new Claude chat to give full context.

---

## HELP

When you're stuck:
1. **Check the error message** (in terminal or browser F12)
2. **Search PYTHON_COMMANDS.md or GIT_COMMANDS.md**
3. **Read WINDOWS_SETUP.md for setup issues**
4. **Restart the server** (Ctrl+C, then python main.py)
5. **Upload this cheat sheet to Claude** with a description of the problem

---

## FINAL CHECKLIST BEFORE STARTING

- [ ] Python installed (python --version works)
- [ ] Git installed (git --version works)
- [ ] SSH key created and added to GitHub
- [ ] Repository cloned (`cd ~/Documents/dolphin` works)
- [ ] Virtual environment created (source venv/Scripts/activate works)
- [ ] Dependencies installed (pip list shows packages)
- [ ] Database created (python migrate.py works)
- [ ] Server starts (python main.py shows http://127.0.0.1:8000)
- [ ] Browser loads (http://localhost:8000 shows dashboard)

**All checked? You're ready to develop!** 🚀

---

**Dolphin ERP Development**  
Last Updated: May 2026  
Keep this cheat sheet within arm's reach!
