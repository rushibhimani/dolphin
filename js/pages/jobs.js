/**
 * Dolphin ERP — Jobs
 */

async function renderJobs(){
  await loadAll();
  _jobSel = new Set(); // reset selection on page load
  // Load next-op data in background
  api('GET','/api/jobs/next-ops').then(d=>{ jobNextOps=d||{}; renderJobsTable(); }).catch(()=>{});

  document.getElementById('topbarActions').innerHTML=`
    <button class="btn btn-secondary" onclick="scheduleAll()">⚡ Schedule All</button>
    <button class="btn btn-primary" onclick="navigate('/jobs/new')">+ New Job</button>`;

  renderJobsTable();
}

function renderJobsTable(){
  const sorted=[...allJobs].sort((a,b)=>a.critical_ratio-b.critical_ratio);

  // Group: orders first (grouped), then standalone
  const orderGroups = {};
  const standalone  = [];
  sorted.forEach(j=>{
    if(j.order_id){
      if(!orderGroups[j.order_id]) orderGroups[j.order_id]=[];
      orderGroups[j.order_id].push(j);
    } else { standalone.push(j); }
  });

  // Status filter
  const sf = document.getElementById('jobStatusFilter')?.value || '';
  const tf = (document.getElementById('jobTextFilter')?.value || '').toLowerCase();

  function matchJob(j){
    if(sf && j.status !== sf) return false;
    if(tf && !`${j.job_number} ${j.customer_name} ${j.product_type} ${j.product_size}`.toLowerCase().includes(tf)) return false;
    return true;
  }

  let html = `<div class="card">
    <div class="card-hdr" style="flex-wrap:wrap;gap:8px">
      <div class="card-title">Jobs (${allJobs.length})</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select id="jobStatusFilter" onchange="renderJobsTable()" style="width:130px">
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="scheduled">Scheduled</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
        </select>
        <input id="jobTextFilter" placeholder="Search…" oninput="renderJobsTable()" style="width:180px">
        <label style="font-size:12px;display:flex;align-items:center;gap:5px;cursor:pointer">
          <input type="checkbox" id="jobGroupToggle" onchange="renderJobsTable()" ${jobGroupByOrder?'checked':''}> Group by Order
        </label>
      </div>
    </div>
    <!-- Bulk action bar -->
    <div id="jobBulkBar" style="display:none;background:var(--accent-soft);border-top:1px solid var(--accent);padding:8px 14px;align-items:center;gap:10px;flex-wrap:wrap">
      <span id="jobBulkCount" style="font-size:13px;font-weight:600"></span>
      <button class="btn btn-secondary" style="font-size:12px" onclick="bulkScheduleJobs()">⚡ Schedule Selected</button>
      <button class="btn btn-danger"    style="font-size:12px" onclick="bulkDeleteJobs()">🗑 Delete Selected</button>
      <button class="btn btn-ghost"     style="font-size:12px;margin-left:auto" onclick="clearJobSel()">✕ Clear</button>
    </div>`;

  const doGroup = document.getElementById('jobGroupToggle')?.checked ?? jobGroupByOrder;
  jobGroupByOrder = doGroup;

  if(doGroup){
    // Render order groups
    Object.entries(orderGroups).forEach(([ordId, pieces])=>{
      const visiblePieces = pieces.filter(matchJob);
      if(!visiblePieces.length) return;
      const order = allOrders.find(o=>o.id==ordId);
      const done  = pieces.filter(p=>p.status==='completed').length;
      const pct   = Math.round(done/pieces.length*100);
      const lastFinish = pieces.map(p=>p.scheduled_finish).filter(Boolean).sort().pop();
      const anyLate = pieces.some(p=>p.is_late);
      html += `<div style="margin-bottom:6px">
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px 8px 0 0;padding:8px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span class="mono" style="color:var(--accent);font-weight:600;font-size:13px">${order?.order_number||'ORD-?'}</span>
          <span style="font-size:12px;color:var(--muted)">${pieces[0]?.customer_name} · ${pieces[0]?.product_type} · ${pieces.length} pcs</span>
          <div class="prog-bar" style="width:80px;flex-shrink:0"><div class="prog-fill" style="width:${pct}%"></div></div>
          <span style="font-size:11px;color:var(--muted)">${done}/${pieces.length} done</span>
          ${lastFinish?`<span style="font-size:11px;color:${anyLate?'var(--red)':'var(--muted)'}">Finish: ${fmtD(lastFinish)}${anyLate?' ⚠':''}</span>`:''}
          <button class="btn btn-ghost" style="font-size:11px;margin-left:auto" onclick="bulkOverrideOrder(${ordId})">✏ Edit All Times</button>
        </div>
        ${visiblePieces.map(j=>jobRowHTML(j,true)).join('')}
      </div>`;
    });
    // Standalone
    const visSA = standalone.filter(matchJob);
    if(visSA.length){
      if(Object.keys(orderGroups).length) html+=`<div style="font-size:11px;color:var(--muted);margin:12px 0 6px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Standalone Jobs</div>`;
      visSA.forEach(j=>{ html+=jobRowHTML(j,false); });
    }
  } else {
    sorted.filter(matchJob).forEach(j=>{ html+=jobRowHTML(j,false); });
  }

  if(!allJobs.filter(matchJob).length){
    html+=`<div class="empty">No jobs match the filter.</div>`;
  }
  html+='</div>';
  document.getElementById('content').innerHTML=html;
  if(expandedJobId) setTimeout(()=>expandJob(expandedJobId,true),80);
}

