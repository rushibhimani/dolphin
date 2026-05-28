# Git Commands — Quick Reference

**For Dolphin ERP Development**

Keep this file in your project folder: `dolphin/GIT_COMMANDS.md`

---

## First Time Setup (Do Once)

### Generate SSH Key
```bash
ssh-keygen -t ed25519 -C "rushibhimani@gmail.com"
# Press Enter 3 times
```

### View Your Public Key (Copy to GitHub)
```bash
cat ~/.ssh/id_ed25519.pub
```

### Configure Git (Do Once Per Computer)
```bash
git config --global user.email "rushibhimani@gmail.com"
git config --global user.name "Rushi Bhimani"
```

### Clone the Repository (First Time)
```bash
cd C:\Users\YOUR_NAME\Documents
git clone git@github.com:rushibhimani/dolphin.git
cd dolphin
```

---

## Every Day — Start Work

### Open Git Bash
Right-click in folder → **Git Bash Here**

Or search Windows for **Git Bash**

### Activate Python Virtual Environment
```bash
# Windows
venv\Scripts\activate

# Mac
source venv/bin/activate
```

### Start the Server
```bash
python main.py
```

Visit: **http://localhost:8000**

---

## After Making Changes — Save to GitHub

### See What Changed
```bash
git status
```

### Add All Changes
```bash
git add .
```

### Commit Changes (Write a meaningful message)
```bash
git commit -m "Fixed syntax error on line 510"
```

Examples:
- `"Fix: resolve frontend syntax errors"`
- `"Feature: add machine continuity window"`
- `"Docs: update README with setup instructions"`

### Push to GitHub
```bash
git push origin main
```

**No password needed!** SSH handles it automatically.

---

## Get Latest Code from GitHub

### Pull Latest Changes
```bash
git pull origin main
```

Do this when Claude tells you "I've pushed a fix to main" or when working with others.

---

## Fix Mistakes

### Undo Last Commit (Haven't Pushed Yet)
```bash
git reset --soft HEAD~1
```

Then make changes and commit again.

### Undo Last Commit (Already Pushed)
```bash
git revert HEAD
git push origin main
```

### Discard All Local Changes (Back to GitHub Version)
```bash
git checkout -- .
```

---

## Branching (For Bigger Features)

### Create a Feature Branch
```bash
git checkout -b fix/feature-name
```

Examples:
- `fix/syntax-errors`
- `feature/load-balancing`
- `docs/setup-guide`

### Switch Between Branches
```bash
# See all branches
git branch

# Switch to a branch
git checkout main
git checkout fix/syntax-errors
```

### Push Your Feature Branch
```bash
git push origin fix/feature-name
```

Then on GitHub, click "Create Pull Request" to merge into main.

### Merge Back to Main (After Testing)
```bash
git checkout main
git merge fix/feature-name
git push origin main
```

---

## Checking History

### See Recent Commits
```bash
git log --oneline
```

Shows last 10 commits with IDs.

### See What Changed in Last Commit
```bash
git show
```

### Compare Local to GitHub
```bash
git diff
```

---

## Emergency Commands

### If Everything is Broken — Start Over
```bash
# Delete local repo
cd ..
rm -rf dolphin

# Clone fresh from GitHub
git clone git@github.com:rushibhimani/dolphin.git
cd dolphin
```

### If You Need to Reset to a Previous Commit
```bash
# See the commit ID
git log --oneline

# Reset to that commit (WARNING: loses recent work)
git reset --hard <commit-id>

# Example: git reset --hard abc1234
```

---

## Daily Workflow — Copy & Paste

```bash
# Morning: Start work
venv\Scripts\activate
python main.py

# Work on code...

# Evening: Save changes
git status
git add .
git commit -m "Fixed something"
git push origin main

# Before closing
# (optional) git log --oneline  # see what you did
```

---

## Useful Aliases (Optional)

Add these to make commands shorter:

```bash
git config --global alias.st status
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.ci commit
git config --global alias.lo "log --oneline"
```

Then you can use:
- `git st` instead of `git status`
- `git co main` instead of `git checkout main`
- `git lo` instead of `git log --oneline`

---

## Troubleshooting

### "fatal: not a git repository"
```bash
# Make sure you're in the dolphin folder
cd C:\Users\YOUR_NAME\Documents\dolphin
git status
```

### "Permission denied (publickey)"
```bash
# SSH key wasn't added to GitHub
# Redo the SSH setup section above
```

### "error: src refspec main does not match any"
```bash
# Make sure you have at least one commit
git status
git add .
git commit -m "Initial commit"
git push -u origin main
```

### "Your branch is ahead of 'origin/main'"
```bash
# You have commits not pushed yet
git push origin main
```

---

## Quick Copy-Paste Blocks

### Full Daily Cycle
```bash
# Start
venv\Scripts\activate
python main.py
# ... work ...

# End
git status
git add .
git commit -m "Your message"
git push origin main
```

### Create and Push Feature Branch
```bash
git checkout -b fix/my-feature
# ... work ...
git add .
git commit -m "Fixed something"
git push origin fix/my-feature
# Then merge on GitHub
```

### Update from GitHub
```bash
git pull origin main
venv\Scripts\activate
python main.py
```

---

## Print This!

**Save as:** `dolphin/GIT_COMMANDS.md`

**Print and keep on desk** while developing. Way easier than searching online.

---

**Made for Dolphin ERP Development**  
Keep it updated as you learn more commands.
