/**
 * Dolphin ERP — Assembly Order Management
 * Handles: component list (make/outside/purchase) + assembly steps + progress
 */

let _asmOrderId   = null;
let _asmOrder     = null;
let _asmData      = null;   // { components, assembly_steps }
let _asmWorkers   = [];
let _asmRoutings  = [];

// ── Entry point ────────────────────────────────────────────────────────────────
async function renderAssemblyOrder(orderId) {
  _asmOrderId = orderId;
  await loadAll();
  _asmWorkers  = allWorkers  || [];
  _asmRoutings = allRoutings || [];

  const o = (allOrders || []).find(x => x.id === orderId);
  _asmOrder = o;

  if (!o) {
    document.getElementById('content').innerHTML =
      `<div class="card"><div class="empty">Order not found.</div></div>`;
    return;
  }

  await _reloadAssemblyData();
  _renderAssemblyPage();
}

async function _reloadAssemblyData() {
  try {
    _asmData = await api('GET', `/api/orders/${_asmOrderId}/assembly`);
  } catch(e) {
    _asmData = { components: [], assembly_steps: [] };
  }
}

function _renderAssemblyPage() {
  const o       = _asmOrder;
  const comps   = _asmData.components   || [];
  const steps   = _asmData.assembly_steps || [];

  const dueColor = new Date(o.due_date) < new Date() ? 'var(--red)' : 'var(--text-soft)';

  document.getElementById('topbarActions').innerHTML = `
    <button class="btn btn-ghost" onclick="navigate('/orders')">← Orders</button>
    <button class="btn btn-primary" onclick="asmAddComponent()">+ Component</button>
    <button class="btn btn-secondary" onclick="asmAddStep()">+ Assembly Step</button>`;

  document.getElementById('content').innerHTML = `
    <div style="max-width:1000px;margin:0 auto;display:flex;flex-direction:column;gap:16px">

      <!-- Header card -->
      <div class="card" style="padding:16px 20px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-size:11px;color:var(--muted);font-weight:600;letter-spacing:.05em">ASSEMBLY ORDER</div>
            <div style="font-size:22px;font-weight:700;margin:2px 0">${o.order_number}</div>
            <div style="font-size:14px;color:var(--muted)">${o.customer_name} · ${o.product_type}${o.product_size?' '+o.product_size:''}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;color:var(--muted)">Due</div>
            <div style="font-size:16px;font-weight:600;color:${dueColor}">${fmtD(o.due_date)}</div>
            ${o.total_price?`<div style="font-size:13px;color:var(--green);font-weight:600">${fmtINR(o.total_price)}</div>`:''}
          </div>
        </div>
        <!-- Progress bar -->
        ${_asmProgressBar(comps, steps)}
      </div>

      <!-- Two columns: Components left, Assembly Steps right -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">

        <!-- COMPONENTS -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="font-size:13px;font-weight:700">Components</div>
            <button class="btn btn-ghost" style="font-size:11px;padding:4px 8px" onclick="asmAddComponent()">+ Add</button>
          </div>
          <div id="asmCompList" style="display:flex;flex-direction:column;gap:6px">
            ${comps.length ? comps.map(c => _compCardHTML(c)).join('') :
              `<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;border:1px dashed var(--border);border-radius:8px">
                No components yet. Add components to define what needs to be made, sent outside, or purchased.
              </div>`}
          </div>
        </div>

        <!-- ASSEMBLY STEPS -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="font-size:13px;font-weight:700">Assembly Sequence</div>
            <button class="btn btn-ghost" style="font-size:11px;padding:4px 8px" onclick="asmAddStep()">+ Add Step</button>
          </div>
          <div id="asmStepList" style="display:flex;flex-direction:column;gap:6px">
            ${steps.length ? steps.map(s => _stepCardHTML(s, comps)).join('') :
              `<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;border:1px dashed var(--border);border-radius:8px">
                No assembly steps yet. Define the assembly sequence — each step unlocks when its required components are ready.
              </div>`}
          </div>
        </div>

      </div>
    </div>`;
}

