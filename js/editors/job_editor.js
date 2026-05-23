/**
 * Dolphin ERP — Job Editor (full-page, replaces modal)
 * Routes: #/jobs/new, #/jobs/:id (handled via router as 'job-edit')
 */

async function renderJobEditor(editId) {
  await loadAll();

  const PTYPES = ['Punch','Die Frame','Liner Set','Complete Mould','Custom Plate',
                  'Base Plate','Ejector Plate','Addon Plate','SFS Lower','SFS Upper'];
  const SIZES  = ['600x600','600x900','600x1200','900x900','900x1200','1200x1200'];

  let editJob = null;
  if (editId) editJob = await api('GET', `/api/jobs/${editId}`);

  jobFormOps = [];

  const defDue = new Date(Date.now() + 14*86400000).toISOString().slice(0,10);
  const curPtype = editJob?.product_type || PTYPES[0];

  const custOpts = allCustomers.map(c =>
    `<option value="${c.id}" ${editJob?.customer_id==c.id?'selected':''}>${escHtml(c.name)}</option>`
  ).join('');

  const routingOpts = allRoutings
    .filter(r => !curPtype || r.product_type === curPtype)
    .map(r => `<option value="${r.id}" ${editJob?.routing_id==r.id?'selected':''}>${escHtml(r.name)}</option>`)
    .join('');

  const ptypeOpts = PTYPES.map(p => `<option ${curPtype===p?'selected':''}>${p}</option>`).join('');
  const sizeOpts  = SIZES.map(s => `<option ${editJob?.product_size===s?'selected':''}>${s}</option>`).join('')
    + `<option value="custom" ${editJob?.product_size&&!SIZES.includes(editJob.product_size)?'selected':''}>Custom…</option>`;

  const dueVal = editJob?.due_date ? editJob.due_date.slice(0,10) : defDue;
  const nbVal  = editJob?.not_before ? editJob.not_before.slice(0,10) : '';
  const matVal = editJob?.material_ready_date ? editJob.material_ready_date.slice(0,10) : '';

  document.getElementById('topbarActions').innerHTML =
    `<button class="btn btn-ghost" onclick="goBack('/jobs')">← Back</button>`;

  document.getElementById('content').innerHTML = `
  <div class="editor-page">
    <div class="editor-header">
      <h2 class="editor-title">${editJob ? `Edit — ${editJob.job_number}` : 'New Job'}</h2>
      <div class="editor-subtitle">${editJob ? `${editJob.customer_name} · ${editJob.product_type}` : 'Create a standalone job'}</div>
    </div>
    <div class="editor-body" style="padding:20px 28px;max-width:900px">

      <div class="form-section" style="margin-top:0">Customer & Pricing</div>
      <div class="form-row cols-2">
        <div class="form-group">
          <div class="fld-label">Customer <span style="color:var(--red)">*</span></div>
          <select id="f_cust_id" onchange="jeOnCustomerChange()">
            <option value="">— Select customer —</option>
            ${custOpts}
            <option value="__new__">+ Add new customer…</option>
          </select>
          <input id="f_cust" value="${editJob?.customer_name&&!editJob?.customer_id?escHtml(editJob.customer_name):''}"
            placeholder="Type new customer name"
            style="margin-top:6px;display:${(editJob?.customer_name&&!editJob?.customer_id)?'block':'none'}">
        </div>
        <div class="form-group">
          <div class="fld-label">Total Price (₹)</div>
          <input id="f_price" type="number" min="0" step="100" value="${editJob?.total_price||''}" placeholder="e.g. 50000">
        </div>
      </div>
      <div class="form-row cols-2">
        <div class="form-group">
          <div class="fld-label">Job Number <span style="font-size:10px;color:var(--muted);font-weight:400">(blank = auto)</span></div>
          <input id="f_jobnum" value="${editJob?.job_number||''}" placeholder="Auto: DL-2026-001">
        </div>
        <div class="form-group">
          <div class="fld-label">PO Number</div>
          <input id="f_po" value="${escHtml(editJob?.po_number||'')}" placeholder="Customer PO reference">
        </div>
      </div>

      <div class="form-section">Product Details</div>
      <div class="form-row cols-3">
        <div class="form-group">
          <div class="fld-label">Product Type <span style="color:var(--red)">*</span></div>
          <select id="f_ptype" onchange="filterRoutingsByType(this.value)">${ptypeOpts}</select>
        </div>
        <div class="form-group">
          <div class="fld-label">Size <span style="color:var(--red)">*</span></div>
          <select id="f_size_sel" onchange="jeOnSizeChange()">${sizeOpts}</select>
        </div>
        <div class="form-group">
          <div class="fld-label">Variant / Type</div>
          <input id="f_variant" value="${escHtml(editJob?.product_variant||'')}" placeholder="Plain, Carbide…">
        </div>
      </div>
      <div id="f_size_custom_wrap" style="display:${editJob?.product_size&&!SIZES.includes(editJob.product_size)?'':'none'}" class="form-row cols-1">
        <div class="form-group">
          <div class="fld-label">Custom Size</div>
          <input id="f_size_custom" value="${escHtml((editJob?.product_size&&!SIZES.includes(editJob.product_size))?editJob.product_size:'')}" placeholder="e.g. 750x1000">
        </div>
      </div>
      <div class="form-row cols-1">
        <div class="form-group">
          <div class="fld-label">Routing Template <span style="color:var(--red)">*</span></div>
          <select id="f_routing" onchange="loadJobOps()">
            <option value="">— Select a routing template —</option>
            ${routingOpts}
          </select>
        </div>
      </div>
      <label class="checkbox-row">
        <input type="checkbox" id="f_urgent" ${editJob?.priority_flag?'checked':''}> 🚨 Mark as Emergency / Priority Job
      </label>

      <div class="form-section" style="margin-top:14px">Scheduling</div>
      <div class="form-row cols-3">
        <div class="form-group">
          <div class="fld-label">Due Date <span style="color:var(--red)">*</span></div>
          <input id="f_due_d" type="date" value="${dueVal}">
        </div>
        <div class="form-group">
          <div class="fld-label">Material Ready Date</div>
          <input id="f_mat_d" type="date" value="${matVal}" title="Job won't schedule before this date">
        </div>
        <div class="form-group">
          <div class="fld-label">Not Before Date</div>
          <input id="f_nb_d" type="date" value="${nbVal}" title="Earliest any operation can start">
        </div>
      </div>

      <div class="form-section" style="margin-top:14px">Notes</div>
      <div class="form-row cols-1">
        <div class="form-group">
          <textarea id="f_notes" rows="2" placeholder="Special instructions, material details…">${escHtml(editJob?.notes||'')}</textarea>
        </div>
      </div>

      <div class="form-section" style="margin-top:14px">
        Operations <small style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">(override times for this job)</small>
      </div>
      <div id="jobOpsWrap">
        <div style="color:var(--muted);font-size:12px;padding:4px 0">Select a routing template above</div>
      </div>

    </div>
    <div class="editor-footer">
      <button class="btn btn-ghost" onclick="goBack('/jobs')">Cancel</button>
      <button class="btn btn-primary" id="saveJobBtn" onclick="saveJobPage(${editId||'null'})">${editJob?'Save Changes':'Create Job'}</button>
    </div>
  </div>`;

  // If editing, pre-load ops
  if (editJob?.routing_id) {
    document.getElementById('f_routing').value = editJob.routing_id;
    await loadJobOps();
    // Apply any existing overrides
    if (editJob.op_overrides) {
      try {
        const ovs = typeof editJob.op_overrides === 'string'
          ? JSON.parse(editJob.op_overrides) : editJob.op_overrides;
        ovs.forEach((ov, i) => {
          const siEl = document.getElementById(`opsetup_${i}`);
          const wiEl = document.getElementById(`opwork_${i}`);
          const ckEl = document.getElementById(`opchk_${i}`);
          if (siEl && ov.setup_time_mins != null) siEl.value = Math.round(ov.setup_time_mins);
          if (wiEl && ov.work_time_mins  != null) wiEl.value = Math.round(ov.work_time_mins);
          if (ckEl && ov.included === false) {
            ckEl.checked = false;
            toggleOp(i, false);
          }
        });
      } catch(e) {}
    }
  }

  // Wire size select
  jeOnSizeChange();
}

