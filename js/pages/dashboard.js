/**
 * Dolphin ERP — Dashboard
 */

async function renderDashboard(){
  try { await loadAll(); } catch(e) { console.error('loadAll failed:', e); }
  // Show offline banner if server not responding
  const isOffline = document.getElementById('serverStatus').textContent==='Offline';
  if(isOffline && allJobs.length===0){
    document.getElementById('topbarActions').innerHTML='';
    document.getElementById('content').innerHTML=`
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:60vh;gap:16px;color:var(--muted)">
        <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="opacity:.3"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        <div style="font-size:16px;font-weight:600;color:var(--text)">Cannot connect to server</div>
        <div style="font-size:13px;text-align:center">Make sure <code style="background:var(--surface);padding:2px 6px;border-radius:4px">python main.py</code> is running<br>then refresh this page.</div>
        <button class="btn btn-primary" onclick="init()">↻ Retry Connection</button>
      </div>`;
    return;
  }
  const total=allJobs.length,pending=allJobs.filter(j=>j.status==='pending').length,
        done=allJobs.filter(j=>j.status==='completed').length,
        urgent=allJobs.filter(j=>j.critical_ratio<1&&j.status!=='completed').length,
        late=allJobs.filter(j=>j.is_late&&j.status!=='completed').length,
        downMachines=allMachines.filter(m=>m.status&&m.status!=='active').length;
  const _dashUser = authGetUser();
  const _isAdmin  = _dashUser?.role === 'admin';
  // Dashboard topbar: admin gets a compact "⚙ Admin" dropdown for seeding
  document.getElementById('topbarActions').innerHTML=
    _isAdmin ? `<div style="position:relative;display:inline-block" id="adminMenuWrap">
      <button class="btn btn-ghost" onclick="toggleAdminMenu()" style="font-size:12px">⚙ Admin ▾</button>
      <div id="adminMenu" style="display:none;position:absolute;right:0;top:110%;background:var(--card);
           border:1px solid var(--border);border-radius:8px;padding:6px;min-width:170px;z-index:200;box-shadow:0 4px 16px rgba(0,0,0,.15)">
        <button onclick="seedData();toggleAdminMenu()" style="display:block;width:100%;text-align:left;padding:8px 12px;font-size:13px;background:none;border:none;color:var(--text);cursor:pointer;border-radius:6px" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background='none'">Load Demo Data</button>
        <button onclick="seedRealSetup();toggleAdminMenu()" style="display:block;width:100%;text-align:left;padding:8px 12px;font-size:13px;background:none;border:none;color:var(--text);cursor:pointer;border-radius:6px" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background='none'">Load Real Setup</button>
      </div>
    </div>` : '';
  // Load preemption alerts
  try{
    const alerts = await api('GET','/api/preemption-alerts');
    const alertBox = document.getElementById('preemptAlertBox');
    if(alertBox && alerts.length>0){
      alertBox.innerHTML=`<div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:8px;padding:12px 16px;margin-bottom:14px">
        <div style="font-size:12px;font-weight:600;color:var(--red);margin-bottom:8px">⚡ Urgent Job Alerts — Consider Preemption</div>
        ${alerts.map(a=>`<div style="font-size:12px;color:var(--muted);margin-bottom:4px">
          Job <strong style="color:var(--accent2)">${a.urgent_job}</strong> (CR=${a.urgent_cr}) is urgent.
          Worker <strong>${a.worker_name}</strong> is on Job ${a.job_number} (CR=${a.other_cr}, not urgent).
          <button class="btn btn-danger" style="font-size:10px;padding:2px 7px;margin-left:8px" onclick="scheduleAll()">Run Schedule All to resolve</button>
        </div>`).join('')}
      </div>`;
    } else if(alertBox){ alertBox.innerHTML=''; }
  }catch{}
  const topJobs=[...allJobs].filter(j=>j.status!=='completed').sort((a,b)=>a.critical_ratio-b.critical_ratio).slice(0,6);
  document.getElementById('content').innerHTML=`
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Total Jobs</div><div class="stat-value">${total}</div><div class="stat-sub">${pending} pending</div></div>
      <div class="stat-card"><div class="stat-label">Completed</div><div class="stat-value" style="color:var(--green)">${done}</div><div class="stat-sub">${total?Math.round(done/total*100):0}%</div></div>
      <div class="stat-card"><div class="stat-label">At Risk</div><div class="stat-value" style="color:${urgent?'var(--orange)':'var(--green)'}">${urgent}</div><div class="stat-sub">CR &lt; 1.0</div></div>
      <div class="stat-card"><div class="stat-label">Will Be Late</div><div class="stat-value" style="color:${late?'var(--red)':'var(--green)'}">${late}</div><div class="stat-sub">Past due date</div></div>
      <div class="stat-card"><div class="stat-label">Revenue (Active Jobs)</div><div class="stat-value" style="color:var(--green);font-size:18px">${fmtINR(allJobs.filter(j=>j.status!=='completed').reduce((s,j)=>s+(j.total_price||0),0))}</div><div class="stat-sub">In pipeline</div></div>
    </div>
    <div style="display:grid;grid-template-columns:3fr 2fr;gap:16px;margin-bottom:16px">
      <div class="card">
        <div class="card-hdr"><div class="card-title">Priority Queue</div><button class="btn btn-ghost" style="font-size:11px;padding:4px 9px" onclick="navigate('/jobs')">All Jobs →</button></div>
        ${topJobs.length?`<table class="jobs-table"><thead><tr>
          <th style="padding-left:36px;width:140px">Job #</th><th>Customer</th><th style="width:80px">Due</th><th style="width:80px">Finish</th><th style="width:100px">Priority</th>
        </tr></thead><tbody>
        ${topJobs.map(j=>`<tr><td><div class="job-main-row" onclick="navigate('/jobs');setTimeout(()=>expandJob(${j.id}),200)" style="cursor:pointer">
          <svg class="expand-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:14px;height:14px"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
          <div class="jcol" style="flex:none;width:120px"><span class="mono" style="font-size:12px">${j.job_number}</span>${j.priority_flag?'<span class="badge badge-urgent" style="margin-left:4px">🚨</span>':''}</div>
          <div class="jcol" style="flex:1;font-size:12px">${j.customer_name}</div>
          <div class="jcol" style="flex:none;width:80px;font-size:11px;font-family:var(--mono)">${fmtD(j.due_date)}</div>
          <div class="jcol" style="flex:none;width:80px;font-size:11px;font-family:var(--mono);color:${j.is_late?'var(--red)':'var(--muted)'}">${fmtD(j.scheduled_finish)}${j.is_late?' ⚠':''}</div>
          <div style="flex:none;width:100px">${crBar(j.critical_ratio)}</div>
        </div></td></tr>`).join('')}</tbody></table>`:
        `<div class="empty">All clear — no urgent jobs ✓</div>`}
      </div>
      <div class="card">
        <div class="card-hdr"><div class="card-title">Status</div></div>
        <div class="card-body">
          ${['pending','scheduled','in_progress','completed'].map(s=>{
            const cnt=allJobs.filter(j=>j.status===s).length,pct=total?Math.round(cnt/total*100):0;
            const col={pending:'var(--muted)',scheduled:'var(--accent2)',in_progress:'var(--accent)',completed:'var(--green)'}[s];
            return`<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;text-transform:capitalize">${s.replace('_',' ')}</span><span class="mono" style="font-size:11px">${cnt}</span></div><div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:${col}"></div></div></div>`;
          }).join('')}
        </div>
      </div>
    </div>
    <div id="preemptAlertBox"></div>
    <div class="card">
      <div class="card-hdr"><div class="card-title">Quick Actions</div></div>
      <div class="card-body" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="navigate('/jobs/new')">+ New Job</button>
        <button class="btn btn-secondary" onclick="navigate('/orders/new')">+ New Order</button>
        <button class="btn btn-secondary" onclick="navigate('/today')">🕐 Today</button>
        <button class="btn btn-secondary" onclick="navigate('/schedule')">📅 Gantt</button>
        <button class="btn btn-secondary" onclick="navigate('/capacity')">🔥 Capacity</button>
        <button class="btn btn-secondary" onclick="navigate('/workers')">👷 Workers</button>
      </div>
    </div>`;
}

function toggleAdminMenu(){
  const m=document.getElementById('adminMenu');
  if(!m) return;
  const open = m.style.display==='none'||!m.style.display;
  m.style.display = open ? '' : 'none';
  if(open){
    // Close when clicking outside
    setTimeout(()=>{
      const close=()=>{ m.style.display='none'; document.removeEventListener('click',close); };
      document.addEventListener('click',close);
    },0);
  }
}

// ── TODAY ──
let todayRefreshTimer=null;
