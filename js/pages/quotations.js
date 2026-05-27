/**
 * Dolphin ERP — Quotations
 * Full CRUD + Apple-style PDF generation.
 */

// ── List Page ─────────────────────────────────────────────────────────────────
async function renderQuotations(){
  document.getElementById('topbarActions').innerHTML = `
    <button class="btn btn-secondary" onclick="openCompanySettingsModal()">⚙ Settings</button>
    <button class="btn btn-primary" onclick="navigate('/quotations/new')">+ New Quote</button>`;
  document.getElementById('content').innerHTML = `
    <div style="max-width:1050px;margin:0 auto">
      <div id="quoteListContent"><div style="color:var(--muted)">Loading…</div></div>
    </div>`;
  await _loadQuoteList();
}

async function _loadQuoteList(){
  try {
    const [quotes, company] = await Promise.all([
      api('GET','/api/quotations'),
      api('GET','/api/company-settings').catch(()=>({})),
    ]);

    const statusCfg = {
      draft:    { label:'Draft',    col:'var(--muted)',  bg:'var(--surface)'   },
      sent:     { label:'Sent',     col:'var(--accent)', bg:'var(--accent-soft)'},
      accepted: { label:'Accepted', col:'var(--green)',  bg:'var(--green-soft)' },
      rejected: { label:'Rejected', col:'var(--red)',    bg:'var(--red-soft)'   },
      expired:  { label:'Expired',  col:'var(--muted)',  bg:'var(--surface)'    },
    };

    // Summary bar
    const counts = {};
    quotes.forEach(q=>{ counts[q.status]=(counts[q.status]||0)+1; });
    const total_value = quotes.filter(q=>q.status!=='rejected').reduce((s,q)=>s+(q.total||0),0);

    const summaryHtml = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:18px">
        <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Total</div>
          <div style="font-size:24px;font-weight:700">${quotes.length}</div>
        </div>
        ${Object.entries(statusCfg).map(([s,cfg])=>counts[s]?`
          <div style="background:${cfg.bg};border:1px solid ${cfg.col}44;border-radius:10px;padding:14px 16px;cursor:pointer" onclick="_filterQuotes('${s}')">
            <div style="font-size:11px;color:${cfg.col};text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;font-weight:600">${cfg.label}</div>
            <div style="font-size:24px;font-weight:700;color:${cfg.col}">${counts[s]}</div>
          </div>`:''
        ).join('')}
        <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Pipeline Value</div>
          <div style="font-size:20px;font-weight:700;color:var(--accent)">₹${total_value.toLocaleString('en-IN',{maximumFractionDigits:0})}</div>
        </div>
      </div>`;

    // Quote rows
    const rows = quotes.map(q => {
      const cfg = statusCfg[q.status] || statusCfg.draft;
      const created = q.created_at ? new Date(q.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '';
      const valid   = q.valid_until ? new Date(q.valid_until+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short'}) : '';
      const isExpired = q.valid_until && q.status==='sent' && new Date(q.valid_until) < new Date();
      return `
        <div style="display:flex;align-items:center;gap:14px;padding:14px 18px;border-bottom:1px solid var(--border);
             cursor:pointer;transition:background .1s" onclick="navigate('/quotations/${q.id}')"
             onmouseenter="this.style.background='var(--row-hover)'" onmouseleave="this.style.background=''">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <span style="font-family:var(--mono);font-size:12px;font-weight:700;color:var(--accent)">${q.quote_number}</span>
              <span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600;
                   background:${cfg.bg};color:${cfg.col};border:1px solid ${cfg.col}44">
                ${isExpired?'Expired':cfg.label}
              </span>
            </div>
            <div style="font-size:14px;font-weight:600;margin-top:4px">${escHtml(q.customer_name)}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">
              ${q.line_items?.length||0} item${(q.line_items?.length||0)!==1?'s':''}
              · Created ${created}
              ${valid ? '· Valid to '+valid : ''}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:18px;font-weight:700">₹${(q.total||0).toLocaleString('en-IN',{maximumFractionDigits:0})}</div>
            <div style="display:flex;gap:6px;margin-top:8px;justify-content:flex-end">
              <button onclick="event.stopPropagation();downloadQuotePDF(${q.id},'${q.quote_number}')"
                style="padding:5px 10px;font-size:12px;background:var(--surface);border:1px solid var(--border);
                       border-radius:6px;cursor:pointer;color:var(--text)">📥 PDF</button>
              <button onclick="event.stopPropagation();navigate('/quotations/${q.id}')"
                style="padding:5px 10px;font-size:12px;background:var(--accent);color:#000;border:none;
                       border-radius:6px;cursor:pointer;font-weight:600">Edit →</button>
              <button onclick="event.stopPropagation();deleteQuotation(${q.id},'${q.quote_number}')"
                style="padding:5px 10px;font-size:12px;background:var(--red-soft);color:var(--red);
                       border:1px solid var(--red);border-radius:6px;cursor:pointer">🗑</button>
            </div>
          </div>
        </div>`;
    }).join('');

    const html = summaryHtml + `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden">
        ${quotes.length ? rows : '<div style="padding:40px;text-align:center;color:var(--muted)">No quotations yet.<br>Click "+ New Quote" to create one.</div>'}
      </div>`;

    document.getElementById('quoteListContent').innerHTML = html;

    // Company settings notice if empty
    if(!company.company_name){
      document.getElementById('quoteListContent').insertAdjacentHTML('afterbegin',`
        <div style="background:var(--amber-soft);border:1px solid var(--amber);border-radius:8px;
             padding:12px 16px;margin-bottom:14px;font-size:13px">
          ⚠ <b>Company details not set.</b> PDFs will show blank header.
          <button onclick="openCompanySettingsModal()" style="background:none;border:none;cursor:pointer;
            color:var(--accent);font-size:13px;text-decoration:underline;padding:0;margin-left:6px">
            Set up now →</button>
        </div>`);
    }
  } catch(e){
    document.getElementById('quoteListContent').innerHTML=`<div style="color:var(--red);padding:20px">${e.message}</div>`;
  }
}

// ── Edit / New Quotation ──────────────────────────────────────────────────────
let _qData = null;   // current quotation being edited

async function renderQuotationEdit(qid){
  const isNew = !qid || qid === 'new';
  _qData = isNew ? _blankQuote() : null;

  document.getElementById('topbarActions').innerHTML = `
    <button class="btn btn-ghost" onclick="navigate('/quotations')">← Back</button>
    ${!isNew ? `<button class="btn btn-secondary" onclick="downloadQuotePDF(${qid},'')">📥 PDF</button>` : ''}
    ${!isNew ? `<button class="btn btn-danger" onclick="deleteQuotation(${qid},'${_qData?.quote_number||''}')">🗑 Delete</button>` : ''}
    <button class="btn btn-primary" id="qSaveBtn" onclick="saveQuotation()">
      ${isNew ? 'Create' : 'Save'}
    </button>`;

  document.getElementById('content').innerHTML = `<div style="color:var(--muted)">Loading…</div>`;

  try {
    const [customers, settings] = await Promise.all([
      api('GET', '/api/customers'),
      api('GET', '/api/company-settings').catch(()=>({})),
    ]);

    if(!isNew){
      _qData = await api('GET', `/api/quotations/${qid}`);
    } else {
      // Pre-fill individual fields from company defaults
      _qData.delivery_time  = settings.default_delivery_time  || '';
      _qData.payment_terms  = settings.default_payment_terms  || '';
      _qData.pan_no         = settings.default_pan_no         || '';
      _qData.packing_cost   = settings.default_packing_cost   || '';
      _qData.bank_details   = settings.default_bank_details   || '';
      _qData.message        = settings.default_message        || '';
      _qData.terms          = '';
    }

    const custOpts = customers.map(cu =>
      `<option value="${cu.id}" data-name="${escHtml(cu.name)}"
        data-addr="${escHtml(cu.address||'')}"
        data-gstin="${escHtml(cu.gstin||'')}"
        data-email="${escHtml(cu.email||'')}"
        data-phone="${escHtml(cu.phone||'')}"
        ${_qData.customer_id===cu.id?'selected':''}>${escHtml(cu.name)}</option>`
    ).join('');

    const defaultTerms = settings.default_terms || "";

    document.getElementById('content').innerHTML = `
      <div style="max-width:900px;margin:0 auto;display:grid;gap:16px">

        <!-- Header row: number + status -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-size:22px;font-weight:700">${isNew ? 'New Quotation' : _qData.quote_number}</div>
            ${!isNew?`<div style="font-size:13px;color:var(--muted)">
              Created ${_qData.created_at?new Date(_qData.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):''}
            </div>`:''}
          </div>
          ${!isNew?`<select id="q_status" style="padding:7px 12px;border-radius:8px;border:1px solid var(--border);
              background:var(--card);color:var(--text);font-size:14px;font-weight:600">
            ${['draft','sent','accepted','rejected','expired'].map(s=>
              `<option value="${s}" ${_qData.status===s?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`
            ).join('')}
          </select>`:''}
        </div>

        <!-- Customer block -->
        <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px">
          <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:14px">Customer</div>
          <div class="form-row cols-2">
            <div class="form-group">
              <div class="fld-label">Select Customer</div>
              <select id="q_cust_id" onchange="qAutoFillCustomer(this)">
                <option value="">— Manual entry —</option>
                ${custOpts}
              </select>
            </div>
            <div class="form-group">
              <div class="fld-label">Customer Name *</div>
              <input id="q_cust_name" value="${escHtml(_qData.customer_name||'')}" placeholder="Company / Individual name">
            </div>
          </div>
          <div class="form-group">
            <div class="fld-label">Address</div>
            <textarea id="q_cust_addr" style="min-height:70px;resize:vertical"
              placeholder="Street, City, State, PIN">${escHtml(_qData.customer_address||'')}</textarea>
          </div>
          <div class="form-row cols-3">
            <div class="form-group">
              <div class="fld-label">GSTIN</div>
              <input id="q_cust_gstin" value="${escHtml(_qData.customer_gstin||'')}" placeholder="22XXXXX">
            </div>
            <div class="form-group">
              <div class="fld-label">Email</div>
              <input id="q_cust_email" type="email" value="${escHtml(_qData.customer_email||'')}" placeholder="contact@company.com">
            </div>
            <div class="form-group">
              <div class="fld-label">Phone</div>
              <input id="q_cust_phone" value="${escHtml(_qData.customer_phone||'')}" placeholder="+91 98765 43210">
            </div>
          </div>
        </div>

        <!-- Line items -->
        <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)">Items</div>
            <button class="btn btn-secondary" style="font-size:12px;padding:5px 12px" onclick="qAddItem()">+ Add Item</button>
          </div>

          <!-- Column headers -->
          <div style="display:grid;grid-template-columns:3fr 70px 80px 110px 110px 36px;gap:8px;
               padding:0 4px 8px;border-bottom:1px solid var(--border);margin-bottom:8px">
            ${['Description','Qty','Unit','Unit Price','Amount',''].map(h=>
              `<div style="font-size:11px;font-weight:600;color:var(--muted)">${h}</div>`
            ).join('')}
          </div>

          <div id="qItemsWrap"></div>

          <!-- Totals -->
          <div style="margin-top:18px;display:flex;justify-content:flex-end">
            <div style="width:280px">
              <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:13px">
                <span style="color:var(--muted)">Subtotal</span>
                <span id="q_subtotal" style="font-family:var(--mono);font-weight:600">₹0.00</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:13px">
                <span style="color:var(--muted)">Discount %</span>
                <input id="q_disc" type="number" min="0" max="100" step="0.5"
                  value="${_qData.discount_pct||0}" oninput="qRecalc()"
                  style="width:70px;text-align:right;font-size:13px">
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:13px">
                <span style="color:var(--muted)">GST %</span>
                <input id="q_tax" type="number" min="0" max="30" step="0.5"
                  value="${_qData.tax_pct||18}" oninput="qRecalc()"
                  style="width:70px;text-align:right;font-size:13px">
              </div>
              <div style="height:1px;background:var(--border);margin:8px 0"></div>
              <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:16px;font-weight:700">
                <span>Total</span>
                <span id="q_total" style="font-family:var(--mono);color:var(--accent)">₹0.00</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Validity & Notes -->
        <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px">
          <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:14px">Details & Terms</div>
          <div class="form-row cols-2">
            <div class="form-group">
              <div class="fld-label">Validity (days)</div>
              <input id="q_validity" type="number" min="7" max="365" value="${_qData.validity_days||30}">
            </div>
            <div class="form-group">
              <div class="fld-label">Currency</div>
              <select id="q_currency">
                ${['INR','USD','EUR','AED','GBP'].map(cur=>
                  `<option value="${cur}" ${(_qData.currency||'INR')===cur?'selected':''}>${cur}</option>`
                ).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <div class="fld-label">Message to Customer
              <span style="font-size:11px;color:var(--muted);font-weight:400"> — appears above the table in the PDF</span>
            </div>
            <textarea id="q_message" style="min-height:70px;resize:vertical"
              placeholder="e.g. As per your kind request, we are pleased to submit our best proposal...">${escHtml(_qData.message||'')}</textarea>
          </div>
          <div class="form-group">
            <div class="fld-label">Additional Notes
              <span style="font-size:11px;color:var(--muted);font-weight:400"> — shown inside Terms &amp; Conditions block in PDF</span>
            </div>
            <textarea id="q_notes" style="min-height:70px;resize:vertical"
              placeholder="Any per-quotation note, e.g. special discount, custom delivery...">${escHtml(_qData.notes||'')}</textarea>
          </div>
        </div>

        <!-- Action buttons -->
        <div style="display:flex;gap:10px;justify-content:flex-end;padding-bottom:40px;flex-wrap:wrap">
          <button class="btn btn-ghost" onclick="navigate('/quotations')">Cancel</button>
          ${!isNew?`<button class="btn btn-secondary" onclick="downloadQuotePDF(${qid},'${_qData.quote_number}')">📥 Download PDF</button>`:''}
          <button class="btn btn-primary" id="qSaveBtn2" onclick="saveQuotation()">
            ${isNew?'Create Quotation':'Save Changes'}
          </button>
        </div>
      </div>`;

    // Render existing items
    (_qData.line_items||[]).forEach(item => _qAddItemRow(item));
    if(!_qData.line_items?.length) _qAddItemRow();
    qRecalc();

  } catch(e){
    document.getElementById('content').innerHTML=`<div style="color:var(--red);padding:20px">${e.message}</div>`;
  }
}

function _blankQuote(){
  return { customer_name:'', customer_address:'', customer_gstin:'',
           customer_email:'', customer_phone:'', customer_id: null,
           line_items:[], discount_pct:0, tax_pct:18, total:0, subtotal:0,
           validity_days:30, currency:'INR', notes:'', terms:'', status:'draft' };
}

// ── Customer auto-fill ────────────────────────────────────────────────────────
function qAutoFillCustomer(sel){
  const opt = sel.options[sel.selectedIndex];
  if(!opt.value) return;
  document.getElementById('q_cust_name').value  = opt.getAttribute('data-name')  || '';
  document.getElementById('q_cust_addr').value  = opt.getAttribute('data-addr')  || '';
  document.getElementById('q_cust_gstin').value = opt.getAttribute('data-gstin') || '';
  document.getElementById('q_cust_email').value = opt.getAttribute('data-email') || '';
  document.getElementById('q_cust_phone').value = opt.getAttribute('data-phone') || '';
}

// ── Line items ────────────────────────────────────────────────────────────────
let _qItemCount = 0;

function qAddItem(){ _qAddItemRow(null); }

function _qAddItemRow(item){
  const id = ++_qItemCount;
  const wrap = document.getElementById('qItemsWrap');
  if(!wrap) return;
  const div = document.createElement('div');
  div.id = `qi_${id}`;
  div.style.cssText = 'display:grid;grid-template-columns:3fr 70px 80px 110px 110px 36px;gap:8px;margin-bottom:8px;align-items:start';
  div.innerHTML = `
    <div>
      <input id="qi_desc_${id}" value="${escHtml(item?.desc||item?.description||'')}"
        placeholder="Product / service description" style="width:100%;font-weight:600" oninput="qRecalc()">
      <input id="qi_notes_${id}" value="${escHtml(item?.notes||'')}"
        placeholder="Additional details (optional)" style="width:100%;font-size:12px;margin-top:4px;color:var(--text-soft)" oninput="qRecalc()">
    </div>
    <input id="qi_qty_${id}" type="number" min="0" step="0.5"
      value="${item?.qty||item?.quantity||1}" oninput="qRecalcItem(${id})" style="text-align:center">
    <input id="qi_unit_${id}" value="${escHtml(item?.unit||'pcs')}" style="text-align:center">
    <input id="qi_up_${id}" type="number" min="0" step="100"
      value="${item?.unit_price||0}" oninput="qRecalcItem(${id})" style="text-align:right">
    <input id="qi_amt_${id}" type="number" min="0" step="100"
      value="${item?.amount||0}" readonly style="text-align:right;background:var(--surface);cursor:default">
    <button onclick="qRemoveItem(${id})"
      style="background:none;border:none;color:var(--red);cursor:pointer;font-size:18px;padding:8px 0;line-height:1">×</button>`;
  wrap.appendChild(div);
  qRecalcItem(id);
}

function qRemoveItem(id){
  document.getElementById(`qi_${id}`)?.remove();
  qRecalc();
}

function qRecalcItem(id){
  const qty = parseFloat(document.getElementById(`qi_qty_${id}`)?.value)||0;
  const up  = parseFloat(document.getElementById(`qi_up_${id}`)?.value)||0;
  const amt = Math.round(qty * up * 100) / 100;
  const amtEl = document.getElementById(`qi_amt_${id}`);
  if(amtEl) amtEl.value = amt.toFixed(2);
  qRecalc();
}

function _collectItems(){
  const items = [];
  document.querySelectorAll('[id^="qi_desc_"]').forEach(el => {
    const id  = el.id.replace('qi_desc_','');
    if(!document.getElementById(`qi_${id}`)) return;
    const qty = parseFloat(document.getElementById(`qi_qty_${id}`)?.value)||0;
    const up  = parseFloat(document.getElementById(`qi_up_${id}`)?.value)||0;
    const amt = parseFloat(document.getElementById(`qi_amt_${id}`)?.value)||0;
    items.push({
      desc:       document.getElementById(`qi_desc_${id}`)?.value.trim()||'',
      notes:      document.getElementById(`qi_notes_${id}`)?.value.trim()||'',
      qty, unit:  document.getElementById(`qi_unit_${id}`)?.value||'pcs',
      unit_price: up, amount: amt,
    });
  });
  return items.filter(i=>i.desc||i.amount);
}

function qRecalc(){
  const items     = _collectItems();
  const subtotal  = items.reduce((s,i)=>s+i.amount,0);
  const disc_pct  = parseFloat(document.getElementById('q_disc')?.value)||0;
  const tax_pct   = parseFloat(document.getElementById('q_tax')?.value)||18;
  const disc_amt  = Math.round(subtotal * disc_pct / 100 * 100)/100;
  const tax_base  = subtotal - disc_amt;
  const tax_amt   = Math.round(tax_base * tax_pct / 100 * 100)/100;
  const total     = Math.round((tax_base + tax_amt)*100)/100;
  const fmt = v => `₹${v.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const st = document.getElementById('q_subtotal');
  const tt = document.getElementById('q_total');
  if(st) st.textContent = fmt(subtotal);
  if(tt) tt.textContent = fmt(total);
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function saveQuotation(){
  const custName = document.getElementById('q_cust_name')?.value.trim();
  if(!custName){ toast('Customer name is required','error'); return; }

  const items    = _collectItems();
  const subtotal = items.reduce((s,i)=>s+i.amount,0);
  const disc_pct = parseFloat(document.getElementById('q_disc')?.value)||0;
  const tax_pct  = parseFloat(document.getElementById('q_tax')?.value)||18;

  const custSel  = document.getElementById('q_cust_id');
  const custId   = custSel?.value ? parseInt(custSel.value) : null;

  const data = {
    customer_id:      custId,
    customer_name:    custName,
    customer_address: document.getElementById('q_cust_addr')?.value.trim()||'',
    customer_gstin:   document.getElementById('q_cust_gstin')?.value.trim()||'',
    customer_email:   document.getElementById('q_cust_email')?.value.trim()||'',
    customer_phone:   document.getElementById('q_cust_phone')?.value.trim()||'',
    line_items:       items,
    discount_pct:     disc_pct,
    tax_pct:          tax_pct,
    validity_days:    parseInt(document.getElementById('q_validity')?.value)||30,
    currency:         document.getElementById('q_currency')?.value||'INR',
    message:          document.getElementById('q_message')?.value.trim()||'',
    delivery_time:    _qData?.delivery_time  || '',
    payment_terms:    _qData?.payment_terms  || '',
    pan_no:           _qData?.pan_no         || '',
    packing_cost:     _qData?.packing_cost   || '',
    bank_details:     _qData?.bank_details   || '',
    notes:            document.getElementById('q_notes')?.value.trim()||'',
    terms:            _qData?.terms || '',
  };

  const statusEl = document.getElementById('q_status');
  if(statusEl) data.status = statusEl.value;

  const isNew = !_qData?.id;
  const btnId = isNew ? 'qSaveBtn' : 'qSaveBtn2';
  setLoading(btnId, true);
  try {
    let saved;
    if(isNew){
      saved = await api('POST','/api/quotations', data);
    } else {
      saved = await api('PUT',`/api/quotations/${_qData.id}`, data);
    }
    toast(isNew ? `Quotation ${saved.quote_number} created!` : 'Saved!', 'success');
    if(isNew) navigate(`/quotations/${saved.id}`);
    else _qData = saved;
  } catch(e){ toast(e.message,'error'); }
  finally{ setLoading(btnId||'qSaveBtn', false); }
}

// ── PDF Download ──────────────────────────────────────────────────────────────
async function downloadQuotePDF(qid, qnum){
  try {
    const token = authGetToken();
    const res = await fetch(`/api/quotations/${qid}/pdf`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if(!res.ok){
      const j = await res.json().catch(()=>({}));
      throw new Error(j.detail || 'PDF generation failed');
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = (qnum||'quotation') + '.pdf';
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 1000);
    toast('PDF downloaded!', 'success');
  } catch(e){ toast(e.message,'error'); }
}

// ── Company Settings Modal ────────────────────────────────────────────────────
async function openCompanySettingsModal(){
  let s = {};
  try{ s = await api('GET','/api/company-settings'); } catch{}
  showModal('Company Settings', `
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px">
      Company details appear in every PDF. Quotation defaults pre-fill every new quote.
    </div>

    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
         color:var(--muted);margin-bottom:10px">Company Information</div>
    <div class="form-group">
      <div class="fld-label">Company Name *</div>
      <input id="cs_name" value="${escHtml(s.company_name||'')}" placeholder="Yukeng Mould & Die">
    </div>
    <div class="form-group">
      <div class="fld-label">Address</div>
      <textarea id="cs_addr" style="min-height:60px;resize:vertical"
        placeholder="Street, City, State, PIN">${escHtml(s.company_address||'')}</textarea>
    </div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">GSTIN</div>
        <input id="cs_gstin" value="${escHtml(s.company_gstin||'')}" placeholder="22XXXXX...">
      </div>
      <div class="form-group">
        <div class="fld-label">Email</div>
        <input id="cs_email" value="${escHtml(s.company_email||'')}" placeholder="info@company.com">
      </div>
    </div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Phone</div>
        <input id="cs_phone" value="${escHtml(s.company_phone||'')}" placeholder="+91 99999 88888">
      </div>
      <div class="form-group">
        <div class="fld-label">Website</div>
        <input id="cs_website" value="${escHtml(s.company_website||'')}" placeholder="www.yukeng.com">
      </div>
    </div>

    <div style="height:1px;background:var(--border);margin:14px 0"></div>
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
         color:var(--muted);margin-bottom:10px">Quotation Defaults
      <span style="font-size:10px;font-weight:400;text-transform:none;letter-spacing:0;color:var(--muted)">
        — pre-filled on every new quotation
      </span>
    </div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Delivery Time</div>
        <input id="cs_delivery_time" value="${escHtml(s.default_delivery_time||'')}"
          placeholder="e.g. 30 days after receiving PO">
      </div>
      <div class="form-group">
        <div class="fld-label">Payment Terms</div>
        <input id="cs_payment_terms" value="${escHtml(s.default_payment_terms||'')}"
          placeholder="e.g. 30% advance, balance before dispatch">
      </div>
    </div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">PAN No</div>
        <input id="cs_pan_no" value="${escHtml(s.default_pan_no||'')}" placeholder="e.g. AAACY4135H">
      </div>
      <div class="form-group">
        <div class="fld-label">Packing Cost</div>
        <input id="cs_packing_cost" value="${escHtml(s.default_packing_cost||'')}"
          placeholder="e.g. Included">
      </div>
    </div>
    <div class="form-group">
      <div class="fld-label">Bank Details</div>
      <textarea id="cs_bank_details" style="min-height:60px;resize:vertical"
        placeholder="Bank Name, Branch, Account No, IFSC Code">${escHtml(s.default_bank_details||'')}</textarea>
    </div>
    <div class="form-group">
      <div class="fld-label">Message to Customer</div>
      <textarea id="cs_message" style="min-height:60px;resize:vertical"
        placeholder="e.g. As per your kind request, we are pleased to submit our best proposal...">${escHtml(s.default_message||'')}</textarea>
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" id="csSaveBtn" onclick="saveCompanySettings()">Save Settings</button>`
  );
}

async function saveCompanySettings(){
  const data = {
    company_name:           document.getElementById('cs_name')?.value.trim()||'',
    company_address:        document.getElementById('cs_addr')?.value.trim()||'',
    company_gstin:          document.getElementById('cs_gstin')?.value.trim()||'',
    company_email:          document.getElementById('cs_email')?.value.trim()||'',
    company_phone:          document.getElementById('cs_phone')?.value.trim()||'',
    company_website:        document.getElementById('cs_website')?.value.trim()||'',
    default_delivery_time:  document.getElementById('cs_delivery_time')?.value.trim()||'',
    default_payment_terms:  document.getElementById('cs_payment_terms')?.value.trim()||'',
    default_pan_no:         document.getElementById('cs_pan_no')?.value.trim()||'',
    default_packing_cost:   document.getElementById('cs_packing_cost')?.value.trim()||'',
    default_bank_details:   document.getElementById('cs_bank_details')?.value.trim()||'',
    default_message:        document.getElementById('cs_message')?.value.trim()||'',
  };
  setLoading('csSaveBtn',true);
  try{
    await api('PUT','/api/company-settings', data);
    toast('Company settings saved!','success');
    closeModal();
    _loadQuoteList();
  } catch(e){ toast(e.message,'error'); }
  finally{ setLoading('csSaveBtn',false); }
}

async function deleteQuotation(qid, qnum){
  const label = qnum || `#${qid}`;
  const ok = await confirm2(`Delete quotation ${label}? This cannot be undone.`, 'Delete Quotation');
  if(!ok) return;
  try{
    await api('DELETE', `/api/quotations/${qid}`);
    toast(`Quotation ${label} deleted`);
    navigate('/quotations');
  } catch(e){ toast(e.message, 'error'); }
}
