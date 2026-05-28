/**
 * Dolphin ERP — Past Work
 * Shows scheduled ops from previous days that were never started.
 * Same UI as Today's Work (timeline cards + desktop rows).
 */

async function renderPastWork() {
  document.getElementById('topbarActions').innerHTML = `
    <button class="btn btn-ghost" onclick="navigate('/today')" style="font-size:12px">← Today's Work</button>
    <button class="btn btn-secondary" onclick="renderPastWork()">↻</button>`;
  document.getElementById('content').innerHTML = `<div style="color:var(--muted)">Loading…</div>`;

  const nowISO = istNow().toISOString().slice(0,19);
  const perms  = authGetUser()?.permissions || {};
  const canControlOps  = perms.can_control_ops !== false;
  const ownOpsOnly     = !!perms.can_control_own_ops_only;
  const myWorkerId     = authGetUser()?.worker_id || null;

  try {
    const ops = await api('GET', '/api/past-work');

    if (!ops.length) {
      document.getElementById('content').innerHTML = `
        <div class="card" style="padding:40px;text-align:center">
          <div style="font-size:32px;margin-bottom:12px">✅</div>
          <div style="font-size:15px;font-weight:600;margin-bottom:6px">All caught up!</div>
          <div style="font-size:13px;color:var(--muted)">No overdue or running operations from previous days.</div>
        </div>`;
      return;
    }

    // Group by date (scheduled_start date)
    const byDate = {};
    ops.forEach(op => {
      const d = op.scheduled_start ? op.scheduled_start.slice(0,10) : 'Unknown';
      (byDate[d] = byDate[d] || []).push(op);
    });
    const dates = Object.keys(byDate).sort().reverse(); // newest first

    let html = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        <div style="font-size:13px;color:var(--muted)">
          ${ops.length} overdue/running operation(s) from ${dates.length} previous day(s)
        </div>
        <button class="btn btn-ghost" style="font-size:12px;margin-left:auto"
          onclick="scheduleAll()" title="Reschedule all to fit from today onwards">
          ⚡ Reschedule All
        </button>
      </div>`;

    /* ── MOBILE (≤640px) ──────────────────────────────────────────────────── */
    html += `<div class="today-mobile-view">`;
    dates.forEach(d => {
      const dops = byDate[d];
      const dateLabel = _pastDateLabel(d);
      html += `
        <div style="margin-bottom:22px">
          <div style="display:flex;justify-content:space-between;align-items:center;
                      margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid var(--border)">
            <div style="font-size:13px;font-weight:700">${dateLabel}</div>
            <div style="font-size:11px;color:var(--muted)">${dops.length} op${dops.length>1?'s':''}</div>
          </div>
          ${dops.map(op => renderTimelineCard(op, nowISO, canControlOps, ownOpsOnly, myWorkerId)).join('')}
        </div>`;
    });
    html += `</div>`;

    /* ── DESKTOP (≥641px) ─────────────────────────────────────────────────── */
    html += `<div class="today-desktop-view">`;
    dates.forEach(d => {
      const dops = byDate[d];
      const dateLabel = _pastDateLabel(d);

      // Group by machine within each day
      const byMachine = {};
      dops.forEach(op => { (byMachine[op.wc_name] = byMachine[op.wc_name] || []).push(op); });
      const machines = Object.keys(byMachine).sort();

      html += `
        <div style="margin-bottom:18px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <div style="font-size:13px;font-weight:700">${dateLabel}</div>
            <div style="height:1px;flex:1;background:var(--border)"></div>
            <div style="font-size:11px;color:var(--muted)">${dops.length} op${dops.length>1?'s':''}</div>
          </div>
          ${machines.map(m => `
            <div style="background:var(--card);border:1px solid var(--border);
                        border-radius:10px;overflow:hidden;margin-bottom:8px">
              <div style="display:flex;justify-content:space-between;align-items:center;
                          padding:8px 12px;background:var(--surface);border-bottom:1px solid var(--border)">
                <span style="font-weight:700;font-size:14px">${m}</span>
                <span style="font-size:11px;color:var(--muted)">${byMachine[m].length} op${byMachine[m].length>1?'s':''}</span>
              </div>
              ${byMachine[m].map(op => renderOpRow(op, nowISO, canControlOps, ownOpsOnly, myWorkerId)).join('')}
            </div>`).join('')}
        </div>`;
    });
    html += `</div>`;

    document.getElementById('content').innerHTML = html;

  } catch(e) {
    document.getElementById('content').innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

function _pastDateLabel(dateStr) {
  if (!dateStr || dateStr === 'Unknown') return 'Unknown Date';
  const d     = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  const diff  = Math.round((today - d) / 86400000);
  const label = d.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'short', year:'numeric' });
  if (diff === 1) return `Yesterday — ${label}`;
  if (diff <= 7)  return `${diff} days ago — ${label}`;
  return label;
}
