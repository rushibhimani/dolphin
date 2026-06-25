/**
 * Dolphin ERP — Product Schema Type Editor (full page)
 * Routes: #/product-schema/new, #/product-schema/:id
 *
 * Frappe-DocType-builder inspired: one product type per page. The type
 * name is a click-to-edit title field. Attributes (Size, Mounting,
 * Cavities, …) are listed as rows — click a name to rename it inline,
 * toggle "Required", drag the handle to reorder, and manage its allowed
 * values as a chip list with inline add/rename/delete. Every mutation
 * saves immediately (no big Save button, matching how the rest of this
 * app already treats schema edits) — there is no prompt()/confirm()
 * anywhere; destructive actions go through the existing confirm2()
 * overlay, same as the rest of the app.
 */

let _pte_type = null;          // the product type currently being edited, or null = "new" mode
let _pte_dragAttrId = null;    // attribute id currently being dragged, for reorder

async function renderProductSchemaEditor(typeId){
  if (!typeId) {
    // "New product type" — just ask for a name, then redirect into edit mode.
    // (Reachable via direct nav; the list page's inline add row is the normal path.)
    document.getElementById('content').innerHTML = `
      <div class="editor-page">
        <div class="editor-header">
          <h2 class="editor-title">New Product Type</h2>
          <div class="editor-subtitle">Give it a name, then add attributes</div>
        </div>
        <div class="editor-body" style="max-width:480px">
          <div class="form-group">
            <div class="fld-label">Name <span style="color:var(--red)">*</span></div>
            <input id="pte_new_name" placeholder="e.g. Punch" onkeydown="if(event.key==='Enter')pteCreateAndEnter()">
          </div>
        </div>
        <div class="editor-footer">
          <button class="btn btn-ghost" onclick="navigate('/product-schema')">Cancel</button>
          <button class="btn btn-primary" onclick="pteCreateAndEnter()">Create</button>
        </div>
      </div>`;
    setTimeout(() => document.getElementById('pte_new_name')?.focus(), 30);
    return;
  }

  await _pteLoad(typeId);
}

async function pteCreateAndEnter(){
  const name = (document.getElementById('pte_new_name')?.value || '').trim();
  if (!name) { toast('Enter a name first', 'error'); return; }
  try {
    const created = await api('POST', '/api/product-schema/types', { name });
    navigate(`/product-schema/${created.id}`, true);
  } catch(e) { toast(e.message, 'error'); }
}

async function _pteLoad(typeId){
  const content = document.getElementById('content');
  try {
    const schema = await api('GET', '/api/product-schema');
    _pte_type = (schema.product_types || []).find(p => p.id === typeId);
  } catch(e) {
    content.innerHTML = `<div class="empty">${escHtml(e.message)}</div>`;
    return;
  }
  if (!_pte_type) {
    content.innerHTML = `<div class="empty">Product type not found. <a href="#" onclick="event.preventDefault();navigate('/product-schema')">Back to list</a></div>`;
    return;
  }
  _pteRender();
}

function _pteRender(){
  const pt = _pte_type;
  const attrCount = pt.attributes.length;

  document.getElementById('content').innerHTML = `
    <div class="editor-page">
      <div class="editor-header">
        <h2 class="editor-title editable-title" id="pte_title" onclick="pteEditTitle()" title="Click to rename">
          ${escHtml(pt.name)}
        </h2>
        <div class="editor-subtitle">${attrCount} attribute${attrCount===1?'':'s'} · drives the Job &amp; Order forms for this product type</div>
      </div>
      <div class="editor-body">
        <div class="form-section" style="margin-top:0">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span>Attributes</span>
            <button class="btn btn-secondary" style="font-size:11px;padding:4px 9px" onclick="pteAddAttribute()">+ Add Attribute</button>
          </div>
        </div>
        <div id="pteAttrList">${_pteAttrListHtml()}</div>
      </div>
      <div class="editor-footer" style="justify-content:space-between">
        <button class="btn btn-ghost" style="color:var(--red)" onclick="pteDeleteType()">Delete Product Type</button>
        <button class="btn btn-ghost" onclick="navigate('/product-schema')">Done</button>
      </div>
    </div>`;
}

function _pteAttrListHtml(){
  const attrs = _pte_type.attributes;
  if (!attrs.length) {
    return `<div style="padding:16px 0;text-align:center;color:var(--muted);font-size:13px;border:1px dashed var(--border);border-radius:8px">
      No attributes yet. Click "+ Add Attribute" to define one (e.g. Size, Mounting, Cavities).
    </div>`;
  }
  return attrs.map(a => _pteAttrRowHtml(a)).join('');
}

