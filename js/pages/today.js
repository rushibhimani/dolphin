/**
 * Dolphin ERP — Today
 */

async function renderToday(){
  if(todayRefreshTimer) clearInterval(todayRefreshTimer);
  document.getElementById('topbarActions').innerHTML=`
    <span id="todayTs" style="font-size:13px;color:var(--muted);margin-right:8px"></span>
    <button class="btn btn-secondary" onclick="renderToday()">↻ Refresh</button>`;
  document.getElementById('content').innerHTML=`<div style="color:var(--muted)">Loading…</div>`;
  const nowISO=istNow().toISOString().slice(0,19);
  try{
    const ops=await api('GET','/api/today');
    // Separate by status groups then by machine
    const active=ops.filter(o=>o.status==='in_progress');
    const paused=ops.filter(o=>o.status==='paused');
    const sched=ops.filter(o=>o.status==='scheduled');

    if(!ops.length){document.getElementById('content').innerHTML=`<div class="card"><div class="empty">No operations for today.<br>Schedule some jobs first.</div></div>`;return;}

    function renderOpRow(op){
      const isNow=op.status==='in_progress';
      const isPaused=op.status==='paused';
      const isOverdue=op.scheduled_end&&op.scheduled_end.slice(0,19)<nowISO&&op.status==='scheduled';
      const workMins=op.work_time_mins||(op.work_time_hrs*60);
      const setupMins=op.setup_time_mins||0;
      const pauseInfo=isPaused&&op.pause_reason?`<div style="font-size:11px;color:var(--amber);margin-top:3px">⏸ Paused: ${pauseReasonLabel(op.pause_reason)}${op.pause_notes?' — '+op.pause_notes:''}</div>`:'';
      return `<div class="today-op-row ${isOverdue?'overdue':isNow?'inprog':isPaused?'paused':''}">
        <div class="today-op-info">
          <div class="today-op-title">
            <span class="jobnum">${op.order_label||op.job_number}</span>
            ${op.priority?'<span class="badge badge-urgent">🚨</span>':''}
            ${isOverdue?'<span class="badge badge-overdue">OVERDUE</span>':''}
            ${isPaused?'<span class="badge" style="background:var(--amber-soft);color:var(--amber);border-color:var(--amber)">PAUSED</span>':''}
            <span class="opname">${op.op_name}</span>
          </div>
          <div class="today-op-meta">${op.customer}${op.worker_name?' · <span class="worker">👷 '+op.worker_name+'</span>':''} · Setup ${fmtSetup(setupMins)} · Work ${fmtWork(workMins)}</div>
          ${op.actual_start?`<div class="today-op-started">▶ Started ${fmtDT(op.actual_start)}</div>`:''}
          ${pauseInfo}
        </div>
        <div class="today-op-time">${fmtDT(op.scheduled_start)}<br>→ ${fmtDT(op.scheduled_end)}</div>
        <div class="today-op-status">${sBadge(op.status)}</div>
        <div class="today-op-actions">
          ${op.status==='scheduled'?`<button class="btn btn-success" onclick="promptStart(${op.op_id},'${op.scheduled_start||''}')">▶ Start</button>`:''}
          ${op.status==='in_progress'?`
            <button class="btn btn-secondary" onclick="promptPause(${op.op_id})">⏸ Pause</button>
            <button class="btn btn-primary" onclick="promptComplete(${op.op_id},'${op.actual_start||''}')">✓ Done</button>`:''}
          ${op.status==='paused'?`<button class="btn btn-success" onclick="promptStart(${op.op_id},'${op.scheduled_start||''}')">▶ Resume</button>`:''}
        </div>
      </div>`;
    }

    const byMachine={};
    ops.forEach(op=>{if(!byMachine[op.wc_name])byMachine[op.wc_name]=[];byMachine[op.wc_name].push(op);});
    const machines=Object.keys(byMachine).sort();

    // Summary strip
    let html=`<div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <div style="background:var(--accent-soft);border:1px solid var(--accent);border-radius:8px;padding:8px 16px;font-size:13px"><b style="font-size:20px;color:var(--accent)">${active.length}</b> In Progress</div>
      <div style="background:var(--amber-soft);border:1px solid var(--amber);border-radius:8px;padding:8px 16px;font-size:13px"><b style="font-size:20px;color:var(--amber)">${paused.length}</b> Paused</div>
      <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 16px;font-size:13px"><b style="font-size:20px;color:var(--text)">${sched.length}</b> Scheduled</div>
    </div>`;

    html+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(560px,1fr));gap:18px">';
    machines.forEach(m=>{
      const mops=byMachine[m];
      html+=`<div class="today-machine-block">
        <div class="today-machine-title"><span>${m}</span><span class="opcount">${mops.length} op${mops.length>1?'s':''} today</span></div>`;
      mops.forEach(op=>{ html+=renderOpRow(op); });
      html+=`</div>`;
    });
    html+='</div>';
    document.getElementById('content').innerHTML=html;
  }catch(e){document.getElementById('content').innerHTML=`<div class="empty">${e.message}</div>`;}
  const ts=document.getElementById('todayTs');
  if(ts) ts.textContent=`Updated ${istNow().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:false})}`;
  todayRefreshTimer=setInterval(()=>{if(window.location.hash.includes('today'))renderToday();},60000);
}

