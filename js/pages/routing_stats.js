/**
 * Dolphin ERP — Routing Stats
 */

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