function _pteAttrRowHtml(a){
  return `
    <div class="pte-attr-row" id="pte-attr-${a.id}"
         draggable="true"
         ondragstart="pteDragStart(event, ${a.id})"
         ondragover="pteDragOver(event)"
         ondrop="pteDrop(event, ${a.id})"
         ondragend="pteDragEnd(event)">
      <div class="pte-attr-head">
        <span class="pte-drag-handle" title="Drag to reorder">⠿</span>
        <span class="pte-attr-name editable-field" onclick="pteEditAttrName(${a.id})" title="Click to rename">
          ${escHtml(a.name)}
        </span>
        ${a.is_required ? '<span class="schema-req-badge">Required</span>' : ''}
        <span style="flex:1"></span>
        <label class="pte-required-toggle" title="Require this field on the Job form">
          <input type="checkbox" ${a.is_required?'checked':''} onchange="pteToggleRequired(${a.id}, this.checked)">
          Required
        </label>
        <button class="btn btn-ghost btn-xs" style="color:var(--red)" onclick="pteDeleteAttribute(${a.id})" title="Delete attribute">Delete</button>
      </div>
      <div class="schema-vals" style="padding:0 14px 12px 38px">
        ${a.values.map(v => `
          <span class="schema-val-chip" id="pte-val-${v.id}">
            <span class="schema-val-text editable-field" onclick="pteEditValue(${v.id})" title="Click to rename">${escHtml(v.value)}</span>
            <button class="schema-val-del" onclick="pteDeleteValue(${v.id})" title="Remove">×</button>
          </span>
        `).join('')}
        <span class="schema-val-add">
          <input type="text" placeholder="+ Add value" id="pte-newval-${a.id}"
                 onkeydown="if(event.key==='Enter'){pteAddValue(${a.id})}"
                 maxlength="64">
          <button class="schema-val-add-btn" onclick="pteAddValue(${a.id})" title="Add">+</button>
        </span>
      </div>
    </div>`;
}

// ─── Title (product type name) — click-to-edit ─────────────────────────────

function pteEditTitle(){
  const el = document.getElementById('pte_title');
  if (!el || el.querySelector('input')) return;
  const current = _pte_type.name;
  el.innerHTML = `<input type="text" id="pte_title_input" value="${current.replace(/"/g,'&quot;')}"
    style="font-size:inherit;font-weight:inherit;font-family:inherit;width:100%;max-width:360px"
    onkeydown="if(event.key==='Enter')pteSaveTitle(); if(event.key==='Escape')_pteRender()"
    onblur="pteSaveTitle()">`;
  const inp = document.getElementById('pte_title_input');
  inp.focus(); inp.select();
}

async function pteSaveTitle(){
  const inp = document.getElementById('pte_title_input');
  if (!inp) return;
  const newName = inp.value.trim();
  if (!newName || newName === _pte_type.name) { _pteRender(); return; }
  try {
    await api('PUT', `/api/product-schema/types/${_pte_type.id}`, { name: newName });
    _pte_type.name = newName;
    toast('Renamed');
  } catch(e) { toast(e.message, 'error'); }
  _pteRender();
}

async function pteDeleteType(){
  const ok = await confirm2(`Delete product type "${_pte_type.name}"? Existing jobs using it keep their data — this only removes it from the dropdowns going forward.`, 'Delete');
  if (!ok) return;
  try {
    await api('DELETE', `/api/product-schema/types/${_pte_type.id}`);
    toast('Deleted');
    navigate('/product-schema');
  } catch(e) { toast(e.message, 'error'); }
}

// ─── Attributes ─────────────────────────────────────────────────────────

async function pteAddAttribute(){
  try {
    const created = await api('POST', '/api/product-schema/attributes',
      { product_type_id: _pte_type.id, name: 'New Attribute' });
    _pte_type.attributes.push({ ...created, values: created.values || [] });
    _pteRender();
    pteEditAttrName(created.id);
  } catch(e) { toast(e.message, 'error'); }
}

function pteEditAttrName(attrId){
  const a = _pte_type.attributes.find(x => x.id === attrId);
  const el = document.querySelector(`#pte-attr-${attrId} .pte-attr-name`);
  if (!a || !el || el.querySelector('input')) return;
  el.innerHTML = `<input type="text" id="pte_attrname_${attrId}" value="${a.name.replace(/"/g,'&quot;')}"
    style="font-size:inherit;font-weight:inherit;font-family:inherit;width:160px"
    onkeydown="if(event.key==='Enter')pteSaveAttrName(${attrId}); if(event.key==='Escape')_pteRender()"
    onblur="pteSaveAttrName(${attrId})" onclick="event.stopPropagation()">`;
  const inp = document.getElementById(`pte_attrname_${attrId}`);
  inp.focus(); inp.select();
}

async function pteSaveAttrName(attrId){
  const inp = document.getElementById(`pte_attrname_${attrId}`);
  if (!inp) return;
  const a = _pte_type.attributes.find(x => x.id === attrId);
  const newName = inp.value.trim();
  if (!newName || newName === a.name) { _pteRender(); return; }
  try {
    await api('PUT', `/api/product-schema/attributes/${attrId}`, { name: newName });
    a.name = newName;
    toast('Renamed');
  } catch(e) { toast(e.message, 'error'); }
  _pteRender();
}

