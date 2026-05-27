/**
 * Dolphin ERP — Routing Editor
 * Full-page editor — routes: #/routings/new, #/routings/:id
 */

async function renderRoutingEditor(editId){
  // Fetch fresh data if editing (ensures sub-ops are loaded)
  let r = null;
  if(editId){
    try{ r = await api('GET', `/api/routings/${editId}`); }catch(e){}
    if(!r) r = allRoutings.find(x=>x.id===editId)||null;
  }
  routingOps = r ? r.operations.map(o=>({...o, sub_operations:o.sub_operations||[]})) : [];

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
            <button class="btn btn-secondary" style="font-size:11px;padding:4px 9px" onclick="addOpRow()">+ Add Step</button>
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
  renderOpRows();
}

function renderOpRows(){
  const c=document.getElementById('opsContainer');
  const e=document.getElementById('opsEmpty');
  if(e) e.style.display=routingOps.length?'none':'';
  if(!c) return;

  const FTYPES={
    'Fixed':                         'Fixed (constant time)',
    'Volume Milling':                'Volume Milling — L×W×Depth / MRR',
    'Perimeter Milling Single Side': 'Perimeter Milling Single Side — Dim×Depth / MRR',
    'Perimeter Milling Full':        'Perimeter Milling Full — 2×(L+W)×(T-8)/0.3/Feed',
    'Perimeter Side Milling':        'Perimeter Side Milling — 2×(L+W)×Passes / Feed',
    'Perimeter Milling':             'Perimeter Milling — 2×(L+W)×3 / Feed',
    'Perimeter Welding':             'Perimeter Welding — 2×(L+W) / 200',
    'Surface Grinding':              'Surface Grinding — Passes×(Dim+250) / 20000',
    'Sandblasting':                  'Sandblasting — L×W / MRR',
  };
  const DIMS=['length','width','thickness'];

  c.innerHTML=routingOps.map((op,i)=>{
    const hasFormula=!!(op.formula_type&&op.formula_type!=='none');
    const wMins=op.work_time_mins!=null?Math.round(op.work_time_mins):Math.round((op.work_time_hrs||0)*60);
    const ft=op.formula_type||'';
    // Which inputs each formula needs — keyed on Excel display names
    const needsDimX  = ['Volume Milling','Perimeter Milling Single Side','Surface Grinding'].includes(ft);
    const needsDimY  = ['Volume Milling','Surface Grinding'].includes(ft);
    const needsDepth = ['Volume Milling','Perimeter Milling Single Side','Perimeter Side Milling','Surface Grinding'].includes(ft);
    const needsMRR   = ['Volume Milling','Perimeter Milling Single Side','Sandblasting'].includes(ft);
    const needsFeed  = ['Perimeter Milling Full','Perimeter Side Milling','Perimeter Milling'].includes(ft);
    const needsPasses= ['Perimeter Side Milling'].includes(ft);
    const isStepMilling = ft === 'Perimeter Milling Full';  // depth = T-8 auto from thickness

    // Formula preview string — uses Excel display names
    let preview='';
    if(hasFormula&&ft&&ft!=='Fixed'){
      const dx=(op.dim_x_source||'length').slice(0,1).toUpperCase();
      const dy=(op.dim_y_source||'width').slice(0,1).toUpperCase();
      const d=op.depth_mm||'?'; const r=op.mrr||'?';
      if(ft==='Volume Milling')                preview=`(${dx}×${dy}×${d}) ÷ ${r}`;
      else if(ft==='Perimeter Milling Single Side') preview=`${dx}×${d}×T ÷ ${r}`;
      else if(ft==='Perimeter Milling Full')    preview=`2×(L+W)÷0.3×(T-8)÷Feed`;
      else if(ft==='Perimeter Side Milling')   preview=`2×(L+W)×${d} passes ÷ Feed`;
      else if(ft==='Perimeter Milling')        preview=`2×(L+W)×3 ÷ 250`;
      else if(ft==='Perimeter Welding')        preview=`2×(L+W) ÷ 200`;
      else if(ft==='Surface Grinding')         preview=`(${dy}+50)×${d}×2÷2.5 × (${dx}+250)÷20000`;
      else if(ft==='Sandblasting')             preview=`L×W ÷ ${r}`;
    } else if(hasFormula&&ft==='Fixed') preview='Fixed time — enter Work(min) above';

    return `
    <div style="border:1px solid var(--border);border-radius:7px;margin-bottom:6px;overflow:hidden">

      <!-- TOP ROW: move, seq, name, machine, setup, work/formula-toggle, opt, remove -->
      <div style="display:flex;align-items:center;gap:6px;padding:7px 8px;background:var(--card)">
        <div class="op-ed-arrows" style="display:flex;flex-direction:column;gap:1px">
          <button onclick="moveOp(${i},-1)" ${i===0?'disabled':''} style="font-size:9px;padding:1px 4px;line-height:1.2">▲</button>
          <button onclick="moveOp(${i},1)"  ${i===routingOps.length-1?'disabled':''} style="font-size:9px;padding:1px 4px;line-height:1.2">▼</button>
        </div>
        <span style="font-size:11px;color:var(--muted);font-family:var(--mono);flex-shrink:0;width:16px;text-align:center">${i+1}</span>
        <input id="oped_name_${i}" value="${op.name||''}" placeholder="Operation name" style="flex:2 1 130px;min-width:90px">
        <select id="oped_wc_${i}" style="flex:2 1 140px;min-width:110px">${buildMachineOpts(op.work_center_id)}</select>
        <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:1px">
          <span style="font-size:9px;color:var(--muted)">Setup</span>
          <input type="number" id="oped_setup_${i}" value="${op.setup_time_mins??0}" min="0" step="5" style="width:54px">
        </div>
        ${hasFormula
          ? `<div style="flex:1 1 auto;font-size:11px;color:var(--accent);font-family:var(--mono);padding:0 4px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${preview}">${preview||'Formula set'}</div>`
          : `<div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:1px">
               <span style="font-size:9px;color:var(--muted)">Work(min)</span>
               <input type="number" id="oped_work_${i}" value="${wMins}" min="0" step="10" style="width:64px">
             </div>`
        }
        <label style="font-size:10px;color:var(--muted);white-space:nowrap;cursor:pointer;display:flex;align-items:center;gap:3px;flex-shrink:0">
          <input type="checkbox" id="oped_useformula_${i}" ${hasFormula?'checked':''}
            onchange="toggleOpFormula(${i},this.checked)"
            style="accent-color:var(--accent);width:12px;height:12px"> ⚡
        </label>
        <input type="checkbox" id="oped_opt_${i}" ${op.is_optional?'checked':''} title="Optional step" style="width:13px;height:13px;accent-color:var(--amber);flex-shrink:0">
        <label title="Outside operation (sent to vendor)" style="font-size:10px;color:var(--muted);white-space:nowrap;cursor:pointer;display:flex;align-items:center;gap:2px;flex-shrink:0">
          <input type="checkbox" id="oped_outside_${i}" ${op.op_type==='outside'?'checked':''} onchange="toggleOpOutside(${i},this.checked)" style="accent-color:var(--red);width:12px;height:12px"> Out
        </label>
        <button onclick="removeOp(${i})" title="Remove step" style="flex-shrink:0;background:none;border:none;color:var(--red);font-size:14px;cursor:pointer;padding:2px 4px;line-height:1">✕</button>
      </div>
      <div id="oped_outside_row_${i}" style="${op.op_type==='outside'?'':' display:none;'}background:var(--surface);border-top:1px solid var(--border);padding:6px 12px;display:${op.op_type==='outside'?'flex':'none'};align-items:center;gap:8px">
        <span style="font-size:11px;color:var(--muted);flex-shrink:0">Vendor:</span>
        <input id="oped_vendor_${i}" value="${op.outside_vendor||''}" placeholder="e.g. Rajesh Heat Treatment" style="flex:1;font-size:12px">
      </div>

      <!-- BOTTOM ROW: formula params — only shown when formula ON -->
      <div id="oped_formula_${i}" style="${hasFormula?'':'display:none'}background:var(--surface);border-top:1px solid var(--border);padding:8px 12px;display:${hasFormula?'grid':'none'};grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;align-items:end">

        <div class="form-group" style="margin:0">
          <div class="fld-label" style="font-size:10px">Formula Type</div>
          <select id="oped_ftype_${i}" style="font-size:12px" onchange="syncRoutingOps();renderOpRows()">
            <option value="">— select —</option>
            ${Object.entries(FTYPES).map(([v,l])=>`<option value="${v}" ${ft===v?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>

        ${needsDimX?`<div class="form-group" style="margin:0">
          <div class="fld-label" style="font-size:10px">${ft==='Perimeter Milling Single Side'?'Cut Direction (Dim)':ft==='Surface Grinding'?'Dim X (pass direction — L or W)':'Dim X (length axis)'}</div>
          <select id="oped_dimx_${i}" style="font-size:12px">
            ${DIMS.map(d=>`<option value="${d}" ${op.dim_x_source===d?'selected':''}>${d.charAt(0).toUpperCase()+d.slice(1)}</option>`).join('')}
          </select>
        </div>`:''}

        ${needsDimY?`<div class="form-group" style="margin:0">
          <div class="fld-label" style="font-size:10px">${ft==='Surface Grinding'?'Dim Y (traverse axis — W or T)':'Dim Y (width axis)'}</div>
          <select id="oped_dimy_${i}" style="font-size:12px">
            ${DIMS.map(d=>`<option value="${d}" ${op.dim_y_source===d?'selected':''}>${d.charAt(0).toUpperCase()+d.slice(1)}</option>`).join('')}
          </select>
        </div>`:''}

        ${needsDepth?`<div class="form-group" style="margin:0">
          <div class="fld-label" style="font-size:10px">${needsPasses?'Passes':'Depth (mm)'}</div>
          <input type="number" id="oped_depth_${i}" value="${op.depth_mm||''}" min="0" step="0.5" placeholder="${needsPasses?'e.g. 10 passes':'e.g. 5'}" style="font-size:12px">
        </div>`:''}

        ${needsFeed?`<div class="form-group" style="margin:0">
          <div class="fld-label" style="font-size:10px">Feed Rate (mm/min)</div>
          <input type="number" id="oped_feed_${i}" value="${op.feed_rate||(ft==='Perimeter Milling Full'?1000:250)}" min="1" step="50" placeholder="${ft==='Perimeter Milling Full'?'e.g. 1000':'e.g. 250'}" style="font-size:12px">
        </div>`:''}

        ${needsMRR?`<div class="form-group" style="margin:0">
          <div class="fld-label" style="font-size:10px">MRR (mm³/min)</div>
          <input type="number" id="oped_mrr_${i}" value="${op.mrr||''}" min="0" step="100" placeholder="e.g. 6300" style="font-size:12px">
        </div>`:''}
        ${isStepMilling?`<div style="font-size:10px;color:var(--muted);align-self:center;padding:4px 0">
          Depth = T − 8 mm (auto from thickness at order time). Step-over = 0.3 mm fixed.
        </div>`:''}

        ${ft==='Fixed'?`<div style="font-size:11px;color:var(--muted);align-self:center;padding:4px 0">
          Fixed time — enter minutes in the Work(min) field above. No auto-calculation.
        </div>`:''}

        ${ft&&ft!=='Fixed'?`<div style="font-size:10px;color:var(--accent);align-self:center;padding:4px 0;font-style:italic">
          ${ft==='Volume Milling'?'Time = DimX × DimY × Depth / MRR':
            ft==='Perimeter Milling Single Side'?'Time = Dim × Depth × T / MRR':
            ft==='Perimeter Milling Full'?'Time = 2×(L+W) ÷ 0.3 × (T−8) ÷ Feed Rate  (Depth auto-computed as T−8)':
            ft==='Perimeter Side Milling'?'Time = 2×(L+W) × Passes / Feed':
            ft==='Perimeter Milling'?'Time = 2×(L+W) × 3 ÷ Feed Rate':
            ft==='Perimeter Welding'?'Time = 2×(L+W) / 200':
            ft==='Surface Grinding'?'Time = (DimY+50)×Depth×2/2.5 × (DimX+250)/20000  [DimX=pass direction, DimY=traverse direction]':
            ft==='Sandblasting'?'Time = L × W / MRR':''}
        </div>`:''}

      </div>

      <!-- SUB-OPS SECTION -->
      <div id="oped_subops_${i}" style="background:var(--surface2);border-top:1px solid var(--border);padding:8px 12px">
        ${(op.sub_operations||[]).length > 0 ? `
          <div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px">
            Sub-operations · machine &amp; setup shared from above · work times summed for scheduling
          </div>
          ${(op.sub_operations||[]).map((s,si)=>renderSubOpRow(i,si,s,FTYPES,DIMS)).join('')}
        ` : ''}
        <button onclick="addSubOp(${i})" style="font-size:11px;padding:3px 10px;border:1px dashed var(--border);border-radius:5px;background:none;color:var(--muted);cursor:pointer;margin-top:${(op.sub_operations||[]).length?'4px':'0'}">
          + Add sub-operation
        </button>
        ${(op.sub_operations||[]).length>0?`
          <span style="font-size:11px;color:var(--muted);margin-left:12px">
            Total work: <b>${(op.sub_operations||[]).filter(s=>!s.is_optional).reduce((a,s)=>a+(s.work_time_mins||0),0).toFixed(1)} min</b>
            ${(op.sub_operations||[]).some(s=>s.is_optional)?'(+ optional)':''}
          </span>
        `:''}
      </div>

    </div>`;
  }).join('');
}

function renderSubOpRow(oi, si, s, FTYPES, DIMS){
  const ft = s.formula_type||'';
  const needsDimX  = ['Volume Milling','Perimeter Milling Single Side','Surface Grinding'].includes(ft);
  const needsDimY  = ['Volume Milling','Surface Grinding'].includes(ft);
  const needsDepth = ['Volume Milling','Perimeter Milling Single Side','Perimeter Side Milling','Surface Grinding'].includes(ft);
  const needsMRR   = ['Volume Milling','Perimeter Milling Single Side','Sandblasting'].includes(ft);
  const needsFeed  = ['Perimeter Milling Full','Perimeter Side Milling','Perimeter Milling'].includes(ft);
  const hasFormula = !!ft && ft !== 'none';
  const wMins = s.work_time_mins != null ? Math.round(s.work_time_mins) : 0;

  return `<div style="border:1px solid var(--border);border-radius:6px;margin-bottom:5px;overflow:hidden;margin-left:12px">
    <div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--card)">
      <span style="font-size:10px;color:var(--muted);flex-shrink:0;width:18px;text-align:center">${si+1}</span>
      <input id="sop_name_${oi}_${si}" value="${s.name||''}" placeholder="Sub-op name"
        style="flex:2 1 120px;min-width:80px;font-size:12px">
      ${hasFormula
        ? `<span style="flex:1;font-size:10px;color:var(--accent);font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ft}</span>`
        : `<div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:1px">
             <span style="font-size:9px;color:var(--muted)">Work(min)</span>
             <input type="number" id="sop_work_${oi}_${si}" value="${wMins}" min="0" step="5" style="width:60px;font-size:12px">
           </div>`
      }
      <label style="font-size:10px;color:var(--muted);white-space:nowrap;cursor:pointer;display:flex;align-items:center;gap:3px;flex-shrink:0">
        <input type="checkbox" id="sop_formula_${oi}_${si}" ${hasFormula?'checked':''}
          onchange="toggleSubOpFormula(${oi},${si},this.checked)"
          style="accent-color:var(--accent);width:12px;height:12px"> ⚡
      </label>
      <label style="font-size:10px;color:var(--amber);white-space:nowrap;cursor:pointer;display:flex;align-items:center;gap:3px;flex-shrink:0" title="Optional — can be excluded per order">
        <input type="checkbox" id="sop_opt_${oi}_${si}" ${s.is_optional?'checked':''}
          style="accent-color:var(--amber);width:12px;height:12px"> opt
      </label>
      <button onclick="removeSubOp(${oi},${si})" style="background:none;border:none;color:var(--red);font-size:12px;cursor:pointer;padding:1px 3px;line-height:1;flex-shrink:0">✕</button>
    </div>
    ${hasFormula?`
    <div style="background:var(--surface);border-top:1px solid var(--border);padding:6px 10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;align-items:end">
      <div class="form-group" style="margin:0">
        <div class="fld-label" style="font-size:10px">Formula Type</div>
        <select id="sop_ftype_${oi}_${si}" style="font-size:11px" onchange="syncRoutingOps();renderOpRows()">
          <option value="">— select —</option>
          ${Object.entries(FTYPES).map(([v,l])=>`<option value="${v}" ${ft===v?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
      ${needsDimX?`<div class="form-group" style="margin:0">
        <div class="fld-label" style="font-size:10px">Dim X</div>
        <select id="sop_dimx_${oi}_${si}" style="font-size:11px">
          ${DIMS.map(d=>`<option value="${d}" ${s.dim_x_source===d?'selected':''}>${d.charAt(0).toUpperCase()+d.slice(1)}</option>`).join('')}
        </select>
      </div>`:''}
      ${needsDimY?`<div class="form-group" style="margin:0">
        <div class="fld-label" style="font-size:10px">${ft==='Surface Grinding'?'Dim Y (traverse — W or T)':'Dim Y'}</div>
        <select id="sop_dimy_${oi}_${si}" style="font-size:11px">
          ${DIMS.map(d=>`<option value="${d}" ${s.dim_y_source===d?'selected':''}>${d.charAt(0).toUpperCase()+d.slice(1)}</option>`).join('')}
        </select>
      </div>`:''}
      ${needsDepth?`<div class="form-group" style="margin:0">
        <div class="fld-label" style="font-size:10px">Depth (mm)</div>
        <input type="number" id="sop_depth_${oi}_${si}" value="${s.depth_mm||''}" min="0" step="0.5" placeholder="e.g. 10" style="font-size:11px">
      </div>`:''}
      ${needsFeed?`<div class="form-group" style="margin:0">
        <div class="fld-label" style="font-size:10px">Feed Rate (mm/min)</div>
        <input type="number" id="sop_feed_${oi}_${si}" value="${s.feed_rate||250}" min="1" step="50" style="font-size:11px">
      </div>`:''}
      ${needsMRR?`<div class="form-group" style="margin:0">
        <div class="fld-label" style="font-size:10px">MRR (mm³/min)</div>
        <input type="number" id="sop_mrr_${oi}_${si}" value="${s.mrr||''}" min="0" step="100" placeholder="e.g. 6300" style="font-size:11px">
      </div>`:''}
    </div>`:''}
  </div>`;
}

function toggleOpFormula(i, on){
  syncRoutingOps();
  if(on && (!routingOps[i].formula_type||routingOps[i].formula_type==='none'||routingOps[i].formula_type==='volume_milling')){
    routingOps[i].formula_type='Volume Milling';
    routingOps[i].dim_x_source='length';
    routingOps[i].dim_y_source='width';
  }
  if(!on) routingOps[i].formula_type=null;
  renderOpRows();
}

function toggleSubOpFormula(oi, si, on){
  syncRoutingOps();
  const s = (routingOps[oi].sub_operations||[])[si];
  if(!s) return;
  s.formula_type = on ? 'Perimeter Milling Single Side' : null;
  if(on){ s.dim_x_source='length'; s.dim_y_source='thickness'; }
  renderOpRows();
}

function addSubOp(oi){
  syncRoutingOps();
  if(!routingOps[oi].sub_operations) routingOps[oi].sub_operations=[];
  routingOps[oi].sub_operations.push({
    name:'', formula_type:null, mrr:null, depth_mm:null, feed_rate:null,
    dim_x_source:null, dim_y_source:null, work_time_mins:0, is_optional:false
  });
  renderOpRows();
}

function removeSubOp(oi, si){
  syncRoutingOps();
  routingOps[oi].sub_operations.splice(si,1);
  renderOpRows();
}

function syncRoutingOps(){
  routingOps=routingOps.map((op,i)=>{
    const useFormula=document.getElementById(`oped_useformula_${i}`)?.checked;
    const ftype=document.getElementById(`oped_ftype_${i}`)?.value||null;
    const hasSubs = (op.sub_operations||[]).length > 0;
    let wMins=0;
    if(hasSubs){
      // work time = sum of sub-ops (read-only, auto-calculated)
      wMins = (op.sub_operations||[]).reduce((a,s)=>a+(s.work_time_mins||0),0);
    } else if(useFormula&&ftype){
      wMins=0; // calculated at order time from dimensions
    } else {
      wMins=parseFloat(document.getElementById(`oped_work_${i}`)?.value)||0;
    }

    // Sync sub-ops from DOM
    const syncedSubs = (op.sub_operations||[]).map((s,si)=>{
      const useFm = document.getElementById(`sop_formula_${i}_${si}`)?.checked??!!s.formula_type;
      const sftype = useFm?(document.getElementById(`sop_ftype_${i}_${si}`)?.value||s.formula_type):null;
      const sw = useFm ? 0 : (parseFloat(document.getElementById(`sop_work_${i}_${si}`)?.value)||0);
      return {
        ...s,
        id:           s.id||null,
        name:         document.getElementById(`sop_name_${i}_${si}`)?.value?.trim()||s.name,
        formula_type: sftype||null,
        mrr:          parseFloat(document.getElementById(`sop_mrr_${i}_${si}`)?.value)||null,
        depth_mm:     parseFloat(document.getElementById(`sop_depth_${i}_${si}`)?.value)||null,
        feed_rate:    parseFloat(document.getElementById(`sop_feed_${i}_${si}`)?.value)||null,
        dim_x_source: document.getElementById(`sop_dimx_${i}_${si}`)?.value||null,
        dim_y_source: document.getElementById(`sop_dimy_${i}_${si}`)?.value||null,
        work_time_mins: sw,
        work_time_hrs:  sw/60,
        is_optional:  !!document.getElementById(`sop_opt_${i}_${si}`)?.checked,
      };
    });

    return {
      ...op,
      name:           document.getElementById(`oped_name_${i}`)?.value?.trim()||op.name,
      work_center_id: parseInt(document.getElementById(`oped_wc_${i}`)?.value)||op.work_center_id,
      setup_time_mins:parseFloat(document.getElementById(`oped_setup_${i}`)?.value)||0,
      work_time_mins: wMins,
      work_time_hrs:  wMins/60,
      is_optional:    !!document.getElementById(`oped_opt_${i}`)?.checked,
      op_type:        document.getElementById(`oped_outside_${i}`)?.checked ? 'outside' : 'inhouse',
      outside_vendor: document.getElementById(`oped_vendor_${i}`)?.value?.trim()||null,
      formula_type:   useFormula?(ftype||null):null,
      mrr:            parseFloat(document.getElementById(`oped_mrr_${i}`)?.value)||null,
      depth_mm:       parseFloat(document.getElementById(`oped_depth_${i}`)?.value)||null,
      feed_rate:      parseFloat(document.getElementById(`oped_feed_${i}`)?.value)||null,
      dim_x_source:   document.getElementById(`oped_dimx_${i}`)?.value||null,
      dim_y_source:   document.getElementById(`oped_dimy_${i}`)?.value||null,
      sub_operations: syncedSubs,
    };
  });
}

function moveOp(i,dir){
  syncRoutingOps();
  const j=i+dir;
  if(j<0||j>=routingOps.length) return;
  [routingOps[i],routingOps[j]]=[routingOps[j],routingOps[i]];
  renderOpRows();
}
function addOpRow(){syncRoutingOps();routingOps.push({name:'',work_center_id:allMachines[0]?.id,setup_time_mins:0,work_time_mins:0,work_time_hrs:0,is_optional:false,op_type:'inhouse',outside_vendor:null,sub_operations:[]});renderOpRows();}
function toggleOpOutside(i,checked){const row=document.getElementById('oped_outside_row_'+i);if(row)row.style.display=checked?'flex':'none';}
function removeOp(i){syncRoutingOps();routingOps.splice(i,1);renderOpRows();}

async function saveRouting(editId){
  syncRoutingOps();
  if(!validateAll(['r_name','r_lead'])){toast('Fix highlighted fields','error');return;}
  if(routingOps.some(o=>!o.name.trim())){toast('All operations must have a name','error');return;}
  const data={name:document.getElementById('r_name').value.trim(),product_type:document.getElementById('r_ptype').value,
    description:document.getElementById('r_desc').value.trim(),material_lead_days:parseFloat(document.getElementById('r_lead').value)||2,
    operations:routingOps.map((op,i)=>({sequence:i+1,...op}))};
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
