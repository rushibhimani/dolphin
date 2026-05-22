/**
 * Dolphin ERP — Workers
 */

// ── WORKERS ──
async function loadWorkers(){
  // allWorkers now loaded in loadAll() — kept for compatibility
  if(!allWorkers.length) try{ allWorkers = await api('GET','/api/workers'); }catch{}
}

async function renderWorkers(){
  await loadAll(); await loadWorkers();
  document.getElementById('topbarActions').innerHTML=`
    <button class="btn btn-secondary" onclick="showWorkerAvailability()">📅 Availability</button>
    <button class="btn btn-primary" onclick="openWorkerModal()">+ Add Worker</button>`;

  // Today's leave banner
  let todayLeaves = [];
  try{ todayLeaves = await api('GET','/api/leaves/today'); }catch{}

  const leaveBanner = todayLeaves.length ? `
    <div style="background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span style="font-size:12px;font-weight:600;color:var(--red)">⚠ On Leave Today:</span>
      ${todayLeaves.map(l=>`<span class="badge badge-urgent">${l.worker_name} (${l.type})</span>
        <button class="btn btn-danger btn-sm" onclick="markAbsent(${l.worker_id},'${l.worker_name}')">Reassign Ops</button>`).join('')}
    </div>` : '';

  document.getElementById('content').innerHTML = leaveBanner + `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px" id="workersGrid">
      ${allWorkers.length ? allWorkers.map(workerCard).join('') : '<div class="card"><div class="empty">No workers yet. Add workers and assign machine skills.</div></div>'}
    </div>`;
}

function workerCard(w){
  const statusCol = w.is_active ? 'var(--green)' : 'var(--muted)';
  return `<div class="card">
    <div class="card-hdr">
      <div>
        <div style="font-weight:600;margin-bottom:2px">${w.name}</div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${w.code?`<span style="font-family:var(--mono);font-size:11px;background:rgba(245,158,11,.12);color:var(--accent);padding:1px 6px;border-radius:4px">${w.code}</span>`:''}
          <span style="font-size:11px;color:var(--muted)">${w.role||'Operator'}${w.phone?' · '+w.phone:''}</span>
        </div>
      </div>
      <div style="display:flex;gap:5px;align-items:center">
        <span class="badge" style="background:${w.is_active?'rgba(16,185,129,.12)':'rgba(107,116,138,.15)'};color:${statusCol}">${w.is_active?'Active':'Inactive'}</span>
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 7px" onclick="openWorkerModal(${w.id})">Edit</button>
      </div>
    </div>
    <div class="card-body" style="padding:12px 16px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:6px">Machine Skills</div>
      ${w.skill_names.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px">
        ${w.skill_names.map(s=>`<span style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;font-family:var(--mono)">${s}</span>`).join('')}
      </div>` : `<div style="font-size:11px;color:var(--red);margin-bottom:12px">⚠ No skills assigned</div>`}
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">
        ${w.skill_names.length===0?'<span style="color:var(--red)">⚠ No machine skills assigned</span>':''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-secondary" style="font-size:11px;padding:4px 8px" onclick="openLeaveModal(${w.id},'${w.name}')">+ Add Leave</button>
        <button class="btn btn-secondary" style="font-size:11px;padding:4px 8px" onclick="viewWorkerLeaves(${w.id},'${w.name}')">View Leaves</button>
        ${w.is_active?`<button class="btn btn-danger" style="font-size:11px;padding:4px 8px" onclick="markAbsent(${w.id},'${w.name}')">🚨 Absent Today</button>`:''}
      </div>
    </div>
  </div>`;
}

async function markAbsent(workerId, workerName){
  const ok = await confirm2(`Mark ${workerName} as absent today and reassign their operations?`, 'Mark Absent & Reassign');
  if(!ok) return;
  try{
    const r = await api('POST',`/api/workers/${workerId}/absent-today`);
    toast(`${workerName} marked absent. ${r.reassigned} ops reassigned, ${r.unassigned} need manual assignment.`);
    navigate('/workers');
  }catch(e){ toast(e.message,'error'); }
}