async function pteToggleRequired(attrId, isRequired){
  const a = _pte_type.attributes.find(x => x.id === attrId);
  try {
    await api('PUT', `/api/product-schema/attributes/${attrId}`, { is_required: isRequired });
    if (a) a.is_required = isRequired;
    _pteRender();
  } catch(e) { toast(e.message, 'error'); }
}

async function pteDeleteAttribute(attrId){
  const a = _pte_type.attributes.find(x => x.id === attrId);
  const ok = await confirm2(`Delete attribute "${a?.name||''}"? Existing jobs using it keep their data.`, 'Delete');
  if (!ok) return;
  try {
    await api('DELETE', `/api/product-schema/attributes/${attrId}`);
    _pte_type.attributes = _pte_type.attributes.filter(x => x.id !== attrId);
    toast('Deleted');
    _pteRender();
  } catch(e) { toast(e.message, 'error'); }
}

// ─── Attribute reordering (drag & drop) ────────────────────────────────────

function pteDragStart(ev, attrId){
  _pte_dragAttrId = attrId;
  ev.dataTransfer.effectAllowed = 'move';
  ev.currentTarget.classList.add('dragging');
}

function pteDragOver(ev){
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
}

function pteDragEnd(ev){
  ev.currentTarget.classList.remove('dragging');
}

let _pte_reorderDebounce = null;

async function pteDrop(ev, targetAttrId){
  ev.preventDefault();
  if (_pte_dragAttrId == null || _pte_dragAttrId === targetAttrId) return;
  const attrs = _pte_type.attributes;
  const fromIdx = attrs.findIndex(a => a.id === _pte_dragAttrId);
  const toIdx   = attrs.findIndex(a => a.id === targetAttrId);
  if (fromIdx === -1 || toIdx === -1) return;
  const [moved] = attrs.splice(fromIdx, 1);
  attrs.splice(toIdx, 0, moved);
  _pte_dragAttrId = null;
  _pteRender();
  // Persist new order — debounced so rapid successive drags collapse into
  // one PUT batch instead of racing each other across the network.
  clearTimeout(_pte_reorderDebounce);
  _pte_reorderDebounce = setTimeout(async () => {
    try {
      await Promise.all(attrs.map((a, i) =>
        api('PUT', `/api/product-schema/attributes/${a.id}`, { display_order: i })
      ));
    } catch(e) { toast('Reorder may not have saved: ' + e.message, 'error'); }
  }, 400);
}

// ─── Attribute values ──────────────────────────────────────────────────────

async function pteAddValue(attrId){
  const inp = document.getElementById(`pte-newval-${attrId}`);
  const value = (inp?.value || '').trim();
  if (!value) return;
  const a = _pte_type.attributes.find(x => x.id === attrId);
  try {
    const created = await api('POST', '/api/product-schema/values', { attribute_id: attrId, value });
    a.values.push(created);
    _pteRender();
    setTimeout(() => document.getElementById(`pte-newval-${attrId}`)?.focus(), 30);
  } catch(e) { toast(e.message, 'error'); }
}

function pteEditValue(valId){
  let val = null, owner = null;
  for (const a of _pte_type.attributes) {
    const v = a.values.find(x => x.id === valId);
    if (v) { val = v; owner = a; break; }
  }
  const el = document.querySelector(`#pte-val-${valId} .schema-val-text`);
  if (!val || !el || el.querySelector('input')) return;
  el.innerHTML = `<input type="text" id="pte_valtext_${valId}" value="${val.value.replace(/"/g,'&quot;')}"
    style="font-size:inherit;font-family:inherit;width:90px;border:0;background:transparent;outline:0;color:var(--text)"
    onkeydown="if(event.key==='Enter')pteSaveValue(${valId}); if(event.key==='Escape')_pteRender()"
    onblur="pteSaveValue(${valId})" onclick="event.stopPropagation()">`;
  const inp = document.getElementById(`pte_valtext_${valId}`);
  inp.focus(); inp.select();
}

async function pteSaveValue(valId){
  const inp = document.getElementById(`pte_valtext_${valId}`);
  if (!inp) return;
  let val = null;
  for (const a of _pte_type.attributes) {
    const v = a.values.find(x => x.id === valId);
    if (v) { val = v; break; }
  }
  const newVal = inp.value.trim();
  if (!val || !newVal || newVal === val.value) { _pteRender(); return; }
  try {
    await api('PUT', `/api/product-schema/values/${valId}`, { value: newVal });
    val.value = newVal;
    toast('Renamed');
  } catch(e) { toast(e.message, 'error'); }
  _pteRender();
}

async function pteDeleteValue(valId){
  let val = null, owner = null;
  for (const a of _pte_type.attributes) {
    const v = a.values.find(x => x.id === valId);
    if (v) { val = v; owner = a; break; }
  }
  if (!val) return;
  const ok = await confirm2(`Remove value "${val.value}" from the dropdown? Existing jobs using it keep their data.`, 'Remove');
  if (!ok) return;
  try {
    await api('DELETE', `/api/product-schema/values/${valId}`);
    owner.values = owner.values.filter(x => x.id !== valId);
    toast('Removed');
    _pteRender();
  } catch(e) { toast(e.message, 'error'); }
}
