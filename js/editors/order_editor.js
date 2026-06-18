/**
 * Dolphin ERP — Order Editor
 * Full-page editor — routes: #/orders/new, #/orders/:id
 */

async function renderOrderEditor(editId){
  await loadAll();

  // Pull from schema if available; fall back to legacy hardcoded lists so
  // the form keeps working on databases that pre-date migration 029.
  let _orderSchema = { product_types: [] };
  try { _orderSchema = await api('GET', '/api/product-schema'); } catch(e) { /* fallback */ }

  const schemaTypes = _orderSchema.product_types || [];
  const PTYPES = schemaTypes.length
    ? schemaTypes.map(p => p.name)
    : ['Punch','Die Frame','Liner Set','Complete Mould','Custom Plate',
       'Base Plate','Ejector Plate','Addon Plate','SFS Lower','SFS Upper'];

  // Build the global "all sizes" list — union of every "Size" attribute's
  // values across product types. Same for variant-ish attributes.
  const _collectValues = (attrName) => {
    const seen = new Set();
    schemaTypes.forEach(pt => {
      pt.attributes?.forEach(a => {
        if ((a.name || '').toLowerCase() === attrName.toLowerCase()) {
          a.values.forEach(v => seen.add(v.value));
        }
      });
    });
    return [...seen];
  };
  const allSizes = _collectValues('Size');
  const SIZES = allSizes.length
    ? allSizes
    : ['600x600','600x900','600x1200','900x900','900x1200','1200x1200'];

  // Variant suggestions = union of Type / Mounting / Liner Type / Cavities
  // values across all product types, joined into freeform suggestions for
  // the variant text field. Best-effort: gives the user useful auto-complete.
  const _variantSuggestions = [
    ..._collectValues('Type'),
    ..._collectValues('Mounting'),
    ..._collectValues('Liner Type'),
    ..._collectValues('Cavities').map(c => `${c}-cav`),
  ];

  // Fetch existing order if editing
  let editOrder = null;
  if(editId){ try{ editOrder = await api('GET',`/api/orders/${editId}`); }catch(e){ toast('Order not found','error'); navigate('/orders'); return; } }

  const isEdit = !!editOrder;
  const defDue = new Date(Date.now()+30*86400000).toISOString().slice(0,10);

  // Pre-select values for edit mode
  const selCust    = editOrder?.customer_id || '';
  const selPtype   = editOrder?.product_type || PTYPES[0];
  const selSize    = editOrder?.product_size || SIZES[0];
  const selDue     = editOrder?.due_date ? editOrder.due_date.slice(0,10) : defDue;
  const selQty     = editOrder?.quantity || 1;
  const selPrice   = editOrder?.total_price || '';
  const selVariant = editOrder?.product_variant || '';
  const selPo      = editOrder?.po_number || '';
  const selNotes   = editOrder?.notes || '';
  const selMatD    = editOrder?.material_ready_date ? editOrder.material_ready_date.slice(0,10) : '';
  const selRouting  = editOrder?.routing_id || '';
  const selOrderType = editOrder?.order_type || 'simple';
  const isCustomSize = selSize && !SIZES.includes(selSize);

  const custOpts = allCustomers.map(c=>`<option value="${c.id}" ${c.id==selCust?'selected':''}>${escHtml(c.name)}</option>`).join('');
  const routingOpts = allRoutings.map(r=>`<option value="${r.id}" ${r.id==selRouting?'selected':''}>${escHtml(r.name)} (${escHtml(r.product_type)})</option>`).join('');
  const ptypeOpts = PTYPES.map(p=>`<option ${p===selPtype?'selected':''}>${p}</option>`).join('');
  const sizeOpts  = SIZES.map(s=>`<option ${s===selSize&&!isCustomSize?'selected':''}>${s}</option>`).join('')
    + `<option value="custom" ${isCustomSize?'selected':''}>Custom…</option>`;

  orderFormOps = [];

  document.getElementById('content').innerHTML = `
    <div class="editor-page">
      <div class="editor-header">
        <h2 class="editor-title">${isEdit ? `Edit Order — ${editOrder.order_number}` : 'New Order'}</h2>
        <div class="editor-subtitle">${isEdit ? `${editOrder.customer_name} · ${editOrder.product_type} · ${editOrder.quantity} pcs` : 'Create a new customer manufacturing order'}</div>
      </div>
      <div class="editor-body" style="max-width:100%;padding:20px 28px">
        <div style="display:grid;grid-template-columns:1fr 320px;gap:18px;align-items:start">

    <div><!-- LEFT COLUMN -->
    <!-- ORDER TYPE TOGGLE -->
    <div style="display:flex;gap:10px;margin-bottom:18px;padding:12px 14px;background:var(--surface);border-radius:8px;border:1px solid var(--border);align-items:center">
      <span style="font-size:12px;font-weight:600;color:var(--muted);flex-shrink:0">Order Type:</span>
      <label style="display:flex;align-items:center;gap:7px;cursor:pointer;padding:6px 14px;border-radius:6px;border:2px solid ${selOrderType==='simple'?'var(--accent)':'var(--border)'};background:${selOrderType==='simple'?'var(--accent-soft)':'transparent'};font-size:13px;font-weight:600;transition:all .15s" id="ord_type_simple_lbl">
        <input type="radio" name="ord_type" id="ord_type_simple" value="simple" ${selOrderType==='simple'?'checked':''} onchange="orderTypeChanged('simple')" style="accent-color:var(--accent)">
        📦 Simple Order
      </label>
      <label style="display:flex;align-items:center;gap:7px;cursor:pointer;padding:6px 14px;border-radius:6px;border:2px solid ${selOrderType==='assembly'?'var(--accent)':'var(--border)'};background:${selOrderType==='assembly'?'var(--accent-soft)':'transparent'};font-size:13px;font-weight:600;transition:all .15s" id="ord_type_asm_lbl">
        <input type="radio" name="ord_type" id="ord_type_assembly" value="assembly" ${selOrderType==='assembly'?'checked':''} onchange="orderTypeChanged('assembly')" style="accent-color:var(--accent)">
        🔧 Assembly Order
      </label>
      <span id="ord_type_hint" style="font-size:11px;color:var(--muted);margin-left:8px">${selOrderType==='assembly'?'Multiple parts, assembly steps, outside work':'Single product type, quantity of identical pieces'}</span>
    </div>

    <!-- ASSEMBLY NOTICE — shown only for assembly orders -->
    <div id="ord_asm_notice" style="display:${selOrderType==='assembly'?'flex':'none'};background:var(--accent-soft);border:1px solid var(--accent);border-radius:8px;padding:10px 14px;margin-bottom:14px;gap:10px;align-items:flex-start">
      <span style="font-size:18px;flex-shrink:0">🔧</span>
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--accent)">Assembly Order</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">
          After creating this order you will be taken to the Assembly planner where you can add components (parts to make, send outside, or purchase) and define the assembly sequence.
          The Routing field below is optional — use it only if the overall order has a single base routing.
        </div>
      </div>
    </div>

    <div class="form-section">Customer</div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Customer <span style="color:var(--red)">*</span></div>
        <select id="ord_cust"><option value="">— Select —</option>${custOpts}</select>
      </div>
      <div class="form-group">
        <div class="fld-label">PO Number</div>
        <input id="ord_po" value="${escHtml(selPo)}" placeholder="Customer PO reference">
      </div>
    </div>

    <div class="form-section">Product</div>
    <div class="form-row cols-3">
      <div class="form-group">
        <div class="fld-label">Product Type <span style="color:var(--red)">*</span></div>
        <select id="ord_ptype" onchange="filterOrderRouting()">${ptypeOpts}</select>
      </div>
      <div class="form-group">
        <div class="fld-label">Size <span style="color:var(--red)">*</span></div>
        <select id="ord_size">${sizeOpts}</select>
      </div>
      <div class="form-group">
        <div class="fld-label">Variant / Type</div>
        <input id="ord_variant" list="ord_variant_dl" value="${escHtml(selVariant)}" placeholder="Plain, Carbide, Rustic…" autocomplete="off">
        <datalist id="ord_variant_dl">
          ${[...new Set(_variantSuggestions)].map(v => `<option value="${escAttr(v)}">`).join('')}
        </datalist>
      </div>
    </div>
    <div id="ord_size_custom_wrap" style="display:${isCustomSize?'':'none'}" class="form-row cols-1">
      <div class="form-group">
        <div class="fld-label">Custom Size</div>
        <input id="ord_size_custom" value="${isCustomSize?escHtml(selSize):''}" placeholder="e.g. 750x1000">
      </div>
    </div>

    <div class="form-section">Quantity & Schedule</div>
    <div class="form-row cols-3">
      <div class="form-group">
        <div class="fld-label">Quantity <span style="color:var(--red)">*</span>${isEdit?'<span style="font-size:10px;color:var(--muted);font-weight:400;margin-left:6px">(changing quantity doesn\'t add/remove pieces)</span>':''}</div>
        <input id="ord_qty" type="number" min="1" max="200" value="${selQty}" oninput="triggerEstimate()">
      </div>
      <div class="form-group">
        <div class="fld-label">Due Date <span style="color:var(--red)">*</span></div>
        <input id="ord_due" type="date" value="${selDue}">
      </div>
      <div class="form-group">
        <div class="fld-label">Total Price (₹)</div>
        <input id="ord_price" type="number" min="0" step="100" value="${selPrice}" placeholder="All pieces">
      </div>
    </div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Material Ready Date <span style="font-size:10px;color:var(--muted);font-weight:400">(leave blank if in stock)</span></div>
        <input id="ord_mat_d" type="date" value="${selMatD}" onchange="triggerEstimate()" title="Pieces won't be scheduled before this date">
      </div>
      <div class="form-group">
        <div class="fld-label">Not Before Date</div>
        <input id="ord_nb_d" type="date" title="Earliest any operation can start">
      </div>
    </div>

    <div class="form-section">Routing & Operations</div>
    <div class="form-row cols-1">
      <div class="form-group">
        <div class="fld-label">Routing Template <span id="ord_routing_req" style="color:var(--red)">${selOrderType==='simple'?'*':''}</span> <span id="ord_routing_opt" style="font-size:10px;color:var(--muted);font-weight:400">${selOrderType==='assembly'?'(optional for assembly orders)':''}</span></div>
        <select id="ord_routing" onchange="loadOrderOps()"><option value="">— Select —</option>${routingOpts}</select>
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
        <textarea id="ord_notes" placeholder="Special instructions…" rows="2">${escHtml(selNotes)}</textarea>
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
        <button class="btn btn-primary" id="saveOrderBtn" onclick="saveOrder(${editId||'null'})">${isEdit?'Save Changes':(selOrderType==='assembly'?'Create & Set Up Assembly':'Create Order')}</button>
      </div>
    </div>`;

  // Wire size custom input
  setTimeout(async ()=>{
    document.getElementById('ord_size')?.addEventListener('change', function(){
      document.getElementById('ord_size_custom_wrap').style.display = this.value==='custom'?'':'none';
    });

    // EDIT MODE: load routing ops for existing order
    if(isEdit && selRouting){
      const sel = document.getElementById('ord_routing');
      if(sel) sel.value = selRouting;
      await loadOrderOps();

      // Apply saved op_overrides from the first piece job
      // op_overrides hold the calculated/custom times that were saved when the order was created
      try {
        const firstPiece = editOrder.pieces?.[0];
        let savedOvs = null;
        if(firstPiece){
          // Fetch the actual job to get op_overrides
          const jobDetail = await api('GET', `/api/jobs/${firstPiece.id}`);
          if(jobDetail.op_overrides){
            savedOvs = typeof jobDetail.op_overrides === 'string'
              ? JSON.parse(jobDetail.op_overrides) : jobDetail.op_overrides;
          }
        }
        if(savedOvs && savedOvs.length > 0){
          // Build a map by operation_id for fast lookup
          const ovMap = {};
          savedOvs.forEach(ov => { if(ov.operation_id) ovMap[ov.operation_id] = ov; });

          // Apply overrides to orderFormOps
          orderFormOps = orderFormOps.map(op => {
            const ov = ovMap[op.operation_id];
            if(!ov) return op;
            const workMins = ov.work_time_mins != null ? parseFloat(ov.work_time_mins)
                           : ov.work_time_hrs  != null ? parseFloat(ov.work_time_hrs) * 60
                           : op.work_time_mins;
            const setupMins = ov.setup_time_mins != null ? parseFloat(ov.setup_time_mins) : op.setup_time_mins;
            const included  = ov.included !== false;
            return { ...op, work_time_mins: workMins, setup_time_mins: setupMins, included };
          });
          renderOrderOpsTable();
        }
      } catch(e) { console.warn('Could not load op_overrides for edit:', e); }

      // Punch calc panel visibility
      const punchCalcPanel = document.getElementById('punchCalcPanel');
      if(punchCalcPanel) punchCalcPanel.style.display = selPtype.toLowerCase().includes('punch') ? '' : 'none';
      triggerEstimate();
      return; // skip prefill logic when editing
    }

    // Apply quote prefill if coming from Quote page (new order only)
    const prefillRaw = sessionStorage.getItem('dolphin_quote_prefill');
    if (prefillRaw && !editId) {
      try {
        const pf = JSON.parse(prefillRaw);
        sessionStorage.removeItem('dolphin_quote_prefill');
        if (pf.customer_name) {
          const sel = document.getElementById('ord_cust');
          const opt = sel && [...sel.options].find(o => o.text === pf.customer_name);
          if (opt) sel.value = opt.value;
        }
        if (pf.product_type) {
          const el = document.getElementById('ord_ptype');
          if (el) { el.value = pf.product_type; filterOrderRouting(); }
        }
        if (pf.product_size) {
          const sel = document.getElementById('ord_size');
          if (sel) {
            const opt = [...sel.options].find(o => o.value === pf.product_size);
            sel.value = opt ? pf.product_size : 'custom';
            if (!opt) {
              document.getElementById('ord_size_custom_wrap').style.display = '';
              const ci = document.getElementById('ord_size_custom');
              if (ci) ci.value = pf.product_size;
            }
          }
        }
        if (pf.product_variant) {
          const el = document.getElementById('ord_variant');
          if (el) el.value = pf.product_variant;
        }
        if (pf.quantity)  { const el = document.getElementById('ord_qty');  if(el) el.value = pf.quantity; }
        if (pf.due_date)  { const el = document.getElementById('ord_due');  if(el) el.value = pf.due_date; }
        if (pf.material_ready_date) {
          const el = document.getElementById('ord_mat_d');
          if (el) el.value = pf.material_ready_date.slice(0,10);
        }
        if (pf.routing_id) {
          setTimeout(async () => {
            const sel = document.getElementById('ord_routing');
            if (sel) { sel.value = pf.routing_id; await loadOrderOps(); }
          }, 200);
        }
        toast('Pre-filled from Quote simulation');
      } catch(e) { /* ignore */ }
    }
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
    // Get material ready date if set
    const matD = document.getElementById('ord_mat_d')?.value;
    const matPayload = matD ? `${matD}T00:00:00` : null;
    const r = await api('POST','/api/estimate',{
      routing_id: routingId,
      quantity: Math.min(qty,20),
      op_overrides: ovs,
      material_ready_date: matPayload,
    });
    const due = document.getElementById('ord_due')?.value;
    const dueDate = due ? new Date(due) : null;
    const finishDate = r.est_last_finish ? new Date(r.est_last_finish) : null;
    const isLate = dueDate && finishDate && finishDate > dueDate;
    const diffDays = dueDate && finishDate ? Math.round((finishDate-dueDate)/86400000) : null;
    const matWarn = r.material_blocked
      ? `<div style="background:var(--amber-soft);border:1px solid var(--amber);border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:11px">
           <strong style="color:var(--amber)">⚠ Material delay</strong> — start pushed to
           <strong>${new Date(r.start_date).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</strong>
         </div>`
      : '';

    el.innerHTML=`
      ${matWarn}
      <div style="padding:10px;background:${isLate?'var(--red-soft)':'var(--accent-soft)'};border:1px solid ${isLate?'var(--red)':'var(--accent)'};border-radius:8px;margin-bottom:12px;text-align:center">
        <div style="font-size:11px;color:var(--muted);margin-bottom:2px">Est. completion (last piece)</div>
        <div style="font-size:18px;font-weight:700;color:${isLate?'var(--red)':'var(--accent)'}">${finishDate?finishDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'—'}</div>
        ${diffDays!==null?`<div style="font-size:11px;margin-top:3px;color:${isLate?'var(--red)':'var(--green)'}">${isLate?'⚠ '+Math.abs(diffDays)+' days LATE':'✓ '+Math.abs(diffDays)+' days buffer'}</div>`:''}
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

function orderTypeChanged(type) {
  const isAsm = type === 'assembly';
  // Update label styles
  const sl = document.getElementById('ord_type_simple_lbl');
  const al = document.getElementById('ord_type_asm_lbl');
  if (sl) { sl.style.borderColor = !isAsm ? 'var(--accent)' : 'var(--border)'; sl.style.background = !isAsm ? 'var(--accent-soft)' : 'transparent'; }
  if (al) { al.style.borderColor =  isAsm ? 'var(--accent)' : 'var(--border)'; al.style.background =  isAsm ? 'var(--accent-soft)' : 'transparent'; }
  // Show/hide notice
  const notice = document.getElementById('ord_asm_notice');
  if (notice) notice.style.display = isAsm ? 'flex' : 'none';
  // Hint text
  const hint = document.getElementById('ord_type_hint');
  if (hint) hint.textContent = isAsm ? 'Multiple parts, assembly steps, outside work' : 'Single product type, quantity of identical pieces';
  // Routing req/opt labels
  const req = document.getElementById('ord_routing_req');
  const opt = document.getElementById('ord_routing_opt');
  if (req) req.textContent = isAsm ? '' : '*';
  if (opt) opt.textContent = isAsm ? '(optional for assembly orders)' : '';
  // Button label
  const btn = document.getElementById('saveOrderBtn');
  if (btn) btn.textContent = isAsm ? 'Create & Set Up Assembly' : 'Create Order';
}

async function saveOrder(editId){
  const custId   = document.getElementById('ord_cust').value;
  const ptype    = document.getElementById('ord_ptype').value;
  const sizeSel  = document.getElementById('ord_size').value;
  const size     = sizeSel==='custom'
    ? (document.getElementById('ord_size_custom')?.value||'').trim()
    : sizeSel;
  const qty      = parseInt(document.getElementById('ord_qty').value) || 1;
  const due      = document.getElementById('ord_due').value;
  const routingId= document.getElementById('ord_routing').value;
  const isEdit   = editId && editId !== 'null';

  const orderType = document.querySelector('input[name="ord_type"]:checked')?.value || 'simple';
  if(!custId)    { toast('Select a customer','error');   return; }
  if(!size)      { toast('Enter product size','error');   return; }
  if(!due)       { toast('Select a due date','error');    return; }
  if(!routingId && orderType === 'simple') { toast('Select a routing','error'); return; }
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
    material_ready_date: document.getElementById('ord_mat_d')?.value ? document.getElementById('ord_mat_d').value + 'T08:00:00' : null,
    routing_id:     routingId ? parseInt(routingId) : null,
    order_type:     orderType,
    op_overrides:   ovs.length ? ovs : undefined,
    total_price:    document.getElementById('ord_price').value || null,
    priority_flag:  document.getElementById('ord_urgent').checked,
    notes:          document.getElementById('ord_notes').value,
  };

  setLoading('saveOrderBtn', true);
  try{
    if(isEdit){
      await api('PUT', `/api/orders/${editId}`, data);
      toast('Order updated!');
    } else {
      const r = await api('POST', '/api/orders', data);
      await loadAll();
      if (orderType === 'assembly') {
        toast(`Order ${r.order_number} created — set up assembly components now`);
        navigate(`/orders/${r.id}/assembly`);
      } else {
        toast(`Order ${r.order_number} created — ${qty} piece jobs generated`);
        navigate('/orders');
      }
      return;
    }
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
    if(window.location.pathname.includes('dashboard')){ try{await loadAll();navigate('/dashboard');}catch{} }
  }, 300000);
}
document.getElementById('modalOverlay').addEventListener('click',function(e){if(e.target===this)closeModal();});
