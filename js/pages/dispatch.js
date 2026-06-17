/**
 * Dolphin ERP — Daily Dispatch Sheet
 *
 * Manager workflow (every day before leaving at ~8 PM):
 *   1. Open Dispatch page → see tomorrow's scheduled ops grouped by worker
 *   2. Tick / untick individual tasks to include in the printout
 *   3. Click "Print" → browser print dialog opens
 *      → Each worker gets their own section on paper (page-break between workers)
 *      → Paper shows: worker name, machine, job, op, time window, est. duration, blank "Sign" column
 *
 * The supervisor uses these printed sheets to start/stop tasks for each worker.
 */

// ─── module state ────────────────────────────────────────────────────────────
let _dispatchDate    = null;   // YYYY-MM-DD currently loaded
let _dispatchOps     = [];     // raw ops from API
let _dispatchSelected = new Set(); // op_ids included in the printout
let _dispatchLogo    = null;   // base64 data URL — fetched once per page visit

// ─── entry point (called by router) ─────────────────────────────────────────
async function renderDispatch() {
  // Default to tomorrow
  const tomorrow = new Date(istNow());
  tomorrow.setDate(tomorrow.getDate() + 1);
  _dispatchDate = tomorrow.toISOString().slice(0, 10);

  document.getElementById('topbarActions').innerHTML = `
    <input type="date" id="dispatchDateInput" value="${_dispatchDate}"
      style="font-size:13px;padding:5px 8px;border:1px solid var(--border);
             border-radius:6px;background:var(--surface);color:var(--text);cursor:pointer"
      onchange="onDispatchDateChange(this.value)">
    <button class="btn btn-secondary" onclick="dispatchSelectAll(true)" title="Select all tasks">☑ All</button>
    <button class="btn btn-ghost"     onclick="dispatchSelectAll(false)" title="Deselect all">☐ None</button>
    <button class="btn btn-primary"   onclick="dispatchPrint()" title="Print work cards">🖨 Print</button>`;

  // Fire logo fetch in parallel with the dispatch load — non-blocking, cached
  // for the rest of the session so subsequent prints are instant.
  if (_dispatchLogo === null) {
    api('GET', '/api/company-logo')
      .then(r => { _dispatchLogo = r?.data_url || ''; })
      .catch(() => { _dispatchLogo = ''; });
  }

  await loadDispatch(_dispatchDate);
}

async function onDispatchDateChange(val) {
  _dispatchDate = val;
  await loadDispatch(val);
}

async function loadDispatch(date) {
  const el = document.getElementById('content');
  el.innerHTML = `<div style="color:var(--muted);padding:20px">Loading…</div>`;

  try {
    _dispatchOps = await api('GET', `/api/dispatch?date=${date}`);
  } catch(e) {
    el.innerHTML = `<div class="empty">${e.message}</div>`;
    return;
  }

  // On fresh load → select all ops
  _dispatchSelected = new Set(_dispatchOps.map(o => o.op_id));

  renderDispatchUI();
}