function pauseReasonLabel(r){
  return{waiting_material:'Waiting Material',machine_down:'Machine Down',worker_absent:'Worker Absent',rework:'Rework',other:'Other'}[r]||r||'Unknown';
}

// ── Manual time dialogs ──
function nowLocalInput(){
  const d=istNow();
  return d.toISOString().slice(0,16).replace('T',' ');
}
function isoToLocalInput(iso){
  if(!iso)return nowLocalInput();
  return iso.slice(0,16).replace('T',' ');
}

function promptStart(opId, scheduledStart){
  const schLocal=scheduledStart?isoToLocalInput(scheduledStart):'';
  const nowLocal=nowLocalInput();
  showModal('Start Operation','<div style="display:grid;gap:12px">'+
    '<div><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">Actual Start Time</label>'+
    `<input type="datetime-local" id="dlg_start" value="${nowLocal.replace(' ','T')}" style="width:100%"></div>`+
    (schLocal?`<div style="display:flex;gap:8px;align-items:center"><button class="btn btn-ghost" style="font-size:12px" onclick="document.getElementById('dlg_start').value='${schLocal.replace(' ','T')}'">Use Scheduled (${fmtDT(scheduledStart)})</button></div>`:'')
    +'<div style="font-size:12px;color:var(--muted)">Adjust if data entry is delayed from actual floor start.</div>'+
    '</div>',
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-success" onclick="doStart(${opId})">▶ Start</button>`
  );
}

async function doStart(opId){
  const dt=document.getElementById('dlg_start')?.value;
  const actualStart=dt?dt.replace('T',' '):null;
  try{
    await api('PUT',`/api/ops/${opId}/status`,{status:'in_progress',actual_start:actualStart});
    toast('Started ▶'); closeModal(); handleRoute();
  }catch(e){toast(e.message,'error');}
}

function promptPause(opId){
  showModal('Pause Operation','<div style="display:grid;gap:12px">'+
    '<div><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">Reason for Pause</label>'+
    '<select id="dlg_pause_reason" style="width:100%">'+
    '<option value="">— Select reason —</option>'+
    '<option value="waiting_material">Waiting for Material</option>'+
    '<option value="machine_down">Machine Down / Maintenance</option>'+
    '<option value="worker_absent">Worker Absent</option>'+
    '<option value="rework">Rework / Quality Issue</option>'+
    '<option value="other">Other</option>'+
    '</select></div>'+
    '<div><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">Notes (optional)</label>'+
    '<input type="text" id="dlg_pause_notes" placeholder="Any additional notes…" style="width:100%"></div>'+
    '</div>',
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-secondary" onclick="doPause(${opId})">⏸ Pause</button>`
  );
}

async function doPause(opId){
  const reason=document.getElementById('dlg_pause_reason')?.value||'';
  const notes=document.getElementById('dlg_pause_notes')?.value||'';
  try{
    await api('PUT',`/api/ops/${opId}/status`,{status:'paused',pause_reason:reason,pause_notes:notes});
    toast('Paused ⏸'); closeModal(); handleRoute();
  }catch(e){toast(e.message,'error');}
}

function promptComplete(opId, actualStart){
  const startLocal=actualStart?isoToLocalInput(actualStart):nowLocalInput();
  const nowLocal=nowLocalInput();
  showModal('Complete Operation','<div style="display:grid;gap:12px">'+
    '<div><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">Actual Start Time</label>'+
    `<input type="datetime-local" id="dlg_cstart" value="${startLocal.replace(' ','T')}" style="width:100%"></div>`+
    '<div><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">Actual End Time</label>'+
    `<input type="datetime-local" id="dlg_cend" value="${nowLocal.replace(' ','T')}" style="width:100%"></div>`+
    '<div style="font-size:12px;color:var(--muted)">Adjust times if data entry is delayed from actual floor completion.</div>'+
    '</div>',
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" onclick="doComplete(${opId})">✓ Mark Complete</button>`
  );
}

async function doComplete(opId){
  const cs=document.getElementById('dlg_cstart')?.value;
  const ce=document.getElementById('dlg_cend')?.value;
  try{
    await api('PUT',`/api/ops/${opId}/status`,{
      status:'completed',
      actual_start:cs?cs.replace('T',' '):null,
      actual_end:ce?ce.replace('T',' '):null
    });
    toast('Completed ✓'); closeModal(); handleRoute();
  }catch(e){toast(e.message,'error');}
}

async function updateOpStatus(opId,status){
  // Legacy fast-path for Gantt and job detail — no manual time dialog
  try{await api('PUT',`/api/ops/${opId}/status`,{status});toast(status==='completed'?'Marked complete ✓':status==='in_progress'?'Started ▶':'Updated');handleRoute();}
  catch(e){toast(e.message,'error')}
}

// ── UPCOMING ──
