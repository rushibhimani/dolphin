/**
 * Dolphin ERP — Routing Stats (Estimated vs Actual)
 */

async function renderRoutingStats(){
  document.getElementById('topbarActions').innerHTML =
    `<button class="btn btn-secondary" onclick="renderRoutingStats()">↻ Refresh</button>`;
  document.getElementById('content').innerHTML = `
    <div style="max-width:960px;margin:0 auto">
      <div style="margin-bottom:16px">
        <h2 style="font-size:18px;font-weight:700;margin:0 0 4px">Estimated vs Actual</h2>
        <div style="font-size:12px;color:var(--muted)">Compare formula estimates against completed jobs. Confidence grows with more samples.</div>
      </div>
      <div id="rsContent"><div style="color:var(--muted);padding:20px">Loading…</div></div>
    </div>`;
  try {
    const data = await api('GET', '/api/routings/stats/all');
    _renderRSContent(data.routings || []);
  } catch(e) {
    document.getElementById('rsContent').innerHTML =
      `<div style="color:var(--red);padding:20px">Error: ${e.message}</div>`;
  }
}

function _renderRSContent(routings){
  const el = document.getElementById('rsContent');
  if(!routings.length){ el.innerHTML=`<div class="empty">No active routings yet.</div>`; return; }

  const total    = routings.length;
  const withData = routings.filter(r=>r.sample_count>0).length;
  const samples  = routings.reduce((s,r)=>s+(r.sample_count||0),0);
  const avgVariance = (() => {
    const vs = routings.filter(r=>r.variance_pct!=null).map(r=>r.variance_pct);
    return vs.length ? Math.round(vs.reduce((a,b)=>a+Math.abs(b),0)/vs.length*10)/10 : null;
  })();

  const groups = {};
  routings.forEach(r => {
    const k = r.product_type || 'Uncategorized';
    (groups[k] = groups[k] || []).push(r);
  });

  el.innerHTML = `
    <!-- Summary stats -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:20px">
      ${_rsStat('Routings', total, '')}
      ${_rsStat('With data', withData, '')}
      ${_rsStat('Jobs tracked', samples, '')}
      ${avgVariance!=null ? _rsStat('Avg variance', `${avgVariance>0?'+':''}${avgVariance}%`, avgVariance>20?'red':avgVariance>10?'amber':'green') : _rsStat('Avg variance','—','')}
    </div>

    <!-- Per product type sections -->
    ${Object.keys(groups).sort().map(pt => `
      <div style="margin-bottom:24px">
        <div style="font-weight:700;color:var(--accent);font-size:12px;text-transform:uppercase;
                    letter-spacing:.06em;margin-bottom:10px;border-bottom:1px solid var(--border);padding-bottom:6px">${escHtml(pt)}</div>
        ${groups[pt].map(r => _rsCard(r)).join('')}
      </div>`).join('')}`;
}

function _rsStat(label, value, color){
  const c = color==='red'?'var(--red)':color==='amber'?'var(--amber)':color==='green'?'var(--green)':'var(--text)';
  return `<div class="card" style="padding:12px 14px">
    <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">${label}</div>
    <div style="font-size:20px;font-weight:700;color:${c}">${value}</div>
  </div>`;
}

