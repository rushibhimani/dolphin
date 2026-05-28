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
    const r = await api('POST', '/api/seed-real', {});
    if (r.has_data) {
      const ok = await confirm2('Workers/machines already exist. Load Real Setup anyway? This will add missing entries.', 'Load Real Setup');
      if (!ok) return;
      const r2 = await api('POST', '/api/seed-real', { force: true });
      toast(r2.msg || 'Real setup loaded');
    } else {
      toast(r.msg || 'Real setup loaded');
    }
    await loadAll();
    handleRoute();
  } catch (e) { toast(e.message, 'error'); }
}

async function seedPunchRoutings() {
  try {
    const r = await api('POST', '/api/seed-punch-routings');
    toast(r.msg);
    await loadAll();
    if (window.location.pathname.includes('routing')) handleRoute();
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

// ── User menu ─────────────────────────────────────────────────────────────────
function toggleUserMenu(){
  const m = document.getElementById('userMenu');
  if(!m) return;
  const isOpen = m.style.display === 'block';
  m.style.display = isOpen ? 'none' : 'block';
  if(!isOpen){
    // Close on outside click
    setTimeout(()=>{
      const close = (e) => {
        if(!document.getElementById('userMenuWrap')?.contains(e.target)){
          m.style.display = 'none';
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 10);
  }
}

// ── Role-based UI: hide/show nav items and bottom nav ─────────────────────────

function applyRoleUI(user) {
  const role = user?.role || 'operator';
  const perms = user?.permissions || {};
  // Support both new page_levels and legacy pages array
  const pageLevels = perms.page_levels || {};
  const legacyPages = new Set(perms.pages || []);

  function _pageLevel(page) {
    if(typeof pageLevels[page] === 'number') return pageLevels[page];
    return legacyPages.has(page) ? 3 : 0;
  }

  // ── Sidebar nav items — show if level >= 1 (any access) ──
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    const page = el.dataset.page;
    el.style.display = _pageLevel(page) >= 1 ? '' : 'none';
  });

  // ── Section labels: hide group label if nothing under it is visible ──
  document.querySelectorAll('.nav-group').forEach(label => {
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

  // ── Bottom nav ──
  const BOT_NAV_ITEMS = [
    { page: 'dashboard', icon: '⊞', label: 'Home'  },
    { page: 'today',     icon: '⏱', label: 'Floor' },
    { page: 'tasks',     icon: '✓',  label: 'Tasks' },
    { page: 'jobs',      icon: '📋', label: 'Jobs'  },
    { page: 'orders',    icon: '📦', label: 'Orders'},
    { page: 'schedule',  icon: '📅', label: 'Gantt' },
  ];
  const nav = document.getElementById('bottomNav');
  if (nav) {
    const visible = BOT_NAV_ITEMS.filter(it => _pageLevel(it.page) >= 1);
    nav.innerHTML = visible.map(it =>
      `<button class="bn-item" data-page="${it.page}" onclick="navigate('/${it.page}')">
        <span class="bn-icon">${it.icon}</span>
        <span class="bn-label">${it.label}</span>
      </button>`
    ).join('');
  }

  // ── Operator (shop floor): hide sidebar, go straight to Today ──
  if (role === 'operator') {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.style.display = 'none';
  }

  // ── Staff (office): show sidebar, default page is Tasks ──
  // Sidebar is already visible by default — nothing to hide
}

// ── APP INIT ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // ── Auth gate ──
  if(!authLoadFromStorage()){
    window.location.href = '/login';
    return;
  }

  let user = authGetUser();

  // ── Always refresh permissions from server ──
  // The token in localStorage may have old permissions (e.g. before 'tasks' was added).
  // /api/auth/me re-reads PERMISSIONS from auth.py using the current token's role,
  // so we always get the latest page list without requiring a re-login.
  try {
    const me = await fetch('/api/auth/me', {
      headers: { 'Authorization': 'Bearer ' + authGetToken() }
    });
    if(me.ok){
      const meData = await me.json();
      user = { ...user, permissions: meData.permissions };
      authSaveSession(authGetToken(), user);
    }
  } catch(e) { /* offline — use cached permissions */ }

  // Show user avatar button with initial
  const userBtn  = document.getElementById('userMenuBtn');
  const initial  = document.getElementById('userInitial');
  const menuName = document.getElementById('userMenuName');
  if(userBtn){
    userBtn.style.display = 'flex';
    userBtn.style.alignItems = 'center';
    userBtn.style.justifyContent = 'center';
  }
  if(initial)  initial.textContent = (user?.display_name || user?.username || 'A')[0].toUpperCase();
  if(menuName) menuName.textContent = (user?.display_name || user?.username || '');

  // Apply role-based nav (sidebar + bottom nav)
  applyRoleUI(user);

  // Operator (shop floor): sidebar hidden, go straight to Today's Work
  if(user?.role === 'operator'){
    await loadAll();
    navigate('/today', true);
    setInterval(checkServer, 30000);
    return;
  }

  // Staff (office): sidebar visible, land on Tasks page
  if(user?.role === 'staff'){
    await loadAll();
    navigate('/tasks', true);
    setInterval(checkServer, 30000);
    return;
  }

  // Manager / Admin: full app
  await loadAll();
  // Init notification bell (manager/admin only)
  if (typeof initNotifications === 'function') initNotifications();
  // If at root or no meaningful path, go to dashboard; otherwise honour the URL
  const initPath = window.location.pathname;
  if (!initPath || initPath === '/' || initPath === '/index.html') {
    navigate('/dashboard', true);
  } else {
    handleRoute();
  }
  setInterval(checkServer, 30000);
});
