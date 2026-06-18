/**
 * Dolphin ERP — Product Schema admin page
 *
 * Lets the manager define which attributes each product type has, and which
 * values each attribute can take. Drives the dynamic Job/Order create forms.
 *
 * Data shape from /api/product-schema:
 *   { product_types: [
 *       { id, name, display_order, is_active,
 *         attributes: [
 *           { id, name, display_order, is_required, is_active,
 *             values: [ { id, value, display_order, is_active } ] }
 *         ] }
 *     ] }
 *
 * Edits are saved immediately on blur / change — no big "Save All" button.
 * The UX goal: feel like a spreadsheet you can edit in place, with adds and
 * deletes confirmed inline. Soft-deletes preserve history.
 */

let _schemaCache = null;
let _expandedTypeId = null;  // which product type's attributes are expanded

async function renderProductSchema(){
  document.getElementById('topbarActions').innerHTML = `
    <button class="btn btn-primary" onclick="schemaAddType()">+ New Product Type</button>`;

  await schemaReload();
}

async function schemaReload(){
  const el = document.getElementById('content');
  el.innerHTML = `<div style="color:var(--muted);padding:20px">Loading schema…</div>`;
  try {
    _schemaCache = await api('GET', '/api/product-schema');
  } catch(e) {
    el.innerHTML = `<div class="empty">${e.message}</div>`;
    return;
  }
  _renderSchemaUI();
}

