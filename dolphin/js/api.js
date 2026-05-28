/**
 * Dolphin ERP — API Client
 * Central fetch wrapper + global data store.
 */

const API = '';   // Same-origin — no hardcoded localhost

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
 * Core fetch wrapper. Injects auth token. Throws on non-ok responses.
 */
async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = authGetToken();
  if(token) headers['Authorization'] = `Bearer ${token}`;

  const opts = { method, headers };
  if(body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(API + path, opts);

  if(res.status === 401){
    authHandle401();
    throw new Error('Session expired. Please log in again.');
  }

  if(!res.ok){
    let msg = `${method} ${path} → ${res.status}`;
    try { const j = await res.json(); msg = j.detail || j.message || msg; } catch {}
    throw new Error(msg);
  }
  if(res.status === 204) return null;
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
  } catch(e) {
    console.error('loadAll failed:', e);
    setServerStatus(false);
  }
}

async function checkServer() {
  try {
    await api('GET', '/api/health');
    setServerStatus(true);
  } catch {
    setServerStatus(false);
  }
}

function setServerStatus(online) {
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('serverStatus');
  if(dot)  dot.className   = online ? 'dot dot-green' : 'dot dot-red';
  if(text) text.textContent = online ? 'Connected' : 'Offline';
}

function buildMachineOpts(selectedId) {
  return allMachines.map(m =>
    `<option value="${m.id}" ${m.id == selectedId ? 'selected' : ''}>${m.name}</option>`
  ).join('');
}
