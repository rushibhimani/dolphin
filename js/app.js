/**
 * Dolphin ERP — App Bootstrap
 * Initialises the app on DOMContentLoaded:
 *  1. Load all data
 *  2. Start hash router
 *  3. Poll server status
 */

// ── SCHEDULE ALL ──────────────────────────────────────────────────────────────

async function scheduleAll() {
  try {
    const r = await api('POST', '/api/schedule-all');
    let msg = `Scheduled ${r.scheduled} jobs`;
    if (r.skipped_active > 0) msg += ` · ${r.skipped_active} protected`;
    if (r.frozen_count  > 0) msg += ` · 🔒 ${r.frozen_count} frozen`;
    if (r.preempted     > 0) msg += ` · ⚡ ${r.preempted} paused for urgent`;
    if (r.unassigned_ops > 0) msg += ` · ⚠ ${r.unassigned_ops} unassigned`;
    toast(msg, r.unassigned_ops > 0 ? 'error' : 'success');
    await loadAll();
    handleRoute();
  } catch (e) { toast(e.message, 'error'); }
}

// ── SEED DATA ─────────────────────────────────────────────────────────────────

async function seedData() {
  try {
    const r = await api('POST', '/api/seed');
    toast(r.msg);
    await loadAll();
    handleRoute();
  } catch (e) { toast(e.message, 'error'); }
}

async function seedRealSetup() {
  try {
    const r = await api('POST', '/api/seed-real');
    toast(r.msg || 'Real setup loaded');
    await loadAll();
    handleRoute();
  } catch (e) { toast(e.message, 'error'); }
}

async function seedPunchRoutings() {
  try {
    const r = await api('POST', '/api/seed-punch-routings');
    toast(r.msg);
    await loadAll();
    if (window.location.hash.includes('routing')) handleRoute();
  } catch (e) { toast(e.message, 'error'); }
}

// ── URGENT / FREEZE (job quick actions) ───────────────────────────────────────

async function setUrgent(id) {
  try {
    await api('PUT', `/api/jobs/${id}`, { priority_flag: true });
    toast('🚨 Marked urgent');
    await loadAll();
    handleRoute();
  } catch (e) { toast(e.message, 'error'); }
}

async function toggleFreeze(id) {
  try {
    const r = await api('POST', `/api/jobs/${id}/toggle-freeze`);
    toast(r.is_frozen ? '🔒 Job frozen' : '🔓 Job unfrozen');
    await loadAll();
    handleRoute();
  } catch (e) { toast(e.message, 'error'); }
}

// ── BOTTOM NAV (updated by applyRoleUI based on role) ────────────────────────

function updateBottomNav(page) {
  document.querySelectorAll('.bn-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
}

// ── Role-based UI: hide/show nav items and bottom nav ─────────────────────────

function applyRoleUI(user) {
  const role = user?.role || 'operator';
  const perms = user?.permissions || {};
  const allowedPages = new Set(perms.pages || []);

  // ── Sidebar nav items ──
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    const page = el.dataset.page;
    const show = allowedPages.has(page) ||
                 // sub-routes: job-new/job-edit fall under 'jobs', order under 'orders'
                 (page === 'jobs' && allowedPages.has('jobs')) ||
                 (page === 'orders' && allowedPages.has('orders'));
    el.style.display = show ? '' : 'none';
  });

  // ── Section labels: hide "Setup" group label if nothing under it is visible ──
  document.querySelectorAll('.nav-group').forEach(label => {
    // Find all nav-items until the next nav-group
    let sibling = label.nextElementSibling;
    let anyVisible = false;
    while (sibling && !sibling.classList.contains('nav-group')) {
      if (sibling.classList.contains('nav-item') && sibling.style.display !== 'none') {
        anyVisible = true; break;
      }
      sibling = sibling.nextElementSibling;
    }
    label.style.display = anyVisible ? '' : 'none';
  });

  // ── Bottom nav: only show items this role can access ──
  const BOT_NAV_ITEMS = [
    { page: 'dashboard', icon: '⊞', label: 'Home' },
    { page: 'today',     icon: '⏱', label: 'Today' },
    { page: 'jobs',      icon: '📋', label: 'Jobs' },
    { page: 'orders',    icon: '📦', label: 'Orders' },
    { page: 'schedule',  icon: '📅', label: 'Gantt' },
  ];
  const nav = document.getElementById('bottomNav');
  if (nav) {
    const visible = BOT_NAV_ITEMS.filter(it => allowedPages.has(it.page));
    nav.innerHTML = visible.map(it =>
      `<button class="bn-item" data-page="${it.page}" onclick="navigate('/${it.page}')">
        <span class="bn-icon">${it.icon}</span>
        <span class="bn-label">${it.label}</span>
      </button>`
    ).join('');
  }

  // ── Operator: hide entire sidebar shell, show only Today ──
  if (role === 'operator') {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.style.display = 'none';
  }
}

// ── APP INIT ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // ── Auth gate ──
  if(!authLoadFromStorage()){
    window.location.href = '/login';
    return;
  }

  const user = authGetUser();

  // Show user name + logout button in topbar
  const nameEl  = document.getElementById('topbarUserName');
  const logoutEl = document.getElementById('btnLogout');
  if(nameEl)   { nameEl.textContent = user?.display_name || user?.username || ''; nameEl.style.display = ''; }
  if(logoutEl) { logoutEl.style.display = ''; }

  // Apply role-based nav (sidebar + bottom nav)
  applyRoleUI(user);

  // Operator: go straight to Today's Work
  if(user?.role === 'operator'){
    await loadAll();
    navigate('/today', true);
    setInterval(checkServer, 30000);
    return;
  }

  // Manager / Admin: full app
  await loadAll();
  if(!window.location.hash || window.location.hash === '#'){
    navigate('/dashboard', true);
  } else {
    handleRoute();
  }
  setInterval(checkServer, 30000);
});
