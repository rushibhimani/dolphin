/**
 * Dolphin ERP — Orders
 */

// ── ORDERS (quantity-based) ──
allOrders = allOrders||[];

async function renderOrders(){
  await loadAll();
  document.getElementById('topbarActions').innerHTML=`
    <button class="btn btn-secondary" onclick="scheduleAll()">⚡ Schedule All</button>
    <button class="btn btn-primary" onclick="navigate('/orders/new')">+ New Order</button>`;

  if(!allOrders.length){
    document.getElementById('content').innerHTML=`
      <div class="card"><div class="empty">No orders yet.<br>An order = one customer request for multiple identical pieces.<br>Each piece is scheduled independently — urgent small orders jump ahead of large slow ones automatically.</div></div>`;
    return;
  }

  const sorted = [...allOrders].sort((a,b)=>new Date(a.due_date)-new Date(b.due_date));
  document.getElementById('content').innerHTML=`
    <div style="display:flex;flex-direction:column;gap:12px">
      ${sorted.map(o=>orderCardHTML(o)).join('')}
    </div>`;
}

function orderCardHTML(o){
  const done     = o.pieces_done    || 0;
  const inprog   = o.pieces_inprog  || 0;
  const sched    = o.pieces_scheduled|| 0;
  const total    = o.quantity        || 1;
  const pct      = Math.round((done/total)*100);
  const isLate   = o.is_late;
  const dueColor = isLate ? 'var(--red)' : new Date(o.due_date) < new Date(Date.now()+3*86400000) ? 'var(--amber)' : 'var(--text-soft)';

  const statusBadge = o.status==='completed' ? `<span class="badge badge-done">Done</span>` :
                      o.status==='in_progress' ? `<span class="badge badge-inprog">In Progress</span>` :
                      `<span class="badge badge-pending">Pending</span>`;

  return `<div class="card">
    <div class="card-hdr" style="flex-wrap:wrap;gap:10px">
      <div style="min-width:0;flex:1">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:3px">
          <span class="mono" style="font-size:14px;font-weight:600;color:var(--accent)">${o.order_number}</span>
          ${statusBadge}
          ${isLate?'<span class="badge badge-late">LATE</span>':''}
        </div>
        <div style="font-size:13px;font-weight:500">${o.customer_name} · ${o.product_type} ${o.product_size||''} ${o.product_variant||''}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;align-items:center">
        <button class="btn btn-secondary" style="font-size:12px;padding:5px 10px" onclick="viewOrderPieces(${o.id})">View Pieces</button>
        <button class="btn btn-secondary" style="font-size:12px;padding:5px 10px" onclick="scheduleOrder(${o.id})">⚡ Schedule</button>
        <button class="btn btn-danger" style="font-size:12px;padding:5px 10px" onclick="deleteOrder(${o.id})">Delete</button>
      </div>
    </div>
    <div class="card-body" style="padding:12px 20px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:14px">
        <div><div style="font-size:11px;color:var(--muted);margin-bottom:2px">Quantity</div><div class="mono" style="font-size:16px;font-weight:600">${total} pcs</div></div>
        <div><div style="font-size:11px;color:var(--muted);margin-bottom:2px">Due date</div><div class="mono" style="font-size:14px;color:${dueColor}">${fmtD(o.due_date)}${isLate?' ⚠':''}</div></div>
        <div><div style="font-size:11px;color:var(--muted);margin-bottom:2px">Est. finish</div><div class="mono" style="font-size:14px;color:${o.est_finish&&isLate?'var(--red)':'var(--muted)'}">${o.est_finish?fmtD(o.est_finish):'Not scheduled'}</div></div>
        <div><div style="font-size:11px;color:var(--muted);margin-bottom:2px">Value</div><div class="mono" style="font-size:14px;color:var(--green)">${fmtINR(o.total_price)}</div></div>
      </div>
      <div style="margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px">
          <span style="color:var(--muted)">
            ${done} done · ${inprog} in progress · ${sched} scheduled · ${total-done-inprog-sched} pending
          </span>
          <span class="mono" style="font-weight:600">${pct}%</span>
        </div>
        <div class="prog-bar" style="height:8px">
          <div class="prog-fill" style="width:${pct}%;background:${pct===100?'var(--green)':inprog>0?'var(--accent)':'var(--accent2)'}"></div>
        </div>
      </div>
    </div>
  </div>`;
}

