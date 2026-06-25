/**
 * Dolphin ERP — Shared Product Attribute Input Widget
 *
 * Renders the "one input per product attribute" section used in two places:
 *   1. Job editor (#/jobs/new, #/jobs/:id)
 *   2. Order editor (#/orders/new, #/orders/:id)
 *
 * Both need the same thing: given the chosen Product Type, look up its
 * attributes from /api/product-schema (Size, Mounting, Cavities, …) and
 * render one combo input per attribute — a dropdown of known values that
 * also accepts free text, since the shop sometimes needs a one-off value
 * that isn't in the list yet. Typing a new value auto-saves it to the
 * schema on submit, so it shows up in the dropdown next time.
 *
 * Each input is scoped with `data-attr-container="<containerId>"` so two
 * instances (e.g. a Job form and an Order form, though only one is ever on
 * screen at a time today) never read each other's values even if both
 * happened to be present in the DOM.
 *
 * Usage:
 *   attrInputsRender(schema, ptypeName, 'f_attrs_wrap', existingAttrsObj);
 *   ...on submit...
 *   const attrs = attrInputsCollect('f_attrs_wrap');           // {Size: '600x600', ...}
 *   await attrInputsAutoSaveNew(schema, attrs, ptypeName);     // best-effort
 */

/**
 * Render one input per attribute of `ptypeName` into the container.
 * `existingAttrs` is a plain {attrName: value} object used to pre-fill.
 */
function attrInputsRender(schema, ptypeName, containerId, existingAttrs) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;

  const pt = (schema?.product_types || []).find(p => p.name === ptypeName);
  if (!pt) { wrap.innerHTML = ''; return; }

  if (!pt.attributes.length) {
    wrap.innerHTML = `<div style="font-size:12px;color:var(--muted);padding:6px 0">
      No attributes defined for ${escHtml(ptypeName)}.
      <a href="#/product-schema" onclick="event.preventDefault();navigate('/product-schema')" style="text-decoration:underline;cursor:pointer;color:var(--accent)">Add some →</a>
    </div>`;
    return;
  }

  // Group attributes into rows of 3 for tidy layout
  const groups = [];
  for (let i = 0; i < pt.attributes.length; i += 3) {
    groups.push(pt.attributes.slice(i, i + 3));
  }

  wrap.innerHTML = groups.map(grp => `
    <div class="form-row ${grp.length===1?'cols-1':grp.length===2?'cols-2':'cols-3'}">
      ${grp.map(attr => _attrInputHtml(attr, containerId, (existingAttrs || {})[attr.name] || '')).join('')}
    </div>
  `).join('');
}

function _attrInputHtml(attr, containerId, currentValue) {
  const inputId    = `${containerId}_attr_${attr.id}`;
  const datalistId = `${containerId}_attr_dl_${attr.id}`;
  const valueOpts  = attr.values.map(v => `<option value="${escAttr(v.value)}">`).join('');
  const required   = attr.is_required;

  return `
    <div class="form-group">
      <div class="fld-label">
        ${escHtml(attr.name)}${required?' <span style="color:var(--red)">*</span>':''}
      </div>
      <input id="${inputId}" list="${datalistId}"
             data-attr-container="${containerId}"
             data-attr-id="${attr.id}"
             data-attr-name="${escAttr(attr.name)}"
             data-required="${required?'1':'0'}"
             value="${escAttr(currentValue)}"
             placeholder="${attr.values.length ? 'Type or pick…' : 'Type a value…'}"
             autocomplete="off">
      <datalist id="${datalistId}">${valueOpts}</datalist>
    </div>`;
}

/** Returns {attrName: typedValue} for only the inputs belonging to this container. */
function attrInputsCollect(containerId) {
  const out = {};
  document.querySelectorAll(`[data-attr-container="${containerId}"]`).forEach(el => {
    const name = el.dataset.attrName;
    const val  = (el.value || '').trim();
    if (val) out[name] = val;
  });
  return out;
}

/** Returns the list of {el, name} pairs for required-but-empty attributes in this container. */
function attrInputsMissingRequired(containerId) {
  const missing = [];
  document.querySelectorAll(`[data-attr-container="${containerId}"][data-required="1"]`).forEach(el => {
    if (!(el.value || '').trim()) missing.push(el.dataset.attrName);
  });
  return missing;
}

/**
 * Derive the legacy flattened product_size + product_variant strings from
 * a structured {attrName: value} map — used so older surfaces (dispatch
 * sheet, Jobs/Orders list columns, Quote page) that only know about those
 * two strings keep working without every one of them being rewritten.
 */
function attrInputsDeriveLegacy(attrs) {
  const size = attrs.Size || attrs.size || '';
  const variantParts = [];
  Object.entries(attrs).forEach(([k, v]) => {
    if (!v || k.toLowerCase() === 'size') return;
    if (k.toLowerCase() === 'cavities') variantParts.push(`${v}-cav`);
    else variantParts.push(String(v));
  });
  return { size, variant: variantParts.join(' ') };
}

/**
 * Persist any user-typed attribute values that aren't yet in the schema, so
 * they appear in the dropdown next time. Best-effort — runs in parallel,
 * failures are logged but never block the calling form's save.
 */
async function attrInputsAutoSaveNew(schema, attrs, ptypeName) {
  const pt = (schema?.product_types || []).find(p => p.name === ptypeName);
  if (!pt) return;
  const promises = [];
  pt.attributes.forEach(attr => {
    const typed = attrs[attr.name];
    if (!typed) return;
    const exists = attr.values.some(v => v.value === typed);
    if (!exists) {
      promises.push(
        api('POST', '/api/product-schema/values', { attribute_id: attr.id, value: typed })
          .catch(e => console.warn('Auto-save value failed:', e.message))
      );
    }
  });
  if (promises.length) await Promise.all(promises);
}
