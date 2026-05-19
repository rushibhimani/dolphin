#!/usr/bin/env python3
"""
Dolphin ERP — Comprehensive Fix Script
Fixes all identified issues after reading full source:

1. Gantt label panel hardcoded dark colors → CSS vars
2. Reports completed_revenue undefined → total_revenue
3. renderSettings() missing → adds a working settings page
4. Sidebar nav overflow-y:auto → enables scrolling
5. Orders page → adds full renderOrders() function
6. Sidebar → adds Orders nav item

Run from your dolphin directory:
    python fix_all.py
"""
import shutil, os, re

FILE = "index.html"
if not os.path.exists(FILE):
    print(f"❌ {FILE} not found. Run from ~/dev/Python/Dolphin")
    exit(1)

shutil.copy(FILE, FILE + ".bak_comprehensive")
print(f"✓ Backup: {FILE}.bak_comprehensive")

with open(FILE, "r", encoding="utf-8") as f:
    html = f.read()

fixes = []

# ─────────────────────────────────────────────────────────────
# FIX 1: Gantt label panel hardcoded dark background
# ─────────────────────────────────────────────────────────────
old1 = 'background:#151820;border-right:1px solid #2a2f3d;z-index:10'
new1 = 'background:var(--surface);border-right:1px solid var(--border);z-index:10'
if old1 in html:
    html = html.replace(old1, new1)
    fixes.append("✓ Fix 1: Gantt label panel — theme-aware colors")
else:
    fixes.append("~ Fix 1: Gantt label already fixed or pattern changed")

# ─────────────────────────────────────────────────────────────
# FIX 2: Reports page — completed_revenue not in API response
# The API returns total_revenue, not completed_revenue
# ─────────────────────────────────────────────────────────────
if 't.completed_revenue' in html:
    html = html.replace(
        '${fmtINR(t.completed_revenue)} all-time',
        '${fmtINR(t.total_revenue)} all-time'
    )
    fixes.append("✓ Fix 2: Reports completed_revenue → total_revenue")
else:
    fixes.append("~ Fix 2: Reports revenue already correct")

# ─────────────────────────────────────────────────────────────
# FIX 3: Sidebar nav — add overflow-y:auto so it scrolls
# ─────────────────────────────────────────────────────────────
old3 = 'nav{padding:10px 10px;flex:1}'
new3 = 'nav{padding:10px 10px;flex:1;overflow-y:auto}'
if old3 in html:
    html = html.replace(old3, new3)
    fixes.append("✓ Fix 3: Sidebar nav scroll enabled")
else:
    fixes.append("~ Fix 3: Sidebar scroll already fixed or pattern changed")

# ─────────────────────────────────────────────────────────────
# FIX 4: sidebar-foot — prevent it shrinking
# ─────────────────────────────────────────────────────────────
old4 = '.sidebar-foot{padding:14px 22px;border-top:1px solid var(--border)}'
new4 = '.sidebar-foot{padding:14px 22px;border-top:1px solid var(--border);flex-shrink:0}'
if old4 in html:
    html = html.replace(old4, new4)
    fixes.append("✓ Fix 4: Sidebar footer pinned to bottom")
else:
    fixes.append("~ Fix 4: Sidebar footer already fixed")

# ─────────────────────────────────────────────────────────────
# FIX 5: Add Orders nav item to sidebar
# Insert after the Jobs nav item
# ─────────────────────────────────────────────────────────────
orders_nav = '''    <div class="nav-item" onclick="showPage('orders')">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>Orders
    </div>'''

jobs_nav_end = '''    <div class="nav-item" onclick="showPage('schedule')">'''

if "showPage('orders')" not in html and jobs_nav_end in html:
    html = html.replace(jobs_nav_end, orders_nav + '\n' + jobs_nav_end)
    fixes.append("✓ Fix 5: Orders nav item added to sidebar")
elif "showPage('orders')" in html:
    fixes.append("~ Fix 5: Orders nav already exists")
else:
    fixes.append("⚠ Fix 5: Could not find insertion point for Orders nav")