function renderDispatchUI() {
  const el = document.getElementById('content');
  const ops = _dispatchOps;

  if (!ops.length) {
    el.innerHTML = `<div class="card"><div class="empty">
      No operations scheduled for ${fmtDate(_dispatchDate)}.<br>
      Run <b>Schedule All</b> on the Jobs page first.
    </div></div>`;
    return;
  }

  // Group by worker
  const byWorker = {};
  ops.forEach(op => {
    const w = op.worker_name || 'Unassigned';
    if (!byWorker[w]) byWorker[w] = [];
    byWorker[w].push(op);
  });

  const workerNames = Object.keys(byWorker).sort();
  const totalSelected = ops.filter(o => _dispatchSelected.has(o.op_id)).length;
  const dateLabel = fmtDate(_dispatchDate);

  let html = `
    <div style="display:flex;align-items:center;justify-content:space-between;
                margin-bottom:14px;gap:10px;flex-wrap:wrap">
      <div>
        <div style="font-size:16px;font-weight:700">Work Card — ${dateLabel}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">
          ${workerNames.length} worker${workerNames.length!==1?'s':''} ·
          <span id="dispatchSelCount">${totalSelected}</span> of ${ops.length} tasks selected
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--muted)">Select tasks to include in printout:</span>
      </div>
    </div>`;

  workerNames.forEach(worker => {
    const wops = byWorker[worker];
    const allChecked = wops.every(o => _dispatchSelected.has(o.op_id));
    const anyChecked = wops.some(o => _dispatchSelected.has(o.op_id));
    const indeterminate = anyChecked && !allChecked;

    html += `
      <div class="card" style="margin-bottom:14px;overflow:hidden">
        <!-- Worker header -->
        <div style="display:flex;align-items:center;justify-content:space-between;
                    padding:10px 14px;background:var(--surface);
                    border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:10px">
            <input type="checkbox" id="wcheck_${escAttr(worker)}"
              ${allChecked?'checked':''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)"
              onchange="dispatchToggleWorker('${escAttr(worker)}', this.checked)">
            <label for="wcheck_${escAttr(worker)}"
              style="font-size:14px;font-weight:700;cursor:pointer">👷 ${escHtml(worker)}</label>
          </div>
          <div style="font-size:11px;color:var(--muted)">
            ${wops.length} task${wops.length!==1?'s':''} ·
            ${fmtMins(wops.reduce((a,o)=>a+(o.est_mins||0),0))} total
          </div>
        </div>

        <!-- Ops table -->
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="background:var(--surface-2,var(--surface))">
                <th style="${thStyle()}width:36px;text-align:center">✓</th>
                <th style="${thStyle()}">Time</th>
                <th style="${thStyle()}">Job / Order</th>
                <th style="${thStyle()}">Operation</th>
                <th style="${thStyle()}">Machine</th>
                <th style="${thStyle()}text-align:right">Est.</th>
              </tr>
            </thead>
            <tbody>
              ${wops.map(op => renderDispatchRow(op)).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  });

  el.innerHTML = html;

  // Fix indeterminate checkboxes (can't set via HTML attribute)
  workerNames.forEach(worker => {
    const wops = byWorker[worker];
    const allC = wops.every(o => _dispatchSelected.has(o.op_id));
    const anyC = wops.some(o => _dispatchSelected.has(o.op_id));
    const cb = document.getElementById(`wcheck_${worker}`);
    if (cb) cb.indeterminate = anyC && !allC;
  });
}

function thStyle() {
  return `padding:6px 10px;font-size:11px;font-weight:600;color:var(--muted);
          text-align:left;border-bottom:1px solid var(--border);white-space:nowrap;`;
}

function renderDispatchRow(op) {
  const checked  = _dispatchSelected.has(op.op_id);
  const isUrgent = op.priority;
  const isOut    = op.op_type === 'outside';

  const startFmt = op.scheduled_start
    ? new Date(op.scheduled_start.replace(' ','T')+'').toLocaleTimeString('en-IN',
        {hour:'2-digit',minute:'2-digit',hour12:true})
    : '—';
  const endFmt = op.scheduled_end
    ? new Date(op.scheduled_end.replace(' ','T')+'').toLocaleTimeString('en-IN',
        {hour:'2-digit',minute:'2-digit',hour12:true})
    : '—';

  const rowBg = !checked ? 'opacity:0.45;' : '';
  const urgentBadge = isUrgent
    ? `<span style="color:var(--red);font-size:10px;margin-left:4px">🚨</span>` : '';
  const outsideBadge = isOut
    ? `<span style="background:var(--amber-soft);color:var(--amber);font-size:10px;
                   border-radius:3px;padding:1px 5px;margin-left:4px">OUT</span>` : '';

  const subLabel = op.assembly_context
    ? `<div style="font-size:10px;color:var(--accent)">${escHtml(op.assembly_context)}</div>` : '';

  return `<tr style="border-bottom:1px solid var(--border);${rowBg}transition:opacity .15s"
             id="drow_${op.op_id}">
    <td style="padding:8px 10px;text-align:center">
      <input type="checkbox" ${checked?'checked':''}
        style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)"
        onchange="dispatchToggleOp(${op.op_id}, this.checked)">
    </td>
    <td style="padding:8px 10px;font-family:var(--mono);font-size:12px;white-space:nowrap;color:var(--accent)">
      ${startFmt}<br><span style="color:var(--muted)">${endFmt}</span>
    </td>
    <td style="padding:8px 10px;min-width:0">
      <div style="font-size:12px;font-family:var(--mono);font-weight:600">${escHtml(op.job_number)}</div>
      ${op.order_context ? `<div style="font-size:10px;color:var(--muted);font-family:var(--mono);margin-top:1px">${escHtml(op.order_context)}</div>` : ''}
      <div style="font-size:12px;font-weight:600;margin-top:2px">${escHtml(op.product_name || '')}</div>
      ${subLabel}
      <div style="font-size:11px;color:var(--muted)">${escHtml(op.customer)}</div>
    </td>
    <td style="padding:8px 10px">
      <span style="font-size:13px;font-weight:600">${escHtml(op.op_name)}</span>
      ${urgentBadge}${outsideBadge}
      ${isOut && op.outside_vendor ? `<div style="font-size:11px;color:var(--muted)">→ ${escHtml(op.outside_vendor)}</div>` : ''}
    </td>
    <td style="padding:8px 10px;font-size:12px;color:var(--muted)">${escHtml(op.wc_name)}</td>
    <td style="padding:8px 10px;text-align:right;white-space:nowrap;font-family:var(--mono);font-size:12px">
      ${fmtMins(op.est_mins)}
    </td>
  </tr>`;
}

// ─── selection helpers ────────────────────────────────────────────────────────
function dispatchToggleOp(opId, checked) {
  if (checked) _dispatchSelected.add(opId);
  else         _dispatchSelected.delete(opId);
  // Update the row opacity live
  const row = document.getElementById(`drow_${opId}`);
  if (row) row.style.opacity = checked ? '' : '0.45';
  updateDispatchSelCount();
  // Recompute worker checkbox state
  _syncWorkerCheckboxes();
}

function dispatchToggleWorker(worker, checked) {
  const wops = _dispatchOps.filter(o => (o.worker_name||'Unassigned') === worker);
  wops.forEach(op => {
    if (checked) _dispatchSelected.add(op.op_id);
    else         _dispatchSelected.delete(op.op_id);
    const row = document.getElementById(`drow_${op.op_id}`);
    if (row) row.style.opacity = checked ? '' : '0.45';
    // sync individual row checkboxes
    const cb = row?.querySelector('input[type=checkbox]');
    if (cb) cb.checked = checked;
  });
  updateDispatchSelCount();
}

function dispatchSelectAll(checked) {
  _dispatchOps.forEach(op => {
    if (checked) _dispatchSelected.add(op.op_id);
    else         _dispatchSelected.delete(op.op_id);
  });
  // re-render is lightest here since all states change
  renderDispatchUI();
}

function _syncWorkerCheckboxes() {
  const byWorker = {};
  _dispatchOps.forEach(op => {
    const w = op.worker_name || 'Unassigned';
    if (!byWorker[w]) byWorker[w] = [];
    byWorker[w].push(op);
  });
  Object.entries(byWorker).forEach(([worker, wops]) => {
    const cb = document.getElementById(`wcheck_${worker}`);
    if (!cb) return;
    const all = wops.every(o => _dispatchSelected.has(o.op_id));
    const any = wops.some(o  => _dispatchSelected.has(o.op_id));
    cb.checked       = all;
    cb.indeterminate = any && !all;
  });
}

function updateDispatchSelCount() {
  const el = document.getElementById('dispatchSelCount');
  if (el) el.textContent = _dispatchSelected.size;
}

// ─── formatting helpers ───────────────────────────────────────────────────────
function fmtMins(mins) {
  if (!mins && mins !== 0) return '—';
  const m = Math.round(mins);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
}

function escAttr(s) {
  return String(s).replace(/["'<>&\s]/g, c => ({'\"':'&quot;',"'":'&#39;','<':'&lt;','>':'&gt;','&':'&amp;',' ':'_'}[c]||c));
}

// ─── PRINT — Apple-styled trilingual dispatch sheet ───────────────────────────
//
// Design notes:
//  • System font stack mirrors Apple (-apple-system / SF Pro), with Noto Sans
//    Devanagari + Gujarati as fallbacks so Hindi/Gujarati text renders cleanly
//    on any OS (these are bundled on macOS and most modern Windows installs;
//    Linux falls back to whatever DejaVu/Lohit fonts are available).
//  • Borderless layout — Apple-style. Hairline dividers between rows instead of
//    a grid of boxes. The "table" is really a series of rows with subtle bottom
//    borders, giving a cleaner, less spreadsheet-y feel on paper.
//  • Trilingual labels are stacked: small grey English caps on top, then Hindi
//    in regular weight, then Gujarati. Proper nouns (worker, customer, machine,
//    job number, operation name) remain unchanged — those are data, not labels.
//  • Generous whitespace and larger numbers so the supervisor can scan the
//    sheet at arm's length on the shop floor.

// ─── label translations ──────────────────────────────────────────────────────
// Key = English label. Value = [Hindi (Devanagari), Gujarati]
const DISPATCH_I18N = {
  'Work Card':           ['कार्य कार्ड',       'કાર્ય કાર્ડ'],
  'Worker':              ['कारीगर',          'કારીગર'],
  'Date':                ['तारीख',           'તારીખ'],
  'Tasks':               ['कार्य',            'કાર્યો'],
  'Total':               ['कुल समय',          'કુલ સમય'],
  '#':                   ['क्र.',             'ક્રમ'],
  'Time':                ['समय',             'સમય'],
  'Job':                 ['जॉब',              'જોબ'],
  'Operation':           ['काम',              'કામ'],
  'Machine':             ['मशीन',            'મશીન'],
  'Est.':                ['अनुमान',           'અંદાજ'],
  'Actual Start':        ['वास्तविक शुरू',     'ખરી શરૂઆત'],
  'Actual End':          ['वास्तविक खत्म',    'ખરી પૂર્ણ'],
  'Sign':                ['हस्ताक्षर',         'સહી'],
  'Supervisor Sign':     ['सुपरवाइज़र हस्ताक्षर', 'સુપરવાઇઝરની સહી'],
  'Remarks':             ['टिप्पणी',           'નોંધ'],
  'Urgent':              ['ज़रूरी',            'તાત્કાલિક'],
  'Outside':             ['बाहर',             'બહાર'],
  'Half Day':            ['आधा दिन',          'અડધો દિવસ'],
  'Closes 2 PM':         ['2 बजे बंद',         '2 વાગે બંધ'],
  'Send to vendor':      ['वेंडर को भेजें',     'વેન્ડરને મોકલવું'],
  'Note':                ['नोट',              'નોંધ'],
  'Shift':               ['शिफ्ट',            'શિફ્ટ'],
  'Lunch':               ['भोजन',             'ભોજન'],
};

// Render a TABLE HEADER cell with English bold on top, then Hindi & Gujarati
// as small footnote captions. Cleaner than 3 stacked equal-weight lines.
function _triLabel(en) {
  const tr = DISPATCH_I18N[en] || ['', ''];
  return `<div class="lbl-en">${en}</div>
          <div class="lbl-cap"><span class="lbl-hi">${tr[0]}</span> <span class="lbl-sep">/</span> <span class="lbl-gu">${tr[1]}</span></div>`;
}

// Render a SECTION LABEL (e.g. "Worker") — English on top, local scripts
// combined on a single small line below. Saves vertical space versus three
// separate stacked lines, while keeping all three readable.
function _triInline(en) {
  const tr = DISPATCH_I18N[en] || ['', ''];
  return `<span class="inline-en">${en}</span>
          <span class="inline-cap"><span class="inline-hi">${tr[0]}</span> <span class="inline-sep">/</span> <span class="inline-gu">${tr[1]}</span></span>`;
}

// Day-of-week translations — for the date strip
const DOW_HI = ['रविवार','सोमवार','मंगलवार','बुधवार','गुरुवार','शुक्रवार','शनिवार'];
const DOW_GU = ['રવિવાર','સોમવાર','મંગળવાર','બુધવાર','ગુરુવાર','શુક્રવાર','શનિવાર'];
const MONTH_HI = ['जनवरी','फरवरी','मार्च','अप्रैल','मई','जून','जुलाई','अगस्त','सितंबर','अक्तूबर','नवंबर','दिसंबर'];
const MONTH_GU = ['જાન્યુઆરી','ફેબ્રુઆરી','માર્ચ','એપ્રિલ','મે','જૂન','જુલાઈ','ઓગસ્ટ','સપ્ટેમ્બર','ઓક્ટોબર','નવેમ્બર','ડિસેમ્બર'];

function _fmtDateTri(iso) {
  if (!iso) return { en:'', hi:'', gu:'' };
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDate(), m = d.getMonth(), y = d.getFullYear(), dow = d.getDay();
  const en = d.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const hi = `${DOW_HI[dow]}, ${day} ${MONTH_HI[m]} ${y}`;
  const gu = `${DOW_GU[dow]}, ${day} ${MONTH_GU[m]} ${y}`;
  return { en, hi, gu };
}

function dispatchPrint() {
  const ops = _dispatchOps.filter(o => _dispatchSelected.has(o.op_id));
  if (!ops.length) { toast('No tasks selected', 'error'); return; }

  const dateTri = _fmtDateTri(_dispatchDate);

  // Wednesday is a half-day at the shop (closes 2 PM, no lunch break).
  // Show a banner so workers/supervisors aren't surprised when work ends early.
  const isWednesday = _dispatchDate
    ? new Date(_dispatchDate + 'T00:00:00').getDay() === 3
    : false;

  // Group by worker
  const byWorker = {};
  ops.forEach(op => {
    const w = op.worker_name || 'Unassigned';
    if (!byWorker[w]) byWorker[w] = [];
    byWorker[w].push(op);
  });

  const workerNames = Object.keys(byWorker).sort();

  const workerSections = workerNames.map((worker, wIdx) => {
    const wops = byWorker[worker];
    const totalMins = wops.reduce((a,o) => a + (o.est_mins||0), 0);

    const rows = wops.map((op, i) => {
      const startFmt = op.scheduled_start
        ? new Date(op.scheduled_start.replace(' ','T')+'').toLocaleTimeString('en-IN',
            {hour:'2-digit',minute:'2-digit',hour12:true})
        : '—';
      const endFmt = op.scheduled_end
        ? new Date(op.scheduled_end.replace(' ','T')+'').toLocaleTimeString('en-IN',
            {hour:'2-digit',minute:'2-digit',hour12:true})
        : '—';

      const isOut = op.op_type === 'outside';

      const tags = [];
      if (op.priority) tags.push(`<span class="tag tag-urgent">★ ${DISPATCH_I18N['Urgent'][0]}</span>`);
      const tagHtml = tags.length ? `<div class="tags">${tags.join('')}</div>` : '';

      // Outside ops: worker doesn't do this work — they coordinate sending the
      // piece out to a vendor. Banner + dimmed row makes it visually clear.
      const outsideBanner = isOut
        ? `<div class="out-banner">
             <span class="out-en">↗ Send to vendor${op.outside_vendor?': '+escHtml(op.outside_vendor):''}</span>
             <span class="out-cap">
               <span class="out-hi">${DISPATCH_I18N['Send to vendor'][0]}</span>
               <span class="out-sep">/</span>
               <span class="out-gu">${DISPATCH_I18N['Send to vendor'][1]}</span>
             </span>
           </div>`
        : '';

      const subCtx = op.assembly_context
        ? `<div class="asm-ctx">${escHtml(op.assembly_context)}</div>` : '';

      // Order context: "ORD-2026-001  P5/8" — quiet line beneath job code
      const orderCtxHtml = op.order_context
        ? `<div class="order-ctx">${escHtml(op.order_context)}</div>` : '';

      return `<tr class="${isOut ? 'row-outside' : ''}">
        <td class="c-sn">${i+1}</td>
        <td class="c-time">
          <div class="time-start">${startFmt}</div>
          <div class="time-end">→ ${endFmt}</div>
        </td>
        <td class="c-job">
          <div class="job-num">${escHtml(op.job_number)}</div>
          ${orderCtxHtml}
          <div class="job-prod">${escHtml(op.product_name || '')}</div>
          <div class="job-cust">${escHtml(op.customer)}</div>
          ${subCtx}
        </td>
        <td class="c-op">
          <div class="op-name">${escHtml(op.op_name)}</div>
          ${outsideBanner}
          ${tagHtml}
        </td>
        <td class="c-mach">${escHtml(op.wc_name)}</td>
        <td class="c-est">${fmtMins(op.est_mins)}</td>
        <td class="c-fill"></td>
        <td class="c-fill"></td>
        <td class="c-fill"></td>
      </tr>`;
    }).join('');

    const pageBreak = wIdx < workerNames.length - 1 ? 'page-break-after:always;' : '';

    return `<div class="sheet" style="${pageBreak}">

      <!-- Hidden meta strip. Used by @page margin boxes via string-set to
           carry the worker name + date onto every printed page. As soon as
           the next worker's sheet begins, the strings re-set automatically. -->
      <div class="sheet-meta" aria-hidden="true">
        <span class="meta-worker">${escHtml(worker)}</span>
        <span class="meta-date">${dateTri.en}</span>
      </div>

      <!-- Top hero block — Apple-style, generous spacing, hierarchy of size -->
      <header class="hero">
        <div class="hero-top">
          <div class="brand">${_dispatchLogo
            ? `<img src="${_dispatchLogo}" alt="Company logo" class="brand-logo">`
            : 'YUKENG MOULD &amp; DIE'}</div>
          <div class="hero-date">
            <div class="hero-date-en">${dateTri.en}</div>
            <div class="hero-date-hi">${dateTri.hi}</div>
            <div class="hero-date-gu">${dateTri.gu}</div>
          </div>
        </div>

        <h1 class="hero-title">
          <span class="hero-title-en">Work Card</span>
          <span class="hero-title-cap">
            <span class="hero-title-hi">${DISPATCH_I18N['Work Card'][0]}</span>
            <span class="hero-title-sep">/</span>
            <span class="hero-title-gu">${DISPATCH_I18N['Work Card'][1]}</span>
          </span>
        </h1>

        <div class="worker-card">
          <div class="wc-item wc-item-worker">
            <div class="wc-lbl">${_triInline('Worker')}</div>
            <div class="wc-val worker-name">${escHtml(worker)}</div>
          </div>
          <div class="wc-sep"></div>
          <div class="wc-item">
            <div class="wc-lbl">${_triInline('Tasks')}</div>
            <div class="wc-val">${wops.length}</div>
          </div>
          <div class="wc-sep"></div>
          <div class="wc-item">
            <div class="wc-lbl">${_triInline('Total')}</div>
            <div class="wc-val">${fmtMins(totalMins)}</div>
          </div>
        </div>

        ${isWednesday ? `
        <div class="wed-banner">
          <div class="wed-icon">◐</div>
          <div class="wed-text">
            <div class="wed-en">Half Day — Closes 2 PM</div>
            <div class="wed-cap">
              <span class="wed-hi">${DISPATCH_I18N['Half Day'][0]} — ${DISPATCH_I18N['Closes 2 PM'][0]}</span>
              <span class="wed-sep">/</span>
              <span class="wed-gu">${DISPATCH_I18N['Half Day'][1]} — ${DISPATCH_I18N['Closes 2 PM'][1]}</span>
            </div>
          </div>
        </div>` : ''}
      </header>

      <!-- Tasks list — borderless, hairline rule between rows.
           Pagination strategy when ops exceed one page:
             • <thead> repeats on every overflow page automatically
             • A printed running header (via @page margin boxes) carries the
               worker name + date to every page, so a torn-off page 2 can
               still be identified.
             • Tail block (shift summary + signatures) clings to the last
               page via page-break-inside: avoid.
           See @page rules below for the running header / footer details.   -->
      <table class="ops-table">
        <thead>
          <tr>
            <th class="c-sn">${_triLabel('#')}</th>
            <th class="c-time">${_triLabel('Time')}</th>
            <th class="c-job">${_triLabel('Job')}</th>
            <th class="c-op">${_triLabel('Operation')}</th>
            <th class="c-mach">${_triLabel('Machine')}</th>
            <th class="c-est">${_triLabel('Est.')}</th>
            <th class="c-fill">${_triLabel('Actual Start')}</th>
            <th class="c-fill">${_triLabel('Actual End')}</th>
            <th class="c-fill">${_triLabel('Sign')}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <!-- Tail block: shift summary + signatures stay together as one unit,
           glued to the end of the last page (never orphaned alone on a fresh
           page, never split mid-block). -->
      <div class="sheet-tail">
        <!-- Shift timing reference -->
        <div class="shift-row">
          ${isWednesday
            ? `<div class="shift-item">
                 <span class="shift-lbl">Shift</span>
                 <span class="shift-val">8 AM – 2 PM</span>
               </div>`
            : `<div class="shift-item">
                 <span class="shift-lbl">Shift</span>
                 <span class="shift-val">8 AM – 8 PM</span>
               </div>
               <div class="shift-item">
                 <span class="shift-lbl">Lunch</span>
                 <span class="shift-val">12 – 2 PM</span>
               </div>`
          }
        </div>

        <!-- Footer signature area -->
        <footer class="sheet-foot">
          <div class="sign-block">
            <div class="sign-label">${_triInline('Supervisor Sign')}</div>
            <div class="sign-line"></div>
          </div>
          <div class="sign-block wide">
            <div class="sign-label">${_triInline('Remarks')}</div>
            <div class="sign-line"></div>
          </div>
        </footer>
      </div>
    </div>`;
  }).join('');

  const printHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Work Card — ${dateTri.en}</title>
<style>
  /* ─── Reset ─────────────────────────────────────────────────────── */
  * { box-sizing: border-box; margin: 0; padding: 0; }

  /* ─── Apple system font stack + Indic script fallbacks ──────────── */
  :root {
    --font-sys: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI',
                'Helvetica Neue', 'Arial', sans-serif;
    --font-hi:  'Noto Sans Devanagari', 'Mangal', 'Nirmala UI', var(--font-sys);
    --font-gu:  'Noto Sans Gujarati',  'Shruti', 'Nirmala UI', var(--font-sys);

    --c-ink:     #1d1d1f;     /* Apple "near-black" */
    --c-muted:   #6e6e73;     /* Apple secondary text */
    --c-faint:   #a1a1a6;     /* Apple tertiary */
    --c-line:    #d2d2d7;     /* Apple hairline */
    --c-accent:  #0071e3;     /* Apple blue */
    --c-urgent:  #d70015;
    --c-out:     #b25000;
  }

  html, body {
    font-family: var(--font-sys);
    color: var(--c-ink);
    background: #fff;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  body { font-size: 11.5pt; line-height: 1.4; }

  /* ─── Per-worker sheet (one A4 page each) ──────────────────────── */
  .sheet {
    padding: 16mm 14mm 12mm;
    min-height: 100vh;
  }

  /* ─── Hero block ───────────────────────────────────────────────── */
  .hero { margin-bottom: 8mm; }

  .hero-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 4mm;
    border-bottom: 0.4pt solid var(--c-line);
  }
  .brand {
    font-size: 8pt;
    font-weight: 600;
    letter-spacing: 0.18em;
    color: var(--c-muted);
    text-transform: uppercase;
    display: flex;
    align-items: center;
  }
  /* Logo image sits where the company name text used to. Sized for clear
     visibility but not so large it eats the page. Aspect ratio preserved. */
  .brand-logo {
    height: 18mm;
    width: auto;
    max-width: 60mm;
    display: block;
    /* Print rendering quality + force exact color on browsers that strip
       backgrounds by default in print mode. */
    image-rendering: -webkit-optimize-contrast;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .hero-date { text-align: right; }
  .hero-date-en {
    font-size: 11pt;
    font-weight: 500;
    color: var(--c-ink);
    letter-spacing: -0.005em;
  }
  .hero-date-hi {
    font-size: 8.5pt;
    color: var(--c-muted);
    font-family: var(--font-hi);
    margin-top: 1mm;
  }
  .hero-date-gu {
    font-size: 8.5pt;
    color: var(--c-muted);
    font-family: var(--font-gu);
    margin-top: 0.3mm;
  }

  .hero-title {
    margin-top: 4mm;
    line-height: 1.15;
  }
  .hero-title-en {
    display: block;
    font-size: 24pt;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--c-ink);
    line-height: 1.1;
  }
  .hero-title-cap {
    display: block;
    margin-top: 2mm;
    font-size: 11pt;
    color: var(--c-muted);
    line-height: 1.3;
  }
  .hero-title-hi  { font-family: var(--font-hi); }
  .hero-title-gu  { font-family: var(--font-gu); }
  .hero-title-sep { color: var(--c-faint); margin: 0 2mm; }

  /* ─── Worker card ────────────────────────────────────────────────
     Three columns: Worker | Tasks | Total. In each column the label
     sits on top, the value below — the same reading rhythm in all
     three. Worker name flex-grows to take any spare width.            */
  .worker-card {
    margin-top: 6mm;
    padding: 5mm 7mm;
    background: #f5f5f7;
    border-radius: 12px;
    display: flex;
    align-items: stretch;
    gap: 7mm;
  }
  .wc-item {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 22mm;
  }
  .wc-item-worker { flex: 1; }     /* worker name gets the spare room */
  .wc-lbl {
    margin-bottom: 2.5mm;          /* breathing room between label & value */
  }
  .wc-val {
    font-size: 18pt;
    font-weight: 600;              /* lighter — was 800 */
    letter-spacing: -0.015em;
    color: var(--c-ink);
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .worker-name {
    font-size: 22pt;
    font-weight: 600;              /* lighter — was 800 */
    letter-spacing: -0.015em;
    /* tabular-nums shouldn't apply to a name */
    font-variant-numeric: normal;
  }
  .wc-sep {
    width: 0.4pt;
    background: var(--c-line);
    flex-shrink: 0;
  }

  /* ─── Inline label group (used in worker card + footer signature blocks) ──
     English is the primary, bold, dark line. Hindi & Gujarati share a single
     small caption line below — readable but visually quiet.                 */
  .inline-en {
    display: block;
    font-size: 7.5pt;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: var(--c-muted);
    text-transform: uppercase;
    line-height: 1.2;
  }
  .inline-cap {
    display: block;
    margin-top: 1mm;
    font-size: 8pt;
    color: var(--c-muted);
    line-height: 1.3;
  }
  .inline-hi  { font-family: var(--font-hi); }
  .inline-gu  { font-family: var(--font-gu); }
  .inline-sep { color: var(--c-faint); margin: 0 1.5mm; }

  /* ─── Tasks table ─────────────────────────────────────────────── */
  .ops-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 2mm;
  }
  .ops-table th, .ops-table td {
    padding: 3mm 2.5mm;
    vertical-align: top;
    text-align: left;
    border: 0;
  }
  .ops-table thead th {
    border-bottom: 0.6pt solid var(--c-ink);
    padding-bottom: 3mm;
  }
  .ops-table tbody tr {
    border-bottom: 0.3pt solid var(--c-line);
  }
  .ops-table tbody tr:last-child {
    border-bottom: 0.6pt solid var(--c-ink);
  }

  /* ─── Header labels: English bold on top, Hindi+Gujarati as caption ─── */
  .lbl-en {
    font-size: 8.5pt;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--c-ink);
    text-transform: uppercase;
    line-height: 1.2;
  }
  .lbl-cap {
    margin-top: 1.5mm;
    font-size: 8pt;
    color: var(--c-muted);
    line-height: 1.35;
    font-weight: 400;
  }
  .lbl-hi  { font-family: var(--font-hi); }
  .lbl-gu  { font-family: var(--font-gu); }
  .lbl-sep { color: var(--c-faint); margin: 0 1mm; }

  /* Column widths — sized for A4 portrait */
  .c-sn   { width: 7mm;  text-align: center; color: var(--c-faint); }
  .c-time { width: 22mm; }
  .c-job  { width: 38mm; }
  .c-op   { width: 36mm; }
  .c-mach { width: 28mm; color: var(--c-muted); font-size: 10pt; }
  .c-est  { width: 14mm; text-align: center; font-variant-numeric: tabular-nums; font-weight: 600; }
  .c-fill { width: 22mm; }  /* blank for handwriting */

  td.c-sn { font-size: 10pt; font-variant-numeric: tabular-nums; }
  .time-start { font-size: 12pt; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
  .time-end   { font-size: 9pt;  color: var(--c-muted); font-variant-numeric: tabular-nums; margin-top: 0.5mm; }

  .job-num    { font-size: 11pt; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.005em; }
  .job-prod   { font-size: 10pt; font-weight: 500; color: var(--c-ink); margin-top: 0.8mm; }
  .job-cust   { font-size: 9pt;  color: var(--c-muted); margin-top: 0.8mm; }
  .asm-ctx    { font-size: 8.5pt; color: var(--c-accent); margin-top: 0.5mm; }

  .op-name { font-size: 11pt; font-weight: 500; }
  .tags    { margin-top: 1mm; display: flex; gap: 1mm; flex-wrap: wrap; }
  .tag {
    display: inline-block;
    padding: 0.5mm 1.5mm;
    border-radius: 3px;
    font-size: 7.5pt;
    font-weight: 600;
    font-family: var(--font-hi);
  }
  .tag-urgent { background: #fff0f0; color: var(--c-urgent); }
  .tag-out    { background: #fff5e6; color: var(--c-out);    }

  /* Handwriting columns get a subtle baseline so it's obvious where to write */
  .ops-table tbody .c-fill {
    border-bottom: 0.3pt solid var(--c-line);
    min-height: 10mm;
  }

  /* ─── Footer signature area ──────────────────────────────────── */
  .sheet-foot {
    margin-top: 6mm;
    display: flex;
    gap: 10mm;
  }
  .sign-block { flex: 1; }
  .sign-block.wide { flex: 2; }
  .sign-label {
    margin-bottom: 7mm;
  }
  .sign-line {
    height: 0.4pt;
    background: var(--c-ink);
    width: 100%;
  }

  /* ─── Wednesday half-day banner ─────────────────────────────────
     Soft amber stripe sits below the worker card. Quiet but unmistakable —
     workers/supervisors notice it without it looking like an error.        */
  .wed-banner {
    margin-top: 4mm;
    padding: 3mm 5mm;
    background: #fff4d6;
    border-left: 1.2pt solid #b25000;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 4mm;
  }
  .wed-icon  { font-size: 16pt; color: #b25000; line-height: 1; }
  .wed-en    { font-size: 11pt; font-weight: 600; color: #b25000; }
  .wed-cap   { font-size: 8.5pt; color: #8a3d00; margin-top: 0.7mm; }
  .wed-hi    { font-family: var(--font-hi); }
  .wed-gu    { font-family: var(--font-gu); }
  .wed-sep   { margin: 0 1.5mm; color: rgba(178, 80, 0, 0.4); }

  /* ─── Order context line — small caption beneath job code ──────── */
  .order-ctx {
    font-size: 8.5pt;
    color: var(--c-muted);
    font-variant-numeric: tabular-nums;
    margin-top: 0.5mm;
    letter-spacing: 0.01em;
  }

  /* ─── Outside vendor row treatment ──────────────────────────────
     Worker doesn't *do* this work — they hand off to a vendor. The whole
     row is dimmed and a clear banner appears in the Operation column.   */
  tr.row-outside { background: #fafaf7; }
  tr.row-outside .op-name,
  tr.row-outside .job-num,
  tr.row-outside .job-prod {
    color: var(--c-muted);
  }
  .out-banner {
    margin-top: 1.5mm;
    padding: 1.8mm 2.8mm;
    background: #fff5e6;
    border-left: 1pt solid #b25000;
    border-radius: 3px;
    line-height: 1.3;
  }
  .out-en {
    display: block;
    font-size: 9pt;
    font-weight: 600;
    color: #8a3d00;
  }
  .out-cap {
    display: block;
    font-size: 7.5pt;
    color: #b25000;
    margin-top: 0.5mm;
  }
  .out-hi  { font-family: var(--font-hi); }
  .out-gu  { font-family: var(--font-gu); }
  .out-sep { margin: 0 1mm; color: rgba(178, 80, 0, 0.4); }

  /* ─── Shift summary row — just above signatures ───────────────── */
  .shift-row {
    margin-top: 8mm;
    display: flex;
    gap: 10mm;
    padding: 3mm 6mm;
    background: #f5f5f7;
    border-radius: 8px;
  }
  .shift-item {
    display: flex;
    align-items: baseline;
    gap: 2mm;
  }
  .shift-lbl {
    font-size: 7.5pt;
    font-weight: 600;
    color: var(--c-muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .shift-val {
    font-size: 10pt;
    font-weight: 500;
    color: var(--c-ink);
    font-variant-numeric: tabular-nums;
  }

  /* ─── Sheet meta strip (hidden, drives @page running headers) ──────
     This element is NOT visible in the body — its only job is to expose
     the current worker name + date as named strings, so the @page
     margin boxes can pick them up and stamp every printed page with
     the worker's identity. As the printer moves from one worker's
     sheet to the next, the named strings re-set automatically because
     each .sheet contains its own .sheet-meta.                          */
  .sheet-meta {
    string-set:
      worker-name content(text) "  no-op",   /* placeholder so child .meta-worker drives it */
      sheet-date  content(text) "  no-op";
    /* Don't visually render */
    position: absolute;
    width: 0; height: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .meta-worker { string-set: worker-name content(text); }
  .meta-date   { string-set: sheet-date  content(text); }

  /* ─── Print rules ──────────────────────────────────────────────── */
  @media print {
    /* ── Page-level running headers/footers ─────────────────────────
       Every printed page (page 1, 2, 3...) gets the same compact
       running header at the top and page numbers at the bottom — so
       a stack of loose pages stays identifiable, even if shuffled
       on the shop floor. Values come from string-set above.

       Note: @page margin boxes are supported in Chrome / Edge / Safari
       which is what'll be used for the browser-print workflow here.   */
    @page {
      margin: 22mm 14mm 18mm;       /* extra top/bottom for header & footer */
      size: A4 portrait;

      @top-left {
        content: "YUKENG MOULD & DIE";
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
        font-size: 7.5pt;
        font-weight: 600;
        letter-spacing: 0.16em;
        color: #6e6e73;
        padding-bottom: 3mm;
      }
      @top-right {
        content: string(worker-name) "  ·  " string(sheet-date);
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
        font-size: 9pt;
        font-weight: 600;
        color: #1d1d1f;
        padding-bottom: 3mm;
      }
      @bottom-center {
        /* Thin horizontal rule + page counter. The counter restarts
           across the entire print job (not per-worker), so this reads
           as "page 4 of 12" across the whole stack you took out of
           the printer — useful for collating, but the worker name in
           @top-right is what tells a person whose card any one page
           belongs to.                                                 */
        content: "Page " counter(page) " of " counter(pages);
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
        font-size: 8.5pt;
        color: #6e6e73;
        padding-top: 3mm;
        border-top: 0.3pt solid #d2d2d7;
      }
    }

    body { font-size: 11pt; }
    .sheet { min-height: auto; padding: 0; }

    /* Each worker's card starts on its own page (already set inline via
       page-break-after on the wrapper div for all but the last sheet). */
    .sheet { page-break-after: always; }
    .sheet:last-child { page-break-after: auto; }

    /* Keep individual task rows intact — never split a row across pages. */
    .ops-table tr { page-break-inside: avoid; }

    /* The table header repeats automatically on every overflow page.
       Marking it explicitly here in case some browsers don't apply the
       default behavior to <thead>. */
    .ops-table thead { display: table-header-group; }

    /* Tail block (shift summary + signatures) stays together as one unit
       and glues to the end of the card. page-break-inside: avoid means
       if it doesn't fit on the current page, it pushes to the next page
       intact rather than being split mid-block.                         */
    .sheet-tail { page-break-inside: avoid; }

    /* Keep the hero & worker card together on page 1. */
    .hero, .worker-card, .wed-banner { page-break-inside: avoid; }
  }

  /* On-screen preview — gentle grey background so the white sheet pops */
  @media screen {
    body { background: #f5f5f7; padding: 8mm 0; }
    .sheet {
      background: #fff;
      max-width: 210mm;
      margin: 0 auto 6mm;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.08);
      border-radius: 4px;
    }
  }
</style>
</head>
<body>
${workerSections}
</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { toast('Pop-up blocked — allow pop-ups and try again', 'error'); return; }
  win.document.write(printHTML);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 500);
}