async function showWorkerAvailability(){
  let data = [];
  try{ data = await api('GET','/api/workers/availability'); }catch{}
  const today = new Date();
  const days = Array.from({length:14},(_,i)=>{const d=new Date(today.getTime()+i*86400000);return d.toISOString().slice(0,10);});
  showModal('Worker Availability — Next 14 Days',`
    <div style="overflow-x:auto">
    <table style="border-collapse:collapse;width:100%">
      <thead><tr>
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:var(--muted);white-space:nowrap">Worker</th>
        ${days.map(d=>{const dt=new Date(d);return`<th style="padding:6px 4px;text-align:center;font-size:10px;color:var(--muted);width:44px">${dt.toLocaleDateString('en-IN',{weekday:'short'})}<br>${dt.getDate()}</th>`}).join('')}
      </tr></thead>
      <tbody>
      ${data.map(w=>`<tr>
        <td style="padding:8px 12px;font-size:12px;white-space:nowrap">
          <div style="font-weight:500">${w.name}</div>
          <div style="font-size:10px;color:var(--muted)">${w.role||''}</div>
        </td>
        ${days.map(d=>{
          const isLeave=w.leave_dates_next14.includes(d);
          const isToday=d===today.toISOString().slice(0,10);
          const bg=isLeave?'rgba(239,68,68,.25)':isToday?'rgba(245,158,11,.15)':'var(--surface)';
          const tc=isLeave?'var(--red)':isToday?'var(--accent)':'var(--border)';
          return`<td style="padding:3px"><div style="width:40px;height:40px;border-radius:4px;background:${bg};display:flex;align-items:center;justify-content:center;font-size:11px;color:${tc};margin:auto" title="${w.name} - ${d}">${isLeave?'OFF':isToday?'★':''}</div></td>`;
        }).join('')}
      </tr>`).join('')}
      </tbody>
    </table>
    </div>
    <div style="display:flex;gap:12px;margin-top:12px;font-size:11px;color:var(--muted)">
      <span><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:rgba(239,68,68,.25);margin-right:4px;vertical-align:middle"></span>On Leave</span>
      <span><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:rgba(245,158,11,.15);margin-right:4px;vertical-align:middle"></span>Today</span>
    </div>`,
    `<button class="btn btn-primary" onclick="closeModal()">Close</button>`,
    true
  );
}

function openWorkerModal(editId){
  const w = editId ? allWorkers.find(x=>x.id===editId) : null;
  const byType = {};
  allMachines.forEach(m=>{if(!byType[m.machine_type])byType[m.machine_type]=[];byType[m.machine_type].push(m);});
  const skillsHtml = Object.entries(byType).map(([type,ms])=>`
    <div style="margin-bottom:12px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:6px">${type}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${ms.map(m=>`<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;padding:4px 8px;background:var(--surface);border:1px solid var(--border);border-radius:5px">
          <input type="checkbox" value="${m.id}" class="skill-chk" ${w?.skill_ids?.includes(m.id)?'checked':''} style="width:13px;height:13px;accent-color:var(--accent)">
          ${m.name}
        </label>`).join('')}
      </div>
    </div>`).join('');

  showModal(w?`Edit — ${w.name}`:'Add Worker',`
    <div class="form-section">Worker Details</div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Full Name <span style="color:var(--red)">*</span></div>
        <input id="w_name" value="${w?.name||''}" placeholder="e.g. Ramesh Kumar">
        <div class="field-err" id="w_name_err"></div>
      </div>
      <div class="form-group">
        <div class="fld-label">Role / Designation</div>
        <input id="w_role" value="${w?.role||''}" placeholder="e.g. Senior VMC Operator">
      </div>
    </div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Phone</div>
        <input id="w_phone" value="${w?.phone||''}" placeholder="Mobile number">
      </div>
      <div class="form-group">
        <div class="fld-label">Skill Level</div>
        <select id="w_skill_level">
          <option value="1" ${(w?.skill_level||1)===1?'selected':''}>1 — General (sand blasting, assembly)</option>
          <option value="2" ${(w?.skill_level||1)===2?'selected':''}>2 — Trained (milling, drilling)</option>
          <option value="3" ${(w?.skill_level||1)===3?'selected':''}>3 — Specialist (VMC, precision grinder)</option>
        </select>
      </div>
      ${w?`<div class="form-group">
        <div class="fld-label">Status</div>
        <select id="w_active"><option value="true" ${w.is_active?'selected':''}>Active</option><option value="false" ${!w.is_active?'selected':''}>Inactive</option></select>
      </div>`:'<div></div>'}
    </div>
    <div class="form-section" style="margin-top:14px">Machine Skills <small style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--muted)">(select all machines this worker can operate)</small></div>
    ${skillsHtml}`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" id="saveWorkerBtn" onclick="saveWorker(${w?.id||'null'})">Save Worker</button>`
  );
  setTimeout(()=>attachValidation('w_name',[{test:v=>v.length>0,msg:'Name is required'}],'w_name_err'),50);
}

