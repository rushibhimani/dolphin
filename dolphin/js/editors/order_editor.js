/**
 * Dolphin ERP — Order Editor
 * Full-page editor — routes: #/orders/new, #/orders/:id
 */

async function renderOrderEditor(editId){
  await loadAll();
  const PTYPES = ['Punch','Die Frame','Liner Set','Complete Mould','Custom Plate',
                  'Base Plate','Ejector Plate','Addon Plate','SFS Lower','SFS Upper'];
  const SIZES  = ['600x600','600x900','600x1200','900x900','900x1200','1200x1200'];
  const custOpts = allCustomers.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  const routingOpts = allRoutings.map(r=>`<option value="${r.id}">${r.name} (${r.product_type})</option>`).join('');
  const defDue = new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  orderFormOps = [];

  document.getElementById('content').innerHTML = `
    <div class="editor-page">
      <div class="editor-header">
        <h2 class="editor-title">New Order</h2>
        <div class="editor-subtitle">Create a new customer manufacturing order</div>
      </div>
      <div class="editor-body" style="max-width:100%;padding:20px 28px">
        <div style="display:grid;grid-template-columns:1fr 320px;gap:18px;align-items:start">

    <div><!-- LEFT COLUMN -->
    <div class="form-section">Customer</div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Customer <span style="color:var(--red)">*</span></div>
        <select id="ord_cust"><option value="">— Select —</option>${custOpts}</select>
      </div>
      <div class="form-group">
        <div class="fld-label">PO Number</div>
        <input id="ord_po" placeholder="Customer PO reference">
      </div>
    </div>

    <div class="form-section">Product</div>
    <div class="form-row cols-3">
      <div class="form-group">
        <div class="fld-label">Product Type <span style="color:var(--red)">*</span></div>
        <select id="ord_ptype" onchange="filterOrderRouting()">${PTYPES.map(p=>`<option>${p}</option>`).join('')}</select>
      </div>
      <div class="form-group">
        <div class="fld-label">Size <span style="color:var(--red)">*</span></div>
        <select id="ord_size">
          ${SIZES.map(s=>`<option>${s}</option>`).join('')}
          <option value="custom">Custom…</option>
        </select>
      </div>
      <div class="form-group">
        <div class="fld-label">Variant / Type</div>
        <input id="ord_variant" placeholder="Plain, Carbide, Rustic…">
      </div>
    </div>
    <div id="ord_size_custom_wrap" style="display:none" class="form-row cols-1">
      <div class="form-group">
        <div class="fld-label">Custom Size</div>
        <input id="ord_size_custom" placeholder="e.g. 750x1000">
      </div>
    </div>

    <div class="form-section">Quantity & Schedule</div>
    <div class="form-row cols-3">
      <div class="form-group">
        <div class="fld-label">Quantity <span style="color:var(--red)">*</span></div>
        <input id="ord_qty" type="number" min="1" max="200" value="1" oninput="triggerEstimate()">
      </div>
      <div class="form-group">
        <div class="fld-label">Due Date <span style="color:var(--red)">*</span></div>
        <input id="ord_due" type="date" value="${defDue}">
      </div>
      <div class="form-group">
        <div class="fld-label">Total Price (₹)</div>
        <input id="ord_price" type="number" min="0" step="100" placeholder="All pieces">
      </div>
    </div>

    <div class="form-section">Routing & Operations</div>
    <div class="form-row cols-1">
      <div class="form-group">
        <div class="fld-label">Routing Template <span style="color:var(--red)">*</span></div>
        <select id="ord_routing" onchange="loadOrderOps()">${routingOpts?`<option value="">— Select —</option>${routingOpts}`:'<option value="">No routings — create one first</option>'}</select>
      </div>
    </div>

    <!-- Punch dimension calculator — shown only when routing has formula-based ops -->
    <div id="punchCalcPanel" style="display:none;background:var(--accent-soft);border:1px solid var(--accent);border-radius:8px;padding:12px;margin:8px 0">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--accent);margin-bottom:8px">📐 Auto-Calculate Times from Dimensions</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end">
        <div class="form-group" style="margin:0">
          <div class="fld-label">Length (mm)</div>
          <input type="number" id="ord_length" min="1" step="1" placeholder="e.g. 670" oninput="debounceEstimate()">
        </div>
        <div class="form-group" style="margin:0">
          <div class="fld-label">Width (mm)</div>
          <input type="number" id="ord_width" min="1" step="1" placeholder="e.g. 670" oninput="debounceEstimate()">
        </div>
        <div class="form-group" style="margin:0">
          <div class="fld-label">Thickness (mm)</div>
          <input type="number" id="ord_thickness" min="1" step="1" value="35" placeholder="35">
        </div>
        <button class="btn btn-primary" style="height:36px;white-space:nowrap;flex-shrink:0" onclick="calcPunchTimes()">⚡ Calculate</button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:6px">
        Times calculated from your Excel formula sheet · Plain ≤600mm: Edge Grinding · &gt;600mm: Edge Sizing · Iso adds Iso Depth Milling + Radius Milling
      </div>
    </div>

    <div id="ordOpsWrap" style="margin-top:6px">
      <div style="color:var(--muted);font-size:12px;padding:4px 0">Select a routing to edit operation times</div>
    </div>

    <div class="form-row cols-1" style="margin-top:10px">
      <label class="checkbox-row"><input type="checkbox" id="ord_urgent"> 🚨 Mark all pieces Priority</label>
    </div>
    <div class="form-row cols-1">
      <div class="form-group"><div class="fld-label">Notes</div>
        <textarea id="ord_notes" placeholder="Special instructions…" rows="2"></textarea>
      </div>
    </div>
    </div><!-- end LEFT -->

    <div><!-- RIGHT COLUMN: Estimate Panel -->
      <div id="estimatePanel" style="position:sticky;top:0;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:10px">📊 Delivery Estimate</div>
        <div id="estimateContent" style="color:var(--muted);font-size:12px">Select routing and quantity to see estimate</div>
        <button class="btn btn-secondary" style="width:100%;margin-top:12px;font-size:12px" onclick="triggerEstimate()">↻ Recalculate</button>
      </div>
    </div><!-- end RIGHT -->

    </div><!-- end grid -->
      </div>
      <div class="editor-footer">
        <button class="btn btn-ghost" onclick="navigate('/orders')">Cancel</button>
        <button class="btn btn-primary" id="saveOrderBtn" onclick="saveOrder()">Create Order</button>
      </div>
    </div>`;

  // Wire size custom input
  setTimeout(()=>{
    document.getElementById('ord_size')?.addEventListener('change', function(){
      document.getElementById('ord_size_custom_wrap').style.display = this.value==='custom'?'':'none';
    });
  }, 50);
}

