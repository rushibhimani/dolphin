/**
 * Dolphin ERP — Upcoming
 * Grouped by date → machine → operations table.
 */

async function renderUpcoming(){
  if(todayRefreshTimer) clearInterval(todayRefreshTimer);
  document.getElementById('topbarActions').innerHTML=`
    <select id="upcomingDays" onchange="renderUpcoming()" style="width:130px">
      <option value="7">Next 7 Days</option>
      <option value="14">Next 14 Days</option>
      <option value="30">Next 30 Days</option>
    </select>
    <button class="btn btn-secondary" onclick="renderUpcoming()">↻ Refresh</button>`;
  document.getElementById('content').innerHTML=`<div style="color:var(--muted)">Loading…</div>`;
  const days = parseInt(document.getElementById('upcomingDays')?.value || 7);
  try{
    const ops = await api('GET',`/api/upcoming?days=${days}`);
    if(!ops.length){
      document.getElementById('content').innerHTML=`<div class="card"><div class="empty">No operations scheduled in next ${days} days.<br>Run Schedule All to plan jobs.</div></div>`;
      return;
    }

    // Group by date → then by machine
    const byDate = {};
    ops.forEach(op=>{
      const d = op.scheduled_start ? op.scheduled_start.slice(0,10) : 'Unknown';
      if(!byDate[d]) byDate[d] = {};
      const m = op.wc_name || 'Unknown';
      (byDate[d][m] = byDate[d][m] || []).push(op);
    });

    let html = '';
    Object.keys(byDate).sort().forEach(d => {
      const byMachine = byDate[d];
      const dateObj   = new Date(d+'T00:00:00');
      const dayLabel  = dateObj.toLocaleDateString('en-IN',{weekday:'long',day:'2-digit',month:'short'});
      const totalOps  = Object.values(byMachine).reduce((s,a)=>s+a.length,0);
      const machines  = Object.keys(byMachine).sort();

      // Summary bar: machine load chips for this day
      const machineChips = machines.map(m => {
        const mops    = byMachine[m];
        const totalMin= mops.reduce((s,o)=>{
          const est = (o.work_time_mins||0) + (o.setup_time_mins||0);
          return s + est;
        }, 0);
        const hrs = (totalMin/60).toFixed(1);
        return `<span style="background:var(--surface);border:1px solid var(--border);border-radius:5px;
                  padding:2px 8px;font-size:11px;font-family:var(--mono)">
                  ${m} <b style="color:var(--accent)">${hrs}h</b></span>`;
      }).join('');

      let machineBlocks = '';
      machines.forEach(m => {
        const mops = byMachine[m];
        const machineTotal = mops.reduce((s,o)=>s+(o.work_time_mins||0)+(o.setup_time_mins||0),0);

        const rows = mops.map(op => {
          const startTime = op.scheduled_start
            ? new Date(op.scheduled_start).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:false}) : '';
          const endTime = op.scheduled_end
            ? new Date(op.scheduled_end).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:false}) : '';
          const estMins = (op.work_time_mins||0) + (op.setup_time_mins||0);
          const isLate  = op.status === 'in_progress' || (op.due_date && op.scheduled_end && op.scheduled_end > op.due_date);
          return `<tr style="border-bottom:1px solid var(--border)${isLate?';background:var(--red-soft)':''}">
            <td style="padding:7px 12px;white-space:nowrap">
              <span style="font-size:11px;font-family:var(--mono);color:var(--accent);font-weight:600">${op.order_label||op.job_number}</span>
              ${op.priority?'<span style="color:var(--red);font-size:10px;margin-left:4px">🚨</span>':''}
            </td>
            <td style="padding:7px 8px;font-weight:600;font-size:13px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                title="${escHtml(op.op_name)}">${escHtml(op.op_name)}</td>
            <td style="padding:7px 8px;font-size:12px;color:var(--muted);white-space:nowrap">${escHtml(op.worker_name||'—')}</td>
            <td style="padding:7px 8px;font-size:11px;color:var(--muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                title="${escHtml(op.customer)}">${escHtml(op.customer)}</td>
            <td style="padding:7px 12px;font-size:11px;font-family:var(--mono);color:var(--muted);white-space:nowrap;text-align:right">${startTime} → ${endTime}</td>
            <td style="padding:7px 8px;font-size:11px;font-family:var(--mono);color:var(--muted);text-align:right;white-space:nowrap">${estMins}min</td>
          </tr>`;
        }).join('');

        machineBlocks += `
          <div style="margin-bottom:10px">
            <!-- Machine header -->
            <div style="display:flex;justify-content:space-between;align-items:center;
                 padding:6px 14px;background:var(--surface);border:1px solid var(--border);
                 border-radius:8px 8px 0 0">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:13px;font-weight:700">⚙ ${m}</span>
                <span style="font-size:11px;color:var(--muted)">${mops.length} op${mops.length>1?'s':''}</span>
              </div>
              <span style="font-size:11px;font-family:var(--mono);color:var(--accent);font-weight:600">
                ${(machineTotal/60).toFixed(1)}h total
              </span>
            </div>
            <!-- Ops table -->
            <div style="border:1px solid var(--border);border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
              <div style="overflow-x:auto">
                <table style="width:100%;border-collapse:collapse;min-width:480px">
                  <thead><tr style="background:var(--card)">
                    <th style="padding:5px 12px;font-size:10px;color:var(--muted);text-align:left;font-weight:600">Job</th>
                    <th style="padding:5px 8px;font-size:10px;color:var(--muted);text-align:left;font-weight:600">Operation</th>
                    <th style="padding:5px 8px;font-size:10px;color:var(--muted);text-align:left;font-weight:600">Worker</th>
                    <th style="padding:5px 8px;font-size:10px;color:var(--muted);text-align:left;font-weight:600">Customer</th>
                    <th style="padding:5px 12px;font-size:10px;color:var(--muted);text-align:right;font-weight:600">Time</th>
                    <th style="padding:5px 8px;font-size:10px;color:var(--muted);text-align:right;font-weight:600">Est</th>
                  </tr></thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>
            </div>
          </div>`;
      });

      html += `
        <!-- Date group -->
        <div style="margin-bottom:20px">
          <!-- Date header -->
          <div style="display:flex;justify-content:space-between;align-items:center;
               padding:10px 16px;background:var(--accent);border-radius:10px;margin-bottom:10px">
            <span style="font-weight:700;font-size:15px;color:#000">${dayLabel}</span>
            <span style="font-size:12px;color:rgba(0,0,0,0.6);font-family:var(--mono)">${totalOps} ops · ${machines.length} machine${machines.length>1?'s':''}</span>
          </div>
          <!-- Machine load summary -->
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
            ${machineChips}
          </div>
          <!-- Machine blocks -->
          ${machineBlocks}
        </div>`;
    });

    document.getElementById('content').innerHTML = html;
  } catch(e){ document.getElementById('content').innerHTML=`<div class="empty">${e.message}</div>`; }
}