let jobGroupByOrder = true;
let _jobSel = new Set();

function _syncJobBulkBar(){
  const bar = document.getElementById('jobBulkBar');
  const cnt = document.getElementById('jobBulkCount');
  if(!bar) return;
  bar.style.display = _jobSel.size > 0 ? 'flex' : 'none';
  if(cnt) cnt.textContent = `${_jobSel.size} job${_jobSel.size===1?'':'s'} selected`;
}
function toggleJobSel(id, checked){
  if(checked) _jobSel.add(id); else _jobSel.delete(id);
  _syncJobBulkBar();
}
function clearJobSel(){ _jobSel.clear(); _syncJobBulkBar(); }

async function bulkScheduleJobs(){
  if(!_jobSel.size) return;
  try{
    const r = await api('POST','/api/jobs/bulk-schedule',{ids:[..._jobSel]});
    toast(`Scheduled ${r.scheduled} jobs${r.failed?` · ${r.failed} failed`:''}`);
    clearJobSel(); await loadAll(); renderJobsTable();
  }catch(e){ toast(e.message,'error'); }
}
async function bulkDeleteJobs(){
  if(!_jobSel.size) return;
  const ok = await confirm2(`Delete ${_jobSel.size} job${_jobSel.size===1?'':'s'}?`, 'Delete Jobs');
  if(!ok) return;
  try{
    const r = await api('POST','/api/jobs/bulk-delete',{ids:[..._jobSel]});
    toast(`Deleted ${r.deleted} job${r.deleted===1?'':'s'}${r.skipped?` · ${r.skipped} skipped (in progress)`:''}`);
    clearJobSel(); await loadAll(); renderJobsTable();
  }catch(e){ toast(e.message,'error'); }
}

