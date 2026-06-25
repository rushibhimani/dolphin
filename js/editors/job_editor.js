/**
 * Dolphin ERP — Job Editor (full-page, replaces modal)
 * Routes: #/jobs/new, #/jobs/:id (handled via router as 'job-edit')
 *
 * Major change (migration 029): the product fields are now dynamic. The
 * available product types, attributes (Size, Type, Mounting, Cavities,
 * Liner Type, …), and allowed values per attribute all come from the
 * product schema admin page. This editor:
 *
 *   1. Fetches /api/product-schema on load
 *   2. Renders attribute inputs dynamically based on the chosen product type
 *   3. Each attribute is a "combo" — dropdown of known values + free text.
 *      Typing a new value auto-saves it to the schema on submit.
 *   4. Routing source toggle: "Template" picks an existing Routing,
 *      "Custom" lets the user add operations row-by-row, optionally saving
 *      the result as a new template via the existing /save-inline endpoint.
 */

// Module-level state — survives between helper invocations on the same page
let _schema = { product_types: [] };   // from /api/product-schema
let _routingMode = 'template';         // 'template' | 'custom'
const JOB_OPED_KEY = 'jobCustom';      // shared op-editor instance key for custom ops

async function renderJobEditor(editId) {
  await loadAll();

  // Schema is needed to build the product field inputs. If the fetch fails
  // (e.g. fresh DB before migration ran), fall back to a minimal default so
  // the form is still usable.
  try {
    _schema = await api('GET', '/api/product-schema');
  } catch (e) {
    console.warn('Schema fetch failed, using fallback:', e.message);
    _schema = { product_types: [{
      id: 0, name: 'Punch', is_active: true,
      attributes: [{ id: 0, name: 'Size', is_required: true, values: [] }],
    }]};
  }

  let editJob = null;
  if (editId) editJob = await api('GET', `/api/jobs/${editId}`);

  jobFormOps = [];
  _routingMode = (editJob && !editJob.routing_id && editJob.has_inline_ops) ? 'custom' : 'template';
  const opEd = opEditorCreate(JOB_OPED_KEY, { container: 'customOpsWrap', emptyEl: 'customOpsEmpty' });

  const defDue = new Date(Date.now() + 14*86400000).toISOString().slice(0,10);

  const schemaTypes = _schema.product_types || [];
  const curPtype = editJob?.product_type
                || (schemaTypes[0]?.name)
                || '';

  const custOpts = allCustomers.map(c =>
    `<option value="${c.id}" ${editJob?.customer_id==c.id?'selected':''}>${escHtml(c.name)}</option>`
  ).join('');

  const routingOpts = allRoutings
    .filter(r => !r.is_custom && (!curPtype || r.product_type === curPtype))
    .map(r => `<option value="${r.id}" ${editJob?.routing_id==r.id?'selected':''}>${escHtml(r.name)}</option>`)
    .join('');

  const ptypeOpts = schemaTypes.map(pt =>
    `<option value="${escAttr(pt.name)}" ${curPtype===pt.name?'selected':''}>${escHtml(pt.name)}</option>`
  ).join('') + (
    // Allow editing a job whose product_type isn't in the active schema
    // anymore (e.g. it was renamed). Include it so the user isn't surprised.
    (editJob?.product_type && !schemaTypes.some(p => p.name === editJob.product_type))
      ? `<option value="${escAttr(editJob.product_type)}" selected>${escHtml(editJob.product_type)}</option>`
      : ''
  );

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

      <div class="form-section">
        Product Details
        <a href="#/product-schema" onclick="event.preventDefault();navigate('/product-schema')"
           style="font-size:11px;font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted);margin-left:10px;text-decoration:underline;cursor:pointer">
           Manage attributes →
        </a>
      </div>
      <div class="form-row cols-1">
        <div class="form-group">
          <div class="fld-label">Product Type <span style="color:var(--red)">*</span></div>
          <select id="f_ptype" onchange="jeOnProductTypeChange()">${ptypeOpts}</select>
        </div>
      </div>

      <!-- Dynamic attribute inputs render here — one row per attribute -->
      <div id="f_attrs_wrap"></div>

      <div class="form-section" style="margin-top:14px">
        Routing
        <small style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted);margin-left:8px">
          Pick a saved template, or build operations for this job manually
        </small>
      </div>
      <div class="routing-mode-tabs">
        <label class="routing-mode-tab ${_routingMode==='template'?'active':''}">
          <input type="radio" name="routing_mode" value="template" ${_routingMode==='template'?'checked':''}
                 onchange="jeSetRoutingMode('template')">
          <span>Use template</span>
        </label>
        <label class="routing-mode-tab ${_routingMode==='custom'?'active':''}">
          <input type="radio" name="routing_mode" value="custom" ${_routingMode==='custom'?'checked':''}
                 onchange="jeSetRoutingMode('custom')">
          <span>Custom operations</span>
        </label>
      </div>

      <div id="f_routing_template_pane" style="display:${_routingMode==='template'?'':'none'}">
        <div class="form-row cols-1" style="margin-top:8px">
          <div class="form-group">
            <div class="fld-label">Routing Template <span style="color:var(--red)">*</span></div>
            <select id="f_routing" onchange="loadJobOps()">
              <option value="">— Select a routing template —</option>
              ${routingOpts}
            </select>
          </div>
        </div>
      </div>

      <div id="f_routing_custom_pane" style="display:${_routingMode==='custom'?'':'none'}">
        <div style="margin-top:8px">
          <div style="font-size:11px;color:var(--muted);margin-bottom:6px">
            Add the operations this job needs, in order. Same options as a routing template —
            machines, formula-based time, sub-operations, and outside/vendor steps.
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);padding:4px 8px 6px;border-bottom:1px solid var(--border);margin-bottom:6px">
            <span>Name → Machine → Setup(min) → Work(min) | ⚡ = Formula mode</span>
            <span>☑ = Optional</span>
          </div>
          <div id="customOpsWrap"></div>
          <div id="customOpsEmpty" style="padding:14px;text-align:center;background:var(--surface);border:1px dashed var(--border);border-radius:6px;color:var(--muted);font-size:12px">
            No operations yet. Click <b>+ Add Operation</b> to start.
          </div>
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-ghost" style="font-size:12px" onclick="opEdAddRow('${JOB_OPED_KEY}')">+ Add Operation</button>
            <button class="btn btn-ghost" style="font-size:12px" onclick="jeStartFromTemplate()" title="Copy ops from a template, then edit">📋 Start from a template…</button>
          </div>
          <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
              <input type="checkbox" id="f_save_as_template"
                     onchange="document.getElementById('f_template_name_wrap').style.display=this.checked?'':'none'"
                     style="width:14px;height:14px;cursor:pointer;accent-color:var(--accent)">
              Save these as a reusable routing template
            </label>
          </div>
          <div id="f_template_name_wrap" style="display:none;margin-top:8px">
            <input type="text" id="f_template_name" placeholder="Template name (e.g. Punch 600×600 — Lower Plain)"
                   style="width:100%;max-width:400px">
          </div>
        </div>
      </div>

      <label class="checkbox-row" style="margin-top:12px">
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

      <div class="form-section" id="opsHeader" style="margin-top:14px;display:${_routingMode==='template'?'':'none'}">
        Operations <small style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">(override times for this job)</small>
      </div>
      <div id="jobOpsWrap" style="display:${_routingMode==='template'?'':'none'}">
        <div style="color:var(--muted);font-size:12px;padding:4px 0">Select a routing template above</div>
      </div>

    </div>
    <div class="editor-footer">
      <button class="btn btn-ghost" onclick="goBack('/jobs')">Cancel</button>
      <button class="btn btn-primary" id="saveJobBtn" onclick="saveJobPage(${editId||'null'})">${editJob?'Save Changes':'Create Job'}</button>
    </div>
  </div>`;

  _renderAttributeInputs(curPtype, editJob);

  if (editJob?.routing_id) {
    document.getElementById('f_routing').value = editJob.routing_id;
    await loadJobOps();
    if (editJob.op_overrides) {
      try {
        const ov = typeof editJob.op_overrides === 'string' ? JSON.parse(editJob.op_overrides) : editJob.op_overrides;
        ov.forEach((o, i) => {
          if (o.included === false) {
            const ckEl = document.getElementById(`opchk_${i}`);
            if (ckEl) { ckEl.checked = false; toggleOp(i, false); }
          }
        });
      } catch(e) {}
    }
  } else if (_routingMode === 'custom') {
    opEd.setOps(editJob?.inline_ops || []);
    opEd.render();
  }
}

// ─── Dynamic attribute inputs ─────────────────────────────────────────────
// Rendering/collection logic lives in the shared attr_input_widget
// (js/editors/attr_input_widget.js) so the Order editor gets identical
// behavior. This file only knows its own container id ('f_attrs_wrap')
// and pre-fill logic specific to a Job record.

const JOB_ATTRS_CONTAINER = 'f_attrs_wrap';

/** Pulls existing attrs out of a Job record (product_attrs JSON, falling
 * back to the legacy product_size string on the Size attribute), then
 * renders via the shared widget. */
function _renderAttributeInputs(ptypeName, editJob) {
  let existingAttrs = {};
  if (editJob?.product_attrs) {
    try {
      existingAttrs = typeof editJob.product_attrs === 'string'
        ? JSON.parse(editJob.product_attrs) : editJob.product_attrs;
    } catch(e) {}
  }
  if (editJob?.product_size && !existingAttrs.Size) existingAttrs.Size = editJob.product_size;
  attrInputsRender(_schema, ptypeName, JOB_ATTRS_CONTAINER, existingAttrs);
}

function jeOnProductTypeChange() {
  const ptype = document.getElementById('f_ptype')?.value;
  if (!ptype) return;
  // Preserve already-typed values where attr names overlap, so switching
  // Punch → Die Frame doesn't wipe a shared "Size" the user already typed.
  const currentAttrs = attrInputsCollect(JOB_ATTRS_CONTAINER);
  attrInputsRender(_schema, ptype, JOB_ATTRS_CONTAINER, currentAttrs);
  filterRoutingsByType(ptype);
}

function _collectAttributeValues() {
  return attrInputsCollect(JOB_ATTRS_CONTAINER);
}

// ─── Routing mode toggle ──────────────────────────────────────────────────

function jeSetRoutingMode(mode) {
  _routingMode = mode;
  document.getElementById('f_routing_template_pane').style.display = mode==='template' ? '' : 'none';
  document.getElementById('f_routing_custom_pane').style.display   = mode==='custom'   ? '' : 'none';
  const opsWrap   = document.getElementById('jobOpsWrap');
  const opsHeader = document.getElementById('opsHeader');
  if (opsWrap)   opsWrap.style.display   = mode==='template' ? '' : 'none';
  if (opsHeader) opsHeader.style.display = mode==='template' ? '' : 'none';
  document.querySelectorAll('.routing-mode-tab').forEach(t => {
    const isActive = t.querySelector('input').value === mode;
    t.classList.toggle('active', isActive);
  });
  if (mode === 'custom') _opEd(JOB_OPED_KEY)?.render();
}

// ─── Custom operations editor ─────────────────────────────────────────────
// Row rendering, formula/sub-op/outside-vendor handling all live in the
// shared op_editor_widget (js/editors/op_editor_widget.js) — see opEd above.

function jeStartFromTemplate() {
  const ptype = document.getElementById('f_ptype')?.value || '';
  const eligible = (allRoutings || []).filter(r => !r.is_custom && (!ptype || r.product_type === ptype));
  if (!eligible.length) {
    toast('No templates available for this product type', 'error');
    return;
  }
  showModal(
    'Start from a template',
    `<div style="font-size:12px;color:var(--muted);margin-bottom:10px">
       Pick a routing to copy its operations from. You can still edit everything afterward.
     </div>
     <div class="form-group">
       <select id="je_tpl_pick" style="width:100%">
         ${eligible.map(r => `<option value="${r.id}">${escHtml(r.name)}</option>`).join('')}
       </select>
     </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" onclick="_jeApplyTemplateChoice()">Load Operations</button>`
  );
}

