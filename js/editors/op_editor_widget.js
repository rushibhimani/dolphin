/**
 * Dolphin ERP — Shared Operations Editor Widget
 *
 * Renders the "list of manufacturing steps" editor used in two places:
 *   1. Routing editor (#/routings/new, #/routings/:id) — editing a reusable template
 *   2. Job editor, "Custom operations" mode — editing one-off ops for a single job
 *
 * Both need the exact same capabilities (machine pick, setup/work time,
 * formula-based time calc, sub-operations, outside/vendor ops, reordering),
 * so this widget owns the rendering + state-sync logic once. Each caller
 * gets its own isolated instance via opEditorCreate(key), keyed by a string,
 * so a routing editor and a job editor's custom pane never collide even if
 * (unusually) both were ever mounted at once.
 *
 * Usage:
 *   const ed = opEditorCreate('jobCustom', { container: 'customOpsWrap' });
 *   ed.setOps(existingOpsArray);     // existingOpsArray may be []
 *   ed.render();
 *   ... later ...
 *   ed.sync();                       // pulls current DOM values back into ed.ops
 *   const ops = ed.getOps();         // final array to send to the backend
 *
 * Op shape (matches what /api/routings/{id} returns, and what the backend's
 * _ops_for_job() inline branch now expects):
 *   {
 *     name, work_center_id, setup_time_mins, work_time_mins, work_time_hrs,
 *     is_optional, op_type ('inhouse'|'outside'), outside_vendor,
 *     outside_transit_days, formula_type, mrr, depth_mm, feed_rate,
 *     dim_x_source, dim_y_source, sub_operations: [...]
 *   }
 */

const _opEditors = {};

function opEditorCreate(key, opts) {
  const ed = {
    key,
    container: opts.container,             // element id to render rows into
    emptyEl:   opts.emptyEl || null,        // optional "no ops yet" element id
    onChange:  opts.onChange || null,       // optional callback after sync/render
    ops: [],
    setOps(arr) { this.ops = (arr || []).map(o => ({ ...o, sub_operations: o.sub_operations || [] })); },
    getOps() { return this.ops; },
    render() { _opEdRenderRows(this); },
    sync()   { _opEdSync(this); },
  };
  _opEditors[key] = ed;
  return ed;
}

function _opEd(key) { return _opEditors[key]; }

