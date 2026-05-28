/**
 * Dolphin ERP — Orders
 */

allOrders = allOrders || [];
let _orderSel = new Set(); // selected order IDs for bulk ops

async function renderOrders(){
  await loadAll();
  _orderSel.clear();
  _renderOrdersContent();
}

function _renderOrdersContent(){
  const el = document.getElementById('content');

  const _ordCanModify = authCanModify('orders');
  const _ordCanSched  = authHasPerm('can_schedule');
  document.getElementById('topbarActions').innerHTML = `
    ${_ordCanSched?`<button class="btn btn-secondary" onclick="scheduleAll()">⚡ Schedule All</button>`:''}
    ${_ordCanModify?`<button class="btn btn-primary" onclick="navigate('/orders/new')">+ New Order</button>`:''}`;

  if(!allOrders.length){
    el.innerHTML = `<div class="card"><div class="empty">No orders yet. Create one to get started.</div></div>`;
    return;
  }

  const sorted = [...allOrders].sort((a,b) => new Date(a.due_date) - new Date(b.due_date));

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <!-- Bulk toolbar -->
      <div id="ordBulkBar" style="display:none;background:var(--accent-soft);border:1px solid var(--accent);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span id="ordBulkCount" style="font-size:13px;font-weight:600"></span>
        <button class="btn btn-secondary" style="font-size:12px" onclick="bulkScheduleOrders()">⚡ Schedule Selected</button>
        <button class="btn btn-danger"    style="font-size:12px" onclick="bulkDeleteOrders()">🗑 Delete Selected</button>
        <button class="btn btn-ghost"     style="font-size:12px;margin-left:auto" onclick="clearOrderSel()">✕ Clear</button>
      </div>
      ${sorted.map(o => orderCardHTML(o)).join('')}
    </div>`;

  _syncOrderBulkBar();
}

function _syncOrderBulkBar(){
  const bar = document.getElementById('ordBulkBar');
  const cnt = document.getElementById('ordBulkCount');
  if(!bar) return;
  bar.style.display = _orderSel.size > 0 ? 'flex' : 'none';
  if(cnt) cnt.textContent = `${_orderSel.size} order${_orderSel.size===1?'':'s'} selected`;
  // sync checkboxes
  allOrders.forEach(o => {
    const cb = document.getElementById(`ordchk_${o.id}`);
    if(cb) cb.checked = _orderSel.has(o.id);
  });
}

function toggleOrderSel(id, checked){
  if(checked) _orderSel.add(id); else _orderSel.delete(id);
  _syncOrderBulkBar();
}
function clearOrderSel(){ _orderSel.clear(); _syncOrderBulkBar(); }

// ── Order card ────────────────────────────────────────────────────────────────
function orderCardHTML(o){
  const done   = o.pieces_done     || 0;
  const inprog = o.pieces_inprog   || 0;
  const sched  = o.pieces_scheduled|| 0;
  const total  = o.quantity         || 1;
  const pct    = Math.round((done/total)*100);
  const isLate = o.is_late;
  const dueColor = isLate ? 'var(--red)'
    : new Date(o.due_date) < new Date(Date.now()+3*86400000) ? 'var(--amber)'
    : 'var(--text-soft)';

  // Status badge — includes "draft" for empty orders
  const statusBadge = o.status === 'completed' ? `<span class="badge badge-done">Done</span>`
    : o.status === 'in_progress'               ? `<span class="badge badge-inprog">In Progress</span>`
    : o.status === 'draft'                     ? `<span class="badge" style="background:var(--surface);border:1px solid var(--border);color:var(--muted)">Draft</span>`
    :                                            `<span class="badge badge-pending">Pending</span>`;

  const pending = total - done - inprog - sched;

  return `<div class="card">
    <div class="card-hdr" style="flex-wrap:wrap;gap:8px">
      <div style="display:flex;align-items:center;gap:10px;flex:0 0 auto">
        <input type="checkbox" id="ordchk_${o.id}" ${_orderSel.has(o.id)?'checked':''}
          onchange="toggleOrderSel(${o.id},this.checked)"
          style="width:15px;height:15px;accent-color:var(--accent);cursor:pointer">
      </div>
      <div style="min-width:0;flex:1">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px">
          <span class="mono" style="font-size:14px;font-weight:600;color:var(--accent)">${escHtml(o.order_number)}</span>
          ${statusBadge}
          ${isLate?'<span class="badge badge-late">LATE</span>':''}
        </div>
        <div style="font-size:13px;font-weight:500">${escHtml(o.customer_name)} · ${o.product_type} ${o.product_size||''} ${o.product_variant||''}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;align-items:center">
        <button class="btn btn-ghost" style="font-size:12px;padding:5px 10px" onclick="viewOrderPieces(${o.id})">View Pieces</button>
        ${o.order_type==='assembly'?`<button class="btn btn-secondary" style="font-size:12px;padding:5px 10px" onclick="navigate('/orders/${o.id}/assembly')">🔧 Assembly</button>`:''}
        <button class="btn btn-ghost" style="font-size:12px;padding:5px 10px" onclick="navigate('/orders/${o.id}')">Edit</button>
        <button class="btn btn-secondary" style="font-size:12px;padding:5px 10px" onclick="scheduleOrder(${o.id})">⚡ Schedule</button>
        <button class="btn btn-danger" style="font-size:12px;padding:5px 10px" onclick="deleteOrder(${o.id})">Delete</button>
      </div>
    </div>
    <div class="card-body" style="padding:10px 20px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:12px">
        <div><div style="font-size:10px;color:var(--muted);margin-bottom:1px">Quantity</div><div class="mono" style="font-size:15px;font-weight:600">${total} pcs</div></div>
        <div><div style="font-size:10px;color:var(--muted);margin-bottom:1px">Due date</div><div class="mono" style="font-size:13px;color:${dueColor}">${fmtD(o.due_date)}${isLate?' ⚠':''}</div></div>
        <div><div style="font-size:10px;color:var(--muted);margin-bottom:1px">Est. finish</div><div class="mono" style="font-size:13px;color:${o.est_finish&&isLate?'var(--red)':'var(--muted)'}">${o.est_finish?fmtD(o.est_finish):'Not scheduled'}</div></div>
        <div><div style="font-size:10px;color:var(--muted);margin-bottom:1px">Value</div><div class="mono" style="font-size:13px;color:var(--green)">${fmtINR(o.total_price)}</div></div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:11px">
          <span style="color:var(--muted)">${done} done · ${inprog} in progress · ${sched} scheduled · ${pending} pending</span>
          <span class="mono" style="font-weight:600">${pct}%</span>
        </div>
        <div class="prog-bar" style="height:6px">
          <div class="prog-fill" style="width:${pct}%;background:${pct===100?'var(--green)':inprog>0?'var(--accent)':'var(--accent2)'}"></div>
        </div>
      </div>
    </div>
  </div>`;
}

// ── Bulk actions ──────────────────────────────────────────────────────────────
async function bulkScheduleOrders(){
  if(!_orderSel.size) return;
  try{
    const r = await api('POST','/api/orders/bulk-schedule',{ids:[..._orderSel]});
    toast(`Scheduled ${r.scheduled} pieces${r.failed?` · ${r.failed} failed`:''}`);
    clearOrderSel(); await loadAll(); _renderOrdersContent();
  }catch(e){ toast(e.message,'error'); }
}

async function bulkDeleteOrders(){
  if(!_orderSel.size) return;
  const ok = await confirm2(`Delete ${_orderSel.size} order${_orderSel.size===1?'':'s'} and all their pieces?`, 'Delete Orders');
  if(!ok) return;
  try{
    const r = await api('POST','/api/orders/bulk-delete',{ids:[..._orderSel]});
    toast(`Deleted ${r.deleted} order${r.deleted===1?'':'s'}${r.skipped?` · ${r.skipped} skipped (in progress)`:''}`);
    clearOrderSel(); await loadAll(); _renderOrdersContent();
  }catch(e){ toast(e.message,'error'); }
}

// ── Single order actions ───────────────────────────────────────────────────────
async function viewOrderPieces(orderId){
  const order = await api('GET',`/api/orders/${orderId}`);
  const pieces = order.pieces || [];
  const html = pieces.map(p=>`
    <tr style="border-top:1px solid var(--border)">
      <td style="padding:7px 10px;font-family:var(--mono);font-size:12px;color:var(--accent)">P${String(p.piece_number).padStart(2,'0')}</td>
      <td style="padding:7px 10px;font-family:var(--mono);font-size:11px;color:var(--muted)">${escHtml(p.job_number)}</td>
      <td style="padding:7px 10px">${sBadge(p.status)}</td>
      <td style="padding:7px 10px;font-family:var(--mono);font-size:11px">${p.scheduled_finish?fmtD(p.scheduled_finish):'—'}</td>
      <td style="padding:7px 10px">
        <div style="display:flex;gap:4px;align-items:center">
          <div class="prog-bar" style="width:70px"><div class="prog-fill" style="width:${p.ops_total?Math.round(p.ops_done/p.ops_total*100):0}%"></div></div>
          <span style="font-size:10px;color:var(--muted)">${p.ops_done}/${p.ops_total}</span>
        </div>
      </td>
      <td style="padding:7px 10px">
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 7px" onclick="closeModal();navigate('/jobs');setTimeout(()=>expandJob(${p.id}),300)">View →</button>
      </td>
    </tr>`).join('');

  showModal(`${escHtml(order.order_number)} — Pieces (${order.quantity})`,`
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      <div class="stat-card" style="padding:10px"><div class="stat-label">Total</div><div class="stat-value">${order.quantity}</div></div>
      <div class="stat-card" style="padding:10px"><div class="stat-label">Done</div><div class="stat-value" style="color:var(--green)">${order.pieces_done}</div></div>
      <div class="stat-card" style="padding:10px"><div class="stat-label">In Progress</div><div class="stat-value" style="color:var(--accent)">${order.pieces_inprog}</div></div>
      <div class="stat-card" style="padding:10px"><div class="stat-label">Pending</div><div class="stat-value" style="color:var(--muted)">${order.pieces_pending}</div></div>
    </div>
    <div style="overflow-y:auto;max-height:380px">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="border-bottom:1px solid var(--border)">
          <th style="padding:7px 10px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left">Piece</th>
          <th style="padding:7px 10px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left">Job #</th>
          <th style="padding:7px 10px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left">Status</th>
          <th style="padding:7px 10px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left">Finish</th>
          <th style="padding:7px 10px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left">Ops</th>
          <th></th>
        </tr></thead>
        <tbody>${html || '<tr><td colspan="6" style="padding:16px;text-align:center;color:var(--muted)">No pieces</td></tr>'}</tbody>
      </table>
    </div>`,
    `<button class="btn btn-secondary" onclick="scheduleOrder(${orderId});closeModal()">⚡ Schedule All Pieces</button>
     <button class="btn btn-primary" onclick="closeModal()">Close</button>`,
    true
  );
}

async function scheduleOrder(orderId){
  try{
    const r = await api('POST',`/api/orders/${orderId}/schedule`);
    toast(`Scheduled ${r.scheduled} pieces${r.failed>0?` · ${r.failed} failed`:''}`);
    await loadAll(); _renderOrdersContent();
  }catch(e){ toast(e.message,'error'); }
}

async function deleteOrder(orderId){
  const ok = await confirm2('Delete this order and all its piece jobs? This cannot be undone.','Delete Order');
  if(!ok) return;
  try{
    await api('DELETE',`/api/orders/${orderId}`);
    toast('Order deleted');
    await loadAll(); _renderOrdersContent();
  }catch(e){ toast(e.message,'error'); }
}

// ── Bulk override all pieces (called from jobs page) ──────────────────────────
async function bulkOverrideOrder(orderId){
  const order = allOrders.find(o=>o.id==orderId);
  if(!order) return;
  if(!order.routing_id){ toast('Order has no routing — cannot bulk edit','error'); return; }
  const rt = await api('GET',`/api/routings/${order.routing_id}`);
  jobFormOps = rt.operations.map(op=>({
    operation_id: op.id, name: op.name, wc_name: op.work_center_name,
    work_center_id: op.work_center_id, machine_type: op.machine_type||'',
    setup_time_mins: op.setup_time_mins,
    work_time_mins: op.work_time_mins!=null?op.work_time_mins:(op.work_time_hrs||0)*60,
    work_time_hrs: op.work_time_hrs, is_optional: op.is_optional, included: true
  }));
  showModal(`Edit Times — All Pieces of ${escHtml(order.order_number)}`,
    `<div style="font-size:12px;color:var(--muted);margin-bottom:12px;padding:8px 12px;background:var(--amber-soft);border:1px solid var(--amber);border-radius:6px">
      ⚠ This will apply new times to <strong>all pending/scheduled pieces</strong>. In-progress and completed pieces are not affected. Jobs will be reset to pending and need rescheduling.
    </div>
    <div id="jobOpsWrap"></div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" id="bulkOverrideBtn" onclick="doBulkOverride(${orderId})">Apply to All Pieces</button>`,
    true
  );
  setTimeout(()=>renderJobOpsTable(), 50);
}

async function doBulkOverride(orderId){
  const ovs = jobFormOps.map((op,i)=>({
    operation_id: op.operation_id,
    setup_time_mins: parseFloat(document.getElementById(`opsetup_${i}`)?.value)||op.setup_time_mins||0,
    work_time_mins: parseFloat(document.getElementById(`opwork_${i}`)?.value)||(op.work_time_mins||(op.work_time_hrs||0)*60),
    work_time_hrs: (parseFloat(document.getElementById(`opwork_${i}`)?.value)||(op.work_time_mins||(op.work_time_hrs||0)*60))/60,
    included: document.getElementById(`opchk_${i}`)?.checked??true,
  }));
  setLoading('bulkOverrideBtn',true);
  try{
    const r = await api('POST',`/api/orders/${orderId}/bulk-override`,{op_overrides:ovs});
    toast(`Applied to ${r.updated} pieces${r.skipped_active?` (${r.skipped_active} active skipped)`:''}`);
    closeModal(); await loadAll(); navigate('/jobs');
  }catch(e){ toast(e.message,'error'); }
  finally{ setLoading('bulkOverrideBtn',false); }
}

let orderFormOps = [];
