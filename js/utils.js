/**
 * Dolphin ERP — Utilities
 * Preferences, toast, confirm dialog, modal, validation, formatting.
 */

// ── PREFERENCES ──────────────────────────────────────────────────────────────

const PREFS_KEY = 'dolphin-prefs';
const DEFAULT_PREFS = { theme: 'dark', fontScale: 'default', density: 'comfortable', timeUnit: 'minutes' };
let confirmResolve = () => {};

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return Object.assign({}, DEFAULT_PREFS, JSON.parse(raw));
  } catch {}
  try {
    const oldT = localStorage.getItem('dolphin-theme');
    if (oldT === 'light' || oldT === 'dark') return Object.assign({}, DEFAULT_PREFS, { theme: oldT });
  } catch {}
  return Object.assign({}, DEFAULT_PREFS);
}

function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {}
}

function applyPrefs(p) {
  document.documentElement.setAttribute('data-theme', p.theme);
  document.documentElement.setAttribute('data-font-scale', p.fontScale);
  document.documentElement.setAttribute('data-density', p.density);
  const isLight = p.theme === 'light';
  const sun  = document.getElementById('themeIconSun');
  const moon = document.getElementById('themeIconMoon');
  if (sun)  sun.style.display  = isLight ? '' : 'none';
  if (moon) moon.style.display = isLight ? 'none' : '';
  savePrefs(p);
}

function getPrefs()              { return loadPrefs(); }
function updatePref(key, value)  { const p = getPrefs(); p[key] = value; applyPrefs(p); }
function applyTheme(t)           { updatePref('theme', t); }
function toggleTheme()           { applyTheme(loadPrefs().theme === 'dark' ? 'light' : 'dark'); }

// ── TIME DISPLAY ──────────────────────────────────────────────────────────────

function getTimeUnit()  { return loadPrefs().timeUnit || 'minutes'; }
function timeUnitLabel(){ return getTimeUnit() === 'hours' ? 'hrs' : 'min'; }

function fmtWork(mins) {
  if (mins === null || mins === undefined) return '—';
  if (getTimeUnit() === 'hours') {
    const h = mins / 60;
    return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
  }
  return `${Math.round(mins)}min`;
}

function fmtSetup(mins) { return fmtWork(mins); }

function fmtTotal(totalMins) {
  if (getTimeUnit() === 'hours') return `${(totalMins / 60).toFixed(1)}h`;
  return `${Math.round(totalMins)}min`;
}

// ── IST CLOCK ─────────────────────────────────────────────────────────────────

function istNow() { return new Date(Date.now() + 5.5 * 3600000); }

function startClock() {
  function tick() {
    const d = istNow();
    const el = document.getElementById('istClock');
    if (el) el.textContent = `IST ${d.toUTCString().slice(17, 25)}`;
  }
  tick();
  setInterval(tick, 1000);
}

// ── TOAST ─────────────────────────────────────────────────────────────────────

