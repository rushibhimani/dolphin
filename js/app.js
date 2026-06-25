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
    // ── Step 1: Preview what would happen ──
    const preview = await api('GET', '/api/schedule-all/preview');
    const toSched  = preview.to_schedule.length;
    const frozen   = preview.frozen.length;
    const active   = preview.active_protected.length;
    const noRoute  = preview.no_routing.length;
    const resched  = preview.to_schedule.filter(j => j.has_existing_schedule).length;

    if (toSched === 0) {
      toast('No pending jobs to schedule', 'info');
      return;
    }

    // ── Step 2: Build confirmation message ──
    let lines = [`Schedule ${toSched} job${toSched !== 1 ? 's' : ''}?`];
    if (resched > 0) lines.push(`• ${resched} will be rescheduled (existing schedule replaced)`);
    if (frozen > 0)  lines.push(`• ${frozen} frozen/on-hold — skipped`);
    if (active > 0)  lines.push(`• ${active} with active ops — protected`);
    if (noRoute > 0) lines.push(`• ${noRoute} have no routing — will fail`);
    lines.push('');
    // Show first few job numbers being scheduled
    const show = preview.to_schedule.slice(0, 8);
    lines.push('Jobs: ' + show.map(j => j.job_number).join(', ') +
               (toSched > 8 ? ` … +${toSched - 8} more` : ''));

    const ok = await confirm2(lines.join('\n'), '⚡ Schedule All', 'btn-primary');
    if (!ok) return;

    // ── Step 3: Execute ──
    const r = await api('POST', '/api/schedule-all');
    let msg = `Scheduled ${r.scheduled} jobs`;
    if (r.skipped_active > 0) msg += ` · ${r.skipped_active} protected`;
    if (r.frozen_count  > 0) msg += ` · 🔒 ${r.frozen_count} frozen`;
    if (r.preempted     > 0) msg += ` · ⚡ ${r.preempted} paused for urgent`;
    if (r.unassigned_ops > 0) msg += ` · ⚠ ${r.unassigned_ops} unassigned`;
    if (r.failed > 0) msg += ` · ❌ ${r.failed} could NOT schedule`;
    const hadProblem = r.unassigned_ops > 0 || r.failed > 0;
    toast(msg, hadProblem ? 'error' : 'success');
    // Show exactly which jobs failed and why
    if (r.failures && r.failures.length) {
      const detail = r.failures.slice(0, 6)
        .map(f => `• ${f.job_number}: ${f.reason}`).join('\n');
      const more = r.failures.length > 6 ? `\n…and ${r.failures.length - 6} more` : '';
      setTimeout(() => toast(`Could not schedule:\n${detail}${more}`, 'error'), 400);
    }
    await loadAll();
    if (typeof refreshAtRiskCount === 'function') refreshAtRiskCount();
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

  // Page aliases: a page that doesn't appear in user's permissions inherits
  // from its "parent" page. Dispatch Sheet is a view onto today's work, so it
  // inherits today's permission. Product Schema is an admin sibling to
  // Routings — anyone who can edit routings should be able to edit the schema.
  const PAGE_ALIASES = {
    dispatch: 'today',
    'at-risk': 'today',
    'product-schema': 'routings',
  };

  function _pageLevel(page) {
    if(typeof pageLevels[page] === 'number') return pageLevels[page];
    if(legacyPages.has(page)) return 3;
    const alias = PAGE_ALIASES[page];
    if(alias){
      if(typeof pageLevels[alias] === 'number') return pageLevels[alias];
      if(legacyPages.has(alias)) return 3;
    }
    return 0;
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
    if (typeof initNotifications === 'function') initNotifications();
    navigate('/today', true);
    setInterval(checkServer, 30000);
    return;
  }

  // Staff (office): sidebar visible, land on Tasks page
  if(user?.role === 'staff'){
    await loadAll();
    if (typeof initNotifications === 'function') initNotifications();
    navigate('/tasks', true);
    setInterval(checkServer, 30000);
    return;
  }

  // Manager / Admin: full app
  await loadAll();
  // Init notification bell (all roles)
  if (typeof initNotifications === 'function') initNotifications();
  // Flag-and-wait: populate the At Risk nav badge, and keep it fresh
  if (typeof refreshAtRiskCount === 'function') {
    refreshAtRiskCount();
    setInterval(refreshAtRiskCount, 60000);
  }
  // If at root or no meaningful path, go to dashboard; otherwise honour the URL
  const initPath = window.location.pathname;
  if (!initPath || initPath === '/' || initPath === '/index.html') {
    navigate('/dashboard', true);
  } else {
    handleRoute();
  }
  setInterval(checkServer, 30000);
});