function jobRowHTML(j, inGroup=false){
  const pct = j.ops_total ? Math.round(j.ops_done/j.ops_total*100) : 0;
  const nxt = jobNextOps[j.id];
  const nextOpHtml = nxt
    ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">
        ${nxt.status==='in_progress'?'▶':'⏱'} <span style="color:var(--accent)">${nxt.op_name}</span> · ${nxt.wc_name}${nxt.scheduled_start?' · '+fmtDT(nxt.scheduled_start):''}
       </div>`
    : '';
  const blockHtml = j.status==='paused' ? `<span title="Paused" style="color:var(--amber)">⏸</span>` :
                    (j.ops_total>0 && j.ops_done<j.ops_total && !nxt && j.status!=='completed') ? `<span title="Unscheduled ops" style="color:var(--orange)">⚠</span>` : '';

  const radius = inGroup ? '0' : '8px';
  return `<div id="jblock_${j.id}" style="border:1px solid var(--border);border-radius:${radius};margin-bottom:${inGroup?'0':'8px'};background:var(--card);${inGroup?'border-top:none;border-radius:0;':''}">
    <div class="job-main-row" id="jrow_${j.id}" style="cursor:pointer;padding:10px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <input type="checkbox" id="jchk_${j.id}" ${_jobSel.has(j.id)?'checked':''}
        onchange="toggleJobSel(${j.id},this.checked);event.stopPropagation()"
        style="width:14px;height:14px;accent-color:var(--accent);cursor:pointer;flex-shrink:0">
      <svg class="expand-icon" id="jicon_${j.id}" fill="none" stroke="currentColor" viewBox="0 0 24 24" onclick="expandJob(${j.id})" style="width:14px;height:14px;flex-shrink:0;transition:transform .15s"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>

      <div style="flex:0 0 110px;min-width:0" onclick="expandJob(${j.id})">
        <div class="mono" style="font-size:12px;font-weight:600">${j.job_number}</div>
        ${j.is_frozen?'<span class="badge" style="background:var(--blue-soft,#dbeafe);color:var(--blue,#1d4ed8);margin-left:4px" title="Frozen — schedule intact, excluded from Schedule All">🔒 Frozen</span>':""}
        ${j.is_on_hold?'<span class="badge" style="background:#fff7ed;color:var(--amber);margin-left:4px" title="On Hold — schedule cleared, waiting for manual release">⏸ Hold</span>':""}
        ${j.piece_number?`<div style="font-size:10px;color:var(--muted)">Piece ${j.piece_number}</div>`:''}
      </div>

      ${inGroup?'':`<div style="flex:1 1 120px;min-width:0;font-size:12px">${j.customer_name}</div>`}

      <div style="flex:1 1 140px;min-width:0">
        <div style="font-size:12px;font-weight:500">${j.product_type} ${j.product_size||''}</div>
        ${nextOpHtml}
      </div>

      <div style="flex:0 0 80px;text-align:center">
        <div class="mono" style="font-size:11px;color:var(--muted)">Due</div>
        <div class="mono" style="font-size:12px">${fmtD(j.due_date)}</div>
      </div>

      <div style="flex:0 0 90px;text-align:center">
        <div class="mono" style="font-size:11px;color:var(--muted)">Finish</div>
        <div class="mono" style="font-size:12px;color:${j.is_late?'var(--red)':j.scheduled_finish?'var(--text)':'var(--muted)'}">${j.scheduled_finish?fmtD(j.scheduled_finish):'—'}${j.is_late?' ⚠':''}</div>
      </div>

      <div style="flex:0 0 70px">${sBadge(j.status)} ${blockHtml}</div>

      <div style="flex:0 0 90px">${crBar(j.critical_ratio)}</div>

      <div style="flex:0 0 100px">
        <div style="font-size:10px;color:var(--muted);margin-bottom:2px">${j.ops_done}/${j.ops_total} ops</div>
        <div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div>
      </div>

      <div style="flex:0 0 auto;display:flex;gap:5px;flex-wrap:wrap" onclick="event.stopPropagation()">
        ${j.priority_flag?'':'<button class="btn btn-danger btn-icon" title="Mark Urgent" onclick="setUrgent('+j.id+')">🚨</button>'}
        ${j.is_on_hold
          ? `<button class="btn btn-secondary" style="font-size:11px;padding:3px 8px;color:var(--amber)" title="Job on hold — schedule cleared. Click to release and allow rescheduling." onclick="unholdJob(${j.id})">⏸ On Hold</button>`
          : `<button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" title="Hold job — clears the schedule and pauses it until manually released." onclick="holdJob(${j.id})">Hold</button>`
        }
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;${j.is_frozen?'color:var(--blue,#1d4ed8);font-weight:600':''}" title="${j.is_frozen?'Job is frozen — excluded from Schedule All. Click to unfreeze.':'Freeze job — keeps current schedule intact but excludes it from Schedule All.'}" onclick="toggleFreeze(${j.id})">${j.is_frozen?'🔒 Frozen':'🔒 Freeze'}</button>
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="navigate('/jobs/${j.id}')">Edit</button>
        <button class="btn btn-ghost btn-icon" title="Duplicate" onclick="duplicateJob(${j.id})">⧉</button>
        ${j.status==='pending'&&!j.is_frozen&&!j.is_on_hold?`<button class="btn btn-secondary" style="font-size:11px;padding:3px 8px" onclick="scheduleJob(${j.id})">Schedule</button>`:''}
        <button class="btn btn-danger btn-icon" title="Delete" onclick="delJob(${j.id})">✕</button>
      </div>
    </div>
    <div class="job-detail-panel" id="jpanel_${j.id}" onclick="expandJob(${j.id},true)"></div>
  </div>`;
}

async function expandJob(id,keepOpen=false){
  const panel=document.getElementById(`jpanel_${id}`);
  const icon=document.getElementById(`jicon_${id}`);
  if(!panel||!icon) return;
  if(panel.classList.contains('open')&&!keepOpen){
    panel.classList.remove('open');icon.style.transform='';expandedJobId=null;return;
  }
  document.querySelectorAll('.job-detail-panel.open').forEach(p=>p.classList.remove('open'));
  document.querySelectorAll('.expand-icon').forEach(i=>i.style.transform='');
  panel.innerHTML=`<div style="color:var(--muted);font-size:12px;padding:8px 14px">Loading...</div>`;
  panel.classList.add('open');icon.style.transform='rotate(90deg)';expandedJobId=id;
  const j=await api('GET',`/api/jobs/${id}`);
  const ops=j.scheduled_ops||[];
  panel.innerHTML=`
    <div class="detail-grid">
      <div class="detail-item"><div class="dl">PO Number</div><div class="dv mono" style="font-size:12px">${j.po_number||'—'}</div></div>
      <div class="detail-item"><div class="dl">Size / Variant</div><div class="dv" style="font-size:12px">${j.product_size}${j.product_variant?' · '+j.product_variant:''}</div></div>
      <div class="detail-item"><div class="dl">Est. Finish</div><div class="dv mono" style="font-size:12px;color:${j.is_late?'var(--red)':'inherit'}">${fmtD(j.scheduled_finish)||'—'}${j.is_late?' ⚠':''}</div></div>
      <div class="detail-item"><div class="dl">Material Ready</div><div class="dv mono" style="font-size:12px">${j.material_ready_date?fmtD(j.material_ready_date):'Immediate'}</div></div>
      <div class="detail-item"><div class="dl">Not Before</div><div class="dv mono" style="font-size:12px">${j.not_before?fmtDT(j.not_before):'—'}</div></div>
      <div class="detail-item"><div class="dl">Created</div><div class="dv mono" style="font-size:12px">${fmtD(j.created_at)}</div></div>
      <div class="detail-item"><div class="dl">Total Price</div><div class="dv mono" style="font-size:13px;color:var(--green);font-weight:500">${fmtINR(j.total_price)}</div></div>
      ${j.notes?`<div class="detail-item" style="grid-column:1/-1"><div class="dl">Notes</div><div class="dv" style="font-size:12px;color:var(--muted)">${j.notes}</div></div>`:''}
    </div>
    ${j.is_late?`<div class="warn-box">⚠ Scheduled finish <strong>${fmtD(j.scheduled_finish)}</strong> is after due date <strong>${fmtD(j.due_date)}</strong></div>`:''}
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:8px">Operations</div>
    <div class="ops-timeline">
    ${ops.length?ops.map(op=>{
      const cls=op.status==='in_progress'?'op-line inprog':op.status==='completed'?'op-line done':op.status==='paused'?'op-line paused':'op-line';
      return`<div class="${cls}">
        <span class="mono" style="font-size:11px;color:var(--muted)">${op.sequence}</span>
        <span style="font-size:12px;font-weight:500">${op.op_name}</span>
        <span style="font-size:11px;color:var(--muted);font-family:var(--mono)">${op.wc_name} · ${op.worker_name?'👷 '+op.worker_name:'<span style=\'color:var(--orange)\'>⚠ No worker</span>'} · ${fmtSetup(op.setup_time_mins)} setup · ${fmtWork(op.work_time_mins!=null?op.work_time_mins:(op.work_time_hrs||0)*60)} work${op.setup_waived?' <span style=\'color:var(--green);font-size:10px\'>(machine setup waived)</span>':''}</span>
        <span style="font-size:11px;color:var(--muted);font-family:var(--mono)">${op.scheduled_start?fmtDT(op.scheduled_start)+' → '+fmtDT(op.scheduled_end):'Not scheduled'}</span>
        <span>${sBadge(op.status)}</span>
        <span style="display:flex;gap:4px">
          ${op.status==='scheduled'?`<button class="btn btn-success" style="font-size:11px;padding:3px 7px" onclick="promptStart(${op.id},'${op.scheduled_start||''}')" title="Start">▶ Start</button>`:''}
          ${op.status==='in_progress'?`
            <button class="btn btn-secondary" style="font-size:11px;padding:3px 7px" onclick="promptPause(${op.id})" title="Pause">⏸ Pause</button>
            <button class="btn btn-primary" style="font-size:11px;padding:3px 7px" onclick="promptComplete(${op.id},'${op.actual_start||''}')" title="Complete">✓ Done</button>`:''}
          ${op.status==='paused'?`<button class="btn btn-success" style="font-size:11px;padding:3px 7px" onclick="promptStart(${op.id},'${op.scheduled_start||''}')" title="Resume">▶ Resume</button>`:''}
        </span>
      </div>`;
    }).join(''):`<div style="color:var(--muted);font-size:12px;padding:8px 0">No operations scheduled yet</div>`}
    </div>`;
}

function filterJobsText(q){renderJobsTable();}
function filterJobsStatus(s){renderJobsTable();}

async function duplicateJob(id){
  try{
    const r=await api('POST',`/api/jobs/${id}/duplicate`);
    toast(`Duplicated as ${r.job_number}`);
    await loadAll(); navigate('/jobs');
  }catch(e){toast(e.message,'error')}
}

async function scheduleJob(id){try{await api('POST',`/api/schedule/${id}`);toast('Scheduled!');await loadAll();navigate('/jobs')}catch(e){toast(e.message,'error')}}
async function setUrgent(id){try{await api('PUT',`/api/jobs/${id}`,{priority_flag:true});toast('Marked urgent!');await loadAll();navigate('/jobs')}catch(e){toast(e.message,'error')}}
async function holdJob(id) {
  const j = (allJobs||[]).find(x=>x.id===id);
  const name = j ? j.job_number : `Job #${id}`;
  const ok = await confirm2(
    `Put ${name} on hold?

This will:
• Clear all pending/scheduled ops from the Gantt
• Pause the job until you manually release it
• Job stays in the system — unhold it to reschedule

Note: Freeze keeps schedule intact but skips Schedule All.`,
    'Put on Hold'
  );
  if (!ok) return;
  try {
    await api('POST', `/api/jobs/${id}/hold`);
    toast('Job put on hold — release it when ready to reschedule');
    await loadAll(); renderJobsTable();
  } catch(e) { toast(e.message,'error'); }
}