function toast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `show ${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = ''; }, 3200);
}

// ── CONFIRM DIALOG ────────────────────────────────────────────────────────────

function confirm2(msg, btnLabel = 'Delete', btnClass = 'btn-danger') {
  return new Promise(res => {
    document.getElementById('confirmMsg').textContent = msg;
    const btn = document.getElementById('confirmOkBtn');
    btn.textContent = btnLabel;
    btn.className = 'btn ' + btnClass;
    document.getElementById('confirmOverlay').classList.add('open');
    confirmResolve = (v) => {
      document.getElementById('confirmOverlay').classList.remove('open');
      res(v);
    };
  });
}

// ── MODAL ─────────────────────────────────────────────────────────────────────

function showModal(title, body, footer, lg = false) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = body;
  document.getElementById('modalFooter').innerHTML = footer;
  document.getElementById('modal').className = 'modal' + (lg ? ' modal-lg' : '');
  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

// ── SIDEBAR (mobile) ──────────────────────────────────────────────────────────

function openSidebar() {
  document.querySelector('.sidebar').classList.add('open');
  document.getElementById('sidebarBackdrop').classList.add('open');
}

function closeSidebar() {
  document.querySelector('.sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('open');
}

// ── VALIDATION ────────────────────────────────────────────────────────────────

function attachValidation(fieldId, rules, errId) {
  const field = document.getElementById(fieldId);
  const errEl = document.getElementById(errId);
  if (!field || !errEl) return;

  function validate() {
    const val = field.value.trim();
    for (const rule of rules) {
      if (!rule.test(val, field)) {
        field.classList.add('invalid'); field.classList.remove('valid');
        errEl.textContent = rule.msg; errEl.classList.add('show');
        return false;
      }
    }
    field.classList.remove('invalid'); field.classList.add('valid');
    errEl.classList.remove('show');
    return true;
  }

  field.addEventListener('blur', validate);
  field.addEventListener('input', () => { if (field.classList.contains('invalid')) validate(); });
  field._validate = validate;
  return validate;
}

function validateAll(fieldIds) {
  let ok = true;
  fieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (el && el._validate && !el._validate()) ok = false;
  });
  return ok;
}

function clearValidation(...ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('invalid', 'valid');
    const err = document.getElementById(id + '_err');
    if (err) err.classList.remove('show');
  });
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.classList.toggle('btn-loading', loading);
}

// ── FORMATTING ────────────────────────────────────────────────────────────────

function fmtINR(n) {
  if (n === null || n === undefined || n === '') return '—';
  const num = parseFloat(n);
  if (isNaN(num)) return '—';
  return '₹' + num.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function fmtDT(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' +
         d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtD(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

function toDatePart(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('sv-SE'); // YYYY-MM-DD
}

function toTimePart(iso) {
  if (!iso) return '08:00';
  const d = new Date(iso);
  return isNaN(d) ? '08:00' : d.toTimeString().slice(0, 5);
}

function dtFieldVal(dateId, timeId) {
  const d = document.getElementById(dateId)?.value;
  const t = document.getElementById(timeId)?.value || '00:00';
  return d ? `${d}T${t}` : '';
}

function makeDTField(dateId, timeId, isoVal, required) {
  const dp = toDatePart(isoVal), tp = toTimePart(isoVal);
  return `<div class="dt-field">
    <input type="date" id="${dateId}" value="${dp}" ${required ? 'required' : ''}>
    <input type="time" id="${timeId}" value="${tp}">
  </div>`;
}

function toLocalInput(iso) { return iso ? iso.slice(0, 16) : ''; }

function crColor(cr) {
  return cr < 0 ? '#ef4444' : cr < 0.5 ? '#ef4444' : cr < 1 ? '#f97316' : cr < 1.5 ? '#f59e0b' : '#10b981';
}

function crBar(cr) {
  const w = Math.min(100, Math.max(0, cr < 0 ? 100 : (cr / 3) * 100));
  return `<div class="cr-bar"><div class="cr-track"><div class="cr-fill" style="width:${w}%;background:${crColor(cr)}"></div></div><span class="cr-val mono" style="font-size:10px">${cr < 0 ? '!' : cr.toFixed(1)}</span></div>`;
}

function sBadge(s) {
  const m = { pending: 'badge-pending', scheduled: 'badge-scheduled', in_progress: 'badge-inprog', completed: 'badge-done' };
  const l = { pending: 'Pending', scheduled: 'Scheduled', in_progress: 'In Prog', completed: 'Done' };
  return `<span class="badge ${m[s] || 'badge-pending'}">${l[s] || s}</span>`;
}

// Flag-and-wait health badge. `health` is one of on_track | at_risk | late | unknown.
function healthBadge(health) {
  const m = {
    on_track: { c: 'var(--green,#10b981)', t: '● On track', bg: 'rgba(16,185,129,.12)' },
    at_risk:  { c: 'var(--amber,#f59e0b)', t: '▲ At risk',  bg: 'rgba(245,158,11,.14)' },
    late:     { c: 'var(--red,#ef4444)',   t: '■ Late',     bg: 'rgba(239,68,68,.14)' },
    unknown:  { c: 'var(--muted,#888)',    t: '— Unscheduled', bg: 'rgba(136,136,136,.10)' },
  };
  const h = m[health] || m.unknown;
  return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;
    padding:2px 8px;border-radius:11px;color:${h.c};background:${h.bg};white-space:nowrap">${h.t}</span>`;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── DOM INIT ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  applyPrefs(loadPrefs());
  startClock();

  document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
  document.getElementById('menuBtn')?.addEventListener('click', openSidebar);
  document.getElementById('sidebarBackdrop')?.addEventListener('click', closeSidebar);

  // Close sidebar on nav tap (mobile)
  document.querySelectorAll('.sidebar .nav-item').forEach(el => {
    el.addEventListener('click', () => { if (window.innerWidth <= 980) closeSidebar(); });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSidebar(); closeModal(); }
  });
});