const _OPED_FTYPES = {
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
const _OPED_DIMS = ['length', 'width', 'thickness'];

function _opEdRenderRows(ed) {
  const c = document.getElementById(ed.container);
  const e = ed.emptyEl ? document.getElementById(ed.emptyEl) : null;
  if (e) e.style.display = ed.ops.length ? 'none' : '';
  if (!c) return;

  c.innerHTML = ed.ops.map((op, i) => _opEdRowHtml(ed, op, i)).join('');
}

function _opEdRowHtml(ed, op, i) {
  const k = ed.key;
  const hasFormula = !!(op.formula_type && op.formula_type !== 'none');
  const wMins = op.work_time_mins != null ? Math.round(op.work_time_mins) : Math.round((op.work_time_hrs || 0) * 60);
  const ft = op.formula_type || '';
  const needsDimX   = ['Volume Milling', 'Perimeter Milling Single Side', 'Surface Grinding'].includes(ft);
  const needsDimY   = ['Volume Milling', 'Surface Grinding'].includes(ft);
  const needsDepth  = ['Volume Milling', 'Perimeter Milling Single Side', 'Perimeter Side Milling', 'Surface Grinding'].includes(ft);
  const needsMRR    = ['Volume Milling', 'Perimeter Milling Single Side', 'Sandblasting'].includes(ft);
  const needsFeed   = ['Perimeter Milling Full', 'Perimeter Side Milling', 'Perimeter Milling'].includes(ft);
  const needsPasses = ['Perimeter Side Milling'].includes(ft);
  const isStepMilling = ft === 'Perimeter Milling Full';

  let preview = '';
  if (hasFormula && ft && ft !== 'Fixed') {
    const dx = (op.dim_x_source || 'length').slice(0, 1).toUpperCase();
    const dy = (op.dim_y_source || 'width').slice(0, 1).toUpperCase();
    const d = op.depth_mm || '?'; const r = op.mrr || '?';
    if (ft === 'Volume Milling')                  preview = `(${dx}×${dy}×${d}) ÷ ${r}`;
    else if (ft === 'Perimeter Milling Single Side') preview = `${dx}×${d}×T ÷ ${r}`;
    else if (ft === 'Perimeter Milling Full')     preview = `2×(L+W)÷0.3×(T-8)÷Feed`;
    else if (ft === 'Perimeter Side Milling')     preview = `2×(L+W)×${d} passes ÷ Feed`;
    else if (ft === 'Perimeter Milling')          preview = `2×(L+W)×3 ÷ 250`;
    else if (ft === 'Perimeter Welding')          preview = `2×(L+W) ÷ 200`;
    else if (ft === 'Surface Grinding')           preview = `(${dy}+50)×${d}×2÷2.5 × (${dx}+250)÷20000`;
    else if (ft === 'Sandblasting')               preview = `L×W ÷ ${r}`;
  } else if (hasFormula && ft === 'Fixed') preview = 'Fixed time — enter Work(min) above';

  const isOutside = op.op_type === 'outside';

  return `
  <div style="border:1px solid var(--border);border-radius:7px;margin-bottom:6px;overflow:hidden">

    <!-- TOP ROW -->
    <div style="display:flex;align-items:center;gap:6px;padding:7px 8px;background:var(--card)">
      <div class="op-ed-arrows" style="display:flex;flex-direction:column;gap:1px">
        <button onclick="opEdMove('${k}',${i},-1)" ${i === 0 ? 'disabled' : ''} style="font-size:9px;padding:1px 4px;line-height:1.2">▲</button>
        <button onclick="opEdMove('${k}',${i},1)"  ${i === ed.ops.length - 1 ? 'disabled' : ''} style="font-size:9px;padding:1px 4px;line-height:1.2">▼</button>
      </div>
      <span style="font-size:11px;color:var(--muted);font-family:var(--mono);flex-shrink:0;width:16px;text-align:center">${i + 1}</span>
      <input id="oped_${k}_name_${i}" value="${escAttr(op.name || '')}" placeholder="Operation name" style="flex:2 1 130px;min-width:90px">
      ${isOutside
        ? `<div style="flex:2 1 140px;min-width:110px;display:flex;align-items:center;justify-content:center;
                        padding:3px 8px;background:var(--red-soft,rgba(220,38,38,.08));border:1px solid var(--red,#DC2626);
                        border-radius:5px;color:var(--red,#DC2626);font-size:11px;font-weight:600">
             🏭 Outside / Vendor
           </div>`
        : `<select id="oped_${k}_wc_${i}" style="flex:2 1 140px;min-width:110px">${buildMachineOpts(op.work_center_id)}</select>`
      }
      <div style="flex-shrink:0;display:${isOutside ? 'none' : 'flex'};flex-direction:column;align-items:center;gap:1px">
        <span style="font-size:9px;color:var(--muted)">Setup</span>
        <input type="number" id="oped_${k}_setup_${i}" value="${op.setup_time_mins ?? 0}" min="0" step="5" style="width:54px">
      </div>
      ${isOutside
        ? `<div id="oped_${k}_days_row_${i}" style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:1px">
             <span style="font-size:9px;color:var(--muted)">Transit(days)</span>
             <input type="number" id="oped_${k}_transit_${i}" value="${Math.round((op.outside_transit_days || op.work_time_hrs / 24 || 1) * 10) / 10}" min="0.5" step="0.5" style="width:64px">
           </div>`
        : hasFormula
          ? `<div style="flex:1 1 auto;font-size:11px;color:var(--accent);font-family:var(--mono);padding:0 4px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${preview}">${preview || 'Formula set'}</div>`
          : `<div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:1px">
               <span style="font-size:9px;color:var(--muted)">Work(min)</span>
               <input type="number" id="oped_${k}_work_${i}" value="${wMins}" min="0" step="10" style="width:64px">
             </div>`
      }
      <label style="font-size:10px;color:var(--muted);white-space:nowrap;cursor:pointer;display:${isOutside ? 'none' : 'flex'};align-items:center;gap:3px;flex-shrink:0">
        <input type="checkbox" id="oped_${k}_useformula_${i}" ${hasFormula ? 'checked' : ''}
          onchange="opEdToggleFormula('${k}',${i},this.checked)"
          style="accent-color:var(--accent);width:12px;height:12px"> ⚡
      </label>
      <input type="checkbox" id="oped_${k}_opt_${i}" ${op.is_optional ? 'checked' : ''} title="Optional step" style="width:13px;height:13px;accent-color:var(--amber);flex-shrink:0">
      <label title="Outside operation (sent to vendor)" style="font-size:10px;color:var(--muted);white-space:nowrap;cursor:pointer;display:flex;align-items:center;gap:2px;flex-shrink:0">
        <input type="checkbox" id="oped_${k}_outside_${i}" ${op.op_type === 'outside' ? 'checked' : ''} onchange="opEdToggleOutside('${k}',${i},this.checked)" style="accent-color:var(--red);width:12px;height:12px"> Out
      </label>
      <button onclick="opEdRemove('${k}',${i})" title="Remove step" style="flex-shrink:0;background:none;border:none;color:var(--red);font-size:14px;cursor:pointer;padding:2px 4px;line-height:1">✕</button>
    </div>

    <div id="oped_${k}_outside_row_${i}" style="background:var(--surface);border-top:1px solid var(--border);padding:6px 12px;display:${op.op_type === 'outside' ? 'flex' : 'none'};align-items:center;gap:8px">
      <span style="font-size:11px;color:var(--muted);flex-shrink:0">Vendor:</span>
      <input id="oped_${k}_vendor_${i}" value="${escAttr(op.outside_vendor || '')}" placeholder="e.g. Rajesh Heat Treatment" style="flex:1;font-size:12px">
    </div>

    <!-- FORMULA PARAMS -->
    <div id="oped_${k}_formula_${i}" style="background:var(--surface);border-top:1px solid var(--border);padding:8px 12px;display:${hasFormula ? 'grid' : 'none'};grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;align-items:end">

      <div class="form-group" style="margin:0">
        <div class="fld-label" style="font-size:10px">Formula Type</div>
        <select id="oped_${k}_ftype_${i}" style="font-size:12px" onchange="opEdSync('${k}');opEdRender('${k}')">
          <option value="">— select —</option>
          ${Object.entries(_OPED_FTYPES).map(([v, l]) => `<option value="${v}" ${ft === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>

      ${needsDimX ? `<div class="form-group" style="margin:0">
        <div class="fld-label" style="font-size:10px">${ft === 'Perimeter Milling Single Side' ? 'Cut Direction (Dim)' : ft === 'Surface Grinding' ? 'Dim X (pass direction — L or W)' : 'Dim X (length axis)'}</div>
        <select id="oped_${k}_dimx_${i}" style="font-size:12px">
          ${_OPED_DIMS.map(d => `<option value="${d}" ${op.dim_x_source === d ? 'selected' : ''}>${d.charAt(0).toUpperCase() + d.slice(1)}</option>`).join('')}
        </select>
      </div>` : ''}

      ${needsDimY ? `<div class="form-group" style="margin:0">
        <div class="fld-label" style="font-size:10px">${ft === 'Surface Grinding' ? 'Dim Y (traverse axis — W or T)' : 'Dim Y (width axis)'}</div>
        <select id="oped_${k}_dimy_${i}" style="font-size:12px">
          ${_OPED_DIMS.map(d => `<option value="${d}" ${op.dim_y_source === d ? 'selected' : ''}>${d.charAt(0).toUpperCase() + d.slice(1)}</option>`).join('')}
        </select>
      </div>` : ''}

      ${needsDepth ? `<div class="form-group" style="margin:0">
        <div class="fld-label" style="font-size:10px">${needsPasses ? 'Passes' : 'Depth (mm)'}</div>
        <input type="number" id="oped_${k}_depth_${i}" value="${op.depth_mm || ''}" min="0" step="0.5" placeholder="${needsPasses ? 'e.g. 10 passes' : 'e.g. 5'}" style="font-size:12px">
      </div>` : ''}

      ${needsFeed ? `<div class="form-group" style="margin:0">
        <div class="fld-label" style="font-size:10px">Feed Rate (mm/min)</div>
        <input type="number" id="oped_${k}_feed_${i}" value="${op.feed_rate || (ft === 'Perimeter Milling Full' ? 1000 : 250)}" min="1" step="50" placeholder="${ft === 'Perimeter Milling Full' ? 'e.g. 1000' : 'e.g. 250'}" style="font-size:12px">
      </div>` : ''}

      ${needsMRR ? `<div class="form-group" style="margin:0">
        <div class="fld-label" style="font-size:10px">MRR (mm³/min)</div>
        <input type="number" id="oped_${k}_mrr_${i}" value="${op.mrr || ''}" min="0" step="100" placeholder="e.g. 6300" style="font-size:12px">
      </div>` : ''}
      ${isStepMilling ? `<div style="font-size:10px;color:var(--muted);align-self:center;padding:4px 0">
        Depth = T − 8 mm (auto from thickness at order time). Step-over = 0.3 mm fixed.
      </div>` : ''}

      ${ft === 'Fixed' ? `<div style="font-size:11px;color:var(--muted);align-self:center;padding:4px 0">
        Fixed time — enter minutes in the Work(min) field above. No auto-calculation.
      </div>` : ''}

      ${ft && ft !== 'Fixed' ? `<div style="font-size:10px;color:var(--accent);align-self:center;padding:4px 0;font-style:italic">
        ${ft === 'Volume Milling' ? 'Time = DimX × DimY × Depth / MRR' :
          ft === 'Perimeter Milling Single Side' ? 'Time = Dim × Depth × T / MRR' :
          ft === 'Perimeter Milling Full' ? 'Time = 2×(L+W) ÷ 0.3 × (T−8) ÷ Feed Rate  (Depth auto-computed as T−8)' :
          ft === 'Perimeter Side Milling' ? 'Time = 2×(L+W) × Passes / Feed' :
          ft === 'Perimeter Milling' ? 'Time = 2×(L+W) × 3 ÷ Feed Rate' :
          ft === 'Perimeter Welding' ? 'Time = 2×(L+W) / 200' :
          ft === 'Surface Grinding' ? 'Time = (DimY+50)×Depth×2/2.5 × (DimX+250)/20000  [DimX=pass direction, DimY=traverse direction]' :
          ft === 'Sandblasting' ? 'Time = L × W / MRR' : ''}
      </div>` : ''}

    </div>

    <!-- SUB-OPS -->
    <div id="oped_${k}_subops_${i}" style="background:var(--surface2);border-top:1px solid var(--border);padding:8px 12px">
      ${(op.sub_operations || []).length > 0 ? `
        <div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px">
          Sub-operations · machine &amp; setup shared from above · work times summed for scheduling
        </div>
        ${(op.sub_operations || []).map((s, si) => _opEdSubRowHtml(ed, i, si, s)).join('')}
      ` : ''}
      <button onclick="opEdAddSub('${k}',${i})" style="font-size:11px;padding:3px 10px;border:1px dashed var(--border);border-radius:5px;background:none;color:var(--muted);cursor:pointer;margin-top:${(op.sub_operations || []).length ? '4px' : '0'}">
        + Add sub-operation
      </button>
      ${(op.sub_operations || []).length > 0 ? `
        <span style="font-size:11px;color:var(--muted);margin-left:12px">
          Total work: <b>${(op.sub_operations || []).filter(s => !s.is_optional).reduce((a, s) => a + (s.work_time_mins || 0), 0).toFixed(1)} min</b>
          ${(op.sub_operations || []).some(s => s.is_optional) ? '(+ optional)' : ''}
        </span>
      ` : ''}
    </div>

  </div>`;
}

function _opEdSubRowHtml(ed, oi, si, s) {
  const k = ed.key;
  const ft = s.formula_type || '';
  const needsDimX  = ['Volume Milling', 'Perimeter Milling Single Side', 'Surface Grinding'].includes(ft);
  const needsDimY  = ['Volume Milling', 'Surface Grinding'].includes(ft);
  const needsDepth = ['Volume Milling', 'Perimeter Milling Single Side', 'Perimeter Side Milling', 'Surface Grinding'].includes(ft);
  const needsMRR   = ['Volume Milling', 'Perimeter Milling Single Side', 'Sandblasting'].includes(ft);
  const needsFeed  = ['Perimeter Milling Full', 'Perimeter Side Milling', 'Perimeter Milling'].includes(ft);
  const hasFormula = !!ft && ft !== 'none';
  const wMins = s.work_time_mins != null ? Math.round(s.work_time_mins) : 0;

  return `<div style="border:1px solid var(--border);border-radius:6px;margin-bottom:5px;overflow:hidden;margin-left:12px">
    <div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--card)">
      <span style="font-size:10px;color:var(--muted);flex-shrink:0;width:18px;text-align:center">${si + 1}</span>
      <input id="sop_${k}_name_${oi}_${si}" value="${escAttr(s.name || '')}" placeholder="Sub-op name"
        style="flex:2 1 120px;min-width:80px;font-size:12px">
      ${hasFormula
        ? `<span style="flex:1;font-size:10px;color:var(--accent);font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ft}</span>`
        : `<div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:1px">
             <span style="font-size:9px;color:var(--muted)">Work(min)</span>
             <input type="number" id="sop_${k}_work_${oi}_${si}" value="${wMins}" min="0" step="5" style="width:60px;font-size:12px">
           </div>`
      }
      <label style="font-size:10px;color:var(--muted);white-space:nowrap;cursor:pointer;display:flex;align-items:center;gap:3px;flex-shrink:0">
        <input type="checkbox" id="sop_${k}_formula_${oi}_${si}" ${hasFormula ? 'checked' : ''}
          onchange="opEdToggleSubFormula('${k}',${oi},${si},this.checked)"
          style="accent-color:var(--accent);width:12px;height:12px"> ⚡
      </label>
      <label style="font-size:10px;color:var(--amber);white-space:nowrap;cursor:pointer;display:flex;align-items:center;gap:3px;flex-shrink:0" title="Optional — can be excluded per order">
        <input type="checkbox" id="sop_${k}_opt_${oi}_${si}" ${s.is_optional ? 'checked' : ''}
          style="accent-color:var(--amber);width:12px;height:12px"> opt
      </label>
      <button onclick="opEdRemoveSub('${k}',${oi},${si})" style="background:none;border:none;color:var(--red);font-size:12px;cursor:pointer;padding:1px 3px;line-height:1;flex-shrink:0">✕</button>
    </div>
    ${hasFormula ? `
    <div style="background:var(--surface);border-top:1px solid var(--border);padding:6px 10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;align-items:end">
      <div class="form-group" style="margin:0">
        <div class="fld-label" style="font-size:10px">Formula Type</div>
        <select id="sop_${k}_ftype_${oi}_${si}" style="font-size:11px" onchange="opEdSync('${k}');opEdRender('${k}')">
          <option value="">— select —</option>
          ${Object.entries(_OPED_FTYPES).map(([v]) => `<option value="${v}" ${ft === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </div>
      ${needsDimX ? `<div class="form-group" style="margin:0">
        <div class="fld-label" style="font-size:10px">Dim X</div>
        <select id="sop_${k}_dimx_${oi}_${si}" style="font-size:11px">
          ${_OPED_DIMS.map(d => `<option value="${d}" ${s.dim_x_source === d ? 'selected' : ''}>${d.charAt(0).toUpperCase() + d.slice(1)}</option>`).join('')}
        </select>
      </div>` : ''}
      ${needsDimY ? `<div class="form-group" style="margin:0">
        <div class="fld-label" style="font-size:10px">${ft === 'Surface Grinding' ? 'Dim Y (traverse — W or T)' : 'Dim Y'}</div>
        <select id="sop_${k}_dimy_${oi}_${si}" style="font-size:11px">
          ${_OPED_DIMS.map(d => `<option value="${d}" ${s.dim_y_source === d ? 'selected' : ''}>${d.charAt(0).toUpperCase() + d.slice(1)}</option>`).join('')}
        </select>
      </div>` : ''}
      ${needsDepth ? `<div class="form-group" style="margin:0">
        <div class="fld-label" style="font-size:10px">Depth (mm)</div>
        <input type="number" id="sop_${k}_depth_${oi}_${si}" value="${s.depth_mm || ''}" min="0" step="0.5" placeholder="e.g. 10" style="font-size:11px">
      </div>` : ''}
      ${needsFeed ? `<div class="form-group" style="margin:0">
        <div class="fld-label" style="font-size:10px">Feed Rate (mm/min)</div>
        <input type="number" id="sop_${k}_feed_${oi}_${si}" value="${s.feed_rate || 250}" min="1" step="50" style="font-size:11px">
      </div>` : ''}
      ${needsMRR ? `<div class="form-group" style="margin:0">
        <div class="fld-label" style="font-size:10px">MRR (mm³/min)</div>
        <input type="number" id="sop_${k}_mrr_${oi}_${si}" value="${s.mrr || ''}" min="0" step="100" placeholder="e.g. 6300" style="font-size:11px">
      </div>` : ''}
    </div>` : ''}
  </div>`;
}

// ─── Public action handlers (called from inline onclick/onchange) ─────────

function opEdRender(key) { _opEdRenderRows(_opEd(key)); }

function opEdSync(key) { _opEdSync(_opEd(key)); }

function _opEdSync(ed) {
  const k = ed.key;
  ed.ops = ed.ops.map((op, i) => {
    const useFormula = document.getElementById(`oped_${k}_useformula_${i}`)?.checked;
    const ftype = document.getElementById(`oped_${k}_ftype_${i}`)?.value || null;
    const hasSubs = (op.sub_operations || []).length > 0;
    const isOutside = document.getElementById(`oped_${k}_outside_${i}`)?.checked;
    let wMins = 0;
    if (hasSubs) {
      wMins = (op.sub_operations || []).reduce((a, s) => a + (s.work_time_mins || 0), 0);
    } else if (useFormula && ftype) {
      wMins = 0; // calculated at order time from dimensions
    } else {
      wMins = parseFloat(document.getElementById(`oped_${k}_work_${i}`)?.value) || 0;
    }

    const syncedSubs = (op.sub_operations || []).map((s, si) => {
      const useFm = document.getElementById(`sop_${k}_formula_${i}_${si}`)?.checked ?? !!s.formula_type;
      const sftype = useFm ? (document.getElementById(`sop_${k}_ftype_${i}_${si}`)?.value || s.formula_type) : null;
      const sw = useFm ? 0 : (parseFloat(document.getElementById(`sop_${k}_work_${i}_${si}`)?.value) || 0);
      return {
        ...s,
        id:             s.id || null,
        name:           document.getElementById(`sop_${k}_name_${i}_${si}`)?.value?.trim() || s.name,
        formula_type:   sftype || null,
        mrr:            parseFloat(document.getElementById(`sop_${k}_mrr_${i}_${si}`)?.value) || null,
        depth_mm:       parseFloat(document.getElementById(`sop_${k}_depth_${i}_${si}`)?.value) || null,
        feed_rate:      parseFloat(document.getElementById(`sop_${k}_feed_${i}_${si}`)?.value) || null,
        dim_x_source:   document.getElementById(`sop_${k}_dimx_${i}_${si}`)?.value || null,
        dim_y_source:   document.getElementById(`sop_${k}_dimy_${i}_${si}`)?.value || null,
        work_time_mins: sw,
        work_time_hrs:  sw / 60,
        is_optional:    !!document.getElementById(`sop_${k}_opt_${i}_${si}`)?.checked,
      };
    });

    const transitVal = parseFloat(document.getElementById(`oped_${k}_transit_${i}`)?.value) || null;

    return {
      ...op,
      name:                  document.getElementById(`oped_${k}_name_${i}`)?.value?.trim() || op.name,
      work_center_id:        parseInt(document.getElementById(`oped_${k}_wc_${i}`)?.value) || (isOutside ? op.work_center_id : null),
      setup_time_mins:       parseFloat(document.getElementById(`oped_${k}_setup_${i}`)?.value) || 0,
      work_time_mins:        wMins,
      work_time_hrs:         isOutside ? (transitVal || 1) * 24 : wMins / 60,
      is_optional:           !!document.getElementById(`oped_${k}_opt_${i}`)?.checked,
      op_type:               isOutside ? 'outside' : 'inhouse',
      outside_vendor:        document.getElementById(`oped_${k}_vendor_${i}`)?.value?.trim() || null,
      outside_transit_days:  transitVal,
      formula_type:          useFormula ? (ftype || null) : null,
      mrr:                   parseFloat(document.getElementById(`oped_${k}_mrr_${i}`)?.value) || null,
      depth_mm:              parseFloat(document.getElementById(`oped_${k}_depth_${i}`)?.value) || null,
      feed_rate:             parseFloat(document.getElementById(`oped_${k}_feed_${i}`)?.value) || null,
      dim_x_source:          document.getElementById(`oped_${k}_dimx_${i}`)?.value || null,
      dim_y_source:          document.getElementById(`oped_${k}_dimy_${i}`)?.value || null,
      sub_operations:        syncedSubs,
    };
  });
  if (ed.onChange) ed.onChange(ed.ops);
}

function opEdMove(key, i, dir) {
  const ed = _opEd(key); _opEdSync(ed);
  const j = i + dir;
  if (j < 0 || j >= ed.ops.length) return;
  [ed.ops[i], ed.ops[j]] = [ed.ops[j], ed.ops[i]];
  _opEdRenderRows(ed);
}

function opEdAddRow(key) {
  const ed = _opEd(key); _opEdSync(ed);
  ed.ops.push({
    name: '', work_center_id: allMachines[0]?.id, setup_time_mins: 0,
    work_time_mins: 60, work_time_hrs: 1, is_optional: false,
    op_type: 'inhouse', outside_vendor: null, outside_transit_days: null,
    sub_operations: [],
  });
  _opEdRenderRows(ed);
}

function opEdRemove(key, i) {
  const ed = _opEd(key); _opEdSync(ed);
  ed.ops.splice(i, 1);
  _opEdRenderRows(ed);
}

function opEdToggleOutside(key, i, checked) {
  const ed = _opEd(key); _opEdSync(ed);
  ed.ops[i].op_type = checked ? 'outside' : 'inhouse';
  _opEdRenderRows(ed);
  setTimeout(() => document.getElementById(`oped_${key}_name_${i}`)?.focus(), 50);
}

function opEdToggleFormula(key, i, on) {
  const ed = _opEd(key); _opEdSync(ed);
  if (on && (!ed.ops[i].formula_type || ed.ops[i].formula_type === 'none')) {
    ed.ops[i].formula_type = 'Volume Milling';
    ed.ops[i].dim_x_source = 'length';
    ed.ops[i].dim_y_source = 'width';
  }
  if (!on) ed.ops[i].formula_type = null;
  _opEdRenderRows(ed);
}

function opEdToggleSubFormula(key, oi, si, on) {
  const ed = _opEd(key); _opEdSync(ed);
  const s = (ed.ops[oi].sub_operations || [])[si];
  if (!s) return;
  s.formula_type = on ? 'Perimeter Milling Single Side' : null;
  if (on) { s.dim_x_source = 'length'; s.dim_y_source = 'thickness'; }
  _opEdRenderRows(ed);
}

function opEdAddSub(key, oi) {
  const ed = _opEd(key); _opEdSync(ed);
  if (!ed.ops[oi].sub_operations) ed.ops[oi].sub_operations = [];
  ed.ops[oi].sub_operations.push({
    name: '', formula_type: null, mrr: null, depth_mm: null, feed_rate: null,
    dim_x_source: null, dim_y_source: null, work_time_mins: 0, is_optional: false,
  });
  _opEdRenderRows(ed);
}

function opEdRemoveSub(key, oi, si) {
  const ed = _opEd(key); _opEdSync(ed);
  ed.ops[oi].sub_operations.splice(si, 1);
  _opEdRenderRows(ed);
}
