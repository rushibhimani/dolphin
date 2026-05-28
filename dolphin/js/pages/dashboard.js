/**
 * Dolphin ERP — Dashboard
 * Manager's first screen: what's happening RIGHT NOW and what needs attention.
 */

async function renderDashboard(){
  try { await loadAll(); } catch(e) { console.error('loadAll failed:', e); }

  const isOffline = document.getElementById('serverStatus').textContent === 'Offline';
  if(isOffline && allJobs.length === 0){
    document.getElementById('topbarActions').innerHTML = '';
    document.getElementById('content').innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:60vh;gap:16px;color:var(--muted)">
        <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="opacity:.3"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        <div style="font-size:16px;font-weight:600;color:var(--text)">Cannot connect to server</div>
        <div style="font-size:13px;text-align:center">Make sure <code style="background:var(--surface);padding:2px 6px;border-radius:4px">python main.py</code> is running<br>then refresh this page.</div>
        <button class="btn btn-primary" onclick="handleRoute()">↻ Retry</button>
      </div>`;
    return;
  }

  document.getElementById('topbarActions').innerHTML = '';

  // ── Compute all metrics ───────────────────────────────────────────────────
  const activeJobs  = allJobs.filter(j => j.status !== 'completed');
  const inProg      = allJobs.filter(j => j.status === 'in_progress');
  const pending     = allJobs.filter(j => j.status === 'pending');
  const scheduled   = allJobs.filter(j => j.status === 'scheduled');
  const lateJobs    = activeJobs.filter(j => j.is_late);
  const urgentJobs  = activeJobs.filter(j => j.critical_ratio < 1.0 && j.status !== 'pending');
  const downMachines= allMachines.filter(m => m.status && m.status !== 'active');
  const pendingOrders = allOrders?.filter(o => o.status !== 'completed') || [];
  const revenue     = allOrders?.filter(o => o.status !== 'completed').reduce((s,o) => s + (o.total_price||0), 0) || 0;
  const doneToday   = allJobs.filter(j => j.status === 'completed' && j.completed_at &&
                        j.completed_at.slice(0,10) === new Date().toISOString().slice(0,10)).length;

  // ── Fetch today's ops for live summary ───────────────────────────────────
  let todayOps = [];
  try { todayOps = await api('GET', '/api/today'); } catch {}
  const todayActive = todayOps.filter(o => o.status === 'in_progress');
  const todayPaused = todayOps.filter(o => o.status === 'paused');
  const todayDone   = todayOps.filter(o => o.status === 'completed');
  const todaySched  = todayOps.filter(o => o.status === 'scheduled');

  // ── Fetch preemption alerts ───────────────────────────────────────────────
  let alerts = [];
  try { alerts = await api('GET', '/api/preemption-alerts'); } catch {}

  // ── Top urgent/late jobs ──────────────────────────────────────────────────
  const topJobs = [...activeJobs]
    .filter(j => j.status !== 'pending')
    .sort((a,b) => a.critical_ratio - b.critical_ratio)
    .slice(0, 5);

  // ── Machine load (from workers/machines) ─────────────────────────────────
  const machineLoad = allMachines.slice(0, 8);

  document.getElementById('content').innerHTML = `
  <style>
    .db-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px; margin-bottom:18px; }
    .db-card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:14px 16px; }
    .db-card.alert { border-color:var(--red); background:var(--red-soft,rgba(239,68,68,.06)); }
    .db-card.warn  { border-color:var(--amber); background:var(--amber-soft,rgba(245,158,11,.06)); }
    .db-card.good  { border-color:var(--green); background:rgba(16,185,129,.06); }
    .db-val  { font-size:28px; font-weight:800; line-height:1.1; margin:4px 0; }
    .db-lbl  { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
    .db-sub  { font-size:11px; color:var(--muted); margin-top:2px; }
    .db-2col { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px; }
    .db-3col { display:grid; grid-template-columns:2fr 1fr; gap:14px; margin-bottom:14px; }
    @media(max-width:640px){ .db-2col,.db-3col{grid-template-columns:1fr;} }
    .dash-section-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); margin-bottom:8px; }
    .today-op-mini { display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border); font-size:12px; }
    .today-op-mini:last-child { border-bottom:none; }
    .dash-admin-item { display:block; width:100%; text-align:left; padding:8px 12px; font-size:13px; background:none; border:none; color:var(--text); cursor:pointer; border-radius:6px; }
    .dash-admin-item:hover { background:var(--surface); }
    .machine-row { display:flex; justify-content:space-between; align-items:center; padding:5px 0; border-bottom:1px solid var(--border); font-size:12px; }
    .machine-row:last-child { border-bottom:none; }
    .cr-chip { display:inline-block; padding:2px 7px; border-radius:10px; font-size:10px; font-weight:700; font-family:var(--mono); }
  </style>

  <!-- ── Row 1: Key stat cards ── -->
  <div class="db-grid">
    <div class="db-card ${lateJobs.length ? 'alert' : ''}">
      <div class="db-lbl">Late Jobs</div>
      <div class="db-val" style="color:${lateJobs.length ? 'var(--red)' : 'var(--green)'}">${lateJobs.length}</div>
      <div class="db-sub">${lateJobs.length ? 'Need attention now' : 'All on track ✓'}</div>
    </div>
    <div class="db-card ${urgentJobs.length ? 'warn' : ''}">
      <div class="db-lbl">Urgent (CR &lt; 1)</div>
      <div class="db-val" style="color:${urgentJobs.length ? 'var(--amber)' : 'var(--green)'}">${urgentJobs.length}</div>
      <div class="db-sub">${urgentJobs.length ? 'Critical ratio &lt; 1.0' : 'No urgent jobs'}</div>
    </div>
    <div class="db-card">
      <div class="db-lbl">In Progress</div>
      <div class="db-val" style="color:var(--accent)">${inProg.length}</div>
      <div class="db-sub">${scheduled.length} scheduled · ${pending.length} pending</div>
    </div>
    <div class="db-card ${doneToday > 0 ? 'good' : ''}">
      <div class="db-lbl">Done Today</div>
      <div class="db-val" style="color:${doneToday > 0 ? 'var(--green)' : 'var(--text)'}">${doneToday}</div>
      <div class="db-sub">Jobs completed today</div>
    </div>
    <div class="db-card ${downMachines.length ? 'alert' : ''}">
      <div class="db-lbl">Machines Down</div>
      <div class="db-val" style="color:${downMachines.length ? 'var(--red)' : 'var(--green)'}">${downMachines.length}</div>
      <div class="db-sub">${downMachines.length ? downMachines.map(m=>m.name).join(', ') : 'All running'}</div>
    </div>
    <div class="db-card">
      <div class="db-lbl">Pipeline Value</div>
      <div class="db-val" style="color:var(--green);font-size:20px">${fmtINR(revenue)}</div>
      <div class="db-sub">${pendingOrders.length} active orders</div>
    </div>
  </div>

  <!-- ── Alerts row ── -->
  ${lateJobs.length || alerts.length || downMachines.length ? `
  <div style="background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.25);border-radius:10px;padding:12px 16px;margin-bottom:14px">
    <div style="font-size:12px;font-weight:700;color:var(--red);margin-bottom:8px">⚠ Needs Attention</div>
    <div style="display:flex;flex-direction:column;gap:6px;font-size:12px">
      ${lateJobs.slice(0,3).map(j=>`<div>🔴 <strong>${j.job_number}</strong> (${escHtml(j.customer_name)}) — <span style="color:var(--red)">overdue by ${Math.round((new Date()-new Date(j.due_date))/86400000)}d</span>
        <a onclick="navigate('/jobs');setTimeout(()=>expandJob(${j.id}),200)" style="cursor:pointer;color:var(--accent);margin-left:8px;font-size:11px">View →</a></div>`).join('')}
      ${downMachines.map(m=>`<div>🔧 <strong>${escHtml(m.name)}</strong> — ${m.status} <a onclick="navigate('/machines')" style="cursor:pointer;color:var(--accent);margin-left:8px;font-size:11px">Manage →</a></div>`).join('')}
      ${alerts.slice(0,2).map(a=>`<div>⚡ Urgent: <strong>${a.urgent_job}</strong> — worker <strong>${escHtml(a.worker_name)}</strong> tied up on lower-priority job</div>`).join('')}
    </div>
  </div>` : ''}

  <!-- ── Row 2: Today's ops + Priority queue ── -->
  <div class="db-3col">

    <!-- Priority queue -->
    <div class="db-card" style="padding:14px 16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="dash-section-title" style="margin:0">Priority Queue</div>
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="navigate('/jobs')">All Jobs →</button>
      </div>
      ${topJobs.length ? topJobs.map(j => {
        const cr = j.critical_ratio;
        const crColor = cr < 0.5 ? 'var(--red)' : cr < 1 ? 'var(--amber)' : 'var(--green)';
        return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${j.job_number} ${j.priority_flag ? '🚨' : ''}
            </div>
            <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(j.customer_name)} · Due ${fmtD(j.due_date)}</div>
          </div>
          <div style="flex-shrink:0;text-align:right">
            <span class="cr-chip" style="background:${crColor}22;color:${crColor};border:1px solid ${crColor}55">CR ${cr.toFixed(1)}</span>
            <div style="font-size:10px;color:${j.is_late?'var(--red)':'var(--muted)'};margin-top:2px">${sBadge(j.status)}</div>
          </div>
        </div>`;
      }).join('') : `<div style="color:var(--muted);font-size:12px;padding:16px 0;text-align:center">All clear — no urgent jobs ✓</div>`}
    </div>

    <!-- Today's work summary -->
    <div class="db-card" style="padding:14px 16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="dash-section-title" style="margin:0">Today's Floor</div>
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="navigate('/today')">Full View →</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px">
        <div style="background:var(--accent-soft);border:1px solid var(--accent);border-radius:6px;padding:8px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:var(--accent)">${todayActive.length}</div>
          <div style="font-size:10px;color:var(--muted)">In Progress</div>
        </div>
        <div style="background:var(--amber-soft,rgba(245,158,11,.08));border:1px solid var(--amber);border-radius:6px;padding:8px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:var(--amber)">${todayPaused.length}</div>
          <div style="font-size:10px;color:var(--muted)">Paused</div>
        </div>
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px;text-align:center">
          <div style="font-size:22px;font-weight:700">${todaySched.length}</div>
          <div style="font-size:10px;color:var(--muted)">Scheduled</div>
        </div>
        <div style="background:rgba(16,185,129,.07);border:1px solid var(--green);border-radius:6px;padding:8px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:var(--green)">${todayDone.length}</div>
          <div style="font-size:10px;color:var(--muted)">Done Today</div>
        </div>
      </div>
      ${todayActive.slice(0,3).map(op => `
        <div class="today-op-mini">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0"></span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(op.op_name)}</div>
            <div style="color:var(--muted);font-size:11px">${op.wc_name} · ${escHtml(op.worker_name||'No worker')}</div>
          </div>
          <span style="font-size:10px;color:var(--accent);flex-shrink:0">▶ Running</span>
        </div>`).join('')}
      ${todayPaused.slice(0,2).map(op => `
        <div class="today-op-mini">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--amber);flex-shrink:0"></span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(op.op_name)}</div>
            <div style="color:var(--muted);font-size:11px">${op.wc_name} · ${escHtml(op.pause_reason||'Paused')}</div>
          </div>
          <span style="font-size:10px;color:var(--amber);flex-shrink:0">⏸ Paused</span>
        </div>`).join('')}
      ${!todayOps.length ? `<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px 0">No ops scheduled today</div>` : ''}
    </div>
  </div>

  <!-- ── Row 3: Machine status + Quick actions ── -->
  <div class="db-2col">

    <!-- Machine status -->
    <div class="db-card" style="padding:14px 16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="dash-section-title" style="margin:0">Machines</div>
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="navigate('/machines')">Manage →</button>
      </div>
      ${allMachines.slice(0,10).map(m => {
        const busy = todayOps.some(o => o.wc_name === m.name && o.status === 'in_progress');
        const paused = todayOps.some(o => o.wc_name === m.name && o.status === 'paused');
        const isDown = m.status && m.status !== 'active';
        const dot = isDown ? '#EF4444' : busy ? 'var(--accent)' : paused ? 'var(--amber)' : '#9CA3AF';
        const label = isDown ? m.status : busy ? 'Running' : paused ? 'Paused' : 'Idle';
        return `<div class="machine-row">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:8px;height:8px;border-radius:50%;background:${dot};flex-shrink:0"></span>
            <span style="font-weight:500">${escHtml(m.name)}</span>
          </div>
          <span style="font-size:11px;color:${isDown?'var(--red)':busy?'var(--accent)':'var(--muted)'}">${label}</span>
        </div>`;
      }).join('')}
    </div>

    <!-- Quick actions + orders summary -->
    <div style="display:flex;flex-direction:column;gap:14px">
      <!-- Orders summary -->
      <div class="db-card" style="padding:14px 16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div class="dash-section-title" style="margin:0">Active Orders</div>
          <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="navigate('/orders')">All →</button>
        </div>
        ${pendingOrders.slice(0,4).map(o => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px">
            <div style="min-width:0">
              <div style="font-weight:600">${escHtml(o.order_number)}</div>
              <div style="color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(o.customer_name)} · ${o.product_type}</div>
            </div>
            <div style="text-align:right;flex-shrink:0;margin-left:8px">
              <div style="font-size:11px;color:${o.is_late?'var(--red)':'var(--muted)'}">${fmtD(o.due_date)}</div>
              <div style="font-size:10px;margin-top:2px">${o.pieces_done}/${o.quantity} done</div>
            </div>
          </div>`).join('')}
        ${!pendingOrders.length ? `<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px 0">No active orders</div>` : ''}
      </div>

      <!-- Quick actions -->
      <div class="db-card" style="padding:14px 16px">
        <div class="dash-section-title">Quick Actions</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button class="btn btn-primary" onclick="navigate('/orders/new')">+ New Order</button>
          <button class="btn btn-secondary" onclick="navigate('/jobs/new')">+ New Job</button>
          <button class="btn btn-secondary" onclick="navigate('/today')">🕐 Today</button>
          <button class="btn btn-secondary" onclick="navigate('/quote')">📋 Quote</button>
          <button class="btn btn-secondary" onclick="navigate('/schedule')">📅 Gantt</button>
          <button class="btn btn-secondary" onclick="navigate('/capacity')">🔥 Capacity</button>
        </div>
      </div>
    </div>

  </div>`;
}

function toggleAdminMenu(){
  const m = document.getElementById('adminMenu');
  if(!m) return;
  const open = m.style.display === 'none' || !m.style.display;
  m.style.display = open ? '' : 'none';
  if(open){
    setTimeout(()=>{
      const close = () => { m.style.display='none'; document.removeEventListener('click',close); };
      document.addEventListener('click', close);
    }, 0);
  }
}

// ── TODAY ──
let todayRefreshTimer = null;