function _renderSchemaUI(){
  const el  = document.getElementById('content');
  const pts = _schemaCache?.product_types || [];

  if (!pts.length) {
    el.innerHTML = `
      <div class="card" style="padding:24px;text-align:center">
        <div style="font-size:14px;color:var(--muted);margin-bottom:14px">
          No product types yet. Add one to get started.
        </div>
        <button class="btn btn-primary" onclick="schemaAddType()">+ New Product Type</button>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div style="margin-bottom:16px">
      <div style="font-size:15px;font-weight:600">Product Schema</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">
        Define which attributes each product type has, and the allowed values for each.
        These drive the dropdowns on the Job and Order forms.
      </div>
    </div>
    <div class="schema-list">
      ${pts.map(pt => _renderTypeCard(pt)).join('')}
    </div>`;
}

function _renderTypeCard(pt){
  const isExpanded = pt.id === _expandedTypeId;
  const attrCount  = pt.attributes.length;
  const valCount   = pt.attributes.reduce((a, x) => a + x.values.length, 0);

  return `
    <div class="card schema-type-card" style="margin-bottom:10px;overflow:hidden">

      <!-- Type header — click to expand/collapse -->
      <div class="schema-type-head" onclick="schemaToggleType(${pt.id})">
        <div class="schema-type-head-left">
          <span class="schema-chev">${isExpanded?'▾':'▸'}</span>
          <span class="schema-type-name">${escHtml(pt.name)}</span>
          <span class="schema-type-meta">
            ${attrCount} attribute${attrCount===1?'':'s'} · ${valCount} value${valCount===1?'':'s'}
          </span>
        </div>
        <div class="schema-type-head-right" onclick="event.stopPropagation()">
          <button class="btn btn-ghost btn-xs" onclick="schemaRenameType(${pt.id},'${escAttr(pt.name)}')" title="Rename">Rename</button>
          <button class="btn btn-ghost btn-xs" onclick="schemaDeleteType(${pt.id},'${escAttr(pt.name)}')" title="Delete">Delete</button>
        </div>
      </div>

      ${isExpanded ? `
      <!-- Attribute list (expanded view) -->
      <div class="schema-attr-list">
        ${pt.attributes.map(a => _renderAttrRow(pt.id, a)).join('') || `
          <div style="padding:10px 14px;color:var(--muted);font-size:12px;font-style:italic">
            No attributes yet.
          </div>`}
        <div style="padding:8px 14px;border-top:1px solid var(--border)">
          <button class="btn btn-ghost btn-xs" onclick="schemaAddAttr(${pt.id})">+ Add Attribute</button>
        </div>
      </div>` : ''}
    </div>`;
}

function _renderAttrRow(ptId, a){
  return `
    <div class="schema-attr-row" id="attr-row-${a.id}">
      <div class="schema-attr-header">
        <div class="schema-attr-name-wrap">
          <span class="schema-attr-name">${escHtml(a.name)}</span>
          ${a.is_required?'<span class="schema-req-badge">Required</span>':''}
        </div>
        <div class="schema-attr-actions">
          <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);cursor:pointer;margin-right:8px">
            <input type="checkbox" ${a.is_required?'checked':''} onchange="schemaToggleRequired(${a.id}, this.checked)" style="width:13px;height:13px;cursor:pointer;accent-color:var(--accent)">
            Required
          </label>
          <button class="btn btn-ghost btn-xs" onclick="schemaRenameAttr(${a.id},'${escAttr(a.name)}')" title="Rename">Rename</button>
          <button class="btn btn-ghost btn-xs" onclick="schemaDeleteAttr(${a.id},'${escAttr(a.name)}')" title="Delete">Delete</button>
        </div>
      </div>
      <div class="schema-vals">
        ${a.values.map(v => `
          <span class="schema-val-chip" id="val-chip-${v.id}">
            <span class="schema-val-text">${escHtml(v.value)}</span>
            <button class="schema-val-edit" onclick="schemaRenameValue(${v.id},'${escAttr(v.value)}')" title="Rename">✎</button>
            <button class="schema-val-del"  onclick="schemaDeleteValue(${v.id},'${escAttr(v.value)}')" title="Delete">×</button>
          </span>
        `).join('')}
        <span class="schema-val-add">
          <input type="text" placeholder="+ Add value" id="newval-${a.id}"
                 onkeydown="if(event.key==='Enter'){schemaAddValue(${a.id})}"
                 maxlength="64">
          <button class="schema-val-add-btn" onclick="schemaAddValue(${a.id})" title="Add">+</button>
        </span>
      </div>
    </div>`;
}

// ─── Actions ──────────────────────────────────────────────────────────────

function schemaToggleType(ptId){
  _expandedTypeId = (_expandedTypeId === ptId) ? null : ptId;
  _renderSchemaUI();
}

async function schemaAddType(){
  const name = prompt('New product type name:');
  if (!name || !name.trim()) return;
  try {
    await api('POST', '/api/product-schema/types', { name: name.trim() });
    toast('Product type added');
    await schemaReload();
  } catch(e) { toast(e.message, 'error'); }
}

async function schemaRenameType(ptId, curName){
  const newName = prompt('Rename product type:', curName);
  if (!newName || newName.trim() === curName) return;
  try {
    await api('PUT', `/api/product-schema/types/${ptId}`, { name: newName.trim() });
    toast('Renamed');
    await schemaReload();
  } catch(e) { toast(e.message, 'error'); }
}

async function schemaDeleteType(ptId, name){
  if (!confirm(`Delete product type "${name}"?\n\nExisting jobs using it will keep their data — this only removes it from the dropdowns going forward.`)) return;
  try {
    await api('DELETE', `/api/product-schema/types/${ptId}`);
    toast('Deleted');
    if (_expandedTypeId === ptId) _expandedTypeId = null;
    await schemaReload();
  } catch(e) { toast(e.message, 'error'); }
}

async function schemaAddAttr(ptId){
  const name = prompt('New attribute name (e.g. Size, Type, Mounting):');
  if (!name || !name.trim()) return;
  try {
    await api('POST', '/api/product-schema/attributes',
              { product_type_id: ptId, name: name.trim() });
    toast('Attribute added');
    await schemaReload();
  } catch(e) { toast(e.message, 'error'); }
}

async function schemaRenameAttr(attrId, curName){
  const newName = prompt('Rename attribute:', curName);
  if (!newName || newName.trim() === curName) return;
  try {
    await api('PUT', `/api/product-schema/attributes/${attrId}`, { name: newName.trim() });
    toast('Renamed');
    await schemaReload();
  } catch(e) { toast(e.message, 'error'); }
}

async function schemaDeleteAttr(attrId, name){
  if (!confirm(`Delete attribute "${name}"?\n\nExisting jobs using it will keep their data.`)) return;
  try {
    await api('DELETE', `/api/product-schema/attributes/${attrId}`);
    toast('Deleted');
    await schemaReload();
  } catch(e) { toast(e.message, 'error'); }
}

async function schemaToggleRequired(attrId, isRequired){
  try {
    await api('PUT', `/api/product-schema/attributes/${attrId}`,
              { is_required: isRequired });
    // Update local cache to avoid a full reload (which would collapse the card)
    _schemaCache?.product_types?.forEach(pt => {
      const a = pt.attributes.find(x => x.id === attrId);
      if (a) a.is_required = isRequired;
    });
  } catch(e) { toast(e.message, 'error'); }
}

async function schemaAddValue(attrId){
  const inp = document.getElementById(`newval-${attrId}`);
  const value = (inp?.value || '').trim();
  if (!value) return;
  try {
    await api('POST', '/api/product-schema/values',
              { attribute_id: attrId, value });
    inp.value = '';
    await schemaReload();
    inp.focus && document.getElementById(`newval-${attrId}`)?.focus();
  } catch(e) { toast(e.message, 'error'); }
}

async function schemaRenameValue(valId, curValue){
  const newValue = prompt('Rename value:', curValue);
  if (!newValue || newValue.trim() === curValue) return;
  try {
    await api('PUT', `/api/product-schema/values/${valId}`, { value: newValue.trim() });
    await schemaReload();
  } catch(e) { toast(e.message, 'error'); }
}

async function schemaDeleteValue(valId, value){
  if (!confirm(`Remove value "${value}" from the dropdown?\n\nExisting jobs using it will keep their data.`)) return;
  try {
    await api('DELETE', `/api/product-schema/values/${valId}`);
    await schemaReload();
  } catch(e) { toast(e.message, 'error'); }
}

// ─── small helpers ────────────────────────────────────────────────────────
function escAttr(s){
  return String(s||'').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
