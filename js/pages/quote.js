/**
 * Dolphin ERP — Quote Mode
 * Simulate delivery estimates without touching the DB.
 */

const QUOTE_PTYPES = ['Punch','Die Frame','Liner Set','Complete Mould','Custom Plate',
                      'Base Plate','Ejector Plate','Addon Plate','SFS Lower','SFS Upper'];
const QUOTE_SIZES  = ['600x600','600x900','600x1200','900x900','900x1200','1200x1200'];

let _quoteResult  = null;
let _quoteFormOps = [];
let _quoteTimer   = null;

async function renderQuote() {
  await loadAll();
  document.getElementById('topbarActions').innerHTML = '';

  const routingOpts = allRoutings
    .map(r => `<option value="${r.id}" data-ptype="${escHtml(r.product_type||'')}">${escHtml(r.name)} (${escHtml(r.product_type||'')})</option>`)
    .join('');
  const custOpts = allCustomers
    .map(c => `<option value="${escHtml(c.name)}">${escHtml(c.name)}</option>`)
    .join('');
  const defDue = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const ptypeOpts = QUOTE_PTYPES.map(p => `<option>${p}</option>`).join('');
  const sizeOpts  = QUOTE_SIZES.map(s => `<option>${s}</option>`).join('') + '<option value="custom">Custom…</option>';

  document.getElementById('content').innerHTML = `
  <div style="max-width:1100px;margin:0 auto;padding:0 4px">

    <div style="margin-bottom:20px">
      <h2 style="font-size:20px;font-weight:700;margin:0 0 4px">Quote Mode</h2>
      <div style="font-size:13px;color:var(--muted)">Simulate delivery dates without creating an order. Checks real machine load.</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 380px;gap:18px;align-items:start">

      <!-- LEFT -->
      <div style="display:flex;flex-direction:column;gap:14px">

        <!-- Product -->
        <div class="card" style="padding:18px 20px">
          <div class="form-section" style="margin-top:0">Product</div>
          <div class="form-row cols-3">
            <div class="form-group">
              <div class="fld-label">Product Type</div>
              <select id="q_ptype" onchange="qFilterRouting()">${ptypeOpts}</select>
            </div>
            <div class="form-group">
              <div class="fld-label">Size</div>
              <select id="q_size" onchange="qOnSizeChange()">${sizeOpts}</select>
            </div>
            <div class="form-group">
              <div class="fld-label">Variant / Type</div>
              <input id="q_variant" placeholder="Plain, Carbide, Rustic…">
            </div>
          </div>
          <div id="q_size_custom_wrap" style="display:none" class="form-row cols-1">
            <div class="form-group">
              <div class="fld-label">Custom Size</div>
              <input id="q_size_custom" placeholder="e.g. 750x1000">
            </div>
          </div>
          <div class="form-row cols-2">
            <div class="form-group">
              <div class="fld-label">Routing Template <span style="color:var(--red)">*</span></div>
              <select id="q_routing" onchange="qLoadOps()">${routingOpts ? `<option value="">— Select —</option>${routingOpts}` : '<option value="">No routings yet</option>'}</select>
            </div>
            <div class="form-group">
              <div class="fld-label">Customer (optional)</div>
              <input id="q_cust" list="q_cust_list" placeholder="Type customer name">
              <datalist id="q_cust_list">${custOpts}</datalist>
            </div>
          </div>
        </div>

        <!-- Dimension calculator (shown for punch types) -->
        <div id="q_dim_panel" style="display:none;background:var(--accent-soft);border:1px solid var(--accent);border-radius:8px;padding:14px 16px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--accent);margin-bottom:10px">📐 Auto-Calculate Times from Dimensions</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end">
            <div class="form-group" style="margin:0">
              <div class="fld-label">Length (mm)</div>
              <input type="number" id="q_length" min="1" step="1" placeholder="e.g. 670" oninput="qDimDebounce()">
            </div>
            <div class="form-group" style="margin:0">
              <div class="fld-label">Width (mm)</div>
              <input type="number" id="q_width" min="1" step="1" placeholder="e.g. 670" oninput="qDimDebounce()">
            </div>
            <div class="form-group" style="margin:0">
              <div class="fld-label">Thickness (mm)</div>
              <input type="number" id="q_thickness" min="1" step="1" value="35" oninput="qDimDebounce()">
            </div>
            <button class="btn btn-primary" style="white-space:nowrap;height:36px" onclick="qCalcDims()">⚡ Calculate</button>
          </div>
          <div style="font-size:10px;color:var(--muted);margin-top:6px">
            Times calculated from formula sheet · Plain ≤600mm: Edge Grinding · &gt;600mm: Edge Sizing · Iso adds Iso Depth Milling + Radius Milling
          </div>
        </div>

        <!-- Quantity & Schedule -->
        <div class="card" style="padding:18px 20px">
          <div class="form-section" style="margin-top:0">Quantity & Dates</div>
          <div class="form-row cols-3">
            <div class="form-group">
              <div class="fld-label">Quantity <span style="color:var(--red)">*</span></div>
              <input id="q_qty" type="number" min="1" max="50" value="1" oninput="qDebounce()">
            </div>
            <div class="form-group">
              <div class="fld-label">Desired Due Date <span style="color:var(--red)">*</span></div>
              <input id="q_due" type="date" value="${defDue}" onchange="qDebounce()">
            </div>
            <div class="form-group">
              <div class="fld-label">Material Ready Date</div>
              <input id="q_mat" type="date" title="Leave blank if material already in stock" onchange="qDebounce()">
            </div>
          </div>
        </div>

        <!-- Operation times -->
        <div class="card" style="padding:18px 20px;display:none" id="q_ops_card">
          <div class="form-section" style="margin-top:0">Operation Times
            <span style="font-size:11px;color:var(--muted);font-weight:400;margin-left:8px">Edit then recalculate</span>
          </div>
          <div id="q_ops_wrap"><div style="color:var(--muted);font-size:12px">Select a routing first</div></div>
          <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
            <button class="btn btn-primary" onclick="runQuote()">⚡ Recalculate</button>
            <span style="font-size:11px;color:var(--muted)" id="q_total_label"></span>
          </div>
        </div>

      </div>

      <!-- RIGHT: result -->
      <div style="position:sticky;top:16px">
        <div class="card" style="padding:18px 20px" id="q_result_panel">
          <div style="text-align:center;padding:32px 16px;color:var(--muted)">
            <div style="font-size:32px;margin-bottom:10px">📋</div>
            <div style="font-size:13px">Select a routing and due date<br>to simulate delivery</div>
          </div>
        </div>
      </div>

    </div>
  </div>`;

  // Auto-filter routing based on default product type
  qFilterRouting();
}

