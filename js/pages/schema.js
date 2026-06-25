/**
 * Dolphin ERP — Product Schema (list page)
 *
 * Frappe-DocType-list inspired: each "Product Type" is a row you click to
 * open its own full-page editor (js/editors/schema_type_editor.js), where
 * attributes and their allowed values are managed. No prompt()/confirm()
 * popups anywhere — creation happens inline at the top of this list, and
 * the editor page handles renames/deletes with click-to-edit fields and
 * the existing confirm2() overlay.
 *
 * Data shape from /api/product-schema:
 *   { product_types: [
 *       { id, name, display_order, is_active,
 *         attributes: [
 *           { id, name, display_order, is_required, is_active,
 *             values: [ { id, value, display_order, is_active } ] }
 *         ] }
 *     ] }
 */

let _schemaListCache = null;
let _schemaAddingNew = false;

async function renderProductSchema(){
  document.getElementById('topbarActions').innerHTML = `
    <button class="btn btn-primary" onclick="schemaListShowAddRow()">+ New Product Type</button>`;
  _schemaAddingNew = false;
  await schemaListReload();
}

async function schemaListReload(){
  const el = document.getElementById('content');
  el.innerHTML = `<div style="color:var(--muted);padding:20px">Loading schema…</div>`;
  try {
    _schemaListCache = await api('GET', '/api/product-schema');
  } catch(e) {
    el.innerHTML = `<div class="empty">${escHtml(e.message)}</div>`;
    return;
  }
  _renderSchemaListUI();
}

function _renderSchemaListUI(){
  const el  = document.getElementById('content');
  const pts = _schemaListCache?.product_types || [];

  el.innerHTML = `
    <div style="margin-bottom:16px">
      <div style="font-size:15px;font-weight:600">Product Types</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">
        Each product type defines its own set of attributes (Size, Mounting, Cavities…) and
        the allowed values for each. These drive the dropdowns on the Job and Order forms.
        Click a product type to manage its fields.
      </div>
    </div>
    <div class="card" style="overflow:hidden">
      <div id="schemaAddRowSlot"></div>
      ${pts.length ? `
        <div class="schema-list-table">
          ${pts.map(pt => _schemaListRow(pt)).join('')}
        </div>
      ` : (!_schemaAddingNew ? `
        <div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">
          No product types yet. Click <b>+ New Product Type</b> to add one.
        </div>
      ` : '')}
    </div>`;

  if (_schemaAddingNew) _schemaRenderAddRow();
}

function _schemaListRow(pt){
  const attrCount = pt.attributes.length;
  const valCount  = pt.attributes.reduce((a, x) => a + x.values.length, 0);
  return `
    <div class="schema-list-row" onclick="navigate('/product-schema/${pt.id}')">
      <div class="schema-list-row-main">
        <span class="schema-list-row-name">${escHtml(pt.name)}</span>
        <span class="schema-list-row-meta">${attrCount} attribute${attrCount===1?'':'s'} · ${valCount} value${valCount===1?'':'s'}</span>
      </div>
      <span class="schema-list-row-arrow">→</span>
    </div>`;
}

// ─── Inline "add new product type" row (replaces prompt()) ────────────────

function schemaListShowAddRow(){
  _schemaAddingNew = true;
  _renderSchemaListUI();
}

function _schemaRenderAddRow(){
  const slot = document.getElementById('schemaAddRowSlot');
  if (!slot) return;
  slot.innerHTML = `
    <div class="schema-add-row">
      <input id="schemaNewTypeName" type="text" placeholder="New product type name, e.g. Punch"
             onkeydown="if(event.key==='Enter'){schemaListCreateType()} if(event.key==='Escape'){schemaListCancelAdd()}">
      <button class="btn btn-primary btn-xs" onclick="schemaListCreateType()">Add</button>
      <button class="btn btn-ghost btn-xs" onclick="schemaListCancelAdd()">Cancel</button>
    </div>`;
  setTimeout(() => document.getElementById('schemaNewTypeName')?.focus(), 30);
}

function schemaListCancelAdd(){
  _schemaAddingNew = false;
  _renderSchemaListUI();
}

async function schemaListCreateType(){
  const inp = document.getElementById('schemaNewTypeName');
  const name = (inp?.value || '').trim();
  if (!name) { toast('Enter a name first', 'error'); return; }
  try {
    const created = await api('POST', '/api/product-schema/types', { name });
    toast('Product type added');
    _schemaAddingNew = false;
    navigate(`/product-schema/${created.id}`);
  } catch(e) { toast(e.message, 'error'); }
}