function jeOnSizeChange(){
  const sel = document.getElementById('f_size_sel');
  const cw  = document.getElementById('f_size_custom_wrap');
  if(cw) cw.style.display = sel?.value === 'custom' ? '' : 'none';
}

function jeOnCustomerChange(){
  const sel = document.getElementById('f_cust_id');
  const txt = document.getElementById('f_cust');
  if(!sel||!txt) return;
  if(sel.value === '__new__'){
    txt.style.display = 'block'; txt.value = ''; txt.focus();
  } else {
    txt.style.display = 'none';
    txt.value = sel.value ? (allCustomers.find(c=>c.id==sel.value)?.name||'') : '';
  }
}

async function saveJobPage(editId){
  const custIdVal = document.getElementById('f_cust_id')?.value;
  const custId    = (custIdVal && custIdVal !== '__new__' && custIdVal !== '') ? parseInt(custIdVal) : null;
  const custName  = custId
    ? (allCustomers.find(c=>c.id==custId)?.name||'')
    : (document.getElementById('f_cust')?.value||'').trim();

  const sizeSel  = document.getElementById('f_size_sel')?.value;
  const size     = sizeSel === 'custom'
    ? (document.getElementById('f_size_custom')?.value||'').trim()
    : sizeSel;

  const due  = document.getElementById('f_due_d')?.value;
  const matD = document.getElementById('f_mat_d')?.value;
  const nbD  = document.getElementById('f_nb_d')?.value;
  const rid  = document.getElementById('f_routing')?.value;

  if(!custName){ toast('Select a customer','error'); return; }
  if(!size)    { toast('Enter product size','error'); return; }
  if(!due)     { toast('Select a due date','error');  return; }
  if(!rid)     { toast('Select a routing','error');   return; }
  if(!jobFormOps.length){ toast('Routing has no operations','error'); return; }

  const ovs = jobFormOps.map((op,i)=>({
    operation_id:    op.operation_id,
    setup_time_mins: parseFloat(document.getElementById(`opsetup_${i}`)?.value)||op.setup_time_mins||0,
    work_time_mins:  parseFloat(document.getElementById(`opwork_${i}`)?.value)||(op.work_time_mins||(op.work_time_hrs||0)*60),
    work_time_hrs:   (parseFloat(document.getElementById(`opwork_${i}`)?.value)||(op.work_time_mins||(op.work_time_hrs||0)*60))/60,
    included:        document.getElementById(`opchk_${i}`)?.checked ?? true,
  }));

  const data = {
    customer_id:         custId,
    customer_name:       custName,
    po_number:           document.getElementById('f_po')?.value.trim()||'',
    product_type:        document.getElementById('f_ptype')?.value,
    product_size:        size,
    product_variant:     document.getElementById('f_variant')?.value.trim()||'',
    due_date:            due + 'T08:00:00',
    material_ready_date: matD ? matD + 'T08:00:00' : null,
    not_before:          nbD  ? nbD  + 'T08:00:00' : null,
    routing_id:          parseInt(rid),
    priority_flag:       document.getElementById('f_urgent')?.checked||false,
    notes:               document.getElementById('f_notes')?.value||'',
    total_price:         document.getElementById('f_price')?.value||null,
    op_overrides:        ovs,
    job_number:          document.getElementById('f_jobnum')?.value.trim()||null,
  };

  setLoading('saveJobBtn', true);
  try{
    if(editId && editId !== 'null') await api('PUT', `/api/jobs/${editId}`, data);
    else await api('POST', '/api/jobs', data);
    toast(editId && editId !== 'null' ? 'Job updated!' : 'Job created!');
    await loadAll(); navigate('/jobs');
  }catch(e){ toast(e.message,'error'); }
  finally{ setLoading('saveJobBtn', false); }
}
