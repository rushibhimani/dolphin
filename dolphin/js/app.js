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

// ── BOTTOM NAV (mobile) ───────────────────────────────────────────────────────

function buildBottomNav() {
  const nav = document.getElementById('bottomNav');
  if (!nav) return;
  const items = [
    { page: 'dashboard', icon: '⊞', label: 'Home' },
    { page: 'today',     icon: '⏱', label: 'Today' },
    { page: 'jobs',      icon: '📋', label: 'Jobs' },
    { page: 'orders',    icon: '📦', label: 'Orders' },
    { page: 'schedule',  icon: '📅', label: 'Gantt' },
  ];
  nav.innerHTML = items.map(it =>
    `<button class="bn-item" data-page="${it.page}" onclick="navigate('/${it.page}')">
      <span class="bn-icon">${it.icon}</span>
      <span class="bn-label">${it.label}</span>
    </button>`
  ).join('');
}

function updateBottomNav(page) {
  document.querySelectorAll('.bn-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
}

// ── APP INIT ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Build bottom nav for mobile
  buildBottomNav();

  // Load all data then start router
  await loadAll();

  // If no hash set, default to dashboard
  if (!window.location.hash || window.location.hash === '#') {
    navigate('/dashboard', true);
  } else {
    handleRoute();
  }

  // Poll server status every 30 seconds
  setInterval(checkServer, 30000);
});