// ── Filter routing dropdown by product type ───────────────────────────────────
function qFilterRouting() {
  const ptype  = document.getElementById('q_ptype')?.value || '';
  const sel    = document.getElementById('q_routing');
  if (!sel) return;
  const matches = allRoutings.filter(r => !ptype || r.product_type === ptype);
  sel.innerHTML = `<option value="">— Select routing —</option>`
    + matches.map(r => `<option value="${r.id}">${escHtml(r.name)}</option>`).join('');
  _quoteFormOps = [];
  document.getElementById('q_ops_card').style.display = 'none';

  // Show dimension panel for Punch types
  const dimPanel = document.getElementById('q_dim_panel');
  if (dimPanel) dimPanel.style.display = ptype.toLowerCase().includes('punch') ? '' : 'none';
}

function qOnSizeChange() {
  const sel = document.getElementById('q_size');
  const cw  = document.getElementById('q_size_custom_wrap');
  if (cw) cw.style.display = sel?.value === 'custom' ? '' : 'none';

  // Auto-fill dimensions from selected size
  if (sel?.value && sel.value !== 'custom') {
    const parts = sel.value.toLowerCase().split('x');
    if (parts.length === 2) {
      const L = parseInt(parts[0]), W = parseInt(parts[1]);
      const lEl = document.getElementById('q_length');
      const wEl = document.getElementById('q_width');
      if (lEl && !lEl.value) lEl.value = L;
      if (wEl && !wEl.value) wEl.value = W;
    }
  }
}

