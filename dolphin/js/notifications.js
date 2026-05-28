/**
 * Dolphin ERP — Notification System
 * Real-time bell icon + panel for manager/admin users only.
 * Polls every 30s. Supports browser push for urgent events.
 */

let _notifOpen       = false;
let _notifPollTimer  = null;
let _notifLastCount  = 0;
let _notifPushAsked  = false;

const NOTIF_ICONS = {
  assembly_unlocked:  '🔧',
  job_urgent:         '🚨',
  machine_breakdown:  '🔴',
  outside_received:   '📥',
  order_due_soon:     '⏰',
  assembly_complete:  '✅',
};

const NOTIF_COLORS = {
  assembly_unlocked:  'var(--accent)',
  job_urgent:         'var(--red,#DC2626)',
  machine_breakdown:  'var(--red,#DC2626)',
  outside_received:   'var(--green,#16a34a)',
  order_due_soon:     'var(--amber,#d97706)',
  assembly_complete:  'var(--green,#16a34a)',
};

// ── Initialise after login ────────────────────────────────────────────────────
function initNotifications() {
  const user = authGetUser();
  if (!user || !['admin','manager'].includes(user.role)) {
    // Hide bell for operators/staff
    const wrap = document.getElementById('notifBellWrap');
    if (wrap) wrap.style.display = 'none';
    return;
  }

  const wrap = document.getElementById('notifBellWrap');
  if (wrap) wrap.style.display = 'flex';

  // Initial load
  _pollNotifications();

  // Poll every 30 seconds
  if (_notifPollTimer) clearInterval(_notifPollTimer);
  _notifPollTimer = setInterval(_pollNotifications, 30000);

  // Ask for browser push permission once
  if (!_notifPushAsked && 'Notification' in window && Notification.permission === 'default') {
    _notifPushAsked = true;
    // Ask politely after 5 seconds (not immediately on load)
    setTimeout(() => {
      Notification.requestPermission();
    }, 5000);
  }
}

// ── Poll unread count ─────────────────────────────────────────────────────────
async function _pollNotifications() {
  const user = authGetUser();
  if (!user || !['admin','manager'].includes(user.role)) return;
  try {
    const data = await api('GET', '/api/notifications/count');
    const count = data.unread || 0;
    _updateBadge(count);

    // If new notifications arrived since last poll → browser push for urgent ones
    if (count > _notifLastCount && count > 0) {
      const newCount = count - _notifLastCount;
      _tryBrowserPush(newCount);
    }
    _notifLastCount = count;

    // If panel is open, refresh the list
    if (_notifOpen) _loadNotifList();
  } catch(e) {
    // Silent fail — server might be restarting
  }
}

function _updateBadge(count) {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  if (count > 0) {
    badge.style.display = 'block';
    badge.textContent   = count > 99 ? '99+' : count;
  } else {
    badge.style.display = 'none';
  }
}

// ── Browser push ──────────────────────────────────────────────────────────────
async function _tryBrowserPush(newCount) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    // Fetch latest unread to get the most urgent one
    const notifs = await api('GET', '/api/notifications?unread_only=true');
    const urgent  = notifs.find(n => ['job_urgent','machine_breakdown'].includes(n.event_type));
    const first   = urgent || notifs[0];
    if (!first) return;
    new Notification(first.title, {
      body: first.body,
      icon: '/logo.png',
      tag:  `dolphin-${first.event_type}`,   // replaces previous same-type notification
      requireInteraction: ['job_urgent','machine_breakdown'].includes(first.event_type),
    });
  } catch(e) { /* ignore */ }
}

// ── Toggle panel ──────────────────────────────────────────────────────────────
function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  _notifOpen = !_notifOpen;
  panel.style.display = _notifOpen ? 'block' : 'none';
  if (_notifOpen) _loadNotifList();
}

// Close panel when clicking outside
document.addEventListener('click', function(e) {
  if (!_notifOpen) return;
  const wrap = document.getElementById('notifBellWrap');
  if (wrap && !wrap.contains(e.target)) {
    _notifOpen = false;
    const panel = document.getElementById('notifPanel');
    if (panel) panel.style.display = 'none';
  }
});

// ── Load notification list ────────────────────────────────────────────────────
async function _loadNotifList() {
  const listEl = document.getElementById('notifList');
  if (!listEl) return;
  try {
    const notifs = await api('GET', '/api/notifications');
    if (!notifs.length) {
      listEl.innerHTML = `
        <div style="padding:28px 20px;text-align:center;color:var(--muted);font-size:13px">
          <div style="font-size:28px;margin-bottom:8px">🔔</div>
          All caught up!
        </div>`;
      return;
    }

    listEl.innerHTML = notifs.map(n => _notifCardHTML(n)).join('');
  } catch(e) {
    listEl.innerHTML = `<div style="padding:16px;color:var(--red);font-size:12px">Failed to load notifications</div>`;
  }
}

function _notifCardHTML(n) {
  const icon  = NOTIF_ICONS[n.event_type]  || '📌';
  const color = NOTIF_COLORS[n.event_type] || 'var(--muted)';
  const ago   = _timeAgo(n.created_at);
  const unread = !n.is_read;

  return `
    <div onclick="notifClick(${n.id},'${n.link||''}')"
      style="display:flex;gap:10px;padding:10px 14px;cursor:pointer;
             background:${unread ? 'var(--accent-soft,rgba(245,158,11,.07))' : 'transparent'};
             border-bottom:1px solid var(--border);transition:background .15s"
      onmouseover="this.style.background='var(--surface)'"
      onmouseout="this.style.background='${unread ? 'var(--accent-soft,rgba(245,158,11,.07))' : 'transparent'}'">
      <div style="font-size:20px;flex-shrink:0;width:28px;text-align:center;padding-top:1px">${icon}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:${unread?'700':'500'};color:var(--text);
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(n.title)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;line-height:1.4">${escHtml(n.body)}</div>
        <div style="font-size:10px;color:${color};margin-top:3px;font-weight:600">${ago}</div>
      </div>
      ${unread ? `<div style="width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0;margin-top:5px"></div>` : ''}
    </div>`;
}

async function notifClick(id, link) {
  // Mark as read
  try { await api('PUT', `/api/notifications/${id}/read`); } catch(e) {}
  // Navigate
  if (link && link !== 'undefined') {
    toggleNotifPanel();
    navigate(link);
  }
  // Refresh badge
  _pollNotifications();
}

async function markAllNotifsRead() {
  try {
    await api('PUT', '/api/notifications/read-all');
    _updateBadge(0);
    _notifLastCount = 0;
    _loadNotifList();
  } catch(e) { toast(e.message, 'error'); }
}

// ── Time ago helper ───────────────────────────────────────────────────────────
function _timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 60)   return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400)return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}