function _rsCard(r){
  const hasData = r.sample_count > 0;
  const v = r.variance_pct;

  // Confidence badge
  const confLabel = {none:'No data',low:'Low',medium:'Medium',high:'High'}[r.confidence] || '—';
  const confColor = {none:'var(--muted)',low:'var(--red)',medium:'var(--amber)',high:'var(--green)'}[r.confidence];
  const confStars = {none:'○○○',low:'★○○',medium:'★★○',high:'★★★'}[r.confidence];

  // Variance color
  let varColor='var(--muted)', varText='No data yet';
  if(v!=null){
    varText = `${v>0?'+':''}${v}%`;
    varColor = Math.abs(v)<=10?'var(--green)':Math.abs(v)<=25?'var(--amber)':'var(--red)';
  }

  // Per-operation rows
  const opRows = (r.operations||[]).map(op=>{
    const hasOpData = op.sample_count > 0;
    let opVarColor='var(--muted)', opVarText='—';
    if(op.variance_pct!=null){
      opVarText = `${op.variance_pct>0?'+':''}${op.variance_pct}%`;
      opVarColor = Math.abs(op.variance_pct)<=10?'var(--green)':Math.abs(op.variance_pct)<=25?'var(--amber)':'var(--red)';
    }
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:5px 8px;color:var(--muted);font-family:var(--mono);font-size:11px">${op.sequence}</td>
      <td style="padding:5px 8px;font-size:12px">${escHtml(op.name)}</td>
      <td style="padding:5px 8px;font-size:11px;color:var(--muted)">${escHtml(op.wc_name||'')}</td>
      <td style="padding:5px 8px;text-align:right;font-family:var(--mono);font-size:11px">${op.estimated_hours}h</td>
      <td style="padding:5px 8px;text-align:right;font-family:var(--mono);font-size:11px;color:${hasOpData?'var(--text)':'var(--muted)'}">${hasOpData?op.avg_actual_hours+'h':'—'}</td>
      <td style="padding:5px 8px;text-align:right;font-family:var(--mono);font-size:11px;color:${opVarColor};font-weight:${hasOpData?600:400}">${opVarText}</td>
      <td style="padding:5px 8px;text-align:right;font-size:10px;color:var(--muted)">${op.sample_count>0?op.sample_count:''}</td>
    </tr>`;
  }).join('');

  // Recent job history
  const histRows = (r.job_history||[]).slice(0,5).map(j=>{
    const jv = j.variance_pct;
    const jvColor = jv==null?'var(--muted)':Math.abs(jv)<=10?'var(--green)':Math.abs(jv)<=25?'var(--amber)':'var(--red)';
    const jvText  = jv!=null?`${jv>0?'+':''}${jv}%`:'—';
    const end = j.actual_end ? new Date(j.actual_end).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}) : '—';
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:4px 8px;font-family:var(--mono);font-size:11px;color:var(--accent)">${escHtml(j.job_number)}</td>
      <td style="padding:4px 8px;font-size:11px;color:var(--muted)">${end}</td>
      <td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:11px">${j.est_hrs}h</td>
      <td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:11px">${j.actual_hrs}h</td>
      <td style="padding:4px 8px;text-align:right;font-family:var(--mono);font-size:11px;color:${jvColor};font-weight:600">${jvText}</td>
    </tr>`;
  }).join('');

  return `
  <div class="card" style="margin-bottom:12px;overflow:hidden">
    <!-- Header row -->
    <div style="padding:14px 16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-weight:600;font-size:14px">${escHtml(r.name)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">Estimated: <strong>${r.estimated_total_hours}h</strong> total</div>
      </div>
      <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        <!-- Confidence badge -->
        <div style="text-align:center">
          <div style="font-size:10px;color:var(--muted);margin-bottom:2px">Confidence</div>
          <div style="font-size:12px;font-weight:600;color:${confColor}">${confStars} ${confLabel}</div>
        </div>
        <!-- Avg actual -->
        <div style="text-align:center">
          <div style="font-size:10px;color:var(--muted);margin-bottom:2px">Avg actual</div>
          <div style="font-size:14px;font-weight:700;color:var(--text)">${hasData?r.avg_actual_total_hours+'h':'—'}</div>
        </div>
        <!-- Variance -->
        <div style="text-align:center">
          <div style="font-size:10px;color:var(--muted);margin-bottom:2px">Variance</div>
          <div style="font-size:14px;font-weight:700;color:${varColor}">${varText}</div>
        </div>
        <!-- Samples -->
        <div style="text-align:center">
          <div style="font-size:10px;color:var(--muted);margin-bottom:2px">Jobs</div>
          <div style="font-size:14px;font-weight:700">${r.sample_count}</div>
        </div>
      </div>
    </div>

    <!-- Per-operation table -->
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:var(--surface);border-bottom:1px solid var(--border)">
            <th style="padding:6px 8px;text-align:left;font-size:10px;color:var(--muted);width:30px">#</th>
            <th style="padding:6px 8px;text-align:left;font-size:10px;color:var(--muted)">Operation</th>
            <th style="padding:6px 8px;text-align:left;font-size:10px;color:var(--muted)">Machine</th>
            <th style="padding:6px 8px;text-align:right;font-size:10px;color:var(--muted)">Estimated</th>
            <th style="padding:6px 8px;text-align:right;font-size:10px;color:var(--muted)">Avg actual</th>
            <th style="padding:6px 8px;text-align:right;font-size:10px;color:var(--muted)">Variance</th>
            <th style="padding:6px 8px;text-align:right;font-size:10px;color:var(--muted)">n</th>
          </tr>
        </thead>
        <tbody>${opRows || '<tr><td colspan="7" style="padding:12px;text-align:center;color:var(--muted);font-size:12px">No operations</td></tr>'}</tbody>
      </table>
    </div>

    <!-- Job history -->
    ${histRows ? `
    <div style="border-top:1px solid var(--border)">
      <div style="padding:8px 14px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)">Recent completed jobs</div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:var(--surface);border-bottom:1px solid var(--border)">
          <th style="padding:4px 8px;text-align:left;font-size:10px;color:var(--muted)">Job</th>
          <th style="padding:4px 8px;text-align:left;font-size:10px;color:var(--muted)">Completed</th>
          <th style="padding:4px 8px;text-align:right;font-size:10px;color:var(--muted)">Est</th>
          <th style="padding:4px 8px;text-align:right;font-size:10px;color:var(--muted)">Actual</th>
          <th style="padding:4px 8px;text-align:right;font-size:10px;color:var(--muted)">Variance</th>
        </tr></thead>
        <tbody>${histRows}</tbody>
      </table>
    </div>` : `
    <div style="padding:14px;text-align:center;color:var(--muted);font-size:12px;border-top:1px solid var(--border)">
      No completed jobs yet — variance data will appear here as jobs finish.
    </div>`}
  </div>`;
}