async function filterOrderRouting(){
  const ptype = document.getElementById('ord_ptype')?.value||'';
  const sel   = document.getElementById('ord_routing');
  if(!sel) return;
  const opts = allRoutings.filter(r=>!ptype || r.product_type===ptype);
  sel.innerHTML = `<option value="">— Select routing —</option>`+opts.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
  orderFormOps = [];
  document.getElementById('ordOpsWrap').innerHTML=`<div style="color:var(--muted);font-size:12px;padding:4px 0">Select a routing to edit operation times</div>`;
  document.getElementById('estimateContent').innerHTML=`<div style="color:var(--muted);font-size:12px">Select routing and quantity to see estimate</div>`;
  // Show punch calc panel for punch types
  const punchCalcPanel = document.getElementById('punchCalcPanel');
  if(punchCalcPanel) punchCalcPanel.style.display = ptype.toLowerCase().includes('punch') ? '' : 'none';
}

async function loadOrderOps(){
  const rid = parseInt(document.getElementById('ord_routing')?.value);
  if(!rid){ orderFormOps=[]; return; }
  const rt = await api('GET',`/api/routings/${rid}`);
  orderFormOps = rt.operations.map(op=>{
    const subs = (op.sub_operations||[]).map(s=>({
      id:            s.id,
      name:          s.name,
      formula_type:  s.formula_type || null,
      mrr:           s.mrr          ?? null,
      depth_mm:      s.depth_mm     ?? null,
      feed_rate:     s.feed_rate    ?? null,
      dim_x_source:  s.dim_x_source || null,
      dim_y_source:  s.dim_y_source || null,
      work_time_mins: s.work_time_mins || 0,
      is_optional:   s.is_optional,
      included:      !s.is_optional, // optional sub-ops excluded by default
    }));
    // If sub-ops exist, work_time_mins = sum of included (non-optional) sub-ops
    const hasSubs = subs.length > 0;
    const subTotal = hasSubs ? subs.filter(s=>s.included).reduce((a,s)=>a+(s.work_time_mins||0),0) : null;
    return {
      operation_id:    op.id,
      name:            op.name,
      wc_name:         op.work_center_name,
      work_center_id:  op.work_center_id,
      machine_type:    op.machine_type||'',
      setup_time_mins: op.setup_time_mins,
      work_time_mins:  hasSubs ? subTotal : (op.work_time_mins!=null ? op.work_time_mins : (op.work_time_hrs||0)*60),
      work_time_hrs:   hasSubs ? subTotal/60 : (op.work_time_hrs||0),
      is_optional:     op.is_optional,
      included:        true,
      formula_type:    op.formula_type  || null,
      mrr:             op.mrr           ?? null,
      depth_mm:        op.depth_mm      ?? null,
      feed_rate:       op.feed_rate     ?? null,
      dim_x_source:    op.dim_x_source  || null,
      dim_y_source:    op.dim_y_source  || null,
      sub_operations:  subs,
    };
  });

  // Show punch calc panel whenever product type is a punch type
  const ptype = document.getElementById('ord_ptype')?.value||'';
  const punchCalcPanel = document.getElementById('punchCalcPanel');
  if(punchCalcPanel) punchCalcPanel.style.display = ptype.toLowerCase().includes('punch') ? '' : 'none';

  renderOrderOpsTable();
  triggerEstimate();
}