# ─────────────────────────────────────────────────────────────
# FIX 6: Add 'orders' to showPage title map
# ─────────────────────────────────────────────────────────────
old6 = "document.getElementById('pageTitle').textContent={dashboard:'Dashboard',today:\"Today's Work\",jobs:'Jobs',schedule:'Gantt Schedule'"
new6 = "document.getElementById('pageTitle').textContent={dashboard:'Dashboard',today:\"Today's Work\",jobs:'Jobs',orders:'Orders',schedule:'Gantt Schedule'"
if old6 in html:
    html = html.replace(old6, new6)
    fixes.append("✓ Fix 6: Orders added to page title map")

# ─────────────────────────────────────────────────────────────
# FIX 7: Add 'orders' to pageRenderer map in showPage()
# ─────────────────────────────────────────────────────────────
old7 = "const pageRenderer = ({dashboard:renderDashboard,today:renderToday,jobs:renderJobs,schedule:renderSchedule"
new7 = "const pageRenderer = ({dashboard:renderDashboard,today:renderToday,jobs:renderJobs,orders:renderOrders,schedule:renderSchedule"
if old7 in html:
    html = html.replace(old7, new7)
    fixes.append("✓ Fix 7: Orders added to page renderer map")

# ─────────────────────────────────────────────────────────────
# FIX 8: Add renderSettings() function (currently missing)
# Insert before the closing </script> tag
# ─────────────────────────────────────────────────────────────
SETTINGS_FN = '''
// ── SETTINGS ──
async function renderSettings(){
  document.getElementById('topbarActions').innerHTML = '';
  const p = loadPrefs();
  document.getElementById('content').innerHTML = `
    <div class="card">
      <div class="card-hdr"><div class="card-title">Appearance & Preferences</div></div>
      <div class="card-body">

        <div class="pref-row">
          <div class="pref-info">
            <div class="pref-label">Theme</div>
            <div class="pref-help">Switch between dark and light mode.</div>
          </div>
          <div class="pref-opts">
            <button class="pref-opt ${p.theme==='dark'?'active':''}" onclick="updatePref('theme','dark');renderSettings()">Dark</button>
            <button class="pref-opt ${p.theme==='light'?'active':''}" onclick="updatePref('theme','light');renderSettings()">Light</button>
          </div>
        </div>

        <div class="pref-row">
          <div class="pref-info">
            <div class="pref-label">Font Size</div>
            <div class="pref-help">Adjust text size across the whole app.</div>
          </div>
          <div class="pref-opts">
            <button class="pref-opt ${p.fontScale==='small'?'active':''}" onclick="updatePref('fontScale','small');renderSettings()">Small</button>
            <button class="pref-opt ${p.fontScale==='default'?'active':''}" onclick="updatePref('fontScale','default');renderSettings()">Default</button>
            <button class="pref-opt ${p.fontScale==='large'?'active':''}" onclick="updatePref('fontScale','large');renderSettings()">Large</button>
            <button class="pref-opt ${p.fontScale==='xlarge'?'active':''}" onclick="updatePref('fontScale','xlarge');renderSettings()">X-Large</button>
          </div>
        </div>

        <div class="pref-row">
          <div class="pref-info">
            <div class="pref-label">Density</div>
            <div class="pref-help">Control spacing and padding density.</div>
          </div>
          <div class="pref-opts">
            <button class="pref-opt ${p.density==='compact'?'active':''}" onclick="updatePref('density','compact');renderSettings()">Compact</button>
            <button class="pref-opt ${p.density==='comfortable'?'active':''}" onclick="updatePref('density','comfortable');renderSettings()">Comfortable</button>
            <button class="pref-opt ${p.density==='spacious'?'active':''}" onclick="updatePref('density','spacious');renderSettings()">Spacious</button>
          </div>
        </div>

      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-hdr"><div class="card-title">System</div></div>
      <div class="card-body">
        <div class="pref-row">
          <div class="pref-info">
            <div class="pref-label">Database</div>
            <div class="pref-help">Your data is stored in dolphin.db in the project folder. Back it up by copying that file.</div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            <button class="btn btn-secondary" onclick="checkHealth()">Check Server</button>
          </div>
        </div>
        <div class="pref-row">
          <div class="pref-info">
            <div class="pref-label">Load Real Machine Setup</div>
            <div class="pref-help">Load Yukeng's 22 machines and 10 workers. Only works on a fresh/empty database.</div>
          </div>
          <button class="btn btn-secondary" onclick="seedRealData()">Load Real Setup</button>
        </div>
        <div class="pref-row" style="border-bottom:none">
          <div class="pref-info">
            <div class="pref-label">Load Demo Data</div>
            <div class="pref-help">Load sample jobs and routings for testing.</div>
          </div>
          <button class="btn btn-secondary" onclick="seedData()">Load Demo Data</button>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-hdr"><div class="card-title">About</div></div>
      <div class="card-body" style="font-size:13px;color:var(--muted);line-height:1.8">
        <div><strong style="color:var(--text)">Dolphin ERP</strong> — Mould & Die Shop Management</div>
        <div>Shift: Mon–Sat 8 AM–8 PM IST · Wed half-day (8 AM–2 PM) · Lunch 12–2 PM</div>
        <div>Backend: FastAPI + SQLite · Frontend: Vanilla JS</div>
        <div id="healthStatus" style="margin-top:8px"></div>
      </div>
    </div>`;
}

async function checkHealth(){
  try{
    const r = await api('GET','/api/health');
    document.getElementById('healthStatus').innerHTML =
      `<span style="color:var(--green)">✓ Server OK · IST ${r.time_ist?.slice(11,19)||'—'}</span>`;
  }catch(e){
    document.getElementById('healthStatus').innerHTML =
      `<span style="color:var(--red)">✗ Server offline: ${e.message}</span>`;
  }
}

// ── ORDERS ──
let allOrders = [];

async function renderOrders(){
  document.getElementById('topbarActions').innerHTML = `
    <button class="btn btn-secondary" onclick="renderOrders()">↻ Refresh</button>
    <button class="btn btn-primary" onclick="openOrderModal()">+ New Order</button>`;
  document.getElementById('content').innerHTML = `<div style="color:var(--muted);padding:40px;text-align:center">Loading orders...</div>`;
  try{
    allOrders = await api('GET', '/api/orders');
    await loadAll();
    renderOrdersList();
  }catch(e){
    document.getElementById('content').innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

function renderOrdersList(){
  if(!allOrders.length){
    document.getElementById('content').innerHTML = `
      <div class="card"><div class="empty">No orders yet.<br>
      <button class="btn btn-primary" style="margin-top:12px" onclick="openOrderModal()">+ New Order</button></div></div>`;
    return;
  }
  document.getElementById('content').innerHTML = `
    <div class="card">
      <div class="card-hdr">
        <div class="card-title">Orders (${allOrders.length})</div>
        <input placeholder="Search..." oninput="filterOrders(this.value)"
          style="width:200px;padding:5px 9px;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);outline:none">
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;min-width:900px" id="ordersTable">
          <thead>
            <tr style="border-bottom:1px solid var(--border);font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em">
              <th style="padding:10px 14px;text-align:left">Order #</th>
              <th style="padding:10px 14px;text-align:left">Customer</th>
              <th style="padding:10px 14px;text-align:left">Product</th>
              <th style="padding:10px 14px;text-align:center">Qty</th>
              <th style="padding:10px 14px;text-align:left">Progress</th>
              <th style="padding:10px 14px;text-align:left">Due</th>
              <th style="padding:10px 14px;text-align:left">Est. Finish</th>
              <th style="padding:10px 14px;text-align:left">Status</th>
              <th style="padding:10px 14px;text-align:right">Price</th>
              <th style="padding:10px 14px;text-align:right">Actions</th>
            </tr>
          </thead>
          <tbody id="ordersBody">
            ${allOrders.map(o => orderRowHTML(o)).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function orderRowHTML(o){
  const done = o.pieces_done || 0;
  const total = o.quantity || 1;
  const pct = Math.round(done / total * 100);
  const isLate = o.is_late && o.status !== 'completed';

  return `<tr style="border-bottom:1px solid var(--border)" id="orow_${o.id}">
    <td style="padding:10px 14px;font-family:var(--mono);font-size:12px;font-weight:500;color:var(--accent)">${o.order_number}</td>
    <td style="padding:10px 14px;font-size:13px">${o.customer_name}</td>
    <td style="padding:10px 14px;font-size:12px;color:var(--text-soft)">${o.product_type} ${o.product_size||''}</td>
    <td style="padding:10px 14px;text-align:center;font-family:var(--mono)">${total}</td>
    <td style="padding:10px 14px;min-width:130px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:3px">${done}/${total} pieces · ${pct}%</div>
      <div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:${pct===100?'var(--green)':'var(--accent)'}"></div></div>
      ${o.pieces_inprog ? `<div style="font-size:10px;color:var(--accent);margin-top:2px">${o.pieces_inprog} in progress</div>` : ''}
    </td>
    <td style="padding:10px 14px;font-family:var(--mono);font-size:11px">${fmtD(o.due_date)}</td>
    <td style="padding:10px 14px;font-family:var(--mono);font-size:11px;color:${isLate?'var(--red)':'var(--muted)'}">${o.est_finish ? fmtD(o.est_finish) : '—'}${isLate?' ⚠':''}</td>
    <td style="padding:10px 14px">${sBadge(o.status)}</td>
    <td style="padding:10px 14px;font-family:var(--mono);font-size:12px;text-align:right">${fmtINR(o.total_price)}</td>
    <td style="padding:10px 14px;text-align:right">
      <div style="display:flex;gap:5px;justify-content:flex-end">
        <button class="btn btn-secondary" style="font-size:11px;padding:4px 8px" onclick="viewOrderDetail(${o.id})">View</button>
        <button class="btn btn-ghost" style="font-size:11px;padding:4px 8px" onclick="scheduleOrder(${o.id})">⚡ Schedule</button>
        <button class="btn btn-danger btn-icon" onclick="deleteOrder(${o.id})">✕</button>
      </div>
    </td>
  </tr>`;
}

function filterOrders(q){
  const ql = q.toLowerCase();
  document.querySelectorAll('#ordersBody tr').forEach(r => {
    r.style.display = r.textContent.toLowerCase().includes(ql) ? '' : 'none';
  });
}

async function viewOrderDetail(orderId){
  const o = await api('GET', `/api/orders/${orderId}`);
  const piecesHtml = (o.pieces||[]).map(p => `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 12px;font-family:var(--mono);font-size:12px">P${String(p.piece_number).padStart(2,'0')}</td>
      <td style="padding:8px 12px;font-size:12px;font-family:var(--mono)">${p.job_number}</td>
      <td style="padding:8px 12px">${sBadge(p.status)}</td>
      <td style="padding:8px 12px;font-size:11px;font-family:var(--mono)">${p.scheduled_finish ? fmtD(p.scheduled_finish) : '—'}</td>
      <td style="padding:8px 12px">
        <div class="prog-wrap">
          <div style="font-size:11px;color:var(--muted)">${p.ops_done}/${p.ops_total}</div>
          <div class="prog-bar"><div class="prog-fill" style="width:${p.ops_total?Math.round(p.ops_done/p.ops_total*100):0}%"></div></div>
        </div>
      </td>
      <td style="padding:8px 12px">
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 7px" onclick="closeModal();showPage('jobs');setTimeout(()=>expandJob(${p.id}),200)">View Job</button>
      </td>
    </tr>`).join('');

  showModal(`Order: ${o.order_number}`, `
    <div class="detail-grid" style="margin-bottom:16px">
      <div class="detail-item"><div class="dl">Customer</div><div class="dv">${o.customer_name}</div></div>
      <div class="detail-item"><div class="dl">Product</div><div class="dv">${o.product_type} ${o.product_size||''} ${o.product_variant||''}</div></div>
      <div class="detail-item"><div class="dl">Quantity</div><div class="dv mono">${o.quantity} pieces</div></div>
      <div class="detail-item"><div class="dl">Due Date</div><div class="dv mono">${fmtD(o.due_date)}</div></div>
      <div class="detail-item"><div class="dl">Est. Finish</div><div class="dv mono" style="color:${o.is_late?'var(--red)':'inherit'}">${o.est_finish ? fmtD(o.est_finish) : '—'}${o.is_late?' ⚠':''}</div></div>
      <div class="detail-item"><div class="dl">Total Price</div><div class="dv mono" style="color:var(--green)">${fmtINR(o.total_price)}</div></div>
      <div class="detail-item"><div class="dl">Status</div><div class="dv">${sBadge(o.status)}</div></div>
      <div class="detail-item"><div class="dl">Progress</div><div class="dv mono">${o.pieces_done}/${o.quantity} pieces done</div></div>
    </div>
    <div class="form-section">Piece Jobs</div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="border-bottom:1px solid var(--border);font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:700">
          <th style="padding:8px 12px;text-align:left">Piece</th>
          <th style="padding:8px 12px;text-align:left">Job #</th>
          <th style="padding:8px 12px;text-align:left">Status</th>
          <th style="padding:8px 12px;text-align:left">Est. Finish</th>
          <th style="padding:8px 12px;text-align:left">Progress</th>
          <th style="padding:8px 12px;text-align:left">Actions</th>
        </tr></thead>
        <tbody>${piecesHtml}</tbody>
      </table>
    </div>`,
    `<button class="btn btn-secondary" onclick="scheduleOrder(${o.id})">⚡ Schedule All Pieces</button>
     <button class="btn btn-primary" onclick="closeModal()">Close</button>`,
    true
  );
}

async function scheduleOrder(orderId){
  try{
    toast('Scheduling order...', 'info');
    const r = await api('POST', `/api/orders/${orderId}/schedule`);
    toast(`Scheduled ${r.scheduled} pieces${r.failed ? ' · ' + r.failed + ' failed' : ''}`, r.failed ? 'error' : 'success');
    allOrders = await api('GET', '/api/orders');
    renderOrdersList();
  }catch(e){ toast(e.message, 'error'); }
}

async function deleteOrder(orderId){
  const ok = await confirm2('Delete this order and all its piece jobs? This cannot be undone.');
  if(!ok) return;
  try{
    await api('DELETE', `/api/orders/${orderId}`);
    toast('Order deleted');
    allOrders = await api('GET', '/api/orders');
    renderOrdersList();
  }catch(e){ toast(e.message, 'error'); }
}

async function openOrderModal(){
  await loadAll();
  const routingOpts = allRoutings.map(r =>
    `<option value="${r.id}">${r.name} (${r.product_type})</option>`
  ).join('');
  const custOpts = allCustomers.map(c =>
    `<option value="${c.id}">${c.name}</option>`
  ).join('');
  const PTYPES = ['Punch','Die Frame','Liner Set','Complete Mould','Custom Plate','Base Plate','Ejector Plate','Addon Plate','SFS Lower','SFS Upper'];
  const defDue = new Date(Date.now() + 7*86400000).toISOString().slice(0,10);

  showModal('New Order', `
    <div class="form-section">Customer & Order Details</div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Customer <span style="color:var(--red)">*</span></div>
        <select id="o_cust_id" onchange="document.getElementById('o_cust').value=this.options[this.selectedIndex].text">
          <option value="">— Select customer —</option>
          ${custOpts}
          <option value="__new__">+ Add new customer...</option>
        </select>
        <input id="o_cust" placeholder="Or type new customer name" style="margin-top:6px">
      </div>
      <div class="form-group">
        <div class="fld-label">PO Number</div>
        <input id="o_po" placeholder="Customer PO reference">
      </div>
    </div>
    <div class="form-row cols-3">
      <div class="form-group">
        <div class="fld-label">Product Type <span style="color:var(--red)">*</span></div>
        <select id="o_ptype">${PTYPES.map(t => `<option>${t}</option>`).join('')}</select>
      </div>
      <div class="form-group">
        <div class="fld-label">Size <span style="color:var(--red)">*</span></div>
        <input id="o_size" placeholder="600x600">
      </div>
      <div class="form-group">
        <div class="fld-label">Variant</div>
        <input id="o_variant" placeholder="Plain, Carbide...">
      </div>
    </div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Quantity (pieces) <span style="color:var(--red)">*</span></div>
        <input id="o_qty" type="number" min="1" max="100" value="1">
      </div>
      <div class="form-group">
        <div class="fld-label">Total Price (₹)</div>
        <input id="o_price" type="number" min="0" placeholder="Total for all pieces">
      </div>
    </div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Routing Template <span style="color:var(--red)">*</span></div>
        <select id="o_routing">
          <option value="">— Select routing —</option>
          ${routingOpts}
        </select>
      </div>
      <div class="form-group">
        <div class="fld-label">Due Date <span style="color:var(--red)">*</span></div>
        <input id="o_due" type="date" value="${defDue}">
      </div>
    </div>
    <div class="form-group">
      <div class="fld-label">Notes</div>
      <textarea id="o_notes" placeholder="Special instructions..."></textarea>
    </div>
    <div class="info-hint">Each piece becomes an independent job (DL-YYYY-NNN). They are scheduled separately so the shop can work on multiple pieces simultaneously.</div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" id="saveOrderBtn" onclick="saveOrder()">Create Order</button>`,
    true
  );
}

async function saveOrder(){
  const custSel = document.getElementById('o_cust_id');
  const custId = custSel?.value && custSel.value !== '__new__' ? parseInt(custSel.value) : null;
  const custName = document.getElementById('o_cust').value.trim() || custSel?.options[custSel?.selectedIndex]?.text || '';
  const routingId = parseInt(document.getElementById('o_routing').value);
  const due = document.getElementById('o_due').value;
  const qty = parseInt(document.getElementById('o_qty').value) || 1;

  if(!custName){ toast('Customer required', 'error'); return; }
  if(!routingId){ toast('Routing template required', 'error'); return; }
  if(!due){ toast('Due date required', 'error'); return; }

  const data = {
    customer_id: custId,
    customer_name: custName,
    po_number: document.getElementById('o_po').value.trim(),
    product_type: document.getElementById('o_ptype').value,
    product_size: document.getElementById('o_size').value.trim(),
    product_variant: document.getElementById('o_variant').value.trim(),
    routing_id: routingId,
    quantity: qty,
    total_price: parseFloat(document.getElementById('o_price').value) || null,
    due_date: due + 'T17:00:00',
    notes: document.getElementById('o_notes').value.trim(),
  };

  setLoading('saveOrderBtn', true);
  try{
    const r = await api('POST', '/api/orders', data);
    toast(`Order ${r.order_number} created — ${qty} piece job${qty > 1 ? 's' : ''} generated`);
    closeModal();
    allOrders = await api('GET', '/api/orders');
    renderOrdersList();
  }catch(e){ toast(e.message, 'error'); }
  finally{ setLoading('saveOrderBtn', false); }
}
'''