function _asmProgressBar(comps, steps) {
  const totalComps = comps.length;
  if (!totalComps && !steps.length) return '';
  const doneComps  = comps.filter(c => ['done','received'].includes(c.status)).length;
  const totalSteps = steps.length;
  const doneSteps  = steps.filter(s => s.status === 'done').length;
  const total      = totalComps + totalSteps;
  const done       = doneComps + doneSteps;
  const pct        = total ? Math.round((done/total)*100) : 0;
  return `
    <div style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:4px">
        <span>${doneComps}/${totalComps} components ready · ${doneSteps}/${totalSteps} assembly steps done</span>
        <span>${pct}%</span>
      </div>
      <div style="height:6px;background:var(--surface);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${pct===100?'var(--green)':'var(--accent)'};border-radius:3px;transition:width .3s"></div>
      </div>
    </div>`;
}

// ── Component card ─────────────────────────────────────────────────────────────
function _compCardHTML(c) {
  const typeColors = { make: 'var(--accent)', outside: 'var(--amber)', purchase: 'var(--purple,#9b59b6)' };
  const typeLabels = { make: 'Make', outside: 'Outside', purchase: 'Purchase' };
  const statusColors = {
    pending: 'var(--muted)', in_progress: 'var(--accent)',
    done: 'var(--green)', sent: 'var(--amber)', received: 'var(--green)', ordered: 'var(--amber)'
  };
  const col  = typeColors[c.component_type]  || 'var(--muted)';
  const sCl  = statusColors[c.status] || 'var(--muted)';

  let statusActions = '';
  if (c.component_type === 'outside') {
    if (c.status === 'pending')
      statusActions = `<button class="btn btn-secondary" style="font-size:10px;padding:3px 7px" onclick="asmCompStatus(${c.id},'sent')">📤 Mark Sent</button>`;
    else if (c.status === 'sent')
      statusActions = `<button class="btn btn-secondary" style="font-size:10px;padding:3px 7px" onclick="asmCompStatus(${c.id},'received')">📥 Mark Received</button>`;
  } else if (c.component_type === 'purchase') {
    if (c.status === 'pending')
      statusActions = `<button class="btn btn-secondary" style="font-size:10px;padding:3px 7px" onclick="asmCompStatus(${c.id},'ordered')">🛒 Mark Ordered</button>`;
    else if (c.status === 'ordered')
      statusActions = `<button class="btn btn-secondary" style="font-size:10px;padding:3px 7px" onclick="asmCompStatus(${c.id},'received')">📥 Mark Received</button>`;
  } else if (c.component_type === 'make') {
    if (c.job_number)
      statusActions = `
        <span style="font-size:10px;color:var(--muted);font-family:var(--mono)">${c.job_number}</span>
        <button class="btn btn-ghost" style="font-size:10px;padding:2px 7px" onclick="navigate('/jobs');setTimeout(()=>expandJob(${c.job_id}),400)" title="Open job to edit times">✎ Job</button>`;
  }

  const extraInfo = [];
  if (c.vendor_name)    extraInfo.push(`Vendor: ${c.vendor_name}`);
  if (c.sent_date)      extraInfo.push(`Sent: ${fmtD(c.sent_date)}`);
  if (c.expected_back)  extraInfo.push(`Expected: ${fmtD(c.expected_back)}`);
  if (c.received_date)  extraInfo.push(`Received: ${fmtD(c.received_date)}`);
  if (c.ordered_date)   extraInfo.push(`Ordered: ${fmtD(c.ordered_date)}`);

  return `
    <div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;background:var(--card);position:relative">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="width:3px;height:36px;background:${col};border-radius:2px;flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(c.name)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">
            <span style="color:${col};font-weight:600">${typeLabels[c.component_type]||c.component_type}</span>
            · Step ${c.assembly_step}
            ${c.quantity && c.quantity > 1 ? ` · Qty: ${c.quantity}` : ''}
            ${c.routing_name ? ` · <span style="color:var(--accent)">${escHtml(c.routing_name)}</span>` : ''}
            ${c.notes ? ' · '+escHtml(c.notes) : ''}
          </div>
          ${extraInfo.length ? `<div style="font-size:10px;color:var(--muted);margin-top:2px">${extraInfo.join(' · ')}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <span style="font-size:11px;font-weight:600;color:${sCl};text-transform:capitalize">${c.status}</span>
          ${statusActions}
          <button class="btn btn-ghost" style="font-size:10px;padding:2px 6px" onclick="asmEditComponent(${c.id})">✎</button>
          <button style="background:none;border:none;color:var(--red);cursor:pointer;font-size:13px;padding:2px 4px" onclick="asmDeleteComponent(${c.id})">✕</button>
        </div>
      </div>
    </div>`;
}

// ── Assembly step card ─────────────────────────────────────────────────────────
function _stepCardHTML(s, comps) {
  const statusColors = {
    waiting: 'var(--muted)', ready: 'var(--accent)',
    in_progress: 'var(--amber)', done: 'var(--green)'
  };
  const col = statusColors[s.status] || 'var(--muted)';

  const needsComps = comps.filter(c => c.assembly_step <= s.step_number);
  const doneComps  = needsComps.filter(c => ['done','received'].includes(c.status));
  const isReady    = s.is_ready || needsComps.length === doneComps.length;
  const isWaiting  = s.status === 'waiting';

  let actionBtn = '';
  if (s.status === 'ready')
    actionBtn = `<button class="btn btn-primary" style="font-size:10px;padding:3px 8px" onclick="asmStepAction(${s.id},'in_progress')">▶ Start</button>`;
  else if (s.status === 'in_progress')
    actionBtn = `<button class="btn btn-secondary" style="font-size:10px;padding:3px 8px" onclick="asmStepAction(${s.id},'done')">✓ Done</button>`;

  return `
    <div style="border:1px solid ${s.status==='ready'?'var(--accent)':s.status==='in_progress'?'var(--amber)':'var(--border)'};border-radius:8px;padding:10px 12px;background:var(--card);${isWaiting?'opacity:0.75':''}">
      <div style="display:flex;align-items:flex-start;gap:8px">
        <div style="font-size:18px;font-weight:800;color:${col};flex-shrink:0;width:22px;text-align:center;line-height:1.2">${s.step_number}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600">${escHtml(s.name)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">
            ${s.worker_name ? '👷 '+escHtml(s.worker_name)+' · ' : ''}
            ${s.est_hours ? '⏱ '+s.est_hours+'h · ' : ''}
            <span style="color:${col};font-weight:600;text-transform:capitalize">${s.status}</span>
          </div>
          ${isWaiting ? `<div style="font-size:10px;color:var(--amber);margin-top:3px">⏳ Waiting: ${doneComps.length}/${needsComps.length} required components ready</div>` : ''}
          ${s.description ? `<div style="font-size:11px;color:var(--muted);margin-top:3px">${escHtml(s.description)}</div>` : ''}
          ${s.started_at   ? `<div style="font-size:10px;color:var(--muted)">Started: ${fmtDT(s.started_at)}</div>` : ''}
          ${s.completed_at ? `<div style="font-size:10px;color:var(--green)">Done: ${fmtDT(s.completed_at)}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:5px;flex-shrink:0">
          ${actionBtn}
          <button class="btn btn-ghost" style="font-size:10px;padding:2px 6px" onclick="asmEditStep(${s.id})">✎</button>
          <button style="background:none;border:none;color:var(--red);cursor:pointer;font-size:13px;padding:2px 4px" onclick="asmDeleteStep(${s.id})">✕</button>
        </div>
      </div>
    </div>`;
}

// ── Modals ─────────────────────────────────────────────────────────────────────
function _routingOpts(selId) {
  if (!_asmRoutings.length) return '<option value="">No routings defined yet</option>';
  return '<option value="">— Select routing —</option>' +
    _asmRoutings.map(r =>
      `<option value="${r.id}" ${selId===r.id?'selected':''}>[${escHtml(r.product_type)}] ${escHtml(r.name)}</option>`
    ).join('');
}

// Stores loaded ops for the currently-open component modal
let _compModalOps = [];

async function asmRoutingChanged(selEl) {
  const routingId = parseInt(selEl.value) || null;
  const previewEl = document.getElementById('ac_routing_preview');
  if (!previewEl) return;
  if (!routingId) { previewEl.innerHTML = ''; _compModalOps = []; return; }

  previewEl.innerHTML = `<div style="padding:10px;text-align:center;color:var(--muted);font-size:12px">Loading operations…</div>`;

  try {
    const r = await api('GET', `/api/routings/${routingId}`);
    // Cache it
    const idx = _asmRoutings.findIndex(x => x.id === routingId);
    if (idx >= 0) _asmRoutings[idx] = r; else _asmRoutings.push(r);

    // Build editable ops list
    _compModalOps = r.operations.map(op => {
      const subs = (op.sub_operations || []).map(s => ({
        id: s.id, name: s.name,
        work_time_mins: s.work_time_mins || 0,
        is_optional: s.is_optional, included: !s.is_optional,
      }));
      const hasSubs = subs.length > 0;
      const subTotal = hasSubs ? subs.filter(s=>s.included).reduce((a,s)=>a+(s.work_time_mins||0),0) : null;
      return {
        operation_id:   op.id,
        name:           op.name,
        wc_name:        op.work_center_name || op.wc_name || '',
        work_center_id: op.work_center_id,
        setup_time_mins: op.setup_time_mins || 0,
        work_time_mins:  hasSubs ? subTotal : (op.work_time_mins != null ? op.work_time_mins : (op.work_time_hrs||0)*60),
        is_optional:    op.is_optional,
        included:       true,
        sub_operations: subs,
        hasSubs,
      };
    });

    _renderCompModalOps(previewEl);
  } catch(e) { previewEl.innerHTML = `<div style="color:var(--red);font-size:12px;padding:8px">Failed to load routing: ${e.message}</div>`; }
}

function _renderCompModalOps(container) {
  if (!container) container = document.getElementById('ac_routing_preview');
  if (!container) return;
  if (!_compModalOps.length) { container.innerHTML = ''; return; }

  const rows = _compModalOps.map((op, i) => {
    const wMins = op.hasSubs
      ? (op.sub_operations.filter(s=>s.included!==false).reduce((a,s)=>a+(s.work_time_mins||0),0))
      : (op.work_time_mins || 0);
    const chk = op.is_optional
      ? `<input type="checkbox" ${op.included?'checked':''} onchange="_compOpToggle(${i},this.checked)" style="accent-color:var(--amber);width:13px;height:13px">`
      : `<span style="color:var(--muted);font-size:11px">✓</span>`;
    return `<tr style="${op.included?'':'opacity:.4'}">
      <td style="padding:4px 6px;text-align:center">${chk}</td>
      <td style="padding:4px 6px;font-size:11px;font-weight:500">${escHtml(op.name)}</td>
      <td style="padding:4px 6px;font-size:10px;color:var(--muted)">${escHtml(op.wc_name)}</td>
      <td style="padding:4px 6px;text-align:center">
        <input type="number" value="${Math.round(op.setup_time_mins||0)}" min="0" step="5"
          onchange="_compOpSetup(${i},this.value)"
          style="width:52px;font-size:11px;${op.included?'':'pointer-events:none'}">
      </td>
      <td style="padding:4px 6px;text-align:center">
        <input type="number" value="${Math.round(wMins)}" min="0" step="10"
          onchange="_compOpWork(${i},this.value)"
          style="width:62px;font-size:11px;${(op.included&&!op.hasSubs)?'':'pointer-events:none;background:var(--surface)'}">
      </td>
    </tr>`;
  }).join('');

  const totalMins = _compModalOps
    .filter(op=>op.included)
    .reduce((a,op) => {
      const w = op.hasSubs
        ? op.sub_operations.filter(s=>s.included!==false).reduce((acc,s)=>acc+(s.work_time_mins||0),0)
        : (op.work_time_mins||0);
      return a + (op.setup_time_mins||0) + w;
    }, 0);
  const totalHrs = (totalMins/60).toFixed(1);

  container.innerHTML = `
    <div style="margin-top:10px;border:1px solid var(--border);border-radius:6px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:var(--surface)">
            <th style="padding:4px 6px;font-size:10px;color:var(--muted);width:28px">✓</th>
            <th style="padding:4px 6px;font-size:10px;color:var(--muted);text-align:left">Operation</th>
            <th style="padding:4px 6px;font-size:10px;color:var(--muted);text-align:left">Machine</th>
            <th style="padding:4px 6px;font-size:10px;color:var(--muted);text-align:center">Setup<br><span style="font-weight:400">(min)</span></th>
            <th style="padding:4px 6px;font-size:10px;color:var(--muted);text-align:center">Work<br><span style="font-weight:400">(min)</span></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr style="background:var(--surface);border-top:1px solid var(--border)">
            <td colspan="4" style="padding:5px 8px;font-size:11px;color:var(--muted)">Total estimated time</td>
            <td style="padding:5px 8px;font-size:11px;font-weight:700;color:var(--accent);text-align:center">${Math.round(totalMins)}min (${totalHrs}h)</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <!-- Material ready date -->
    <div style="display:flex;gap:12px;margin-top:10px;align-items:flex-end">
      <div class="form-group" style="margin:0;flex:1">
        <div class="fld-label" style="font-size:11px">Material Ready Date <span style="font-size:10px;color:var(--muted);font-weight:400">(leave blank if in stock)</span></div>
        <input type="date" id="ac_mat_date" style="font-size:12px">
      </div>
    </div>`;
}

function _compOpToggle(i, checked) {
  _compModalOps[i].included = checked;
  _renderCompModalOps();
}
function _compOpSetup(i, val) {
  _compModalOps[i].setup_time_mins = parseFloat(val)||0;
}
function _compOpWork(i, val) {
  _compModalOps[i].work_time_mins = parseFloat(val)||0;
  _compModalOps[i].work_time_hrs  = (parseFloat(val)||0)/60;
}
function _workerOpts(selId) {
  return `<option value="">— unassigned —</option>` +
    _asmWorkers.filter(w => w.is_active).map(w =>
      `<option value="${w.id}" ${selId===w.id?'selected':''}>${escHtml(w.name)}</option>`
    ).join('');
}
function _stepOpts(selStep) {
  const steps = _asmData?.assembly_steps || [];
  const maxStep = steps.length ? Math.max(...steps.map(s=>s.step_number)) : 0;
  const opts = [];
  for (let i = 1; i <= maxStep + 2; i++)
    opts.push(`<option value="${i}" ${selStep===i?'selected':''}>${i}</option>`);
  return opts.join('');
}

function asmAddComponent() {
  showModal('Add Component', `
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Component Name <span style="color:var(--red)">*</span></div>
        <input id="ac_name" placeholder="e.g. Lower Die Frame">
      </div>
      <div class="form-group">
        <div class="fld-label">Quantity</div>
        <input id="ac_qty" type="number" value="1" min="1" style="width:80px">
      </div>
    </div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Type <span style="color:var(--red)">*</span></div>
        <select id="ac_type" onchange="asmCompTypeChange(this.value)">
          <option value="make">🔨 Make (in-house job)</option>
          <option value="outside">🏭 Outside (send to vendor)</option>
          <option value="purchase">🛒 Purchase (buy/order)</option>
        </select>
      </div>
      <div class="form-group">
        <div class="fld-label">Assembly Step <span style="font-size:10px;color:var(--muted);font-weight:400">— needed before which step?</span></div>
        <select id="ac_step">${_stepOpts(1)}</select>
      </div>
    </div>

    <!-- MAKE section -->
    <div id="ac_make_section">
      <div class="form-group">
        <div class="fld-label">Routing Template <span style="color:var(--red)">*</span> <span style="font-size:10px;color:var(--muted);font-weight:400">— defines the machine operations for this part</span></div>
        <select id="ac_routing" onchange="asmRoutingChanged(this)" style="width:100%">
          ${_routingOpts(null)}
        </select>
      </div>
      <div id="ac_routing_preview"></div>
    </div>

    <!-- OUTSIDE section -->
    <div id="ac_outside_section" style="display:none">
      <div class="form-row cols-2">
        <div class="form-group">
          <div class="fld-label">Vendor Name</div>
          <input id="ac_vendor" placeholder="e.g. Rajesh Heat Treatment">
        </div>
        <div class="form-group">
          <div class="fld-label">Expected Back Date</div>
          <input type="date" id="ac_expected_out">
        </div>
      </div>
    </div>

    <!-- PURCHASE section -->
    <div id="ac_purchase_section" style="display:none">
      <div class="form-group">
        <div class="fld-label">Supplier / Source</div>
        <input id="ac_supplier" placeholder="e.g. Rathod Hardware">
      </div>
    </div>

    <div class="form-group">
      <div class="fld-label">Notes</div>
      <input id="ac_notes" placeholder="Optional notes or specifications">
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" id="ac_save_btn" onclick="asmSaveComponent(null)">Add Component</button>`
  );
}

function asmCompTypeChange(val) {
  document.getElementById('ac_make_section').style.display     = val==='make'     ? '' : 'none';
  document.getElementById('ac_outside_section').style.display  = val==='outside'  ? '' : 'none';
  const ps = document.getElementById('ac_purchase_section');
  if (ps) ps.style.display = val==='purchase' ? '' : 'none';
}

function asmEditComponent(compId) {
  const c = (_asmData.components||[]).find(x=>x.id===compId);
  if (!c) return;
  showModal('Edit Component', `
    <div class="form-group">
      <div class="fld-label">Component Name</div>
      <input id="ac_name" value="${escHtml(c.name)}">
    </div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Type</div>
        <select id="ac_type" disabled>
          <option value="${c.component_type}" selected>${c.component_type}</option>
        </select>
      </div>
      <div class="form-group">
        <div class="fld-label">Assembly Step</div>
        <select id="ac_step">${_stepOpts(c.assembly_step)}</select>
      </div>
    </div>
    ${c.component_type==='outside' ? `
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Vendor</div>
        <input id="ac_vendor" value="${escHtml(c.vendor_name||'')}">
      </div>
      <div class="form-group">
        <div class="fld-label">Expected Back</div>
        <input type="date" id="ac_expected" value="${c.expected_back?.substring(0,10)||''}">
      </div>
    </div>` : ''}
    <div class="form-group">
      <div class="fld-label">Notes</div>
      <input id="ac_notes" value="${escHtml(c.notes||'')}">
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" id="ac_save_btn" onclick="asmSaveComponent(${compId})">Save</button>`
  );
}

async function asmSaveComponent(editId) {
  const name = document.getElementById('ac_name')?.value?.trim();
  if (!name) { toast('Name is required','error'); return; }
  setLoading('ac_save_btn', true);
  try {
    if (editId) {
      const data = {
        name:           name,
        assembly_step:  parseInt(document.getElementById('ac_step')?.value)||1,
        quantity:       parseInt(document.getElementById('ac_qty')?.value)||1,
        notes:          document.getElementById('ac_notes')?.value?.trim()||'',
        vendor_name:    document.getElementById('ac_vendor')?.value?.trim()||undefined,
        expected_back:  document.getElementById('ac_expected')?.value||document.getElementById('ac_expected_out')?.value||undefined,
      };
      await api('PUT', `/api/orders/${_asmOrderId}/components/${editId}`, data);
    } else {
      const type = document.getElementById('ac_type').value;
      const routingId = parseInt(document.getElementById('ac_routing')?.value)||null;
      if (type === 'make' && !routingId) {
        toast('Select a routing template for this part', 'error');
        setLoading('ac_save_btn', false);
        return;
      }
      // Collect op overrides from the modal op table
      const opOverrides = type === 'make' ? _compModalOps.map((op, i) => ({
        operation_id:    op.operation_id,
        setup_time_mins: parseFloat(document.querySelector(`#ac_routing_preview input[onchange*="_compOpSetup(${i}"]`)?.value) || op.setup_time_mins || 0,
        work_time_mins:  parseFloat(document.querySelector(`#ac_routing_preview input[onchange*="_compOpWork(${i}"]`)?.value) || op.work_time_mins || 0,
        included:        op.included !== false,
      })) : [];
      const matDate = document.getElementById('ac_mat_date')?.value || null;
      const data = {
        name:               name,
        component_type:     type,
        assembly_step:      parseInt(document.getElementById('ac_step')?.value)||1,
        quantity:           parseInt(document.getElementById('ac_qty')?.value)||1,
        notes:              document.getElementById('ac_notes')?.value?.trim()||'',
        routing_id:         routingId,
        op_overrides:       opOverrides.length ? opOverrides : undefined,
        material_ready_date: matDate ? matDate + 'T08:00:00' : undefined,
        vendor_name:    type==='outside' ? (document.getElementById('ac_vendor')?.value?.trim()||'') :
                        type==='purchase' ? (document.getElementById('ac_supplier')?.value?.trim()||'') : '',
        expected_back:  document.getElementById('ac_expected_out')?.value||undefined,
      };
      await api('POST', `/api/orders/${_asmOrderId}/components`, data);
    }
    toast('Saved!');
    closeModal();
    await _reloadAssemblyData();
    _renderAssemblyPage();
  } catch(e) { toast(e.message,'error'); }
  finally { setLoading('ac_save_btn', false); }
}

async function asmCompStatus(compId, newStatus) {
  try {
    await api('PUT', `/api/orders/${_asmOrderId}/components/${compId}`, { status: newStatus });
    await _reloadAssemblyData();
    _renderAssemblyPage();
  } catch(e) { toast(e.message,'error'); }
}

async function asmDeleteComponent(compId) {
  const c = (_asmData.components||[]).find(x=>x.id===compId);
  if (!c) return;
  const ok = await confirm2(`Delete component "${c.name}"?${c.job_number?' This will also delete job '+c.job_number+'.':''}`, 'Delete');
  if (!ok) return;
  try {
    await api('DELETE', `/api/orders/${_asmOrderId}/components/${compId}`);
    toast('Deleted');
    await _reloadAssemblyData();
    _renderAssemblyPage();
  } catch(e) { toast(e.message,'error'); }
}

// ── Assembly Steps ─────────────────────────────────────────────────────────────
function asmAddStep() {
  const steps    = _asmData?.assembly_steps || [];
  const nextStep = steps.length ? Math.max(...steps.map(s=>s.step_number)) + 1 : 1;
  showModal('Add Assembly Step', `
    <div class="form-group">
      <div class="fld-label">Step Name <span style="color:var(--red)">*</span></div>
      <input id="as_name" placeholder="e.g. Mount lower die frame on base plate">
    </div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Step Number</div>
        <input type="number" id="as_num" value="${nextStep}" min="1">
      </div>
      <div class="form-group">
        <div class="fld-label">Est. Hours</div>
        <input type="number" id="as_hrs" placeholder="2.5" min="0" step="0.25">
      </div>
    </div>
    <div class="form-group">
      <div class="fld-label">Assigned Worker</div>
      <select id="as_worker">${_workerOpts(null)}</select>
    </div>
    <div class="form-group">
      <div class="fld-label">Description / Instructions</div>
      <textarea id="as_desc" placeholder="What happens in this step..."></textarea>
    </div>
    <div style="padding:10px 12px;background:var(--surface);border-radius:6px;font-size:12px;color:var(--muted)">
      💡 This step will become <strong>Ready</strong> automatically when all components assigned to Step ≤ ${nextStep} are done/received.
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" id="as_save_btn" onclick="asmSaveStep(null)">Add Step</button>`
  );
}

function asmEditStep(stepId) {
  const s = (_asmData.assembly_steps||[]).find(x=>x.id===stepId);
  if (!s) return;
  showModal('Edit Assembly Step', `
    <div class="form-group">
      <div class="fld-label">Step Name</div>
      <input id="as_name" value="${escHtml(s.name)}">
    </div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Step Number</div>
        <input type="number" id="as_num" value="${s.step_number}" min="1">
      </div>
      <div class="form-group">
        <div class="fld-label">Est. Hours</div>
        <input type="number" id="as_hrs" value="${s.est_hours||''}" min="0" step="0.25">
      </div>
    </div>
    <div class="form-group">
      <div class="fld-label">Assigned Worker</div>
      <select id="as_worker">${_workerOpts(s.worker_id)}</select>
    </div>
    <div class="form-group">
      <div class="fld-label">Description</div>
      <textarea id="as_desc">${escHtml(s.description||'')}</textarea>
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" id="as_save_btn" onclick="asmSaveStep(${stepId})">Save</button>`
  );
}

async function asmSaveStep(editId) {
  const name = document.getElementById('as_name')?.value?.trim();
  if (!name) { toast('Step name is required','error'); return; }
  setLoading('as_save_btn', true);
  const data = {
    name:        name,
    step_number: parseInt(document.getElementById('as_num')?.value)||1,
    est_hours:   parseFloat(document.getElementById('as_hrs')?.value)||null,
    worker_id:   parseInt(document.getElementById('as_worker')?.value)||null,
    description: document.getElementById('as_desc')?.value?.trim()||'',
  };
  try {
    if (editId)
      await api('PUT', `/api/orders/${_asmOrderId}/assembly-steps/${editId}`, data);
    else
      await api('POST', `/api/orders/${_asmOrderId}/assembly-steps`, data);
    toast('Saved!');
    closeModal();
    await _reloadAssemblyData();
    _renderAssemblyPage();
  } catch(e) { toast(e.message,'error'); }
  finally { setLoading('as_save_btn', false); }
}

async function asmStepAction(stepId, newStatus) {
  try {
    await api('PUT', `/api/orders/${_asmOrderId}/assembly-steps/${stepId}`, { status: newStatus });
    await _reloadAssemblyData();
    _renderAssemblyPage();
  } catch(e) { toast(e.message,'error'); }
}

async function asmDeleteStep(stepId) {
  const s = (_asmData.assembly_steps||[]).find(x=>x.id===stepId);
  const ok = await confirm2(`Delete step "${s?.name}"?`, 'Delete');
  if (!ok) return;
  try {
    await api('DELETE', `/api/orders/${_asmOrderId}/assembly-steps/${stepId}`);
    toast('Deleted');
    await _reloadAssemblyData();
    _renderAssemblyPage();
  } catch(e) { toast(e.message,'error'); }
}

// ── Helper: format datetime ────────────────────────────────────────────────────
function fmtDT(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
       + ' ' + d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
}
