/**
 * Dolphin ERP — Today's Work
 * Mobile-first layout: timeline cards on small screens, table rows on desktop.
 * iPhone 12 mini (375px) — zero horizontal scrolling.
 */


/* Parse IST datetime strings from server safely across all browsers (incl. Safari).
   Server sends "YYYY-MM-DD HH:MM:SS" (naive IST). Replace space with T and append
   IST offset so Date() always treats it as IST regardless of device timezone. */
function parseISTDate(s){
  if(!s) return null;
  // Already has T or Z — use as-is
  if(s.includes('T') || s.includes('Z')) return new Date(s);
  // "2026-05-24 19:12:00" → "2026-05-24T19:12:00+05:30"
  return new Date(s.trim().replace(' ', 'T') + '+05:30');
}

async function renderToday(){
  if(todayRefreshTimer) clearInterval(todayRefreshTimer);
  if(window._elapsedTimer) clearInterval(window._elapsedTimer);

  const canControl = authGetUser()?.permissions?.can_control_ops !== false;

  document.getElementById('topbarActions').innerHTML=`
    <span id="todayTs" style="font-size:12px;color:var(--muted)"></span>
    ${canControl ? `<button class="btn btn-secondary" style="font-size:12px" onclick="pullForwardOps()" title="Pull future ops forward after early completion">⏩ Pull Forward</button>` : ''}
    <button class="btn btn-secondary" onclick="renderToday()">↻</button>`;
  document.getElementById('content').innerHTML=`<div style="color:var(--muted)">Loading…</div>`;
  const nowISO = istNow().toISOString().slice(0,19);

  // Staff (office) can see all ops but cannot start/pause/complete them
  const perms = authGetUser()?.permissions || {};
  const canControlOps     = perms.can_control_ops     !== false;
  const ownOpsOnly        = !!perms.can_control_own_ops_only;
  const myWorkerId        = authGetUser()?.worker_id || null;

  try{
    const ops = await api('GET','/api/today');
    const active = ops.filter(o=>o.status==='in_progress');
    const paused  = ops.filter(o=>o.status==='paused');
    const sched   = ops.filter(o=>o.status==='scheduled');

    if(!ops.length){
      document.getElementById('content').innerHTML=`<div class="card"><div class="empty">No operations for today.<br>Schedule some jobs first.</div></div>`;
      return;
    }

    // Read-only banner for staff
    const readOnlyBanner = !canControlOps ? `
      <div style="background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.25);
           border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#818cf8;
           display:flex;align-items:center;gap:8px">
        👁 <b>View-only</b> — You can see all floor operations but cannot start, pause, or complete them.
      </div>` : '';

    // ── Summary chips ────────────────────────────────────────────────────────
    let html = readOnlyBanner + `<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
      <div style="background:var(--accent-soft);border:1px solid var(--accent);border-radius:8px;padding:6px 12px;font-size:13px;display:flex;align-items:center;gap:6px">
        <b style="font-size:18px;color:var(--accent)">${active.length}</b> In Progress</div>
      <div style="background:var(--amber-soft,rgba(245,158,11,.08));border:1px solid var(--amber);border-radius:8px;padding:6px 12px;font-size:13px;display:flex;align-items:center;gap:6px">
        <b style="font-size:18px;color:var(--amber)">${paused.length}</b> Paused</div>
      <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-size:13px;display:flex;align-items:center;gap:6px">
        <b style="font-size:18px">${sched.length}</b> Scheduled</div>
    </div>`;

    // Group by machine
    const byMachine = {};
    ops.forEach(op=>{ (byMachine[op.wc_name]=byMachine[op.wc_name]||[]).push(op); });
    const machines = Object.keys(byMachine).sort();

    /* ── MOBILE (≤640px): timeline cards, one per op ────────────────────── */
    html += `<div class="today-mobile-view">`;
    machines.forEach(m=>{
      const mops = byMachine[m];
      html += `<div style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-size:13px;font-weight:700;color:var(--text)">${m}</div>
          <div style="font-size:11px;color:var(--muted)">${mops.length} op${mops.length>1?'s':''}</div>
        </div>
        ${mops.map(op=>renderTimelineCard(op,nowISO,canControlOps,ownOpsOnly,myWorkerId)).join('')}
      </div>`;
    });
    html += `</div>`;

    /* ── DESKTOP (≥641px): grouped machine cards with compact rows ───────── */
    html += `<div class="today-desktop-view">`;
    machines.forEach(m=>{
      const mops = byMachine[m];
      html += `<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--surface);border-bottom:1px solid var(--border)">
          <span style="font-weight:700;font-size:14px">${m}</span>
          <span style="font-size:11px;color:var(--muted)">${mops.length} op${mops.length>1?'s':''} today</span>
        </div>
        ${mops.map(op=>renderOpRow(op,nowISO,canControlOps,ownOpsOnly,myWorkerId)).join('')}
      </div>`;
    });
    html += `</div>`;

    document.getElementById('content').innerHTML = html;

    // ── Live elapsed timer — updates every 30s without re-fetching ────────
    window._elapsedTimer = setInterval(()=>{
      const nowMs = Date.now();
      // Update mobile cards
      document.querySelectorAll('[data-elapsed-start]').forEach(el => {
        const start = parseInt(el.dataset.elapsedStart);
        const est   = parseInt(el.dataset.elapsedEst);
        const elapsed = Math.max(0, Math.round((nowMs - start) / 60000));
        const overrun = elapsed > est;
        el.textContent = `${elapsed}min elapsed`;
        el.style.color = overrun ? 'var(--red)' : 'var(--muted)';
        const bar = el.closest('[data-prog-bar]')?.querySelector('.prog-fill');
        if(bar){
          bar.style.width = Math.min(100, Math.round(elapsed/est*100)) + '%';
          bar.style.background = overrun ? 'var(--red)' : 'var(--green)';
        }
      });
      // Update desktop elapsed spans
      document.querySelectorAll('[data-elapsed-span]').forEach(el => {
        const start = parseInt(el.dataset.elapsedStart);
        const est   = parseInt(el.dataset.elapsedEst);
        const elapsed = Math.max(0, Math.round((nowMs - start) / 60000));
        const overrun = elapsed > est;
        el.textContent = `${elapsed}min / ${est}min${overrun?' ⚠':''}`;
        el.style.color = overrun ? 'var(--red)' : 'var(--accent)';
      });
    }, 30000);

  } catch(e){ document.getElementById('content').innerHTML=`<div class="empty">${e.message}</div>`; }

  const ts = document.getElementById('todayTs');
  if(ts) ts.textContent = istNow().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:false});
  todayRefreshTimer = setInterval(()=>{if(window.location.pathname.includes('today'))renderToday();}, 60000);
}

