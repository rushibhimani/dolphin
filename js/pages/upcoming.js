/**
 * Dolphin ERP — Upcoming
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
  const days=parseInt(document.getElementById('upcomingDays')?.value||7);
  try{
    const ops=await api('GET',`/api/upcoming?days=${days}`);
    if(!ops.length){
      document.getElementById('content').innerHTML=`<div class="card"><div class="empty">No operations scheduled in next ${days} days.<br>Run Schedule All to plan jobs.</div></div>`;
      return;
    }
    // Group by date
    const byDate={};
    ops.forEach(op=>{
      const d=op.scheduled_start?op.scheduled_start.slice(0,10):'Unknown';
      if(!byDate[d])byDate[d]=[];byDate[d].push(op);
    });
    const dates=Object.keys(byDate).sort();
    let html='';
    dates.forEach(d=>{
      const dops=byDate[d];
      const dateObj=new Date(d+'T00:00:00');
      const dayLabel=dateObj.toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short'});
      html+=`<div class="today-machine-block">
        <div class="today-machine-title"><span>${dayLabel}</span><span class="opcount">${dops.length} op${dops.length>1?'s':''}</span></div>`;
      dops.forEach(op=>{
        const workMins=op.work_time_mins||(op.work_time_hrs*60);
        const setupMins=op.setup_time_mins||0;
        html+=`<div class="today-op-row">
          <div class="today-op-info">
            <div class="today-op-title">
              <span class="jobnum">${op.order_label||op.job_number}</span>
              ${op.priority?'<span class="badge badge-urgent">🚨</span>':''}
              <span class="opname">${op.op_name}</span>
            </div>
            <div class="today-op-meta">${op.customer} · ${op.wc_name}${op.worker_name?' · <span class="worker">👷 '+op.worker_name+'</span>':''} · Setup ${fmtSetup(setupMins)} · Work ${fmtWork(workMins)}</div>
          </div>
          <div class="today-op-time">${fmtDT(op.scheduled_start)}<br>→ ${fmtDT(op.scheduled_end)}</div>
          <div class="today-op-status">${sBadge(op.status)}</div>
        </div>`;
      });
      html+=`</div>`;
    });
    document.getElementById('content').innerHTML=`<div style="display:grid;gap:14px">${html}</div>`;
  }catch(e){document.getElementById('content').innerHTML=`<div class="empty">${e.message}</div>`;}
}

// ── JOBS ──
let expandedJobId=null;

let jobNextOps = {};  // populated by loadAll extended
