/**
 * Dolphin ERP — Machines
 */

// ── MACHINES ──
async function renderMachines(){
  await loadAll();
  document.getElementById('topbarActions').innerHTML=`<button class="btn btn-primary" onclick="openMachineModal()">+ Add Machine</button>`;
  const byType={};
  allMachines.forEach(m=>{if(!byType[m.machine_type])byType[m.machine_type]=[];byType[m.machine_type].push(m);});
  document.getElementById('content').innerHTML=`
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px">
    ${Object.entries(byType).map(([type,ms])=>`
      <div class="card">
        <div class="card-hdr"><div class="card-title">${type}</div><span style="font-size:11px;color:var(--muted)">${ms.length} machine${ms.length>1?'s':''}</span></div>
        <table style="width:100%;border-collapse:collapse"><tbody>
          ${ms.map(m=>`<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:9px 14px">
              <div style="font-family:var(--mono);font-size:12px">${m.name}</div>
              ${m.code?`<span style="font-size:10px;color:var(--accent);font-family:var(--mono)">${m.code}</span>`:''}
              ${m.status&&m.status!=='active'?`<span style="font-size:10px;color:var(--orange);margin-left:4px">⚠ ${m.status}</span>`:''}
            </td>
            <td style="padding:9px 6px">
              ${m.is_bottleneck?'<span class="badge badge-bottleneck">BN</span>':''}
              ${m.preferred_worker_name?`<div style="font-size:10px;color:var(--accent);margin-top:2px;font-weight:600">⭐ ${m.preferred_worker_name}</div>`:''}
              ${m.skilled_worker_names&&m.skilled_worker_names.length?`<div style="font-size:10px;color:var(--muted);margin-top:2px">${m.skilled_worker_names.slice(0,2).join(', ')}${m.skilled_worker_names.length>2?' +'+( m.skilled_worker_names.length-2):''}</div>`:'<span style="color:var(--red);font-size:10px">No workers</span>'}
            </td>
            <td style="padding:9px 14px 9px 0">
              <div style="display:flex;gap:4px;justify-content:flex-end">
                <button class="btn btn-ghost" style="font-size:11px;padding:3px 7px" onclick='openMachineModal(${JSON.stringify(m)})'>Edit</button>
                <button class="btn btn-danger btn-icon" onclick="delMachine(${m.id})">✕</button>
              </div>
            </td>
          </tr>`).join('')}
        </tbody></table>
      </div>`).join('')}
    ${!allMachines.length?`<div class="card"><div class="empty">No machines. Add one or load demo data.</div></div>`:''}
    </div>`;
}