/* ── MOBILE: timeline card ─────────────────────────────────────────────────── */
function renderTimelineCard(op, nowISO, canControlOps=true, ownOpsOnly=false, myWorkerId=null){
  // Determine if this user can act on THIS specific op
  const canActOnThis = canControlOps && (!ownOpsOnly || op.worker_id == myWorkerId);
  const isNow    = op.status === 'in_progress';
  const isPaused = op.status === 'paused';
  const isOverdue= op.scheduled_end && op.scheduled_end.slice(0,19) < nowISO && op.status === 'scheduled';
  const estMins  = (op.work_time_mins || 0) + (op.setup_time_mins || 0);

  const startTime = op.scheduled_start
    ? new Date(op.scheduled_start).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})
    : '';
  const endTime = op.scheduled_end
    ? new Date(op.scheduled_end).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})
    : '';

  // Progress calc for in-progress
  let progressPct = 0, elapsedMin = 0, overrun = false;
  if(isNow && op.actual_start){
    // actual_start is an IST string; new Date() parses it as local time on device (also IST),
    // so getTime() already gives correct UTC ms — no offset adjustment needed.
    const elapsedMs = Date.now() - parseISTDate(op.actual_start).getTime();
    elapsedMin = Math.max(0, Math.round(elapsedMs / 60000));
    progressPct = estMins > 0 ? Math.min(100, Math.round(elapsedMin / estMins * 100)) : 0;
    overrun = elapsedMin > estMins;
  }

  const borderColor = isNow ? 'var(--accent)' : isPaused ? 'var(--amber)' : isOverdue ? 'var(--red)' : 'var(--border-strong)';
  const cardBg      = isNow ? 'var(--accent-soft)' : isPaused ? 'var(--amber-soft,rgba(245,158,11,.06))' : isOverdue ? 'var(--red-soft)' : 'var(--card)';

  const statusBadge = isNow ? `<span class="badge" style="background:var(--accent-soft);color:var(--accent)">▶ In Progress</span>`
    : isPaused ? `<span class="badge" style="background:var(--amber-soft);color:var(--amber)">⏸ Paused</span>`
    : isOverdue ? `<span class="badge" style="background:var(--red-soft);color:var(--red)">⚠ LATE</span>`
    : `<span class="badge" style="background:var(--surface);color:var(--muted)">Scheduled</span>`;

  const startMs = op.actual_start ? parseISTDate(op.actual_start).getTime() : 0;
  const progressHtml = (isNow && estMins > 0 && startMs) ? `
    <div style="margin-top:6px" data-prog-bar="1">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:${overrun?'var(--red)':'var(--muted)'};margin-bottom:4px">
        <span data-elapsed-start="${startMs}" data-elapsed-est="${estMins}">${elapsedMin}min elapsed</span>
        <span>${estMins}min est${overrun?' ⚠':''}</span>
      </div>
      <div class="prog-bar"><div class="prog-fill" style="width:${progressPct}%;background:${overrun?'var(--red)':'var(--green)'}"></div></div>
    </div>` : '';

  const pauseInfo = isPaused && op.pause_reason
    ? `<div style="font-size:11px;color:var(--amber);margin-top:4px">⏸ ${pauseReasonLabel(op.pause_reason)}</div>` : '';

  /* Action buttons — handles both inhouse and outside ops */
  const isOutside = op.op_type === 'outside';
  const actionHtml = canActOnThis ? `<div style="display:flex;gap:8px;padding-top:10px;border-top:1px solid var(--border)">
    ${isOutside ? `
      ${op.status==='scheduled'||op.status==='pending'
        ? `<button class="btn btn-warning" style="flex:1;min-height:44px;font-size:14px" onclick="markOutsideSent(${op.op_id})">📤 Send Out${op.outside_vendor?' to '+escHtml(op.outside_vendor):''}</button>`
        : ''}
      ${op.status==='in_progress'
        ? `<div style="flex:1;text-align:center;font-size:12px;color:var(--amber)">📤 Sent out — waiting for return</div>
           <button class="btn btn-primary" style="flex:1;min-height:44px;font-size:14px" onclick="markOutsideReceived(${op.op_id})">📥 Mark Received</button>`
        : ''}
    ` : `
      ${op.status==='scheduled'
        ? `<button class="btn btn-success" style="flex:1;min-height:44px;font-size:14px" onclick="promptStart(${op.op_id},'${op.scheduled_start||''}')">▶ Start</button>`
        : ''}
      ${op.status==='in_progress'
        ? `<button class="btn btn-secondary" style="flex:1;min-height:44px;font-size:14px" onclick="promptPause(${op.op_id})">⏸ Pause</button>
           <button class="btn btn-primary" style="flex:1;min-height:44px;font-size:14px" onclick="promptComplete(${op.op_id},'${op.actual_start||''}')">✓ Done</button>`
        : ''}
      ${op.status==='paused'
        ? `<button class="btn btn-success" style="flex:1;min-height:44px;font-size:14px" onclick="promptStart(${op.op_id},'${op.scheduled_start||''}')">▶ Resume</button>`
        : ''}
    `}
  </div>` : '';

  return `<div style="background:${cardBg};border:1px solid var(--border);border-left:4px solid ${borderColor};
                      border-radius:10px;padding:12px;margin-bottom:10px">
    <!-- Time -->
    <div style="font-family:var(--mono);font-size:12px;color:var(--accent);font-weight:600;margin-bottom:6px">
      ${startTime}${startTime&&endTime?' → ':''}${endTime}
    </div>
    <!-- Job + Op name -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px">
      <div style="flex:1;min-width:0">
        <span style="font-size:13px;font-weight:700;color:var(--text)">${op.op_name}</span>
        ${op.priority?'<span style="color:var(--red);margin-left:6px">🚨</span>':''}
      </div>
      ${statusBadge}
    </div>
    <!-- Customer / Job -->
    <div style="font-size:12px;color:var(--accent);font-family:var(--mono);margin-bottom:2px">${op.order_label||op.job_number}</div>
    <div style="font-size:12px;color:var(--text-soft)">${op.customer}${op.worker_name?' · 👷 '+op.worker_name:''}</div>
    ${pauseInfo}
    ${progressHtml}
    ${actionHtml}
  </div>`;
}

