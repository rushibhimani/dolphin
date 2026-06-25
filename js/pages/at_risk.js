/**
 * Dolphin ERP — At Risk page  (flag-and-wait supervisor view)
 *
 * The screen the supervisor checks to answer "what's going wrong that I need
 * to decide about?". Lists every active job whose PROJECTED finish is trending
 * late or at risk against its FROZEN promised date — newest pain first.
 *
 * This view is read-only and never reschedules. It tells you what's slipping
 * and why; YOU decide whether to replan. (The consequence/what-if engine that
 * suggests how to recover is the next phase — step 4.)
 *
 * Data: GET /api/at-risk
 */

async function renderAtRisk() {
  const el = document.getElementById('content');
  el.innerHTML = `<div style="color:var(--muted);padding:20px">Loading…</div>`;

  let rows = [];
  try {
    rows = await api('GET', '/api/at-risk');
  } catch (e) {
    el.innerHTML = `<div class="empty">${escHtml(e.message)}</div>`;
    return;
  }

  updateAtRiskNavCount(rows.length);

  const late   = rows.filter(r => r.health === 'late');
  const atRisk = rows.filter(r => r.health === 'at_risk');

  if (!rows.length) {
    el.innerHTML = `
      <div class="card" style="padding:40px;text-align:center">
        <div style="font-size:32px;margin-bottom:8px">✓</div>
        <div style="font-size:16px;font-weight:600;margin-bottom:4px">Everything's on track</div>
        <div style="font-size:13px;color:var(--muted)">
          No active job is projected to miss its promised date. As work gets logged,
          anything that starts trending late will show up here.
        </div>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div style="margin-bottom:16px">
      <div style="font-size:13px;color:var(--muted)">
        ${late.length} late, ${atRisk.length} at risk — measured against the
        <b>promised date</b> you gave the customer, using real progress so far.
        Nothing here has been rescheduled; these are flags for you to decide on.
      </div>
    </div>
    ${late.length ? `
      <div class="form-section" style="color:var(--red)">■ Already projected LATE (${late.length})</div>
      ${late.map(atRiskCard).join('')}
    ` : ''}
    ${atRisk.length ? `
      <div class="form-section" style="color:var(--amber);margin-top:18px">▲ At risk (${atRisk.length})</div>
      ${atRisk.map(atRiskCard).join('')}
    ` : ''}
  `;
}

function atRiskCard(r) {
  const slip = r.slip_hours;
  const slipTxt = slip == null ? ''
    : slip > 0 ? `<span style="color:var(--red);font-weight:600">${fmtDur(slip)} past promise</span>`
    : `<span style="color:var(--amber)">${fmtDur(-slip)} of slack left</span>`;
  const onWhat = r.current_op
    ? `Currently on <b>${escHtml(r.current_op)}</b>${r.current_machine ? ` · ${escHtml(r.current_machine)}` : ''}`
    : 'No operation in progress';

  return `
    <div class="card" style="padding:14px 16px;margin-bottom:8px;border-left:3px solid ${r.health==='late'?'var(--red)':'var(--amber)'};cursor:pointer"
         onclick="navigate('${r.order_id ? `/orders/${r.order_id}` : `/jobs`}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div style="min-width:0;flex:1">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="mono" style="font-weight:600;font-size:13px">${escHtml(r.job_number)}</span>
            ${r.is_priority ? '<span style="font-size:10px;color:var(--red)">🚩 URGENT</span>' : ''}
            ${healthBadge(r.health)}
          </div>
          <div style="font-size:13px;margin-top:3px">${escHtml(r.customer_name)} · ${escHtml(r.product_type)} ${escHtml(r.product_size||'')}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:3px">${onWhat}</div>
          ${r.reason ? `<div style="font-size:12px;color:var(--text);margin-top:4px">⚠ ${escHtml(r.reason)}</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:11px;color:var(--muted)">Promised</div>
          <div class="mono" style="font-size:13px">${fmtD(r.promised_date)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:6px">Projected</div>
          <div class="mono" style="font-size:13px;color:${r.health==='late'?'var(--red)':'var(--amber)'}">${fmtD(r.projected_end)}</div>
          <div style="margin-top:4px">${slipTxt}</div>
        </div>
      </div>
    </div>`;
}

function fmtDur(hrs) {
  if (hrs == null) return '';
  if (hrs < 24) return `${Math.round(hrs)}h`;
  const d = Math.floor(hrs / 24), h = Math.round(hrs % 24);
  return h ? `${d}d ${h}h` : `${d}d`;
}

// Updates the sidebar nav badge. Called by the at-risk page and can be called
// after schedule/status changes elsewhere to keep the count fresh.
function updateAtRiskNavCount(n) {
  const badge = document.getElementById('atRiskNavCount');
  if (!badge) return;
  if (n > 0) { badge.textContent = n; badge.style.display = ''; }
  else { badge.style.display = 'none'; }
}

// Lightweight count refresh without rendering the page (for nav badge on load).
async function refreshAtRiskCount() {
  try {
    const rows = await api('GET', '/api/at-risk');
    updateAtRiskNavCount(rows.length);
  } catch (e) { /* silent */ }
}