// ── Load ops from routing ─────────────────────────────────────────────────────
async function qLoadOps() {
  const rid = parseInt(document.getElementById('q_routing')?.value);
  if (!rid) { _quoteFormOps = []; document.getElementById('q_ops_card').style.display = 'none'; return; }
  try {
    const rt = await api('GET', `/api/routings/${rid}`);
    _quoteFormOps = (rt.operations || []).map(op => {
      const subs = (op.sub_operations || []);
      const subTotal = subs.reduce((s, x) => s + (x.work_time_mins || 0), 0);
      const hasSubs  = subs.length > 0;
      return {
        operation_id:   op.id,
        name:           op.name,
        wc_name:        op.work_center_name || '',
        work_center_id: op.work_center_id,
        setup_time_mins: op.setup_time_mins || ((op.machine_setup_mins||0)+(op.job_setup_mins||0)),
        work_time_mins:  hasSubs ? subTotal : (op.work_time_mins != null ? op.work_time_mins : (op.work_time_hrs||0)*60),
        formula_type:   op.formula_type || null,
        mrr:            op.mrr ?? null,
        depth_mm:       op.depth_mm ?? null,
        feed_rate:      op.feed_rate ?? null,
        dim_x_source:   op.dim_x_source || null,
        dim_y_source:   op.dim_y_source || null,
        sub_operations: subs,
        included:       true,
      };
    });
    qRenderOpsTable();
    qDebounce();
  } catch(e) { toast(e.message, 'error'); }
}

