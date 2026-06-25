/**
 * Dolphin ERP — Routing Editor
 * Full-page editor — routes: #/routings/new, #/routings/:id
 *
 * Row-by-row operation editing (machine, setup/work time, formula-based
 * time, sub-operations, outside/vendor ops) is delegated to the shared
 * op_editor_widget (js/editors/op_editor_widget.js) so the Job editor's
 * "Custom operations" mode gets the exact same capabilities for free.
 */

const ROUTING_OPED_KEY = 'routing';

async function renderRoutingEditor(editId){
  // Fetch fresh data if editing (ensures sub-ops are loaded)
  let r = null;
  if(editId){
    try{ r = await api('GET', `/api/routings/${editId}`); }catch(e){}
    if(!r) r = allRoutings.find(x=>x.id===editId)||null;
  }

  const PTYPES = ['Punch','Die Frame','Liner Set','Complete Mould','Custom Plate',
                  'Base Plate','Ejector Plate','Addon Plate','SFS Lower','SFS Upper'];
  const ptypeOpts = PTYPES.map(p=>`<option ${r?.product_type===p?'selected':''}>${p}</option>`).join('');
  const isNew     = !r;
  const opCount   = r?.operations?.length||0;

  document.getElementById('content').innerHTML =
    `<div class="editor-page">
      <div class="editor-header">
        <h2 class="editor-title">${isNew?'New Routing':'Edit Routing'}</h2>
        <div class="editor-subtitle">${isNew?'Define the sequence of manufacturing operations':`${opCount} operation${opCount===1?'':'s'}`}</div>
      </div>
      <div class="editor-body">
        <div class="form-section">Routing Details</div>
        <div class="form-row cols-2">
          <div class="form-group">
            <div class="fld-label">Name <span style="color:var(--red)">*</span></div>
            <input id="r_name" value="${r?.name||''}" placeholder="e.g. Lower Punch — Small">
            <div class="field-err" id="r_name_err"></div>
          </div>
          <div class="form-group">
            <div class="fld-label">Product Type <span style="color:var(--red)">*</span></div>
            <select id="r_ptype">${ptypeOpts}</select>
          </div>
        </div>
        <div class="form-row cols-2">
          <div class="form-group">
            <div class="fld-label">Description</div>
            <input id="r_desc" value="${r?.description||''}" placeholder="Brief description (optional)">
          </div>
          <div class="form-group">
            <div class="fld-label">Material Lead Time (days)</div>
            <input id="r_lead" type="number" min="0" step="0.5" value="${r?.material_lead_days??2}">
            <div class="field-err" id="r_lead_err"></div>
          </div>
        </div>
        <div class="info-hint">Material lead time = days to wait for raw material before manufacturing starts.</div>
        <div class="form-section" style="margin-top:16px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span>Operations</span>
            <button class="btn btn-secondary" style="font-size:11px;padding:4px 9px" onclick="opEdAddRow('${ROUTING_OPED_KEY}')">+ Add Step</button>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);padding:4px 8px 6px;border-bottom:1px solid var(--border);margin-bottom:6px">
          <span>Name → Machine → Setup(min) → Work(min) | ⚡ = Formula mode</span>
          <span>☑ = Optional</span>
        </div>
        <div id="opsContainer"></div>
        <div id="opsEmpty" style="color:var(--muted);font-size:13px;padding:16px 0;text-align:center">
          No operations yet. Click "+ Add Step" to begin.
        </div>
      </div>
      <div class="editor-footer">
        <button class="btn btn-ghost" onclick="navigate('/routings')">Cancel</button>
        <button class="btn btn-primary" id="saveRoutingBtn" onclick="saveRouting(${r?.id??'null'})">
          ${r?'Save Changes':'Create Routing'}
        </button>
      </div>
    </div>`;

  setTimeout(()=>{
    attachValidation('r_name',[{test:v=>v.length>0,msg:'Routing name is required'}],'r_name_err');
    attachValidation('r_lead',[{test:v=>!isNaN(parseFloat(v))&&parseFloat(v)>=0,msg:'Must be 0 or more days'}],'r_lead_err');
  }, 50);

  const ed = opEditorCreate(ROUTING_OPED_KEY, { container: 'opsContainer', emptyEl: 'opsEmpty' });
  ed.setOps(r ? r.operations : []);
  ed.render();
}

async function saveRouting(editId){
  const ed = _opEd(ROUTING_OPED_KEY);
  ed.sync();
  const ops = ed.getOps();
  if(!validateAll(['r_name','r_lead'])){toast('Fix highlighted fields','error');return;}
  if(ops.some(o=>!o.name.trim())){toast('All operations must have a name','error');return;}
  const data={name:document.getElementById('r_name').value.trim(),product_type:document.getElementById('r_ptype').value,
    description:document.getElementById('r_desc').value.trim(),material_lead_days:parseFloat(document.getElementById('r_lead').value)||2,
    operations:ops.map((op,i)=>({sequence:i+1,...op}))};
  setLoading('saveRoutingBtn',true);
  try{
    if(editId&&editId!=='null') await api('PUT',`/api/routings/${editId}`,data);
    else await api('POST','/api/routings',data);
    toast('Routing saved! ✓'); await loadAll(); navigate('/routings');
  }catch(e){toast(e.message,'error');}
  finally{setLoading('saveRoutingBtn',false);}
}

async function delRouting(id){
  const ok=await confirm2('Delete this routing? Jobs using it will lose their routing reference.');if(!ok)return;
  try{await api('DELETE',`/api/routings/${id}`);toast('Deleted');await loadAll();navigate('/routings');}catch(e){toast(e.message,'error')}
}