async function viewOrderPieces(orderId){
  const order = await api('GET',`/api/orders/${orderId}`);
  const pieces = order.pieces || [];
  const html = pieces.map(p=>`
    <tr style="border-top:1px solid var(--border)">
      <td style="padding:8px 12px;font-family:var(--mono);font-size:12px;color:var(--accent)">P${String(p.piece_number).padStart(2,'0')}</td>
      <td style="padding:8px 12px;font-family:var(--mono);font-size:11px;color:var(--muted)">${p.job_number}</td>
      <td style="padding:8px 12px">${sBadge(p.status)}</td>
      <td style="padding:8px 12px;font-family:var(--mono);font-size:11px">${p.scheduled_finish?fmtD(p.scheduled_finish):'—'}</td>
      <td style="padding:8px 12px"><div style="display:flex;gap:4px;align-items:center">
        <div class="prog-bar" style="width:80px"><div class="prog-fill" style="width:${p.ops_total?Math.round(p.ops_done/p.ops_total*100):0}%"></div></div>
        <span style="font-size:10px;color:var(--muted)">${p.ops_done}/${p.ops_total}</span>
      </div></td>
      <td style="padding:8px 12px">
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 7px" onclick="closeModal();navigate('/jobs');setTimeout(()=>expandJob(${p.id}),300)">View →</button>
      </td>
    </tr>`).join('');
  showModal(`${order.order_number} — Pieces (${order.quantity})`,`
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      <div class="stat-card" style="padding:12px"><div class="stat-label">Total</div><div class="stat-value">${order.quantity}</div></div>
      <div class="stat-card" style="padding:12px"><div class="stat-label">Done</div><div class="stat-value" style="color:var(--green)">${order.pieces_done}</div></div>
      <div class="stat-card" style="padding:12px"><div class="stat-label">In Progress</div><div class="stat-value" style="color:var(--accent)">${order.pieces_inprog}</div></div>
      <div class="stat-card" style="padding:12px"><div class="stat-label">Pending</div><div class="stat-value" style="color:var(--muted)">${order.pieces_pending}</div></div>
    </div>
    <div style="overflow-y:auto;max-height:400px">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="border-bottom:1px solid var(--border)">
          <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left">Piece</th>
          <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left">Job #</th>
          <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left">Status</th>
          <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left">Finish</th>
          <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left">Progress</th>
          <th style="padding:8px 12px"></th>
        </tr></thead>
        <tbody>${html}</tbody>
      </table>
    </div>`,
    `<button class="btn btn-primary" onclick="closeModal()">Close</button>`,
    true
  );
}

async function scheduleOrder(orderId){
  try{
    const r = await api('POST',`/api/orders/${orderId}/schedule`);
    toast(`Scheduled ${r.scheduled} pieces${r.failed>0?' · '+r.failed+' failed':''}`);
    await loadAll();
    navigate('/orders');
  }catch(e){ toast(e.message,'error'); }
}

async function deleteOrder(orderId){
  const ok = await confirm2('Delete this order and all its piece jobs? This cannot be undone.','Delete Order');
  if(!ok) return;
  try{
    await api('DELETE',`/api/orders/${orderId}`);
    toast('Order deleted');
    await loadAll();
    navigate('/orders');
  }catch(e){ toast(e.message,'error'); }
}

// ── Bulk override all pieces of an order ──
async function bulkOverrideOrder(orderId){
  const order = allOrders.find(o=>o.id==orderId);
  if(!order) return;
  if(!order.routing_id){ toast('Order has no routing — cannot bulk edit','error'); return; }
  const rt = await api('GET',`/api/routings/${order.routing_id}`);
  // populate jobFormOps from routing
  jobFormOps = rt.operations.map(op=>({
    operation_id: op.id, name: op.name, wc_name: op.work_center_name,
    work_center_id: op.work_center_id, machine_type: op.machine_type||'',
    setup_time_mins: op.setup_time_mins,
    work_time_mins: op.work_time_mins!=null?op.work_time_mins:(op.work_time_hrs||0)*60,
    work_time_hrs: op.work_time_hrs, is_optional: op.is_optional, included: true
  }));
  showModal(`Edit Times — All Pieces of ${order.order_number}`,
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
    toast(`Applied to ${r.updated} pieces${r.skipped_active?' ('+r.skipped_active+' active skipped)':''}`);
    closeModal(); await loadAll(); navigate('/jobs');
  }catch(e){ toast(e.message,'error'); }
  finally{ setLoading('bulkOverrideBtn',false); }
}

let orderFormOps = [];  // routing ops for order creation
