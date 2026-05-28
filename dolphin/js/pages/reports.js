/**
 * Dolphin ERP — Reports
 */

async function renderReports(){
  document.getElementById('topbarActions').innerHTML=`
    <button class="btn btn-secondary" onclick="renderReports()">↻ Refresh</button>
    <button class="btn btn-ghost" onclick="navigate('/reports/workers')">👷 Worker Reports</button>`;
  document.getElementById('content').innerHTML=`<div style="padding:40px;text-align:center;color:var(--muted)">Loading reports...</div>`;
  try{
    const r = await api('GET','/api/reports/summary');
    renderReportsContent(r);
  }catch(e){
    document.getElementById('content').innerHTML=`<div class="empty">${e.message}</div>`;
  }
}

function renderReportsContent(r){
  const t = r.totals;
  const onTimeColor = t.on_time_rate>=90?'var(--green)':t.on_time_rate>=75?'var(--accent)':'var(--red)';
  const machineLoadHtml = r.machine_load.length ? r.machine_load.map((m,i)=>{
    const pct = Math.min(100, (m.hours/200)*100);  // 200hrs max for visualization
    const col = m.hours>180?'var(--red)':m.hours>120?'var(--accent)':'var(--accent2)';
    return `<div style="margin-bottom:9px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span>${i+1}. ${escHtml(m.name)} <span style="color:var(--muted);font-size:10px">(${m.type})</span></span>
        <span class="mono" style="font-size:11px">${m.hours}h · ${m.ops_count} ops</span>
      </div>
      <div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:${col}"></div></div>
    </div>`;
  }).join('') : '<div style="color:var(--muted);font-size:12px">No upcoming machine load</div>';

  // Monthly chart
  const maxRevenue = Math.max(...r.monthly.map(m=>m.revenue), 1);
  const monthlyChart = r.monthly.length ? `
    <div style="display:flex;align-items:end;gap:6px;height:140px;padding:8px 0;border-bottom:1px solid var(--border)">
      ${r.monthly.map(m=>{
        const h = (m.revenue/maxRevenue)*100;
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
          <div style="font-size:9px;color:var(--muted);font-family:var(--mono)">${m.revenue?fmtINR(m.revenue):''}</div>
          <div style="width:100%;background:linear-gradient(to top, var(--accent2), rgba(59,130,246,.4));height:${h}%;min-height:2px;border-radius:3px 3px 0 0" title="${m.month}: ${fmtINR(m.revenue)}"></div>
          <div style="font-size:10px;color:var(--muted);font-family:var(--mono)">${m.month.slice(2)}</div>
        </div>`;
      }).join('')}
    </div>` : '<div style="color:var(--muted);text-align:center;padding:30px">No data yet</div>';

  const monthlyTable = r.monthly.length ? `
    <table style="width:100%;border-collapse:collapse;margin-top:12px">
      <thead><tr>
        <th style="padding:6px 10px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left">Month</th>
        <th style="padding:6px 10px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:right">Created</th>
        <th style="padding:6px 10px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:right">Done</th>
        <th style="padding:6px 10px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:right">On-Time</th>
        <th style="padding:6px 10px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:right">Late</th>
        <th style="padding:6px 10px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:right">Revenue</th>
      </tr></thead>
      <tbody>${r.monthly.slice().reverse().map(m=>`<tr style="border-top:1px solid var(--border)">
        <td style="padding:7px 10px;font-family:var(--mono);font-size:12px">${m.month}</td>
        <td style="padding:7px 10px;font-family:var(--mono);font-size:12px;text-align:right">${m.jobs_created}</td>
        <td style="padding:7px 10px;font-family:var(--mono);font-size:12px;text-align:right">${m.jobs_completed}</td>
        <td style="padding:7px 10px;font-family:var(--mono);font-size:12px;text-align:right;color:var(--green)">${m.on_time_count}</td>
        <td style="padding:7px 10px;font-family:var(--mono);font-size:12px;text-align:right;color:${m.late_count>0?'var(--red)':'var(--muted)'}">${m.late_count}</td>
        <td style="padding:7px 10px;font-family:var(--mono);font-size:12px;text-align:right;font-weight:500">${fmtINR(m.revenue)}</td>
      </tr>`).join('')}</tbody>
    </table>` : '';

  const topCustomersHtml = r.top_customers.length ? r.top_customers.map((c,i)=>`
    <tr style="border-top:1px solid var(--border)">
      <td style="padding:8px 12px;font-size:11px;color:var(--muted);width:30px">${i+1}</td>
      <td style="padding:8px 12px;font-size:12px;font-weight:500">
        <a onclick="viewCustomer(${c.customer_id})" style="cursor:pointer;color:var(--accent2)">${escHtml(c.name)}</a>
      </td>
      <td style="padding:8px 12px;font-family:var(--mono);font-size:12px;text-align:right">${c.jobs}</td>
      <td style="padding:8px 12px;font-family:var(--mono);font-size:12px;text-align:right">${c.completed}</td>
      <td style="padding:8px 12px;font-family:var(--mono);font-size:12px;text-align:right;color:${c.late>0?'var(--red)':'var(--muted)'}">${c.late}</td>
      <td style="padding:8px 12px;font-family:var(--mono);font-size:12px;text-align:right;font-weight:600;color:var(--green)">${fmtINR(c.revenue)}</td>
    </tr>`).join('') : '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--muted)">No customer data yet</td></tr>';

  const lateJobsHtml = r.late_jobs.length ? r.late_jobs.map(j=>`
    <tr style="border-top:1px solid var(--border)">
      <td style="padding:8px 12px;font-family:var(--mono);font-size:12px;color:var(--accent2)"><a onclick="navigate('/jobs');setTimeout(()=>expandJob(${j.id}),200)" style="cursor:pointer">${escHtml(j.job_number)}</a></td>
      <td style="padding:8px 12px;font-size:12px">${escHtml(j.customer_name)}</td>
      <td style="padding:8px 12px;font-family:var(--mono);font-size:11px">${fmtD(j.due_date)}</td>
      <td style="padding:8px 12px;font-family:var(--mono);font-size:11px;color:var(--red);font-weight:600">${j.days_late} days</td>
      <td style="padding:8px 12px">${sBadge(j.status)}</td>
    </tr>`).join('') : '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--green)">✓ No overdue jobs</td></tr>';

  document.getElementById('content').innerHTML=`
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Revenue (Last 30 Days)</div>
        <div class="stat-value" style="color:var(--green);font-size:22px">${fmtINR(t.recent_revenue_30d)}</div>
        <div class="stat-sub">${fmtINR(t.total_revenue)} all-time</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">On-Time Rate</div>
        <div class="stat-value" style="color:${onTimeColor}">${t.on_time_rate}%</div>
        <div class="stat-sub">${t.on_time_jobs} on-time / ${t.late_jobs} late</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Jobs</div>
        <div class="stat-value">${t.total_jobs}</div>
        <div class="stat-sub">${t.completed_jobs} completed</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Currently Late</div>
        <div class="stat-value" style="color:${t.currently_late?'var(--red)':'var(--green)'}">${t.currently_late}</div>
        <div class="stat-sub">Past due, not done</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr;gap:16px;margin-bottom:16px">
      <div class="card">
        <div class="card-hdr"><div class="card-title">Monthly Revenue Trend</div></div>
        <div class="card-body">${monthlyChart}${monthlyTable}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div class="card">
        <div class="card-hdr"><div class="card-title">Top Customers by Revenue</div></div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="border-bottom:1px solid var(--border)">
              <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left">#</th>
              <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left">Customer</th>
              <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:right">Jobs</th>
              <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:right">Done</th>
              <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:right">Late</th>
              <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:right">Revenue</th>
            </tr></thead>
            <tbody>${topCustomersHtml}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-hdr"><div class="card-title">Machine Load (Next 30 Days)</div></div>
        <div class="card-body">${machineLoadHtml}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-hdr"><div class="card-title" style="color:${r.late_jobs.length?'var(--red)':'var(--green)'}">${r.late_jobs.length?'⚠ ':'✓ '}Currently Late Jobs (${r.late_jobs.length})</div></div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="border-bottom:1px solid var(--border)">
            <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left">Job #</th>
            <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left">Customer</th>
            <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left">Due Date</th>
            <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left">Overdue</th>
            <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left">Status</th>
          </tr></thead>
          <tbody>${lateJobsHtml}</tbody>
        </table>
      </div>
    </div>`;
}

// ── INIT ──

// ═════════════════════════════════════════════════════════════════════════════
// WORKER DAILY REPORT
// ═════════════════════════════════════════════════════════════════════════════

async function renderWorkerReports() {
  const today = new Date().toISOString().slice(0,10);
  document.getElementById('topbarActions').innerHTML = `
    <input type="date" id="wdr_date" value="${today}" style="font-size:13px;padding:5px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
    <select id="wdr_worker" style="font-size:13px;padding:5px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
      <option value="">All Workers</option>
      ${(allWorkers||[]).filter(w=>w.is_active).map(w=>`<option value="${w.id}">${escHtml(w.name)}</option>`).join('')}
    </select>
    <button class="btn btn-secondary" onclick="loadWorkerReports()">↻ Load</button>
    <button class="btn btn-primary"   onclick="generateWorkerReports()">⚡ Generate Report</button>`;

  document.getElementById('content').innerHTML = `
    <div class="card" style="padding:30px;text-align:center;color:var(--muted)">
      Select a date and click <b>Generate Report</b> to create today's worker reports,
      or <b>Load</b> to view previously saved reports.
    </div>`;
}

async function generateWorkerReports() {
  const date      = document.getElementById('wdr_date')?.value;
  const btn       = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  try {
    const result = await api('POST', '/api/reports/daily/generate', { date });
    toast(`Generated ${result.count} worker reports for ${date}`);
    await loadWorkerReports();
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Generate Report'; }
  }
}

async function loadWorkerReports() {
  const date     = document.getElementById('wdr_date')?.value;
  const workerId = document.getElementById('wdr_worker')?.value;
  document.getElementById('content').innerHTML = `<div style="padding:30px;text-align:center;color:var(--muted)">Loading…</div>`;
  try {
    let url = `/api/reports/daily?date=${date}`;
    if (workerId) url += `&worker_id=${workerId}`;
    const reports = await api('GET', url);
    renderWorkerReportsList(reports, date);
  } catch(e) {
    document.getElementById('content').innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

function renderWorkerReportsList(reports, date) {
  if (!reports.length) {
    document.getElementById('content').innerHTML = `
      <div class="card" style="padding:30px;text-align:center;color:var(--muted)">
        No reports found for ${date}. Click <b>Generate Report</b> to create them.
      </div>`;
    return;
  }

  const totalEst    = reports.reduce((a,r) => a + (r.est_hours||0), 0);
  const totalActual = reports.reduce((a,r) => a + (r.actual_hours||0), 0);
  const totalDone   = reports.reduce((a,r) => a + (r.ops_completed||0), 0);
  const totalMissed = reports.reduce((a,r) => a + (r.ops_missed||0), 0);
  const avgEff      = reports.filter(r=>r.efficiency_pct).length
    ? Math.round(reports.filter(r=>r.efficiency_pct).reduce((a,r)=>a+(r.efficiency_pct||0),0) / reports.filter(r=>r.efficiency_pct).length)
    : null;

  const effColor = e => e == null ? 'var(--muted)' : e >= 90 ? 'var(--green)' : e >= 70 ? 'var(--accent)' : 'var(--red,#DC2626)';

  const summaryHtml = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      <div class="card" style="text-align:center;padding:14px 8px">
        <div style="font-size:22px;font-weight:700">${totalDone}</div>
        <div style="font-size:11px;color:var(--muted)">Ops Completed</div>
      </div>
      <div class="card" style="text-align:center;padding:14px 8px">
        <div style="font-size:22px;font-weight:700;color:${totalMissed>0?'var(--red)':'var(--green)'}">${totalMissed}</div>
        <div style="font-size:11px;color:var(--muted)">Ops Missed</div>
      </div>
      <div class="card" style="text-align:center;padding:14px 8px">
        <div style="font-size:22px;font-weight:700">${totalActual.toFixed(1)}h</div>
        <div style="font-size:11px;color:var(--muted)">Actual Work (est: ${totalEst.toFixed(1)}h)</div>
      </div>
      <div class="card" style="text-align:center;padding:14px 8px">
        <div style="font-size:22px;font-weight:700;color:${effColor(avgEff)}">${avgEff!=null?avgEff+'%':'—'}</div>
        <div style="font-size:11px;color:var(--muted)">Avg Efficiency</div>
      </div>
    </div>`;

  const workerCards = reports.map(r => {
    const eff = r.efficiency_pct;
    const effBar = r.est_hours > 0
      ? `<div style="height:6px;background:var(--surface);border-radius:3px;margin-top:6px;overflow:hidden">
           <div style="height:100%;width:${Math.min(100,eff||0)}%;background:${effColor(eff)};border-radius:3px"></div>
         </div>` : '';

    const detailRows = (r.ops_detail||[]).map(op => {
      const statusCol = op.status==='completed'?'var(--green)':op.status==='in_progress'?'var(--accent)':'var(--muted)';
      const effVal    = op.efficiency!=null ? `${op.efficiency}%` : '—';
      return `<tr style="border-top:1px solid var(--border)">
        <td style="padding:5px 8px;font-size:11px;font-family:var(--mono)">${escHtml(op.job_number)}</td>
        <td style="padding:5px 8px;font-size:11px">${escHtml(op.op_name)}</td>
        <td style="padding:5px 8px;font-size:11px;color:var(--muted)">${escHtml(op.machine)}</td>
        <td style="padding:5px 8px;font-size:11px;text-align:right">${Math.round(op.est_mins)}m</td>
        <td style="padding:5px 8px;font-size:11px;text-align:right">${op.actual_mins>0?Math.round(op.actual_mins)+'m':'—'}</td>
        <td style="padding:5px 8px;font-size:11px;text-align:right;font-weight:600;color:${effColor(op.efficiency)}">${effVal}</td>
        <td style="padding:5px 8px;font-size:11px;text-align:center">
          <span style="color:${statusCol};font-weight:600;text-transform:capitalize">${op.status}</span>
        </td>
      </tr>`;
    }).join('');

    return `<div class="card" style="padding:0;overflow:hidden;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;
                  padding:10px 14px;background:var(--surface);border-bottom:1px solid var(--border)">
        <div>
          <div style="font-size:14px;font-weight:700">${escHtml(r.worker_name)}</div>
          <div style="font-size:11px;color:var(--muted)">
            ${r.ops_completed} done · ${r.ops_started} in-progress · ${r.ops_missed} missed
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:16px;font-weight:700;color:${effColor(eff)}">${eff!=null?eff+'%':'—'}</div>
          <div style="font-size:10px;color:var(--muted)">${r.actual_hours.toFixed(1)}h / ${r.est_hours.toFixed(1)}h est</div>
          ${effBar}
        </div>
      </div>
      ${r.ops_detail?.length ? `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:var(--surface)">
            <th style="padding:5px 8px;font-size:10px;color:var(--muted);text-align:left;text-transform:uppercase">Job</th>
            <th style="padding:5px 8px;font-size:10px;color:var(--muted);text-align:left;text-transform:uppercase">Operation</th>
            <th style="padding:5px 8px;font-size:10px;color:var(--muted);text-align:left;text-transform:uppercase">Machine</th>
            <th style="padding:5px 8px;font-size:10px;color:var(--muted);text-align:right;text-transform:uppercase">Est</th>
            <th style="padding:5px 8px;font-size:10px;color:var(--muted);text-align:right;text-transform:uppercase">Actual</th>
            <th style="padding:5px 8px;font-size:10px;color:var(--muted);text-align:right;text-transform:uppercase">Eff%</th>
            <th style="padding:5px 8px;font-size:10px;color:var(--muted);text-align:center;text-transform:uppercase">Status</th>
          </tr></thead>
          <tbody>${detailRows}</tbody>
        </table>
      </div>` : `<div style="padding:12px;color:var(--muted);font-size:12px;text-align:center">No operations scheduled</div>`}
      <div style="padding:6px 14px;font-size:10px;color:var(--muted);border-top:1px solid var(--border);text-align:right">
        Generated: ${new Date(r.generated_at).toLocaleString('en-IN')}
      </div>
    </div>`;
  }).join('');

  document.getElementById('content').innerHTML = `
    <div style="max-width:960px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div style="font-size:16px;font-weight:700">Worker Reports — ${date}</div>
        <div style="font-size:11px;color:var(--muted)">${reports.length} worker(s)</div>
      </div>
      ${summaryHtml}
      ${workerCards}
    </div>`;
}