async function saveWorker(editId){
  if(!validateAll(['w_name'])){toast('Name is required','error');return;}
  const skillIds = [...document.querySelectorAll('.skill-chk:checked')].map(el=>parseInt(el.value));
  const data = {
    name: document.getElementById('w_name').value.trim(),
    role: document.getElementById('w_role').value.trim(),
    phone: document.getElementById('w_phone').value.trim(),
    skill_level: parseInt(document.getElementById('w_skill_level')?.value||'1'),
    skill_ids: skillIds,
  };
  const activeEl = document.getElementById('w_active');
  if(activeEl) data.is_active = activeEl.value === 'true';
  setLoading('saveWorkerBtn',true);
  try{
    if(editId&&editId!=='null') await api('PUT',`/api/workers/${editId}`,data);
    else await api('POST','/api/workers',data);
    toast('Worker saved!'); closeModal(); await loadWorkers(); navigate('/workers');
  }catch(e){ toast(e.message,'error'); }
  finally{ setLoading('saveWorkerBtn',false); }
}

function openLeaveModal(workerId, workerName){
  const today = new Date().toISOString().slice(0,10);
  showModal(`Add Leave — ${workerName}`,`
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Leave Date <span style="color:var(--red)">*</span></div>
        <input id="lv_date" type="date" value="${today}">
        <div class="field-err" id="lv_date_err"></div>
      </div>
      <div class="form-group">
        <div class="fld-label">Leave Type</div>
        <select id="lv_type" onchange="toggleLeaveTimeFields()">
          <option value="full">Full Day</option>
          <option value="morning">Morning (8 AM – 12 PM)</option>
          <option value="afternoon">Afternoon (2 PM – 8 PM)</option>
          <option value="hours">Specific Hours</option>
        </select>
      </div>
    </div>
    <div id="lv_hours_wrap" style="display:none">
      <div class="form-row cols-2">
        <div class="form-group">
          <div class="fld-label">From Time</div>
          <input id="lv_start" type="time" value="08:00">
        </div>
        <div class="form-group">
          <div class="fld-label">To Time</div>
          <input id="lv_end" type="time" value="12:00">
        </div>
      </div>
    </div>
    <div class="form-row cols-1">
      <div class="form-group">
        <div class="fld-label">Reason (optional)</div>
        <input id="lv_reason" placeholder="Sick leave, personal, etc.">
      </div>
    </div>
    <div class="info-hint" style="margin-top:8px">After saving, click "Reschedule Ops" to reassign this worker's conflicting operations to other available workers.</div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" id="saveLeaveBtn" onclick="saveLeave(${workerId})">Save Leave</button>
     <button class="btn btn-secondary" id="saveRescheduleBtn" onclick="saveLeaveAndReschedule(${workerId})">Save & Reschedule Ops</button>`
  );
  setTimeout(()=>attachValidation('lv_date',[{test:v=>v.length>0,msg:'Date is required'}],'lv_date_err'),50);
}