/* ── DESKTOP: compact single-line row (unchanged from original) ─────────────── */
function renderOpRow(op, nowISO, canControlOps=true, ownOpsOnly=false, myWorkerId=null){
  const canActOnThis = canControlOps && (!ownOpsOnly || op.worker_id == myWorkerId);
  const isNow    = op.status === 'in_progress';
  const isPaused = op.status === 'paused';
  const isOverdue= op.scheduled_end && op.scheduled_end.slice(0,19) < nowISO && op.status === 'scheduled';
  const estMins  = (op.work_time_mins || 0) + (op.setup_time_mins || 0);

  let actualHtml = '';
  if(isNow && op.actual_start){
    const startMs    = parseISTDate(op.actual_start).getTime();
    const elapsedMs  = Date.now() - startMs;
    const elapsedMin = Math.max(0, Math.round(elapsedMs / 60000));
    const pct        = estMins > 0 ? Math.min(100, Math.round(elapsedMin / estMins * 100)) : 0;
    const overrun    = elapsedMin > estMins;
    actualHtml = `<span data-elapsed-span="1" data-elapsed-start="${startMs}" data-elapsed-est="${estMins}"
      style="font-size:11px;color:${overrun?'var(--red)':'var(--accent)'};font-weight:600;white-space:nowrap">
      ${elapsedMin}min / ${estMins}min${overrun?' ⚠':''}
    </span>`;
  } else if((isNow || isPaused) && op.actual_start && op.actual_end){
    const actualMin = Math.round((parseISTDate(op.actual_end)-parseISTDate(op.actual_start))/60000);
    const diff = actualMin - estMins;
    actualHtml = `<span style="font-size:11px;color:${diff>5?'var(--red)':diff<-5?'var(--green)':'var(--muted)'};font-weight:600;white-space:nowrap">
      ${actualMin}min / ${estMins}min est
    </span>`;
  }

  const startTime = op.scheduled_start ? new Date(op.scheduled_start).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:false}) : '';
  const endTime   = op.scheduled_end   ? new Date(op.scheduled_end).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:false}) : '';
  const rowBg = isNow ? 'var(--accent-soft)' : isPaused ? 'var(--amber-soft,rgba(245,158,11,.06))' : isOverdue ? 'var(--red-soft,rgba(239,68,68,.05))' : '';
  const rowBorder = isNow ? 'var(--accent)' : isPaused ? 'var(--amber)' : isOverdue ? 'var(--red)' : 'var(--border)';

  return `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;
                       border-bottom:1px solid var(--border);background:${rowBg};
                       border-left:3px solid ${rowBorder}">
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:11px;font-family:var(--mono);color:var(--accent);font-weight:600;white-space:nowrap">${op.order_label||op.job_number}</span>
        ${op.priority?'<span style="font-size:10px;color:var(--red)">🚨</span>':''}
        ${isOverdue?'<span style="font-size:10px;font-weight:700;color:var(--red);background:var(--red-soft);border:1px solid var(--red);border-radius:3px;padding:0 4px">LATE</span>':''}
        ${isPaused?'<span style="font-size:10px;font-weight:700;color:var(--amber);background:var(--amber-soft);border:1px solid var(--amber);border-radius:3px;padding:0 4px">PAUSED</span>':''}
        <span style="font-size:13px;font-weight:600">${op.op_name}</span>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        ${op.customer}${op.worker_name?' · 👷 '+op.worker_name:''}</div>
      ${isNow&&op.actual_start?`<div style="font-size:10px;color:var(--muted);margin-top:1px">▶ Started ${fmtDT(op.actual_start)}</div>`:''}
      ${isPaused&&op.pause_reason?`<div style="font-size:10px;color:var(--amber);margin-top:1px">⏸ ${pauseReasonLabel(op.pause_reason)}</div>`:''}
    </div>
    <div style="font-size:11px;font-family:var(--mono);color:var(--muted);text-align:right;flex-shrink:0;white-space:nowrap">
      <div>${startTime} → ${endTime}</div>
      ${actualHtml}
    </div>
    <div style="display:flex;gap:4px;flex-shrink:0">
      ${canActOnThis ? `
        ${op.status==='scheduled'?`<button class="btn btn-success" style="padding:5px 10px;font-size:12px" onclick="promptStart(${op.op_id},'${op.scheduled_start||''}')">▶</button>`:''}
        ${op.status==='in_progress'?`
          <button class="btn btn-secondary" style="padding:5px 10px;font-size:12px" onclick="promptPause(${op.op_id})">⏸</button>
          <button class="btn btn-primary"   style="padding:5px 10px;font-size:12px" onclick="promptComplete(${op.op_id},'${op.actual_start||''}')">✓</button>`:''}
        ${op.status==='paused'?`<button class="btn btn-success" style="padding:5px 10px;font-size:12px" onclick="promptStart(${op.op_id},'${op.scheduled_start||''}')">▶</button>`:''}
      ` : ''}
    </div>
  </div>`;
}