if 'async function renderSettings' not in html and 'async function renderOrders' not in html:
    # Insert before closing </script>
    if '</script>' in html:
        html = html.replace('</script>', SETTINGS_FN + '\n</script>', 1)
        fixes.append("✓ Fix 8: renderSettings() + renderOrders() added")
    else:
        fixes.append("⚠ Fix 8: Could not find </script> to insert functions")
elif 'async function renderSettings' in html:
    fixes.append("~ Fix 8: renderSettings already exists")
elif 'async function renderOrders' in html:
    fixes.append("~ Fix 8: renderOrders already exists")

# ─────────────────────────────────────────────────────────────
# FIX 9: Add 'settings' to page title map if missing
# ─────────────────────────────────────────────────────────────
if "'settings':'Settings'" not in html and "settings:'Settings'" not in html:
    html = html.replace(
        "reports:'Reports'",
        "reports:'Reports',settings:'Settings'"
    )
    fixes.append("✓ Fix 9: Settings added to page title map")

# ─────────────────────────────────────────────────────────────
# Write
# ─────────────────────────────────────────────────────────────
with open(FILE, "w", encoding="utf-8") as f:
    f.write(html)

print("\nResults:")
for f in fixes:
    print(" ", f)

print(f"\n✅ Done. Hard-reload browser: Cmd+Shift+R")
print("   If anything looks wrong: cp index.html.bak_comprehensive index.html")