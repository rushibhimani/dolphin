#!/usr/bin/env python3
"""
Fix the gantt chart broken by the previous fix_ui_bugs.py script.
The previous script corrupted the renderGantt function by inserting
getComputedStyle code that broke the JS template literal.

This script ONLY fixes the gantt — safely.
"""
import re, shutil, os

FILE = "index.html"
if not os.path.exists(FILE):
    print(f"❌ {FILE} not found. Run from your dolphin directory.")
    exit(1)

shutil.copy(FILE, FILE + ".bak2")
print(f"✓ Backup: {FILE}.bak2")

with open(FILE, "r", encoding="utf-8") as f:
    html = f.read()

# ─────────────────────────────────────────────────────────────
# The previous script inserted broken code like:
#   const ganttBg = getComputedStyle(...).getPropertyValue('--bg')...
#   const ganttSurface = ...
#   const ganttBorder = ...
#   const ganttText = ...
#   let s = `<svg ...>
#   <rect ... fill="${ganttBg}"/>`;
#
# This broke the SVG template literal. Remove the broken insertion
# and replace with a clean version that reads CSS vars BEFORE the SVG.
# ─────────────────────────────────────────────────────────────

# Pattern 1: The corrupted block that starts with getComputedStyle
broken_pattern = re.compile(
    r'const ganttBg\s*=\s*getComputedStyle.*?let s\s*=\s*`<svg[^`]*`\s*;',
    re.DOTALL
)

CLEAN_GANTT_INIT = '''  // Read theme colors once before building SVG
  const _cs = getComputedStyle(document.documentElement);
  const _bg  = (_cs.getPropertyValue('--bg').trim())||'#0f1115';
  const _sur = (_cs.getPropertyValue('--surface').trim())||'#171a21';
  const _bdr = (_cs.getPropertyValue('--border').trim())||'#262b36';
  const _mut = (_cs.getPropertyValue('--muted').trim())||'#7a8295';
  const _acc = (_cs.getPropertyValue('--accent').trim())||'#f59e0b';
  let s = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;min-width:${W}px">
  <rect width="${W}" height="${H}" fill="${_bg}"/>`;'''

if broken_pattern.search(html):
    html = broken_pattern.sub(CLEAN_GANTT_INIT, html)
    print("✓ Removed corrupted getComputedStyle block, inserted clean version")
else:
    # Pattern 2: Maybe the original (unfixed) version is still there
    orig = '''  let s = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;min-width:${W}px">
  <rect width="${W}" height="${H}" fill="#0d0f12"/>`;'''
    if orig in html:
        html = html.replace(orig, CLEAN_GANTT_INIT)
        print("✓ Replaced original hardcoded SVG background with theme-aware version")
    else:
        print("⚠ Could not find gantt SVG init block — checking what's there...")
        # Find any SVG rect fill near the gantt
        idx = html.find('let s = `<svg')
        if idx > 0:
            print(f"  Found 'let s = `<svg' at position {idx}")
            print(f"  Context: {repr(html[idx:idx+200])}")

# ─────────────────────────────────────────────────────────────
# Fix the label panel background (was hardcoded #151820 in JS string)
# ─────────────────────────────────────────────────────────────
dark_label_bg = 'background:#151820;border-right:1px solid #2a2f3d'
light_label_bg = 'background:${_sur};border-right:1px solid ${_bdr}'
if dark_label_bg in html:
    html = html.replace(dark_label_bg, light_label_bg)
    print("✓ Gantt label panel: theme-aware background")

# Fix label text colors in JS strings
html = html.replace("color:#c9d0de;", "color:${_mut};")
html = html.replace("color:#4a5568;", "color:${_mut};")
html = html.replace("color:#4a5568}", "color:${_mut}}")
html = html.replace("'color:#4a5568'", "'color:'+_mut")

# Fix SVG stroke colors (these appear inside template literals)
html = html.replace('stroke="#1a1f2e"', 'stroke="${_bdr}"')
html = html.replace('stroke="#2a2f3d"', 'stroke="${_bdr}"')
html = html.replace('stroke="#1e2433"', 'stroke="${_bdr}"')

# Fix SVG fill text colors
html = html.replace('fill="#4a5568"', 'fill="${_mut}"')
html = html.replace('fill="#2e3647"', 'fill="${_mut}"')

# Fix row even-odd backgrounds
html = html.replace(
    'fill="rgba(255,255,255,.018)"',
    'fill="rgba(128,128,128,.06)"'
)
html = html.replace(
    'fill="rgba(255,255,255,.012)"',
    'fill="rgba(128,128,128,.04)"'
)
# Off-hours shading
html = html.replace('fill="rgba(0,0,0,.22)"', 'fill="rgba(128,128,128,.12)"')

print("✓ Gantt SVG colors replaced with theme-aware values")

# ─────────────────────────────────────────────────────────────
# Fix gantt outer containers to use CSS vars (not hardcoded)
# ─────────────────────────────────────────────────────────────
html = html.replace(
    'id="ganttLabels" style="flex-shrink:0;width:210px;overflow:hidden;background:#151820;border-right:1px solid #2a2f3d;z-index:10"',
    'id="ganttLabels" style="flex-shrink:0;width:210px;overflow:hidden;background:var(--surface);border-right:1px solid var(--border);z-index:10"'
)

# ─────────────────────────────────────────────────────────────
# Write
# ─────────────────────────────────────────────────────────────
with open(FILE, "w", encoding="utf-8") as f:
    f.write(html)

print(f"\n✅ Done. Hard-reload browser: Cmd+Shift+R")
print(f"   If gantt still broken: cp {FILE}.bak {FILE}")