async function _jeApplyTemplateChoice() {
  const rid = document.getElementById('je_tpl_pick')?.value;
  if (!rid) return;
  try {
    const full = await api('GET', `/api/routings/${rid}`);
    const opEd = _opEd(JOB_OPED_KEY);
    opEd.setOps(full.operations || []);
    opEd.render();
    closeModal();
    toast(`Loaded ${(full.operations||[]).length} operations from "${full.name}"`);
  } catch(e) { toast(e.message, 'error'); }
}

// ─── Customer change ──────────────────────────────────────────────────────

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

// ─── Save ─────────────────────────────────────────────────────────────────

async function saveJobPage(editId){
  const custIdVal = document.getElementById('f_cust_id')?.value;
  const custId    = (custIdVal && custIdVal !== '__new__' && custIdVal !== '') ? parseInt(custIdVal) : null;
  const custName  = custId
    ? (allCustomers.find(c=>c.id==custId)?.name||'')
    : (document.getElementById('f_cust')?.value||'').trim();

  const ptype = document.getElementById('f_ptype')?.value;
  const attrs = _collectAttributeValues();

  // Validate required attributes
  const missing = attrInputsMissingRequired(JOB_ATTRS_CONTAINER);

  const due  = document.getElementById('f_due_d')?.value;
  const matD = document.getElementById('f_mat_d')?.value;
  const nbD  = document.getElementById('f_nb_d')?.value;

  if(!custName){ toast('Select a customer','error'); return; }
  if(!ptype)   { toast('Select a product type','error'); return; }
  if(missing.length){ toast(`Required: ${missing.join(', ')}`,'error'); return; }
  if(!due)     { toast('Select a due date','error');  return; }

  let routingId = null;
  let inlineOps = null;
  let ovs = [];

  if (_routingMode === 'template') {
    const rid = document.getElementById('f_routing')?.value;
    if(!rid){ toast('Select a routing template (or switch to Custom)','error'); return; }
    if(!jobFormOps.length){ toast('Routing has no operations','error'); return; }
    routingId = parseInt(rid);
    ovs = jobFormOps.map((op,i)=>({
      operation_id:    op.operation_id,
      setup_time_mins: parseFloat(document.getElementById(`opsetup_${i}`)?.value)||op.setup_time_mins||0,
      work_time_mins:  parseFloat(document.getElementById(`opwork_${i}`)?.value)||(op.work_time_mins||(op.work_time_hrs||0)*60),
      work_time_hrs:   (parseFloat(document.getElementById(`opwork_${i}`)?.value)||(op.work_time_mins||(op.work_time_hrs||0)*60))/60,
      included:        document.getElementById(`opchk_${i}`)?.checked ?? true,
    }));
  } else {
    const opEd = _opEd(JOB_OPED_KEY);
    opEd.sync();
    const customOps = opEd.getOps();
    if (!customOps.length) { toast('Add at least one operation','error'); return; }
    const invalid = customOps.find(o => !o.name?.trim() || (o.op_type !== 'outside' && !o.work_center_id));
    if (invalid) { toast('Every operation needs a name, and a machine unless marked Outside','error'); return; }
    inlineOps = customOps.map((op, i) => ({
      sequence:              i + 1,
      name:                  op.name.trim(),
      work_center_id:        op.work_center_id || null,
      setup_time_mins:       +op.setup_time_mins || 0,
      work_time_mins:        +op.work_time_mins || 0,
      work_time_hrs:         op.work_time_hrs != null ? +op.work_time_hrs : (+op.work_time_mins || 0) / 60,
      is_optional:           !!op.is_optional,
      op_type:               op.op_type || 'inhouse',
      outside_vendor:        op.outside_vendor || null,
      outside_transit_days:  op.outside_transit_days || null,
      formula_type:          op.formula_type || null,
      mrr:                   op.mrr ?? null,
      depth_mm:              op.depth_mm ?? null,
      feed_rate:             op.feed_rate ?? null,
      dim_x_source:          op.dim_x_source || null,
      dim_y_source:          op.dim_y_source || null,
      sub_operations:        op.sub_operations || [],
    }));
  }

  // Best-effort: persist any user-typed attribute values that aren't yet
  // in the schema so they appear in future dropdowns.
  await attrInputsAutoSaveNew(_schema, attrs, ptype);

  // Derive product_size + product_variant from the structured attrs for
  // backward compatibility with the dispatch sheet and Jobs list display.
  const { size, variant } = attrInputsDeriveLegacy(attrs);

  const data = {
    customer_id:         custId,
    customer_name:       custName,
    po_number:           document.getElementById('f_po')?.value.trim()||'',
    product_type:        ptype,
    product_size:        size,
    product_variant:     variant,
    product_attrs:       attrs,
    due_date:            due + 'T08:00:00',
    material_ready_date: matD ? matD + 'T08:00:00' : null,
    not_before:          nbD  ? nbD  + 'T08:00:00' : null,
    routing_id:          routingId,
    inline_ops:          inlineOps,
    priority_flag:       document.getElementById('f_urgent')?.checked||false,
    notes:               document.getElementById('f_notes')?.value||'',
    total_price:         document.getElementById('f_price')?.value||null,
    op_overrides:        ovs,
    job_number:          document.getElementById('f_jobnum')?.value.trim()||null,
  };

  setLoading('saveJobBtn', true);
  try{
    let savedJob;
    if(editId && editId !== 'null') {
      savedJob = await api('PUT', `/api/jobs/${editId}`, data);
    } else {
      savedJob = await api('POST', '/api/jobs', data);
    }

    if (_routingMode === 'custom' && document.getElementById('f_save_as_template')?.checked) {
      const tplName = (document.getElementById('f_template_name')?.value || '').trim()
                   || `${ptype} ${size}${variant?' — '+variant:''}`;
      try {
        await api('POST', `/api/jobs/${savedJob.id}/save-inline-as-routing`, { name: tplName });
        toast(`Job created and saved as template "${tplName}"`);
      } catch(e) {
        toast(`Job created, but template save failed: ${e.message}`, 'error');
      }
    } else {
      toast(editId && editId !== 'null' ? 'Job updated!' : 'Job created!');
    }
    await loadAll(); navigate('/jobs');
  }catch(e){ toast(e.message,'error'); }
  finally{ setLoading('saveJobBtn', false); }
}