async function unholdJob(id) {
  try {
    await api('POST', `/api/jobs/${id}/unhold`);
    toast('Job released — run Schedule All to reschedule it');
    await loadAll(); renderJobsTable();
  } catch(e) { toast(e.message,'error'); }
}

async function toggleFreeze(id){
  try{
    const r=await api('POST',`/api/jobs/${id}/toggle-freeze`);
    toast(r.is_frozen?'🔒 Job frozen — will be skipped by Schedule All':'🔓 Job unfrozen — will be included in Schedule All');
    await loadAll();navigate('/jobs');
  }catch(e){toast(e.message,'error')}
}
async function delJob(id){
  const ok=await confirm2('Delete this job? This cannot be undone.');if(!ok)return;
  try{await api('DELETE',`/api/jobs/${id}`);toast('Deleted');await loadAll();navigate('/jobs')}catch(e){toast(e.message,'error')}
}

// ── JOB FORM with full validation ──
async function openJobModal(editId){
  await loadAll();
  let editJob = null;
  if(editId){ editJob = await api('GET', `/api/jobs/${editId}`); }

  const nb  = new Date(istNow().getTime() + 30*60000);
  const defNB  = nb.toISOString().slice(0,16);
  const defDue = new Date(istNow().getTime() + 7*86400000).toISOString().slice(0,16);
  const PTYPES = ['Punch','Die Frame','Liner Set','Complete Mould','Custom Plate',
                  'Base Plate','Ejector Plate','Addon Plate','SFS Lower','SFS Upper'];

  // Pre-load ops for edit
  if(editJob?.routing_id){
    const rt = allRoutings.find(r=>r.id===editJob.routing_id);
    if(rt){
      let ovMap = {};
      const rawOv = typeof editJob.op_overrides==='string' ? editJob.op_overrides : '[]';
      try{ JSON.parse(rawOv).forEach(o=>ovMap[o.operation_id]=o); }catch{}
      jobFormOps = rt.operations.map(op=>({
        operation_id: op.id, name: op.name, wc_name: op.work_center_name,
        machine_type: op.machine_type||'',
        work_center_id: op.work_center_id,
        setup_time_mins: ovMap[op.id]?.setup_time_mins ?? op.setup_time_mins,
        work_time_mins: ovMap[op.id]?.work_time_mins ?? (op.work_time_mins!=null?op.work_time_mins:(op.work_time_hrs||0)*60),
        work_time_hrs:  ovMap[op.id]?.work_time_hrs   ?? op.work_time_hrs,
        is_optional: op.is_optional,
        included: ovMap[op.id]?.included ?? true
      }));
    }
  } else { jobFormOps = []; }

  // Build customer options
  const custOpts = allCustomers.map(c=>
    `<option value="${c.id}" ${editJob?.customer_id==c.id?'selected':''}>${c.name}</option>`
  ).join('');

  // Build routing options filtered by product type
  const curPtype = editJob?.product_type || 'Punch';
  // Show all routings; filterRoutingsByType will narrow when product type changes
  const routingOpts = allRoutings
    .map(r=>`<option value="${r.id}" ${editJob?.routing_id==r.id?'selected':''}>${r.name} (${r.product_type})</option>`)
    .join('');

  showModal(editJob ? `Edit — ${editJob.job_number}` : 'New Job', `

    <div class="form-section">Customer & Pricing</div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Customer <span style="color:var(--red)">*</span></div>
        <select id="f_cust_id" onchange="onCustomerChange()">
          <option value="">— Select customer —</option>
          ${custOpts}
          <option value="__new__">+ Add new customer...</option>
        </select>
        <input id="f_cust" value="${editJob?.customer_name&&!editJob?.customer_id?editJob.customer_name:''}"
          placeholder="Type new customer name"
          style="margin-top:6px;display:${(editJob?.customer_name&&!editJob?.customer_id)?'block':'none'}">
        <div class="field-err" id="f_cust_err"></div>
      </div>
      <div class="form-group">
        <div class="fld-label">Total Price (₹)</div>
        <input id="f_price" type="number" min="0" step="100"
          value="${editJob?.total_price||''}" placeholder="e.g. 50000">
      </div>
    </div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Job Number <span style="color:var(--muted);font-weight:400;font-size:10px">(blank = auto)</span></div>
        <input id="f_jobnum" value="${editJob?.job_number||''}" placeholder="Auto: DL-2026-001">
        <div class="field-err" id="f_jobnum_err"></div>
      </div>
      <div class="form-group">
        <div class="fld-label">PO Number</div>
        <input id="f_po" value="${editJob?.po_number||''}" placeholder="Customer PO reference">
      </div>
    </div>

    <div class="form-section">Product Details</div>
    <div class="form-row cols-3">
      <div class="form-group">
        <div class="fld-label">Product Type <span style="color:var(--red)">*</span></div>
        <select id="f_ptype" onchange="filterRoutingsByType(this.value)">
          ${PTYPES.map(p=>`<option ${curPtype===p?'selected':''}>${p}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <div class="fld-label">Size <span style="color:var(--red)">*</span></div>
        <input id="f_size" value="${editJob?.product_size||''}" placeholder="600x600">
        <div class="field-err" id="f_size_err"></div>
      </div>
      <div class="form-group">
        <div class="fld-label">Variant / Type</div>
        <input id="f_variant" value="${editJob?.product_variant||''}" placeholder="Plain, Carbide...">
      </div>
    </div>
    <div class="form-row cols-1">
      <div class="form-group">
        <div class="fld-label">Routing Template <span style="color:var(--red)">*</span></div>
        <select id="f_routing" onchange="loadJobOps()">
          <option value="">— Select a routing template —</option>
          ${routingOpts}
        </select>
        <div class="field-err" id="f_routing_err"></div>
      </div>
    </div>
    <label class="checkbox-row">
      <input type="checkbox" id="f_urgent" ${editJob?.priority_flag?'checked':''}>
      🚨 Mark as Emergency / Priority Job
    </label>

    <div class="form-section" style="margin-top:14px">Scheduling</div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Due Date <span style="color:var(--red)">*</span></div>
        ${makeDTField('f_due_d','f_due_t', editJob?.due_date||defDue, true)}
        <div class="field-err" id="f_due_err"></div>
      </div>
      <div class="form-group">
        <div class="fld-label">Not Before (IST)</div>
        ${makeDTField('f_nb_d','f_nb_t', editJob?.not_before||defNB, false)}
        <div class="field-err" id="f_nb_err"></div>
      </div>
    </div>
    <div class="form-row cols-1">
      <div class="form-group">
        <div class="fld-label">Material Ready Date (IST)</div>
        ${makeDTField('f_mat_d','f_mat_t', editJob?.material_ready_date||'', false)}
      </div>
    </div>
    <div class="info-hint">⏱ <strong>Not Before</strong> = earliest operations can start. <strong>Material date</strong> auto-fills from routing lead time.</div>

    <div class="form-section" style="margin-top:14px">Notes</div>
    <div class="form-row cols-1">
      <textarea id="f_notes" placeholder="Special instructions, material details...">${editJob?.notes||''}</textarea>
    </div>

    <div class="form-section" style="margin-top:14px">
      Operations <small style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">(override times for this job)</small>
    </div>
    <div id="jobOpsWrap">
      ${jobFormOps.length ? '' : '<div style="color:var(--muted);font-size:12px;padding:4px 0">Select a routing template above to configure operations</div>'}
    </div>
  `,
  `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
   <button class="btn btn-primary" id="saveJobBtn" onclick="saveJob(${editId||'null'})">${editJob?'Save Changes':'Create Job'}</button>`,
  true);

  setTimeout(()=>{
    // Job number uniqueness check
    const jnEl = document.getElementById('f_jobnum');
    if(jnEl){
      jnEl.addEventListener('blur', async()=>{
        const val = jnEl.value.trim();
        const errEl = document.getElementById('f_jobnum_err');
        if(!val || (editJob && val===editJob.job_number)){ if(errEl) errEl.classList.remove('show'); return; }
        try{
          const r = await api('GET',`/api/check-job-number/${encodeURIComponent(val)}`);
          if(r.exists){
            jnEl.classList.add('invalid');
            if(errEl){errEl.textContent=`"${val}" already exists`;errEl.classList.add('show');}
          } else {
            jnEl.classList.remove('invalid'); jnEl.classList.add('valid');
            if(errEl) errEl.classList.remove('show');
          }
        }catch{}
      });
    }
    attachValidation('f_size', [{test:v=>v.length>0, msg:'Size is required'}], 'f_size_err');
    // Validate due date from split fields
document.getElementById('f_due_d')?.addEventListener('change',()=>{
  const errEl=document.getElementById('f_due_err');
  const val=document.getElementById('f_due_d')?.value;
  if(!val&&errEl){errEl.textContent='Due date is required';errEl.classList.add('show');}
  else if(errEl) errEl.classList.remove('show');
});
    attachValidation('f_routing', [{test:v=>v&&v!=='', msg:'Select a routing template'}], 'f_routing_err');
    // nb validated on save

    if(jobFormOps.length) renderJobOpsTable();
  }, 50);

}

function onCustomerChange(){
  const sel = document.getElementById('f_cust_id');
  const txt = document.getElementById('f_cust');
  if(!sel || !txt) return;
  if(sel.value === '__new__'){
    txt.style.display = 'block';
    txt.value = '';
    txt.placeholder = 'Type new customer name';
    txt.focus();
  } else {
    txt.style.display = 'none';
    txt.value = sel.value ? (allCustomers.find(c=>c.id==sel.value)?.name||'') : '';
  }
}

function filterRoutingsByType(ptype){
  const sel = document.getElementById('f_routing');
  if(!sel) return;
  const cur = sel.value;
  const filtered = ptype
    ? allRoutings.filter(r=>r.product_type===ptype)
    : allRoutings;
  // If no routings match this product type, show all routings
  const toShow = filtered.length > 0 ? filtered : allRoutings;
  sel.innerHTML = '<option value="">— Select a routing template —</option>' +
    toShow.map(r=>`<option value="${r.id}"${r.id==cur?' selected':''}>${r.name} (${r.product_type})</option>`).join('');
  if(!toShow.find(r=>r.id==cur)){
    sel.value=''; jobFormOps=[];
    const w=document.getElementById('jobOpsWrap');
    if(w) w.innerHTML='<div style="color:var(--muted);font-size:12px;padding:4px 0">Select a routing template above</div>';
  }
}

async function loadJobOps(){
  const rid=parseInt(document.getElementById('f_routing')?.value);
  if(!rid){document.getElementById('jobOpsWrap').innerHTML='<div style="color:var(--muted);font-size:12px;padding:4px 0">Select a routing template</div>';return;}
  const rt=await api('GET',`/api/routings/${rid}`);
  if(!rt.operations.length){
    document.getElementById('jobOpsWrap').innerHTML='<div style="color:var(--red);font-size:12px;padding:7px 10px;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);border-radius:5px">⚠ This routing has no operations. Add operations to the routing first.</div>';
    jobFormOps=[];return;
  }
  const matEl=document.getElementById('f_mat');
  if(matEl&&!matEl.value&&rt.material_lead_days){
    const md=new Date(istNow().getTime()+(rt.material_lead_days*86400000));
    matEl.value=md.toISOString().slice(0,16);
  }
  jobFormOps=rt.operations.map(op=>({
    operation_id:op.id,name:op.name,wc_name:op.work_center_name,machine_type:op.machine_type||'',
    work_center_id:op.work_center_id,
    setup_time_mins:op.setup_time_mins,
    work_time_mins:op.work_time_mins!=null?op.work_time_mins:(op.work_time_hrs||0)*60,
    work_time_hrs:op.work_time_hrs,
    is_optional:op.is_optional,included:true
  }));
  renderJobOpsTable();
}

function renderJobOpsTable(){
  if(!jobFormOps.length){document.getElementById('jobOpsWrap').innerHTML='<div style="color:var(--muted);font-size:12px">No operations</div>';return;}
  const unit=timeUnitLabel();
  const rows=jobFormOps.map((op,i)=>{
    // work_time_mins is canonical; fall back to hrs*60
    const wMins=op.work_time_mins!=null?op.work_time_mins:((op.work_time_hrs||0)*60);
    const sMins=op.setup_time_mins||0;
    const totMins=sMins+wMins;
    return `
    <tr id="opovrow_${i}" class="${op.included?'':'excluded'}">
      <td><input type="checkbox" id="opchk_${i}" ${op.included?'checked':''} onchange="toggleOp(${i},this.checked)" style="width:14px;height:14px;accent-color:var(--accent)"></td>
      <td class="mono" style="color:var(--muted);text-align:center">${i+1}</td>
      <td style="font-weight:500">${op.name}${op.is_optional?' <span style="font-size:10px;color:var(--muted)">(opt)</span>':''}</td>
      <td style="color:var(--muted);font-family:var(--mono);font-size:11px">${op.wc_name}</td>
      <td><input type="number" id="opsetup_${i}" value="${Math.round(sMins)}" min="0" step="5" onchange="recalcOp(${i})" ${op.included?'':'disabled'} title="Setup time in minutes"></td>
      <td><input type="number" id="opwork_${i}" value="${Math.round(wMins)}" min="0" step="10" onchange="recalcOp(${i})" ${op.included?'':'disabled'} title="Work time in minutes"></td>
      <td id="optot_${i}" class="mono" style="color:var(--muted);text-align:right">${fmtTotal(totMins)}</td>
    </tr>`;
  }).join('');
  document.getElementById('jobOpsWrap').innerHTML=`
    <table class="op-ov-table">
      <thead><tr><th>✓</th><th>#</th><th>Operation</th><th>Machine</th><th>Setup (min)</th><th>Work (min)</th><th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="5" style="padding:7px 8px;font-size:11px;color:var(--muted)">Total working time:</td>
      <td colspan="2" id="opGrandTot" class="mono" style="font-size:12px;font-weight:600;padding:7px 8px;color:var(--text)"></td></tr></tfoot>
    </table>
    <div style="margin-top:10px">
      <button class="btn btn-ghost" style="font-size:12px" onclick="promptSaveAsRouting()" title="Save these operations as a reusable routing template">💾 Save as Routing Template</button>
    </div>`;
  updateGrandTotal();
}

function toggleOp(i,checked){
  jobFormOps[i].included=checked;
  document.getElementById(`opovrow_${i}`).className=checked?'':'excluded';
  [`opsetup_${i}`,`opwork_${i}`].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=!checked;});
  updateGrandTotal();
}
function recalcOp(i){
  const s=parseFloat(document.getElementById(`opsetup_${i}`)?.value)||0;
  const w=parseFloat(document.getElementById(`opwork_${i}`)?.value)||0;
  // both s and w are in MINUTES
  jobFormOps[i].setup_time_mins=s;
  jobFormOps[i].work_time_mins=w;
  jobFormOps[i].work_time_hrs=w/60;
  const el=document.getElementById(`optot_${i}`);if(el)el.textContent=fmtTotal(s+w);
  updateGrandTotal();
}
function updateGrandTotal(){
  const tot=jobFormOps.filter(o=>o.included).reduce((s,o,i)=>{
    const sv=parseFloat(document.getElementById(`opsetup_${i}`)?.value)??o.setup_time_mins;
    const wv=parseFloat(document.getElementById(`opwork_${i}`)?.value)??(o.work_time_mins!=null?o.work_time_mins:(o.work_time_hrs||0)*60);
    return s+sv+wv; // both in minutes
  },0);
  const el=document.getElementById('opGrandTot');
  if(el) el.textContent=`${fmtTotal(tot)} ≈ ${(tot/600).toFixed(1)} days`;
}

async function saveJob(editId){
  // Run all validations first
  const fieldIds=['f_cust','f_due','f_size','f_routing','f_nb'];
  const valid=validateAll(fieldIds);
  // Also check job number async uniqueness
  const jnEl=document.getElementById('f_jobnum');
  if(jnEl?.classList.contains('invalid')){
    toast('Fix the job number — it already exists','error');return;
  }
  if(!valid){
    toast('Please fix the highlighted fields before saving','error');
    return;
  }
  if(jobFormOps.length===0){toast('Routing has no operations — fix the routing first','error');return;}
  const ovs=jobFormOps.map((op,i)=>({
    operation_id:op.operation_id,
    setup_time_mins:parseFloat(document.getElementById(`opsetup_${i}`)?.value)??op.setup_time_mins,
    work_time_mins:parseFloat(document.getElementById(`opwork_${i}`)?.value)??(op.work_time_mins!=null?op.work_time_mins:(op.work_time_hrs||0)*60),
    work_time_hrs:(parseFloat(document.getElementById(`opwork_${i}`)?.value)??(op.work_time_mins!=null?op.work_time_mins:(op.work_time_hrs||0)*60))/60,
    included:document.getElementById(`opchk_${i}`)?.checked??op.included,
  }));
  const custSel = document.getElementById('f_cust_id');
  const custIdVal = custSel?.value;
  const custIdNum = (custIdVal && custIdVal !== '__new__' && custIdVal !== '') ? parseInt(custIdVal) : null;
  const custNameVal = document.getElementById('f_cust').value.trim();
  const data={
    job_number:document.getElementById('f_jobnum').value.trim()||null,
    po_number:document.getElementById('f_po').value.trim(),
    customer_id: custIdNum,
    customer_name: custNameVal,
    total_price: document.getElementById('f_price').value || null,
    product_type:document.getElementById('f_ptype').value,
    product_size:document.getElementById('f_size').value.trim(),
    product_variant:document.getElementById('f_variant').value.trim(),
    due_date: dtFieldVal('f_due_d','f_due_t'),
    routing_id:parseInt(document.getElementById('f_routing').value)||null,
    priority_flag:document.getElementById('f_urgent').checked,
    notes:document.getElementById('f_notes').value,
    not_before: dtFieldVal('f_nb_d','f_nb_t')||null,
    material_ready_date: dtFieldVal('f_mat_d','f_mat_t')||null,
    op_overrides:ovs,
  };
  setLoading('saveJobBtn',true);
  try{
    if(editId&&editId!=='null') await api('PUT',`/api/jobs/${editId}`,data);
    else await api('POST','/api/jobs',data);
    toast(editId&&editId!=='null'?'Job updated!':'Job created!');
    closeModal();await loadAll();navigate('/jobs');
  }catch(e){
    toast(e.message,'error');
  }finally{
    setLoading('saveJobBtn',false);
  }
}

// ── Save current job ops as a new routing template ──
function promptSaveAsRouting(){
  if(!jobFormOps.length){toast('No operations to save','error');return;}
  const ptype=document.getElementById('f_ptype')?.value||'';
  showModal('Save as Routing Template',
    `<div style="display:grid;gap:12px">
      <div><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">Routing Name <span style="color:var(--red)">*</span></label>
        <input type="text" id="dlg_rname" placeholder="e.g. Punch — Custom 600x1200 Rustic" style="width:100%"></div>
      <div><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">Product Type</label>
        <input type="text" id="dlg_rtype" value="${ptype}" style="width:100%"></div>
      <div><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">Description (optional)</label>
        <input type="text" id="dlg_rdesc" placeholder="Brief description…" style="width:100%"></div>
      <div style="font-size:12px;color:var(--muted)">Will save ${jobFormOps.filter(o=>o.included).length} included operations with their current times.</div>
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" onclick="doSaveAsRouting()">💾 Save Routing</button>`
  );
}

