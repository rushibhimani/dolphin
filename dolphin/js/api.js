/**
 * Dolphin ERP — API Client
 * Central fetch wrapper + global data store.
 */

const API = 'http://localhost:8000';

// Global data cache — loaded once, used everywhere
let allMachines  = [];
let allRoutings  = [];
let allJobs      = [];
let allCustomers = [];
let allWorkers   = [];
let allOrders    = [];

// Editor state
let routingOps = [];
let jobFormOps = [];

/**
 * Core fetch wrapper. Throws on non-ok responses with server error message.
 * @param {string} method GET|POST|PUT|DELETE
 * @param {string} path   API path e.g. '/api/jobs'
 * @param {object} body   Optional request body
 */
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(API + path, opts);
  if (!res.ok) {
    let msg = `${method} ${path} → ${res.status}`;
    try { const j = await res.json(); msg = j.detail || j.message || msg; } catch {}
    throw new Error(msg);
  }
  // 204 No Content
  if (res.status === 204) return null;
  return res.json();
}

/**
 * Load all global data in parallel.
 * Called on app init and after mutations.
 */
async function loadAll() {
  try {
    const [machines, routings, jobs, customers, workers, orders] = await Promise.all([
      api('GET', '/api/workcenters'),
      api('GET', '/api/routings'),
      api('GET', '/api/jobs'),
      api('GET', '/api/customers'),
      api('GET', '/api/workers'),
      api('GET', '/api/orders').catch(() => []),
    ]);
    allMachines  = machines  || [];
    allRoutings  = routings  || [];
    allJobs      = jobs      || [];
    allCustomers = customers || [];
    allWorkers   = workers   || [];
    allOrders    = orders    || [];
  } catch (e) {
    console.error('loadAll failed:', e);
    setServerStatus(false);
  }
}

/**
 * Check server connectivity and update status indicator.
 */
async function checkServer() {
  try {
    await fetch(API + '/api/workcenters', { method: 'HEAD' }).catch(() =>
      fetch(API + '/api/workcenters')
    );
    setServerStatus(true);
  } catch {
    setServerStatus(false);
  }
}

function setServerStatus(online) {
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('serverStatus');
  if (dot)  dot.className  = online ? 'dot dot-green' : 'dot dot-red';
  if (text) text.textContent = online ? 'Connected' : 'Offline';
}

// Helper: build <option> list for machine selector
function buildMachineOpts(selectedId) {
  return allMachines.map(m =>
    `<option value="${m.id}" ${m.id == selectedId ? 'selected' : ''}>${m.name}</option>`
  ).join('');
}