// ── Punch dimension calculator ──
async function calcPunchTimes(){
  const L = parseFloat(document.getElementById('ord_length')?.value)||0;
  const W = parseFloat(document.getElementById('ord_width')?.value)||0;
  const T = parseFloat(document.getElementById('ord_thickness')?.value)||35;

  if(!L||!W){toast('Enter length and width first','error');return;}
  if(!orderFormOps.length){toast('Select a routing template first','error');return;}

  // Send the CURRENT routing ops to the API — it calculates times using each op's
  // own formula_type, mrr, and depth_mm. Does NOT replace ops with a hardcoded list.
  const payload = {
    length: L, width: W, thickness: T,
    routing_ops: orderFormOps.map(op=>({
      operation_id:    op.operation_id||null,
      name:            op.name,
      formula_type:    op.formula_type||'fixed',
      mrr:             op.mrr||null,
      depth_mm:        op.depth_mm||null,
      feed_rate:       op.feed_rate||null,
      dim_x_source:    op.dim_x_source||null,
      dim_y_source:    op.dim_y_source||null,
      setup_time_mins: op.setup_time_mins||0,
      machining_mins:  op.work_time_mins||0,
      work_center_id:  op.work_center_id||null,
      included:        op.included!==false,
      sub_operations:  (op.sub_operations||[]).map(s=>({
        id:            s.id||null,
        name:          s.name,
        formula_type:  s.formula_type||'fixed',
        mrr:           s.mrr||null,
        depth_mm:      s.depth_mm||null,
        feed_rate:     s.feed_rate||null,
        dim_x_source:  s.dim_x_source||null,
        dim_y_source:  s.dim_y_source||null,
        work_time_mins:s.work_time_mins||0,
        is_optional:   s.is_optional||false,
        included:      s.included!==false,
      })),
    }))
  };

  try{
    const r = await api('POST','/api/punch-calc', payload);

    // Update times IN PLACE — match by operation_id to avoid index mismatch
    // r.ops mirrors the routing_ops we sent, so same length and order
    if(r.ops.length !== orderFormOps.length){
      toast('Formula result mismatch — please re-select routing template','error');
      return;
    }
    orderFormOps = orderFormOps.map((existing, i)=>{
      const calcOp = r.ops[i];
      // Also update sub-op times if returned
      let updatedSubs = existing.sub_operations || [];
      if(calcOp.sub_operations && calcOp.sub_operations.length === updatedSubs.length){
        updatedSubs = updatedSubs.map((s, si)=>({
          ...s,
          work_time_mins: calcOp.sub_operations[si].work_time_mins,
          work_time_hrs:  calcOp.sub_operations[si].work_time_mins / 60,
        }));
      }
      return {
        ...existing,
        work_time_mins:  calcOp.work_time_mins,
        work_time_hrs:   calcOp.work_time_mins / 60,
        _formula_desc:   calcOp.formula_desc,
        sub_operations:  updatedSubs,
      };
    });

    renderOrderOpsTable();
    triggerEstimate();
    toast(`Calculated ${r.ops.length} ops · total ${Math.round(r.total_mins)} min (${r.total_hrs.toFixed(1)} h)`);
  }catch(e){toast(e.message,'error');}
}