function toggleLeaveTimeFields(){
  const t = document.getElementById('lv_type')?.value;
  const wrap = document.getElementById('lv_hours_wrap');
  if(wrap) wrap.style.display = t==='hours' ? '' : 'none';
}

async function saveLeave(workerId, andReschedule=false){
  if(!validateAll(['lv_date'])){toast('Date is required','error');return;}
  const ltype = document.getElementById('lv_type').value;
  const data = {
    date: document.getElementById('lv_date').value,
    type: ltype,
    start_time: ltype==='hours' ? document.getElementById('lv_start').value : null,
    end_time:   ltype==='hours' ? document.getElementById('lv_end').value : null,
    reason: document.getElementById('lv_reason').value,
  };
  const btnId = andReschedule ? 'saveRescheduleBtn' : 'saveLeaveBtn';
  setLoading(btnId, true);
  try{
    await api('POST',`/api/workers/${workerId}/leaves`, data);
    if(andReschedule){
      const r = await api('POST',`/api/workers/${workerId}/reschedule-after-leave`);
      toast(`Leave saved. ${r.rescheduled} conflicting ops reassigned.`);
    }else{
      toast('Leave saved!');
    }
    closeModal(); navigate('/workers');
  }catch(e){ toast(e.message,'error'); }
  finally{ setLoading(btnId, false); }
}

async function saveLeaveAndReschedule(workerId){ await saveLeave(workerId, true); }

async function viewWorkerLeaves(workerId, workerName){
  const leaves = await api('GET',`/api/workers/${workerId}/leaves`);
  showModal(`Leave History — ${workerName}`,
    `${leaves.length ? `<table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="padding:8px 12px;text-align:left;font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;border-bottom:1px solid var(--border)">Date</th>
        <th style="padding:8px 12px;text-align:left;font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;border-bottom:1px solid var(--border)">Type</th>
        <th style="padding:8px 12px;text-align:left;font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;border-bottom:1px solid var(--border)">Time</th>
        <th style="padding:8px 12px;text-align:left;font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;border-bottom:1px solid var(--border)">Reason</th>
        <th style="padding:8px 12px;border-bottom:1px solid var(--border)"></th>
      </tr></thead>
      <tbody>
      ${leaves.map(lv=>`<tr>
        <td style="padding:9px 12px;font-family:var(--mono);font-size:12px">${lv.date}</td>
        <td style="padding:9px 12px;font-size:12px;text-transform:capitalize">${lv.type}</td>
        <td style="padding:9px 12px;font-size:11px;color:var(--muted);font-family:var(--mono)">${lv.type==='hours'?`${lv.start_time||''} → ${lv.end_time||''}`:''}</td>
        <td style="padding:9px 12px;font-size:12px;color:var(--muted)">${lv.reason||'—'}</td>
        <td style="padding:9px 12px"><button class="btn btn-danger btn-sm" onclick="deleteLeave(${lv.id},'${workerName}',${workerId})">✕</button></td>
      </tr>`).join('')}
      </tbody></table>` : '<div class="empty">No leave records found.</div>'}`,
    `<button class="btn btn-primary" onclick="closeModal()">Close</button>
     <button class="btn btn-secondary" onclick="closeModal();openLeaveModal(${workerId},'${workerName}')">+ Add Leave</button>`
  );
}

async function deleteLeave(leaveId, workerName, workerId){
  const ok = await confirm2('Delete this leave record?');
  if(!ok) return;
  try{
    await api('DELETE',`/api/leaves/${leaveId}`);
    toast('Leave deleted');
    viewWorkerLeaves(workerId, workerName);
  }catch(e){ toast(e.message,'error'); }
}
