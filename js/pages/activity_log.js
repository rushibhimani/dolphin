/**
 * Dolphin ERP — Activity Log
 * Audit trail: who scheduled, started, paused, completed ops, created/edited/deleted jobs.
 */

const _AL_ACTION_LABELS = {
  schedule_all:  '⚡ Schedule All',
  op_started:    '▶ Op Started',
  op_paused:     '⏸ Op Paused',
  op_completed:  '✅ Op Completed',
  job_created:   '📋 Job Created',
  job_updated:   '✏️ Job Updated',
  job_deleted:   '🗑 Job Deleted',
};

const _AL_ACTION_COLORS = {
  schedule_all: 'var(--blue, #3b82f6)',
  op_started:   'var(--amber, #f59e0b)',
  op_paused:    'var(--muted)',
  op_completed: 'var(--green, #22c55e)',
  job_created:  'var(--blue, #3b82f6)',
  job_updated:  'var(--amber, #f59e0b)',
  job_deleted:  'var(--red, #ef4444)',
};

let _alFilter = '';
let _alOffset = 0;
const _AL_LIMIT = 40;

async function renderActivityLog() {
  document.getElementById('topbarActions').innerHTML =
    `<button class="btn btn-ghost" onclick="renderActivityLog()">↻ Refresh</button>`;

  const content = document.getElementById('content');
  content.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <select id="alFilterAction" onchange="_alFilterChanged()" style="padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px">
        <option value="">All actions</option>
        <option value="schedule_all">Schedule All</option>
        <option value="op_started">Op Started</option>
        <option value="op_paused">Op Paused</option>
        <option value="op_completed">Op Completed</option>
        <option value="job_created">Job Created</option>
        <option value="job_updated">Job Updated</option>
        <option value="job_deleted">Job Deleted</option>
      </select>
      <span id="alCount" style="font-size:12px;color:var(--muted)"></span>
    </div>
    <div id="alList"></div>
    <div id="alPager" style="display:flex;gap:10px;margin-top:16px;justify-content:center"></div>`;

  document.getElementById('alFilterAction').value = _alFilter;
  await _alLoad();
}

function _alFilterChanged() {
  _alFilter = document.getElementById('alFilterAction').value;
  _alOffset = 0;
  _alLoad();
}

async function _alLoad() {
  const list = document.getElementById('alList');
  list.innerHTML = '<div style="color:var(--muted);padding:20px">Loading…</div>';

  let url = `/api/activity-log?limit=${_AL_LIMIT}&offset=${_alOffset}`;
  if (_alFilter) url += `&action=${_alFilter}`;

  try {
    const data = await api('GET', url);
    document.getElementById('alCount').textContent = `${data.total} entries`;

    if (!data.items.length) {
      list.innerHTML = `<div class="card" style="padding:40px;text-align:center">
        <div style="font-size:28px;margin-bottom:10px">📭</div>
        <div style="font-size:14px;color:var(--muted)">No activity recorded yet.</div>
      </div>`;
      document.getElementById('alPager').innerHTML = '';
      return;
    }

    // Group by date
    const groups = {};
    for (const item of data.items) {
      const dt = new Date(item.timestamp);
      const dayKey = dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      if (!groups[dayKey]) groups[dayKey] = [];
      groups[dayKey].push(item);
    }

    let html = '';
    for (const [day, items] of Object.entries(groups)) {
      html += `<div style="font-size:12px;font-weight:600;color:var(--muted);margin:18px 0 8px;text-transform:uppercase;letter-spacing:.5px">${day}</div>`;
      for (const item of items) {
        const dt = new Date(item.timestamp);
        const time = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        const label = _AL_ACTION_LABELS[item.action] || item.action;
        const color = _AL_ACTION_COLORS[item.action] || 'var(--muted)';

        let detail = '';
        if (item.entity_label) detail = item.entity_label;
        if (item.details) {
          if (item.action === 'schedule_all') {
            const d = item.details;
            detail = `${d.scheduled} scheduled`;
            if (d.frozen)  detail += `, ${d.frozen} frozen`;
            if (d.failed)  detail += `, ${d.failed} failed`;
          } else if (item.action === 'op_paused' && item.details.pause_reason) {
            detail += ` — ${item.details.pause_reason}`;
          } else if (item.action === 'job_created' && item.details.customer) {
            detail += ` (${item.details.customer})`;
          } else if (item.action === 'job_updated' && item.details.fields) {
            detail += ` — changed: ${item.details.fields.slice(0, 5).join(', ')}`;
          }
        }

        html += `
          <div style="display:flex;align-items:flex-start;gap:12px;padding:10px 14px;border-bottom:1px solid var(--border);font-size:13px">
            <div style="min-width:70px;color:var(--muted);font-size:12px;padding-top:2px">${time}</div>
            <div style="min-width:120px">
              <span style="color:${color};font-weight:600;font-size:12px">${label}</span>
            </div>
            <div style="flex:1;color:var(--text)">${_alEsc(detail)}</div>
            <div style="min-width:80px;text-align:right;color:var(--muted);font-size:12px">${_alEsc(item.username || '—')}</div>
          </div>`;
      }
    }
    list.innerHTML = html;

    // Pager
    const pager = document.getElementById('alPager');
    const hasPrev = _alOffset > 0;
    const hasNext = _alOffset + _AL_LIMIT < data.total;
    pager.innerHTML = `
      ${hasPrev ? `<button class="btn btn-ghost" onclick="_alPage(-1)">← Newer</button>` : ''}
      <span style="font-size:12px;color:var(--muted);padding:8px">${_alOffset + 1}–${Math.min(_alOffset + _AL_LIMIT, data.total)} of ${data.total}</span>
      ${hasNext ? `<button class="btn btn-ghost" onclick="_alPage(1)">Older →</button>` : ''}`;

  } catch (e) {
    list.innerHTML = `<div style="color:var(--red);padding:20px">Error: ${e.message}</div>`;
  }
}

function _alPage(dir) {
  _alOffset += dir * _AL_LIMIT;
  if (_alOffset < 0) _alOffset = 0;
  _alLoad();
}

function _alEsc(s) {
  if (!s) return '';
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}