function qRenderOpsTable() {
  const card = document.getElementById('q_ops_card');
  if (!card) return;
  if (!_quoteFormOps.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  const rows = _quoteFormOps.map((op, i) => {
    const wm = Math.round(op.work_time_mins || 0);
    const sm = Math.round(op.setup_time_mins || 0);
    return `<tr id="q_oprow_${i}" class="${op.included ? '' : 'excluded'}">
      <td><input type="checkbox" ${op.included?'checked':''} onchange="qToggleOp(${i},this.checked)" style="width:14px;height:14px;accent-color:var(--accent)"></td>
      <td class="mono" style="color:var(--muted);text-align:center">${i+1}</td>
      <td style="font-weight:500;font-size:12px">${escHtml(op.name)}</td>
      <td style="color:var(--muted);font-family:var(--mono);font-size:11px">${escHtml(op.wc_name)}</td>
      <td><input type="number" id="qos_${i}" value="${sm}" min="0" step="5" onchange="qRecalcOp(${i})" ${op.included?'':'disabled'} style="width:70px"></td>
      <td><input type="number" id="qow_${i}" value="${wm}" min="0" step="10" onchange="qRecalcOp(${i})" ${op.included?'':'disabled'} style="width:70px"></td>
      <td class="mono" style="color:var(--muted);text-align:right;font-size:11px" id="qot_${i}">${fmtTotal(sm+wm)}</td>
    </tr>`;
  }).join('');

  document.getElementById('q_ops_wrap').innerHTML = `
    <table class="op-ov-table" style="font-size:12px">
      <thead><tr><th>✓</th><th>#</th><th>Operation</th><th>Machine</th><th>Setup(min)</th><th>Work(min)</th><th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  qUpdateGrandTotal();
}

function qToggleOp(i, checked) {
  _quoteFormOps[i].included = checked;
  const row = document.getElementById(`q_oprow_${i}`);
  if (row) row.className = checked ? '' : 'excluded';
  [`qos_${i}`, `qow_${i}`].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = !checked; });
  qUpdateGrandTotal();
}
function qRecalcOp(i) {
  const s = parseFloat(document.getElementById(`qos_${i}`)?.value) || 0;
  const w = parseFloat(document.getElementById(`qow_${i}`)?.value) || 0;
  _quoteFormOps[i].setup_time_mins = s;
  _quoteFormOps[i].work_time_mins  = w;
  const el = document.getElementById(`qot_${i}`);
  if (el) el.textContent = fmtTotal(s + w);
  qUpdateGrandTotal();
}
function qUpdateGrandTotal() {
  const tot = _quoteFormOps.filter(o => o.included).reduce((s, o, i) => {
    const sv = parseFloat(document.getElementById(`qos_${i}`)?.value) ?? o.setup_time_mins;
    const wv = parseFloat(document.getElementById(`qow_${i}`)?.value) ?? o.work_time_mins;
    return s + sv + wv;
  }, 0);
  const el = document.getElementById('q_total_label');
  if (el) el.textContent = `Total work: ${fmtTotal(tot)} per piece`;
}

// ── Dimension calculator (same logic as order editor) ─────────────────────────
let _qDimTimer = null;
function qDimDebounce() { clearTimeout(_qDimTimer); _qDimTimer = setTimeout(qCalcDims, 800); }

async function qCalcDims() {
  const L = parseFloat(document.getElementById('q_length')?.value) || 0;
  const W = parseFloat(document.getElementById('q_width')?.value)  || 0;
  const T = parseFloat(document.getElementById('q_thickness')?.value) || 35;
  if (!L || !W) return;
  if (!_quoteFormOps.length) { toast('Select a routing template first', 'error'); return; }

  const payload = {
    length: L, width: W, thickness: T,
    routing_ops: _quoteFormOps.map(op => ({
      operation_id:   op.operation_id || null,
      name:           op.name,
      formula_type:   op.formula_type || 'fixed',
      mrr:            op.mrr || null,
      depth_mm:       op.depth_mm || null,
      feed_rate:      op.feed_rate || null,
      dim_x_source:   op.dim_x_source || null,
      dim_y_source:   op.dim_y_source || null,
      setup_time_mins:op.setup_time_mins || 0,
      machining_mins: op.work_time_mins  || 0,
      work_center_id: op.work_center_id  || null,
      included:       op.included !== false,
      sub_operations: (op.sub_operations || []).map(s => ({
        id:            s.id || null,
        name:          s.name,
        formula_type:  s.formula_type || 'fixed',
        mrr:           s.mrr || null,
        depth_mm:      s.depth_mm || null,
        feed_rate:     s.feed_rate || null,
        dim_x_source:  s.dim_x_source || null,
        dim_y_source:  s.dim_y_source || null,
        work_time_mins:s.work_time_mins || 0,
        is_optional:   s.is_optional || false,
        included:      s.included !== false,
      })),
    }))
  };

  try {
    const r = await api('POST', '/api/punch-calc', payload);
    if (r.ops.length !== _quoteFormOps.length) {
      toast('Formula mismatch — re-select routing', 'error'); return;
    }
    _quoteFormOps = _quoteFormOps.map((existing, i) => {
      const calcOp = r.ops[i];
      let updatedSubs = existing.sub_operations || [];
      if (calcOp.sub_operations && calcOp.sub_operations.length === updatedSubs.length) {
        updatedSubs = updatedSubs.map((s, si) => ({
          ...s,
          work_time_mins: calcOp.sub_operations[si].work_time_mins,
          work_time_hrs:  calcOp.sub_operations[si].work_time_mins / 60,
        }));
      }
      return { ...existing, work_time_mins: calcOp.work_time_mins, work_time_hrs: calcOp.work_time_mins / 60, sub_operations: updatedSubs };
    });
    qRenderOpsTable();
    runQuote();
    toast(`Calculated ${r.ops.length} ops · ${Math.round(r.total_mins)} min total`);
  } catch(e) { toast(e.message, 'error'); }
}

// ── Debounce + run simulation ─────────────────────────────────────────────────
function qDebounce() { clearTimeout(_quoteTimer); _quoteTimer = setTimeout(runQuote, 500); }

async function runQuote() {
  const rid = parseInt(document.getElementById('q_routing')?.value);
  const qty = Math.min(parseInt(document.getElementById('q_qty')?.value) || 1, 50);
  const due = document.getElementById('q_due')?.value;
  const mat = document.getElementById('q_mat')?.value;
  if (!rid || !due) return;

  const panel = document.getElementById('q_result_panel');
  panel.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted)"><div class="spinner" style="margin:0 auto 10px"></div>Simulating…</div>`;

  const ovs = _quoteFormOps.map((op, i) => ({
    operation_id:    op.operation_id,
    setup_time_mins: parseFloat(document.getElementById(`qos_${i}`)?.value) ?? op.setup_time_mins,
    work_time_mins:  parseFloat(document.getElementById(`qow_${i}`)?.value) ?? op.work_time_mins,
    included:        document.getElementById(`q_oprow_${i}`)?.className !== 'excluded',
  }));

  try {
    const r = await api('POST', '/api/estimate', {
      routing_id: rid, quantity: qty,
      // start_date omitted — backend always uses now_ist()
      material_ready_date: mat ? `${mat}T00:00:00` : null,
      op_overrides: ovs,
    });
    _quoteResult = { ...r, _due: due, _qty: qty, _rid: rid };
    qRenderResult(r, due, mat);
  } catch(e) {
    panel.innerHTML = `<div style="color:var(--red);padding:20px;text-align:center">Simulation failed:<br>${escHtml(e.message)}</div>`;
  }
}

// ── Render result panel ───────────────────────────────────────────────────────
function qRenderResult(r, dueStr, matStr) {
  const panel      = document.getElementById('q_result_panel');
  const dueDate    = dueStr ? new Date(dueStr + 'T23:59:59') : null;
  const lastFinish = r.est_last_finish  ? new Date(r.est_last_finish)  : null;
  const firstFinish= r.est_first_finish ? new Date(r.est_first_finish) : null;
  const qty        = r.quantity;

  const isLate  = dueDate && lastFinish && lastFinish > dueDate;
  const diffMs  = dueDate && lastFinish ? dueDate - lastFinish : null;
  const diffDays= diffMs !== null ? Math.round(diffMs / 86400000) : null;

  const accentC = isLate ? 'var(--red)' : 'var(--green)';
  const bgC     = isLate ? 'var(--red-soft)' : 'var(--green-soft)';
  const bordC   = isLate ? 'var(--red)' : 'var(--green)';

  const fmtDt   = dt => dt ? dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
  const fmtTime = dt => dt ? dt.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}) : '';

  const matWarn = r.material_blocked ? `
    <div style="background:var(--amber-soft);border:1px solid var(--amber);border-radius:6px;padding:10px 12px;margin-bottom:12px;font-size:12px">
      <strong style="color:var(--amber)">⚠ Material delay</strong><br>
      Start pushed to <strong>${new Date(r.start_date).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</strong>
      because material isn't ready until <strong>${new Date(r.material_ready_date).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</strong>.
      Estimate already accounts for this.
    </div>` : '';

  const lateCount   = r.pieces ? r.pieces.filter(p => dueDate && p.est_finish && new Date(p.est_finish) > dueDate).length : 0;
  const onTimeCount = qty - lateCount;

  const showPieces = qty > 1 && r.pieces && r.pieces.length > 1;
  const pieceRows  = showPieces ? r.pieces.slice(0,10).map(p => {
    const pEnd  = p.est_finish ? new Date(p.est_finish) : null;
    const pLate = dueDate && pEnd && pEnd > dueDate;
    return `<tr>
      <td style="padding:4px 8px;color:var(--muted);font-family:var(--mono);font-size:11px">P${String(p.piece).padStart(2,'0')}</td>
      <td style="padding:4px 8px;font-family:var(--mono);font-size:11px">${fmtDt(pEnd)}</td>
      <td style="padding:4px 8px;font-family:var(--mono);font-size:11px;color:var(--muted)">${fmtTime(pEnd)}</td>
      <td style="padding:4px 8px;text-align:center">${pLate
        ? '<span style="color:var(--red);font-size:11px">⚠ LATE</span>'
        : '<span style="color:var(--green);font-size:11px">✓</span>'}</td>
    </tr>`;
  }).join('') : '';

  panel.innerHTML = `
    <!-- Headline -->
    <div style="background:${bgC};border:1px solid ${bordC};border-radius:8px;padding:14px 16px;text-align:center;margin-bottom:14px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Last piece completes</div>
      <div style="font-size:22px;font-weight:800;color:${accentC};line-height:1.2">${fmtDt(lastFinish)}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">${fmtTime(lastFinish)}</div>
      ${diffDays !== null ? `<div style="margin-top:8px;font-size:12px;font-weight:600;color:${accentC}">
        ${isLate ? `⚠ ${Math.abs(diffDays)} day${Math.abs(diffDays)===1?'':'s'} LATE` : `✓ ${diffDays} day${diffDays===1?'':'s'} buffer`}
      </div>` : ''}
      ${qty > 1 ? `<div style="margin-top:6px;font-size:11px;color:var(--muted)">${onTimeCount}/${qty} pieces on time</div>` : ''}
    </div>

    ${matWarn}

    <!-- Stats -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 10px">
        <div style="color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">First piece</div>
        <div class="mono" style="font-weight:600;font-size:12px">${qty > 1 ? fmtDt(firstFinish) : fmtDt(lastFinish)}</div>
      </div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 10px">
        <div style="color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Work per piece</div>
        <div class="mono" style="font-weight:600;font-size:12px">${fmtTotal(r.total_work_mins)}</div>
      </div>
    </div>

    <!-- Bottlenecks -->
    ${r.bottlenecks && r.bottlenecks.length ? `
    <div style="margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:6px">Machine Load (this order)</div>
      ${r.bottlenecks.slice(0,5).map((b,i) => {
        const pct = r.bottlenecks[0].total_mins ? Math.round(b.total_mins/r.bottlenecks[0].total_mins*100) : 0;
        return `<div style="margin-bottom:5px">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">
            <span>${escHtml(b.wc_name)}</span><span class="mono">${fmtTotal(b.total_mins)}</span>
          </div>
          <div style="height:4px;background:var(--border);border-radius:2px">
            <div style="height:4px;width:${pct}%;background:${i===0?'var(--accent)':'var(--border-strong)'};border-radius:2px"></div>
          </div>
        </div>`;
      }).join('')}
    </div>` : ''}

    <!-- Piece breakdown -->
    ${showPieces ? `
    <div style="margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:6px">Piece-by-Piece${qty>10?' (first 10)':''}</div>
      <div style="border:1px solid var(--border);border-radius:6px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="border-bottom:1px solid var(--border);background:var(--surface)">
            <th style="padding:5px 8px;text-align:left;font-size:10px;color:var(--muted)">Piece</th>
            <th style="padding:5px 8px;text-align:left;font-size:10px;color:var(--muted)">Finish</th>
            <th style="padding:5px 8px;text-align:left;font-size:10px;color:var(--muted)">Time</th>
            <th style="padding:5px 8px;text-align:center;font-size:10px;color:var(--muted)">OK?</th>
          </tr></thead>
          <tbody>${pieceRows}</tbody>
        </table>
      </div>
    </div>` : ''}

    <!-- Actions -->
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
      <button class="btn btn-primary" style="width:100%;font-size:13px" onclick="qCreateOrder()">✓ Looks good — Create Order</button>
      <button class="btn btn-secondary" style="width:100%;font-size:12px" onclick="qTryEarlier()">Try earlier due date</button>
    </div>
    <div style="font-size:10px;color:var(--muted);margin-top:10px;text-align:center">Based on real machine load · No order created yet</div>`;
}

// ── Actions ───────────────────────────────────────────────────────────────────
function qTryEarlier() {
  const el = document.getElementById('q_due');
  if (!el) return;
  const d = new Date(el.value);
  d.setDate(d.getDate() - 2);
  el.value = d.toISOString().slice(0,10);
  runQuote();
}

function qCreateOrder() {
  if (!_quoteResult) return;
  const size    = document.getElementById('q_size')?.value === 'custom'
    ? (document.getElementById('q_size_custom')?.value || '')
    : (document.getElementById('q_size')?.value || '');
  sessionStorage.setItem('dolphin_quote_prefill', JSON.stringify({
    routing_id:          _quoteResult._rid,
    due_date:            _quoteResult._due,
    quantity:            _quoteResult._qty,
    material_ready_date: document.getElementById('q_mat')?.value || '',
    customer_name:       document.getElementById('q_cust')?.value || '',
    product_type:        document.getElementById('q_ptype')?.value || '',
    product_size:        size,
    product_variant:     document.getElementById('q_variant')?.value || '',
  }));
  navigate('/orders/new');
}