function renderOrderOpsTable(){
  if(!orderFormOps.length){ document.getElementById('ordOpsWrap').innerHTML='<div style="color:var(--muted);font-size:12px">No operations</div>'; return; }
  const rows = orderFormOps.map((op,i)=>{
    const hasSubs = (op.sub_operations||[]).length > 0;
    const wMins = hasSubs
      ? (op.sub_operations||[]).filter(s=>s.included!==false).reduce((a,s)=>a+(s.work_time_mins||0),0)
      : (op.work_time_mins!=null ? op.work_time_mins : (op.work_time_hrs||0)*60);
    const sMins = op.setup_time_mins||0;
    const hasFormula = !hasSubs && op.formula_type && op.formula_type!=='none';
    const formulaBadge = hasFormula
      ? `<span style="font-size:10px;background:var(--accent-soft);color:var(--accent);border:1px solid var(--accent);border-radius:3px;padding:1px 5px;margin-left:4px" title="${op._formula_desc||op.formula_type}">⚡ formula</span>`
      : hasSubs ? `<span style="font-size:10px;background:var(--surface2);color:var(--muted);border:1px solid var(--border);border-radius:3px;padding:1px 5px;margin-left:4px">${(op.sub_operations||[]).length} sub-ops</span>` : '';
    const wcOpts = allMachines.map(m=>`<option value="${m.id}" ${op.work_center_id==m.id?'selected':''}>${m.name}</option>`).join('');

    // Sub-op rows (indented) — shown if any sub-ops defined
    const subRows = hasSubs ? (op.sub_operations||[]).map((s,si)=>{
      const sInc = s.included!==false;
      const sOpt = s.is_optional;
      const sFmBadge = s.formula_type
        ? `<span style="font-size:9px;background:var(--accent-soft);color:var(--accent);border-radius:3px;padding:1px 4px;margin-left:3px">⚡</span>` : '';
      return `<tr style="background:var(--surface2);${sInc?'':'opacity:.45'}">
        <td style="padding-left:24px">
          ${sOpt?`<input type="checkbox" ${sInc?'checked':''} onchange="toggleSubOrderOp(${i},${si},this.checked)" style="width:12px;height:12px;accent-color:var(--amber)" title="Optional — toggle to include/exclude">`:'<span style="display:inline-block;width:12px">·</span>'}
        </td>
        <td class="mono" style="color:var(--muted);font-size:10px;text-align:center">${i+1}.${si+1}</td>
        <td colspan="3" style="font-size:11px;color:var(--fg);padding-left:8px">
          ${sOpt?'<span style="color:var(--amber);font-size:9px;margin-right:4px">opt</span>':''}${s.name}${sFmBadge}
        </td>
        <td style="font-size:11px;color:var(--muted);text-align:center">${Math.round(s.work_time_mins||0)}</td>
        <td style="font-size:11px;color:var(--muted);text-align:right">${fmtTotal(s.work_time_mins||0)}</td>
      </tr>`;
    }).join('') : '';

    return `<tr id="ooprow_${i}" class="${op.included?'':'excluded'}">
      <td><input type="checkbox" id="oopchk_${i}" ${op.included?'checked':''} onchange="toggleOrderOp(${i},this.checked)" style="width:14px;height:14px;accent-color:var(--accent)"></td>
      <td class="mono" style="color:var(--muted);text-align:center;font-size:11px">${i+1}</td>
      <td style="font-size:12px;font-weight:500">${op.name}${formulaBadge}</td>
      <td><select id="oopwc_${i}" onchange="updateOrderOpWC(${i},this.value)" style="font-size:11px;min-width:120px">${wcOpts}</select></td>
      <td><input type="number" id="oopsetup_${i}" value="${Math.round(sMins)}" min="0" step="5" onchange="recalcOrderOp(${i})" ${op.included?'':'disabled'} style="width:60px"></td>
      <td><input type="number" id="oopwork_${i}"  value="${Math.round(wMins)}" min="0" step="10" onchange="recalcOrderOp(${i})" ${op.included&&!hasSubs?'':'disabled'} style="width:70px" ${hasSubs?'title="Auto-sum of sub-operations"':hasFormula?'title="Auto-calculated — edit to override"':''}></td>
      <td style="font-size:11px;color:var(--muted);text-align:right" id="ooptot_${i}">${fmtTotal(sMins+wMins)}</td>
    </tr>${subRows}`;
  }).join('');
  document.getElementById('ordOpsWrap').innerHTML=`
    <table class="op-ov-table">
      <thead><tr><th>✓</th><th>#</th><th>Operation</th><th>Machine</th><th>Setup(min)</th><th>Work(min)</th><th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function toggleSubOrderOp(oi, si, checked){
  if(!orderFormOps[oi].sub_operations) return;
  orderFormOps[oi].sub_operations[si].included = checked;
  // Recalc parent work time
  const newTotal = orderFormOps[oi].sub_operations.filter(s=>s.included!==false).reduce((a,s)=>a+(s.work_time_mins||0),0);
  orderFormOps[oi].work_time_mins = newTotal;
  orderFormOps[oi].work_time_hrs = newTotal/60;
  renderOrderOpsTable();
  debounceEstimate();
}

function updateOrderOpWC(i, wcId){
  orderFormOps[i].work_center_id = parseInt(wcId);
  const m = allMachines.find(x=>x.id==wcId);
  if(m) orderFormOps[i].wc_name = m.name;
}

function toggleOrderOp(i,checked){
  orderFormOps[i].included=checked;
  document.getElementById(`ooprow_${i}`).className=checked?'':'excluded';
  [`oopsetup_${i}`,`oopwork_${i}`].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=!checked;});
  debounceEstimate();
}
function recalcOrderOp(i){
  const s=parseFloat(document.getElementById(`oopsetup_${i}`)?.value)||0;
  const w=parseFloat(document.getElementById(`oopwork_${i}`)?.value)||0;
  orderFormOps[i].setup_time_mins=s; orderFormOps[i].work_time_mins=w; orderFormOps[i].work_time_hrs=w/60;
  const el=document.getElementById(`ooptot_${i}`); if(el) el.textContent=fmtTotal(s+w);
  debounceEstimate();
}

let _estTimer=null;
function debounceEstimate(){ clearTimeout(_estTimer); _estTimer=setTimeout(triggerEstimate,600); }
function triggerEstimate(){
  clearTimeout(_estTimer);
  const rid=parseInt(document.getElementById('ord_routing')?.value);
  const qty=parseInt(document.getElementById('ord_qty')?.value)||1;
  if(!rid||!orderFormOps.length){ return; }
  runEstimate(rid, qty);
}

async function runEstimate(routingId, qty){
  const el=document.getElementById('estimateContent');
  if(!el) return;
  el.innerHTML=`<div style="color:var(--muted);font-size:12px">Calculating…</div>`;
  try{
    const ovs = orderFormOps.map((op,i)=>({
      operation_id: op.operation_id,
      setup_time_mins: parseFloat(document.getElementById(`oopsetup_${i}`)?.value)||op.setup_time_mins||0,
      work_time_mins:  parseFloat(document.getElementById(`oopwork_${i}`)?.value)||(op.work_time_mins||(op.work_time_hrs||0)*60),
      included: document.getElementById(`oopchk_${i}`)?.checked??op.included,
    }));
    const r = await api('POST','/api/estimate',{routing_id:routingId, quantity:Math.min(qty,20), op_overrides:ovs});
    const due = document.getElementById('ord_due')?.value;
    const dueDate = due ? new Date(due) : null;
    const finishDate = r.est_last_finish ? new Date(r.est_last_finish) : null;
    const isLate = dueDate && finishDate && finishDate > dueDate;
    const diffDays = dueDate && finishDate ? Math.round((finishDate-dueDate)/86400000) : null;

    el.innerHTML=`
      <div style="padding:10px;background:${isLate?'var(--red-soft)':'var(--accent-soft)'};border:1px solid ${isLate?'var(--red)':'var(--accent)'};border-radius:8px;margin-bottom:12px;text-align:center">
        <div style="font-size:11px;color:var(--muted);margin-bottom:2px">Est. completion (last piece)</div>
        <div style="font-size:18px;font-weight:700;color:${isLate?'var(--red)':'var(--accent)'}">${finishDate?finishDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'—'}</div>
        ${diffDays!==null?`<div style="font-size:11px;margin-top:3px;color:${isLate?'var(--red)':'var(--green)'}">${isLate?'⚠ '+diffDays+' days LATE':'✓ '+Math.abs(diffDays)+' days buffer'}</div>`:''}
      </div>
      ${r.est_first_finish&&qty>1?`<div style="font-size:11px;color:var(--muted);margin-bottom:8px">First piece ready: <strong>${new Date(r.est_first_finish).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</strong></div>`:''}
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px;font-weight:600">Total work: ${fmtTotal(r.total_work_mins)} per piece</div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:4px">Bottlenecks</div>
      ${r.bottlenecks.slice(0,4).map(b=>`
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
          <span>${b.wc_name}</span><span class="mono">${fmtTotal(b.total_mins)}</span>
        </div>`).join('')}
      <div style="font-size:10px;color:var(--muted);margin-top:8px">Based on current machine load · ${qty>20?'Capped at 20 pieces for speed':qty+' piece'+(qty>1?'s':'')}</div>
    `;
  }catch(e){
    el.innerHTML=`<div style="color:var(--red);font-size:12px">Estimate failed: ${e.message}</div>`;
  }
}

async function saveOrder(){
  const custId   = document.getElementById('ord_cust').value;
  const ptype    = document.getElementById('ord_ptype').value;
  const sizeSel  = document.getElementById('ord_size').value;
  const size     = sizeSel==='custom'
    ? (document.getElementById('ord_size_custom')?.value||'').trim()
    : sizeSel;
  const qty      = parseInt(document.getElementById('ord_qty').value) || 1;
  const due      = document.getElementById('ord_due').value;
  const routingId= document.getElementById('ord_routing').value;

  if(!custId)    { toast('Select a customer','error');   return; }
  if(!size)      { toast('Enter product size','error');   return; }
  if(!due)       { toast('Select a due date','error');    return; }
  if(!routingId) { toast('Select a routing','error');     return; }
  if(qty < 1)    { toast('Quantity must be at least 1','error'); return; }

  const ovs = orderFormOps.map((op,i)=>({
    operation_id: op.operation_id,
    setup_time_mins: parseFloat(document.getElementById(`oopsetup_${i}`)?.value)||op.setup_time_mins||0,
    work_time_mins:  parseFloat(document.getElementById(`oopwork_${i}`)?.value)||(op.work_time_mins||(op.work_time_hrs||0)*60),
    work_time_hrs:   (parseFloat(document.getElementById(`oopwork_${i}`)?.value)||(op.work_time_mins||(op.work_time_hrs||0)*60))/60,
    included: document.getElementById(`oopchk_${i}`)?.checked??true,
  }));

  const c = allCustomers.find(x=>x.id==custId);
  const data = {
    customer_id:    parseInt(custId),
    customer_name:  c?.name || '',
    po_number:      document.getElementById('ord_po').value.trim(),
    product_type:   ptype,
    product_size:   size,
    product_variant:document.getElementById('ord_variant').value.trim(),
    quantity:       qty,
    due_date:       due + 'T08:00:00',
    routing_id:     parseInt(routingId),
    op_overrides:   ovs.length ? ovs : undefined,
    total_price:    document.getElementById('ord_price').value || null,
    priority_flag:  document.getElementById('ord_urgent').checked,
    notes:          document.getElementById('ord_notes').value,
  };

  setLoading('saveOrderBtn', true);
  try{
    const r = await api('POST', '/api/orders', data);
    toast(`Order ${r.order_number} created — ${qty} piece jobs generated`);
    await loadAll(); navigate('/orders');
  }catch(e){ toast(e.message, 'error'); }
  finally{ setLoading('saveOrderBtn', false); }
}

async function init(){
  let connected = false;
  for(let attempt=0; attempt<3; attempt++){
    try{
      await api('GET','/api/health');
      document.getElementById('serverStatus').textContent='Connected';
      document.getElementById('statusDot').style.background='var(--green)';
      connected=true; break;
    }catch{
      document.getElementById('serverStatus').textContent=
        attempt<2?`Connecting... (${attempt+1}/3)`:'Offline';
      if(attempt<2) await new Promise(r=>setTimeout(r,1500));
    }
  }
  if(!connected){
    document.getElementById('serverStatus').textContent='Offline';
    document.getElementById('statusDot').style.background='var(--red)';
  }
  // Always try to load and show dashboard regardless of connection state
  try{ await loadAll(); }catch(e){ console.error('loadAll:', e); }
  // Backfill codes for existing machines/workers that don't have one
  try{ await api('POST','/api/backfill-codes'); }catch{}
  navigate('/dashboard');
  // Auto-refresh dashboard every 5 minutes when idle
  setInterval(async()=>{
    if(window.location.hash.includes('dashboard')){ try{await loadAll();navigate('/dashboard');}catch{} }
  }, 300000);
}
document.getElementById('modalOverlay').addEventListener('click',function(e){if(e.target===this)closeModal();});
