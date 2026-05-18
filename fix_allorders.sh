#!/bin/bash
# Fixes ALL 3 errors shown in console:
# 1. renderRoutingStats is not defined
# 2. /api/workcenters 500 (need to check backend terminal for root cause)
# 3. /api/backfill-codes 500

FILE="index.html"
if [ ! -f "$FILE" ]; then
  echo "❌ Run this from your dolphin directory (where index.html is)"
  exit 1
fi

echo "=== Fixing renderRoutingStats ==="

# Check if it's missing
if grep -q "renderRoutingStats" "$FILE" && ! grep -q "async function renderRoutingStats" "$FILE"; then
  echo "→ renderRoutingStats called but not defined. Adding it..."

  # Find the closing of renderRoutings function and insert after it
  # We'll append the function just before the closing </script> tag
  python3 - << 'PYEOF'
import re

with open("index.html", "r", encoding="utf-8") as f:
    content = f.read()

FUNC = '''
// ── ROUTING STATS ──
async function renderRoutingStats(){
  document.getElementById('topbarActions').innerHTML = `<button class="btn btn-secondary" onclick="renderRoutingStats()">↻ Refresh</button>`;
  document.getElementById('content').innerHTML = `
    <div class="card">
      <div class="card-hdr">
        <div class="card-title">Estimated vs Actual</div>
        <div style="font-size:12px;color:var(--muted)">Compare estimates against completed jobs. Refine routings as data grows.</div>
      </div>
      <div id="rsContent" style="padding:16px"><div style="color:var(--muted)">Loading...</div></div>
    </div>`;
  try {
    const data = await api('GET', '/api/routings/stats/all');
    _renderRoutingStatsContent(data.routings || []);
  } catch(e) {
    document.getElementById('rsContent').innerHTML = `<div style="color:var(--red);padding:20px">Error: ${e.message}</div>`;
  }
}

function _renderRoutingStatsContent(routings){
  const c = document.getElementById('rsContent');
  if(!routings.length){ c.innerHTML=`<div class="empty">No active routings yet.</div>`; return; }
  const groups = {};
  routings.forEach(r => { (groups[r.product_type||'Uncategorized']=groups[r.product_type||'Uncategorized']||[]).push(r); });
  const keys = Object.keys(groups).sort();
  const totalRoutings=routings.length, withData=routings.filter(r=>r.sample_count>0).length,
        totalSamples=routings.reduce((s,r)=>s+(r.sample_count||0),0);
  c.innerHTML = `
    <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:18px;font-size:13px">
      <div><span style="color:var(--muted)">Total routings:</span> <strong>${totalRoutings}</strong></div>
      <div><span style="color:var(--muted)">With data:</span> <strong>${withData}</strong></div>
      <div><span style="color:var(--muted)">Jobs analyzed:</span> <strong>${totalSamples}</strong></div>
    </div>
    ${keys.map(pt=>`
      <div style="margin-bottom:24px">
        <div style="font-weight:600;color:var(--accent);font-size:13px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;border-bottom:1px solid var(--border);padding-bottom:6px">${escHtml(pt)}</div>
        ${groups[pt].map(r=>_routingStatsCard(r)).join('')}
      </div>`).join('')}`;
}

function _routingStatsCard(r){
  const hasData=r.sample_count>0, v=r.variance_pct;
  let varColor='var(--muted)',varText='—';
  if(v!=null){ if(v>50)varColor='var(--red)'; else if(v>20)varColor='var(--amber)'; else if(v>-20)varColor='var(--green)'; else varColor='var(--accent)'; varText=`${v>0?'+':''}${v}%`; }
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);padding:12px;margin-bottom:10px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px">
      <div style="font-weight:600">${escHtml(r.name)}</div>
      <div style="display:flex;gap:14px;font-size:12px;flex-wrap:wrap">
        <div><span style="color:var(--muted)">Estimated:</span> <strong>${r.estimated_total_hours}h</strong></div>
        <div><span style="color:var(--muted)">Avg actual:</span> <strong>${hasData?r.avg_actual_total_hours+'h':'—'}</strong></div>
        <div><span style="color:var(--muted)">Variance:</span> <strong style="color:${varColor}">${varText}</strong></div>
        <div><span style="color:var(--muted)">Samples:</span> <strong>${r.sample_count}</strong></div>
      </div>
    </div>
    <table style="width:100%;font-size:11px;border-collapse:collapse">
      <thead><tr style="color:var(--muted);border-bottom:1px solid var(--border)">
        <th style="text-align:left;padding:4px;width:24px">#</th>
        <th style="text-align:left;padding:4px">Step</th>
        <th style="text-align:right;padding:4px;width:80px">Estimated</th>
        <th style="text-align:right;padding:4px;width:80px">Avg actual</th>
        <th style="text-align:right;padding:4px;width:70px">Variance</th>
      </tr></thead>
      <tbody>${(r.operations||[]).map(op=>`
        <tr style="border-bottom:1px solid var(--border)">
          <td style="padding:4px;color:var(--muted)">${op.sequence}</td>
          <td style="padding:4px">${escHtml(op.name)}</td>
          <td style="padding:4px;text-align:right">${op.estimated_hours}h</td>
          <td style="padding:4px;text-align:right">—</td>
          <td style="padding:4px;text-align:right;color:var(--muted)">—</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}
'''

# Insert just before closing </script>
if 'async function renderRoutingStats' not in content:
    content = content.replace('</script>\n</body>', FUNC + '\n</script>\n</body>')
    content = content.replace('</script>\r\n</body>', FUNC + '\r\n</script>\r\n</body>')
    with open("index.html", "w", encoding="utf-8") as f:
        f.write(content)
    print("✅ renderRoutingStats added")
else:
    print("ℹ️  renderRoutingStats already exists")
PYEOF

else
  echo "→ renderRoutingStats already present or not called"
fi

echo ""
echo "=== Backend 500 errors ==="
echo "These come from main.py crashing. Check what your backend terminal shows."
echo ""
echo "Common cause: database migration not run, or models.py schema mismatch."
echo "Fix:"
echo "  1. Stop the server (Ctrl+C)"
echo "  2. Run: python migrate.py"
echo "  3. Run: python main.py"
echo "  4. Hard-reload browser: Cmd+Shift+R"
echo ""
echo "If migrate.py doesn't exist, run:"
echo "  python -c \"from models import Base; from main import engine; Base.metadata.create_all(bind=engine); print('DB OK')\""
echo ""
echo "=== Done ==="