async function doSaveAsRouting(){
  const name=(document.getElementById('dlg_rname')?.value||'').trim();
  if(!name){toast('Routing name is required','error');return;}
  const ptype=(document.getElementById('dlg_rtype')?.value||'').trim();
  const desc=(document.getElementById('dlg_rdesc')?.value||'').trim();
  // Collect current op values from form inputs
  const ops=jobFormOps.map((op,i)=>{
    if(!op.included) return null;
    const sMins=parseFloat(document.getElementById(`opsetup_${i}`)?.value)||op.setup_time_mins||0;
    const wMins=parseFloat(document.getElementById(`opwork_${i}`)?.value)||(op.work_time_mins!=null?op.work_time_mins:(op.work_time_hrs||0)*60);
    return {
      name:op.name,
      work_center_id:op.work_center_id,
      machine_setup_mins:0, job_setup_mins:sMins, setup_time_mins:sMins,
      work_time_mins:wMins, work_time_hrs:wMins/60,
      is_optional:op.is_optional||false,
    };
  }).filter(Boolean);
  try{
    const r=await api('POST','/api/routings',{name,product_type:ptype||'Custom',description:desc,operations:ops,is_active:true});
    toast(`Routing "${r.name}" saved!`);
    closeModal();
    await loadAll(); // refresh routing list
  }catch(e){toast(e.message,'error');}
}