function openMachineModal(m){
  // Build skilled worker options for preferred worker dropdown
  // If editing, use the machine's skilled_worker_ids; otherwise show all active workers
  const skilledIds = new Set(m?.skilled_worker_ids || []);
  const workerOpts = allWorkers
    .filter(w => w.is_active && (!m || skilledIds.has(w.id)))
    .map(w=>`<option value="${w.id}" ${m?.preferred_worker_id==w.id?'selected':''}>${w.name} (${w.role||'Operator'})</option>`)
    .join('');

  showModal(m?'Edit Machine':'Add Machine',
    `<div class="form-row cols-2">
      <div class="form-group"><div class="fld-label">Machine Name <span style="color:var(--red)">*</span></div>
        <input id="m_name" value="${m?.name||''}" placeholder="e.g. Double Column VMC">
        <div class="field-err" id="m_name_err"></div>
      </div>
      <div class="form-group">
        <div class="fld-label">Machine Code</div>
        <div style="padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:6px;font-family:var(--mono);font-size:13px;color:var(--accent)">${m?.code||'Auto-assigned on save'}</div>
      </div>
    </div>
    <div class="form-row cols-2">
      <div class="form-group"><div class="fld-label">Machine Type <span style="color:var(--red)">*</span></div>
        <select id="m_type">${['VMC','Milling Machine','Grinder','Drill','CNC','Hydraulic Press','Welding','Assembly','Pump','Finishing','Other'].map(t=>`<option ${m?.machine_type===t?'selected':''}>${t}</option>`).join('')}</select>
      </div>
      <div class="form-group">
        <div class="fld-label">Status</div>
        <select id="m_status">
          <option value="active" ${(!m?.status||m?.status==='active')?'selected':''}>Active</option>
          <option value="maintenance" ${m?.status==='maintenance'?'selected':''}>Under Maintenance</option>
          <option value="breakdown" ${m?.status==='breakdown'?'selected':''}>Breakdown</option>
        </select>
      </div>
    </div>
    <div class="form-row cols-1">
      <div class="form-group">
        <div class="fld-label">Skill Level Required <span style="font-size:10px;color:var(--muted);font-weight:400">— affects which workers get scheduled here</span></div>
        <select id="m_skill_level">
          <option value="1" ${(m?.skill_level||1)<=1?'selected':''}>★ Level 1 — General (sand blasting, assembly, basic ops — any worker)</option>
          <option value="2" ${(m?.skill_level||1)===2?'selected':''}>★★ Level 2 — Trained operator needed (milling, drilling)</option>
          <option value="3" ${(m?.skill_level||1)>=3?'selected':''}>★★★ Level 3 — Specialist only (VMC, precision grinder)</option>
        </select>
      </div>
    </div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Preferred Worker <span style="font-size:10px;color:var(--muted);font-weight:400">— scheduler tries this worker first on this machine</span></div>
        <select id="m_preferred_worker">
          <option value="">— None (use scoring) —</option>
          ${workerOpts}
        </select>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">Also used for order piece consistency — all pieces try the same worker per machine</div>
      </div>
      <div class="form-group">
        <div class="fld-label">Continuity Window (hours) <span style="font-size:10px;color:var(--muted);font-weight:400">— keep same worker on this machine if gap &lt; this</span></div>
        <input type="number" id="m_continuity" min="0" max="12" step="0.5" value="${m?.continuity_hours??2}">
      </div>
    </div>
    <div class="form-row cols-1">
      <label class="checkbox-row"><input type="checkbox" id="m_bot" ${m?.is_bottleneck?'checked':''}>⚠ Mark as Bottleneck (capacity constrained)</label>
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" id="saveMachineBtn" onclick="saveMachine(${m?.id??'null'})">Save Machine</button>`
  );
  setTimeout(()=>{
    attachValidation('m_name',[{test:v=>v.length>0,msg:'Machine name is required'},{test:v=>v.length>=2,msg:'Name must be at least 2 characters'}],'m_name_err');
  },50);
}

async function saveMachine(editId){
  if(!validateAll(['m_name'])){toast('Fix highlighted fields','error');return;}
  const pwVal = document.getElementById('m_preferred_worker')?.value;
  const data={
    name:document.getElementById('m_name').value.trim(),
    machine_type:document.getElementById('m_type').value,
    is_bottleneck:document.getElementById('m_bot').checked,
    status:document.getElementById('m_status')?.value||'active',
    skill_level:parseInt(document.getElementById('m_skill_level')?.value||'1'),
    continuity_hours:parseFloat(document.getElementById('m_continuity')?.value||'2'),
    preferred_worker_id: pwVal ? parseInt(pwVal) : null,
  };
  setLoading('saveMachineBtn',true);
  try{
    if(editId&&editId!=='null') await api('PUT',`/api/workcenters/${editId}`,data);
    else await api('POST',`/api/workcenters`,data);
    toast('Saved!');closeModal();await loadAll();navigate('/machines');
  }catch(e){toast(e.message,'error');}
  finally{setLoading('saveMachineBtn',false);}
}

async function delMachine(id){
  const ok=await confirm2('Delete this machine? This may affect existing routings.');if(!ok)return;
  try{await api('DELETE',`/api/workcenters/${id}`);toast('Deleted');await loadAll();navigate('/machines');}catch(e){toast(e.message,'error')}
}
