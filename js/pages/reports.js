/**
 * Dolphin ERP — Reports
 */

async function renderReports(){
  document.getElementById('topbarActions').innerHTML=`<button class="btn btn-secondary" onclick="renderReports()">↻ Refresh</button>`;
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
        <span>${i+1}. ${m.name} <span style="color:var(--muted);font-size:10px">(${m.type})</span></span>
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
        <a onclick="viewCustomer(${c.customer_id})" style="cursor:pointer;color:var(--accent2)">${c.name}</a>
      </td>
      <td style="padding:8px 12px;font-family:var(--mono);font-size:12px;text-align:right">${c.jobs}</td>
      <td style="padding:8px 12px;font-family:var(--mono);font-size:12px;text-align:right">${c.completed}</td>
      <td style="padding:8px 12px;font-family:var(--mono);font-size:12px;text-align:right;color:${c.late>0?'var(--red)':'var(--muted)'}">${c.late}</td>
      <td style="padding:8px 12px;font-family:var(--mono);font-size:12px;text-align:right;font-weight:600;color:var(--green)">${fmtINR(c.revenue)}</td>
    </tr>`).join('') : '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--muted)">No customer data yet</td></tr>';

  const lateJobsHtml = r.late_jobs.length ? r.late_jobs.map(j=>`
    <tr style="border-top:1px solid var(--border)">
      <td style="padding:8px 12px;font-family:var(--mono);font-size:12px;color:var(--accent2)"><a onclick="navigate('/jobs');setTimeout(()=>expandJob(${j.id}),200)" style="cursor:pointer">${j.job_number}</a></td>
      <td style="padding:8px 12px;font-size:12px">${j.customer_name}</td>
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
