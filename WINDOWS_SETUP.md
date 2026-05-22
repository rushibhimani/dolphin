# Windows Setup Guide — Step by Step

**For Dolphin ERP Development on Windows**

Keep this file in your project folder: `dolphin/WINDOWS_SETUP.md`

---

## What You Need (Prerequisites)

- **Windows 10 or 11**
- **Internet connection**
- **Administrator access** (to install software)
- **GitHub account** (free at github.com)

---

## Step 1: Install Python

### Download
1. Go to **https://www.python.org/downloads/**
2. Click **Download Python 3.11** (or latest 3.x)
3. Run the installer

### Installation Important Steps
1. **CHECK:** "Add Python to PATH" (very important!)
2. Click **Install Now**
3. Wait for installation to complete

### Verify Installation
Open **Command Prompt** (search for "cmd"):

```cmd
python --version
```

Should show: `Python 3.11.x` or similar

---

## Step 2: Install Git for Windows

### Download
1. Go to **https://git-scm.com/download/win**
2. Download the installer
3. Run it

### Installation Settings
- Accept all defaults
- When asked "Default editor": Choose **Vim** or **Nano** (doesn't matter)
- Everything else: Click **Next**

### Verify Installation
Open **Git Bash** (search for "Git Bash"):

```bash
git --version
```

Should show: `git version 2.x.x`

---

## Step 3: Configure Git

**Still in Git Bash:**

```bash
git config --global user.email "rushibhimani@gmail.com"
git config --global user.name "Rushi Bhimani"
```

Verify:
```bash
git config --global --list
```

---

## Step 4: Generate SSH Key

**In Git Bash:**

```bash
ssh-keygen -t ed25519 -C "rushibhimani@gmail.com"
```

When prompted:
```
Enter file in which to save the key:
```
Press **Enter** (use default)

```
Enter passphrase:
```
Press **Enter** (no passphrase)

```
Enter same passphrase again:
```
Press **Enter**

Done! Keys created at:
- `C:\Users\YOUR_NAME\.ssh\id_ed25519` (private)
- `C:\Users\YOUR_NAME\.ssh\id_ed25519.pub` (public)

---

## Step 5: Add SSH Key to GitHub

### View Your Public Key
**In Git Bash:**

```bash
cat ~/.ssh/id_ed25519.pub
```

Copy the entire output (starts with `ssh-ed25519...`).

### Add to GitHub
1. Go to **https://github.com/settings/ssh/new**
2. Log in if needed
3. Fill in:
   - **Title:** `Windows Laptop`
   - **Key:** Paste your public key
4. Click **Add SSH key**

### Test Connection
**In Git Bash:**

```bash
ssh -T git@github.com
```

Should show:
```
Hi rushibhimani! You've successfully authenticated...
```

If you see this, **SSH is working!** ✓

---

## Step 6: Install Visual Studio Code (Optional but Recommended)

### Download
1. Go to **https://code.visualstudio.com/**
2. Click **Download**
3. Run installer
4. Click **Install**

### Open Project in VS Code
**In Git Bash:**

```bash
code .
```

Opens the current folder in VS Code. Great for editing files!

---

## Step 7: Clone Your Repository

**In Git Bash:**

```bash
# Navigate to Documents
cd ~/Documents

# Clone the repository
git clone git@github.com:rushibhimani/dolphin.git

# Enter the folder
cd dolphin
```

You now have the full project!

---

## Step 8: Create Virtual Environment

**In Git Bash (inside dolphin folder):**

```bash
python -m venv venv
```

This creates a virtual environment folder.

---

## Step 9: Activate Virtual Environment

**In Git Bash:**

```bash
source venv/Scripts/activate
```

You should see `(venv)` at the start of your terminal line.

---

## Step 10: Install Dependencies

**In Git Bash (with venv activated):**

```bash
pip install -r requirements.txt
```

This installs all required Python packages. Takes a few minutes.

---

## Step 11: Run Database Migrations

**In Git Bash (with venv activated):**

```bash
python migrate.py
```

Should show:
```
✓ Alembic found
✓ Migration history found
Applying pending migrations...
✅ Database is up to date!
```

---

## Step 12: Start the Server

**In Git Bash (with venv activated):**

```bash
python main.py
```

Should show:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
```

---

## Step 13: Open in Browser

1. Open **Chrome, Firefox, or Edge**
2. Go to **http://localhost:8000**
3. You should see **Dolphin ERP Dashboard**

If you see it, **you're done!** ✓

---

## Every Time You Start Working

### Open Git Bash in Project Folder

**Right-click in `C:\Users\YOUR_NAME\Documents\dolphin` → Git Bash Here**

### Or Open Git Bash from Search
**Search for "Git Bash" → Open it → Type:**

```bash
cd ~/Documents/dolphin
```

### Activate Virtual Environment
```bash
source venv/Scripts/activate
```

### Start Server
```bash
python main.py
```

### Edit Code
In separate Git Bash terminal:
```bash
code .
```

### After Done Working
```bash
git status
git add .
git commit -m "Your message"
git push origin main
```

---

## Troubleshooting

### "Python command not found"
- Python not in PATH
- **Solution:** Reinstall Python and **CHECK "Add Python to PATH"**

### "Git command not found"
- Git not installed
- **Solution:** Install Git for Windows from git-scm.com

### "venv activation failed"
- Try this instead:
```bash
.\venv\Scripts\activate
```

### "Permission denied (publickey)"
- SSH key not added to GitHub
- **Solution:** Redo Step 4-5

### Server won't start on port 8000
- Another program using the port
- **Solution:** Restart computer or change port in main.py

### Browser shows "Connection refused"
- Server not running
- **Solution:** Make sure you ran `python main.py` and it shows the Uvicorn message

---

## Directory Structure After Setup

```
C:\Users\YOUR_NAME\Documents\
├── dolphin/
│   ├── venv/                    ← Virtual environment
│   ├── main.py
│   ├── models.py
│   ├── index.html
│   ├── migrations/
│   ├── dolphin.db               ← Database (created after migrate.py)
│   ├── requirements.txt
│   ├── GIT_COMMANDS.md          ← You'll create this
│   ├── PYTHON_COMMANDS.md       ← You'll create this
│   └── WINDOWS_SETUP.md         ← This file
```

---

## Next Steps

1. **Download GIT_COMMANDS.md** — All Git commands you need
2. **Download PYTHON_COMMANDS.md** — All Python commands you need
3. **Print them** — Keep on your desk while coding
4. **Start coding!**

---

## Quick Reference Shortcuts

### Start Work
```bash
cd ~/Documents/dolphin
source venv/Scripts/activate
python main.py
```

### Edit Code
```bash
code .
```

### Save Changes
```bash
git add .
git commit -m "message"
git push origin main
```

---

## Common Tasks

### Create New Python Feature
1. Edit code in VS Code
2. Save (Ctrl+S)
3. Restart server (`Ctrl+C` then `python main.py`)
4. Test in browser
5. Commit and push

### Update from GitHub
```bash
git pull origin main
python main.py  # Restart if code changed
```

### Reset Database
```bash
del dolphin.db
python migrate.py
```

### Load Demo Data
1. Start server
2. Go to Dashboard
3. Click "Load Demo Data"

---

## Need Help?

### Server Crashes?
```bash
python main.py
# Look at error message
```

### Browser Error (F12 Console)?
```bash
# Check browser console for JavaScript errors
# Refresh page (F5)
```

### Git Error?
```bash
git status  # See what's wrong
```

### Can't Find Folder?
```bash
# In Git Bash:
pwd   # Shows current path
ls    # Lists files
```

---

## Keep This Updated!

As you learn new steps, add them:

```bash
git add WINDOWS_SETUP.md
git commit -m "Docs: updated setup guide"
git push origin main
```

---

**Congratulations! You're set up and ready to develop on Dolphin ERP!** 🎉

Print this guide and the command references. You're all set!