// ── GANTT ──
let ganttData=[],ganttView='machine',ganttFilter='';

function buildGanttShell(){
  // Build the chrome (toolbar + containers) without touching ganttWrap content
  document.getElementById('topbarActions').innerHTML=`<button class="btn btn-secondary" onclick="scheduleAll()">⚡ Reschedule All</button>`;
  document.getElementById('content').innerHTML=`
    <div class="card">
      <div class="card-hdr" style="flex-wrap:wrap;gap:10px">
        <div class="card-title">Gantt Schedule (IST)</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <div style="display:flex;gap:0;border:1px solid var(--border);border-radius:6px;overflow:hidden">
            <button id="gv_machine" class="gantt-view-btn${ganttView==='machine'?' active':''}" onclick="setGanttView('machine')">☰ Machines</button>
            <button id="gv_worker"  class="gantt-view-btn${ganttView==='worker'?' active':''}" onclick="setGanttView('worker')">👷 Workers</button>
            <button id="gv_job"     class="gantt-view-btn${ganttView==='job'?' active':''}" onclick="setGanttView('job')">📋 Jobs</button>
          </div>
          <input id="ganttFilterInput" placeholder="Filter..." oninput="applyGanttFilter(this.value)" value="${ganttFilter}"
            style="width:150px;padding:5px 9px;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);outline:none">
          <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);cursor:pointer">
            <input type="checkbox" id="ganttTodayOnly" onchange="renderGantt(ganttData,ganttView,ganttFilter)" style="accent-color:var(--accent)">
            Today only
          </label>
          <div style="display:flex;gap:8px;font-size:11px;align-items:center;color:var(--muted)">
            <span><span style="display:inline-block;width:8px;height:8px;background:#ef4444;border-radius:2px;margin-right:3px;vertical-align:middle"></span>Late/Urgent</span>
            <span><span style="display:inline-block;width:8px;height:8px;background:#3b82f6;border-radius:2px;margin-right:3px;vertical-align:middle"></span>Scheduled</span>
            <span><span style="display:inline-block;width:8px;height:8px;background:#f59e0b;border-radius:2px;margin-right:3px;vertical-align:middle"></span>In Progress</span>
            <span><span style="display:inline-block;width:8px;height:8px;background:#10b981;border-radius:2px;margin-right:3px;vertical-align:middle"></span>Done</span>
          </div>
        </div>
      </div>
      <div id="ganttOuter" style="display:flex;max-height:600px;background:var(--bg);border-radius:0 0 8px 8px;overflow:hidden">
        <div id="ganttLabels" style="flex-shrink:0;width:210px;overflow:hidden;background:var(--bg);border-right:1px solid var(--border);z-index:10"></div>
        <div id="ganttWrap" style="flex:1;overflow-x:auto;overflow-y:auto;position:relative;background:var(--bg)">
          <div style="padding:40px;text-align:center;color:var(--muted)">Loading...</div>
        </div>
      </div>
    </div>`;
}