async function pullForwardOps(){
  const ok = await confirm2(
    'Pull all future scheduled operations forward to start as soon as each machine is free?\n\nThis is useful when today\'s work finishes early — future jobs move up automatically.',
    'Pull Forward'
  );
  if(!ok) return;
  try{
    const r = await api('POST', '/api/pull-forward');
    toast(`✓ ${r.pulled} operation${r.pulled!==1?'s':''} pulled forward`, 'success');
    renderToday();
  } catch(e){ toast(e.message, 'error'); }
}

function pauseReasonLabel(r){
  return{waiting_material:'Waiting Material',machine_down:'Machine Down',worker_absent:'Worker Absent',rework:'Rework',other:'Other'}[r]||r||'Unknown';
}

// ── Manual time dialogs ──────────────────────────────────────────────────────
function nowLocalInput(){
  const d = istNow();
  return d.toISOString().slice(0,16).replace('T',' ');
}
function isoToLocalInput(iso){
  if(!iso) return nowLocalInput();
  return iso.slice(0,16).replace('T',' ');
}

function promptStart(opId, scheduledStart){
  const schLocal = scheduledStart ? isoToLocalInput(scheduledStart) : '';
  const nowLocal = nowLocalInput();
  showModal('Start Operation','<div style="display:grid;gap:12px">'+
    '<div><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">Actual Start Time</label>'+
    `<input type="datetime-local" id="dlg_start" value="${nowLocal.replace(' ','T')}" style="width:100%"></div>`+
    (schLocal?`<div><button class="btn btn-ghost" style="font-size:12px" onclick="document.getElementById('dlg_start').value='${schLocal.replace(' ','T')}'">Use Scheduled (${fmtDT(scheduledStart)})</button></div>`:'')
    +'</div>',
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" onclick="confirmStart(${opId})">▶ Start</button>`);
}

async function confirmStart(opId){
  const v = document.getElementById('dlg_start')?.value;
  if(!v){toast('Enter start time','error');return;}
  try{
    await api('PUT',`/api/ops/${opId}/status`,{status:'in_progress',actual_start:v.replace('T',' ')});
    closeModal(); renderToday();
  }catch(e){toast(e.message,'error');}
}

function promptPause(opId){
  showModal('Pause Operation','<div style="display:grid;gap:12px">'+
    '<div><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">Reason</label>'+
    '<select id="dlg_reason" style="width:100%">'+
    '<option value="waiting_material">Waiting for Material</option>'+
    '<option value="machine_down">Machine Down / Issue</option>'+
    '<option value="worker_absent">Worker Absent / Break</option>'+
    '<option value="rework">Rework Required</option>'+
    '<option value="other">Other</option>'+
    '</select></div>'+
    '<div><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">Notes (optional)</label>'+
    '<input id="dlg_notes" placeholder="Additional details…" style="width:100%"></div>'+
    '</div>',
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" onclick="confirmPause(${opId})">⏸ Pause</button>`);
}

async function confirmPause(opId){
  const r = document.getElementById('dlg_reason')?.value || 'other';
  const n = document.getElementById('dlg_notes')?.value || '';
  try{
    await api('PUT',`/api/ops/${opId}/status`,{status:'paused',pause_reason:r,pause_notes:n});
    closeModal(); renderToday();
  }catch(e){toast(e.message,'error');}
}

function promptComplete(opId, actualStart){
  const startLocal = actualStart ? isoToLocalInput(actualStart) : nowLocalInput();
  const nowLocal   = nowLocalInput();
  showModal('Complete Operation','<div style="display:grid;gap:12px">'+
    '<div><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">Actual Start Time</label>'+
    `<input type="datetime-local" id="dlg_cstart" value="${startLocal.replace(' ','T')}" style="width:100%"></div>`+
    '<div><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">Actual End Time</label>'+
    `<input type="datetime-local" id="dlg_cend" value="${nowLocal.replace(' ','T')}" style="width:100%"></div>`+
    '</div>',
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" onclick="confirmComplete(${opId})">✓ Mark Done</button>`);
}

async function confirmComplete(opId){
  const s = document.getElementById('dlg_cstart')?.value;
  const e = document.getElementById('dlg_cend')?.value;
  if(!s||!e){toast('Enter start and end times','error');return;}
  try{
    await api('PUT',`/api/ops/${opId}/status`,{
      status:'completed',
      actual_start: s.replace('T',' '),
      actual_end:   e.replace('T',' ')
    });
    closeModal(); renderToday();
  }catch(e){toast(e.message,'error');}
}

async function updateOpStatus(opId, status){
  try{
    await api('PUT',`/api/ops/${opId}/status`,{status});
    renderToday();
  }catch(e){toast(e.message,'error');}
}

// ── JOBS ──
let expandedJobId = null;
let jobNextOps = {};

async function markOutsideSent(opId) {
  try {
    await api('PUT', `/api/scheduled-ops/${opId}/outside`, { action: 'send_out' });
    toast('Marked as sent out'); renderToday();
  } catch(e) { toast(e.message,'error'); }
}
async function markOutsideReceived(opId) {
  try {
    await api('PUT', `/api/scheduled-ops/${opId}/outside`, { action: 'receive_back' });
    toast('Marked as received back'); renderToday();
  } catch(e) { toast(e.message,'error'); }
}
