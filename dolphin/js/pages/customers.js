/**
 * Dolphin ERP — Customers
 */

// ── CUSTOMERS PAGE ──
async function renderCustomers(){
  await loadAll();
  document.getElementById('topbarActions').innerHTML=`<button class="btn btn-primary" onclick="openCustomerModal()">+ New Customer</button>`;
  if(!allCustomers.length){
    document.getElementById('content').innerHTML=`<div class="card"><div class="empty">No customers yet. Click "+ New Customer" to add one.</div></div>`;
    return;
  }

  const sorted = [...allCustomers].sort((a,b)=>b.total_revenue-a.total_revenue);

  document.getElementById('content').innerHTML=`
    <div class="card">
      <div class="card-hdr">
        <div class="card-title">Customers (${allCustomers.length})</div>
        <input placeholder="Search..." oninput="filterCustomers(this.value)"
          style="width:200px;padding:5px 9px;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);outline:none">
      </div>
      <table class="jobs-table" id="customersTable">
        <thead><tr>
          <th style="padding-left:18px;width:200px">Name</th>
          <th style="width:120px">Phone</th>
          <th style="width:140px">Contact</th>
          <th style="width:80px">Jobs</th>
          <th style="width:90px">On-Time</th>
          <th style="width:90px">Late</th>
          <th style="min-width:100px">Revenue</th>
          <th style="width:140px">Actions</th>
        </tr></thead>
        <tbody id="customersBody">
        ${sorted.map(c=>`<tr>
          <td style="padding:10px 14px;font-weight:500">${c.name}</td>
          <td style="padding:10px 14px;font-family:var(--mono);font-size:11px">${c.phone||'—'}</td>
          <td style="padding:10px 14px;font-size:12px;color:var(--muted)">${c.contact_person||'—'}</td>
          <td style="padding:10px 14px;font-family:var(--mono)">${c.job_count}</td>
          <td style="padding:10px 14px;font-family:var(--mono);color:${c.on_time_count>0?'var(--green)':'var(--muted)'}">${c.on_time_count}</td>
          <td style="padding:10px 14px;font-family:var(--mono);color:${c.late_count>0?'var(--red)':'var(--muted)'}">${c.late_count}</td>
          <td style="padding:10px 14px;font-family:var(--mono);font-weight:500">${fmtINR(c.total_revenue)}</td>
          <td style="padding:10px 14px">
            <div style="display:flex;gap:5px">
              <button class="btn btn-secondary" style="font-size:11px;padding:4px 8px" onclick="viewCustomer(${c.id})">View</button>
              <button class="btn btn-ghost" style="font-size:11px;padding:4px 8px" onclick="openCustomerModal(${c.id})">Edit</button>
              <button class="btn btn-danger btn-icon" onclick="delCustomer(${c.id})">✕</button>
            </div>
          </td>
        </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function filterCustomers(q){
  const ql=q.toLowerCase();
  document.querySelectorAll('#customersBody tr').forEach(r=>{
    r.style.display=r.textContent.toLowerCase().includes(ql)?'':'none';
  });
}

function openCustomerModal(editId){
  const c = editId ? allCustomers.find(x=>x.id===editId) : null;
  showModal(c?`Edit — ${c.name}`:'New Customer',`
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Customer Name <span style="color:var(--red)">*</span></div>
        <input id="c_name" value="${c?.name||''}" placeholder="Company name">
        <div class="field-err" id="c_name_err"></div>
      </div>
      <div class="form-group">
        <div class="fld-label">Phone</div>
        <input id="c_phone" value="${c?.phone||''}" placeholder="+91 98765 43210">
      </div>
    </div>
    <div class="form-row cols-1">
      <div class="form-group">
        <div class="fld-label">Contact Person</div>
        <input id="c_contact" value="${c?.contact_person||''}" placeholder="Name of person to call">
      </div>
    </div>
    <div class="form-row cols-1">
      <div class="form-group">
        <div class="fld-label">Notes</div>
        <textarea id="c_notes" placeholder="Special requirements, preferences, etc.">${c?.notes||''}</textarea>
      </div>
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" id="saveCustomerBtn" onclick="saveCustomer(${c?.id||'null'})">Save Customer</button>`
  );
  setTimeout(()=>attachValidation('c_name',[{test:v=>v.length>0,msg:'Name is required'}],'c_name_err'),50);
}

async function saveCustomer(editId){
  if(!validateAll(['c_name'])){toast('Name is required','error');return;}
  const data = {
    name: document.getElementById('c_name').value.trim(),
    phone: document.getElementById('c_phone').value.trim(),
    contact_person: document.getElementById('c_contact').value.trim(),
    notes: document.getElementById('c_notes').value.trim(),
  };
  setLoading('saveCustomerBtn',true);
  try{
    if(editId&&editId!=='null') await api('PUT',`/api/customers/${editId}`,data);
    else await api('POST','/api/customers',data);
    toast('Customer saved!');
    closeModal(); await loadAll(); navigate('/customers');
  }catch(e){toast(e.message,'error');}
  finally{setLoading('saveCustomerBtn',false);}
}

async function delCustomer(id){
  const c = allCustomers.find(x=>x.id===id);
  const msg = c?.job_count>0
    ? `${c.name} has ${c.job_count} jobs. Mark as inactive (jobs preserved)?`
    : 'Delete this customer?';
  const ok = await confirm2(msg, c?.job_count>0?'Mark Inactive':'Delete');
  if(!ok) return;
  try{await api('DELETE',`/api/customers/${id}`);toast('Done');await loadAll();navigate('/customers');}
  catch(e){toast(e.message,'error');}
}

async function viewCustomer(id){
  const c = await api('GET',`/api/customers/${id}`);
  const jobsHtml = c.jobs.length ? c.jobs.map(j=>`
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 12px;font-family:var(--mono);font-size:12px">${j.job_number}</td>
      <td style="padding:8px 12px;font-size:12px">${j.product_type}${j.product_size?' '+j.product_size:''}</td>
      <td style="padding:8px 12px;font-size:11px;font-family:var(--mono)">${fmtD(j.due_date)}</td>
      <td style="padding:8px 12px">${sBadge(j.status)}${j.is_late?' <span class="badge badge-late">LATE</span>':''}</td>
      <td style="padding:8px 12px;font-family:var(--mono);font-size:12px">${fmtINR(j.total_price)}</td>
    </tr>`).join('') : '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--muted)">No jobs yet</td></tr>';

  showModal(`${c.name}`,`
    <div class="detail-grid" style="margin-bottom:16px">
      <div class="detail-item"><div class="dl">Phone</div><div class="dv">${c.phone||'—'}</div></div>
      <div class="detail-item"><div class="dl">Contact Person</div><div class="dv">${c.contact_person||'—'}</div></div>
      <div class="detail-item"><div class="dl">Total Jobs</div><div class="dv mono">${c.job_count}</div></div>
      <div class="detail-item"><div class="dl">On-Time / Late</div><div class="dv mono"><span style="color:var(--green)">${c.on_time_count}</span> / <span style="color:var(--red)">${c.late_count}</span></div></div>
      <div class="detail-item" style="grid-column:1/-1"><div class="dl">Total Revenue</div><div class="dv mono" style="font-size:18px;font-weight:600;color:var(--green)">${fmtINR(c.total_revenue)}</div></div>
      ${c.notes?`<div class="detail-item" style="grid-column:1/-1"><div class="dl">Notes</div><div class="dv" style="color:var(--muted)">${c.notes}</div></div>`:''}
    </div>
    <div class="form-section">Job History (${c.jobs.length})</div>
    <div style="max-height:300px;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left;border-bottom:1px solid var(--border)">Job #</th>
          <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left;border-bottom:1px solid var(--border)">Product</th>
          <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left;border-bottom:1px solid var(--border)">Due</th>
          <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left;border-bottom:1px solid var(--border)">Status</th>
          <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:var(--muted);text-align:left;border-bottom:1px solid var(--border)">Price</th>
        </tr></thead>
        <tbody>${jobsHtml}</tbody>
      </table>
    </div>`,
    `<button class="btn btn-secondary" onclick="closeModal();openCustomerModal(${c.id})">Edit Customer</button>
     <button class="btn btn-primary" onclick="closeModal()">Close</button>`,
    true
  );
}

// ── REPORTS PAGE ──
