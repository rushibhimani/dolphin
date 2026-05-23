/**
 * Dolphin ERP — Hash Router
 * Maps #/route patterns to page renderer functions.
 * Supports back/forward navigation and parameterized routes.
 */

const ROUTES = [
  // Main pages
  { pattern: /^#?\/?(dashboard)?$/,         page: 'dashboard',    title: 'Dashboard' },
  { pattern: /^#\/today$/,                   page: 'today',        title: "Today's Work" },
  { pattern: /^#\/upcoming$/,                page: 'upcoming',     title: 'Upcoming' },
  { pattern: /^#\/schedule$/,                page: 'schedule',     title: 'Gantt Schedule' },
  { pattern: /^#\/capacity$/,                page: 'capacity',     title: 'Capacity' },
  { pattern: /^#\/floorplan$/,               page: 'floorplan',    title: 'Floor Plan' },
  { pattern: /^#\/reports$/,                 page: 'reports',      title: 'Reports' },
  { pattern: /^#\/settings$/,                page: 'settings',     title: 'Settings' },

  // Jobs
  { pattern: /^#\/jobs$/,                    page: 'jobs',         title: 'Jobs' },
  { pattern: /^#\/jobs\/new$/,               page: 'job-new',      title: 'New Job' },
  { pattern: /^#\/jobs\/(\d+)$/,             page: 'job-edit',     title: 'Edit Job',    param: 'jobId' },

  // Orders
  { pattern: /^#\/orders$/,                  page: 'orders',       title: 'Orders' },
  { pattern: /^#\/orders\/new$/,             page: 'order-new',    title: 'New Order' },
  { pattern: /^#\/orders\/(\d+)$/,           page: 'order-edit',   title: 'Edit Order',  param: 'orderId' },

  // Quote
  { pattern: /^#\/quote$/,                   page: 'quote',        title: 'Quote' },

  // Routings
  { pattern: /^#\/routings$/,                page: 'routings',     title: 'Routings' },
  { pattern: /^#\/routings\/new$/,           page: 'routing-new',  title: 'New Routing' },
  { pattern: /^#\/routings\/(\d+)$/,         page: 'routing-edit', title: 'Edit Routing', param: 'routingId' },
  { pattern: /^#\/routing-stats$/,           page: 'routing-stats', title: 'Routing Stats' },

  // Setup pages
  { pattern: /^#\/machines$/,                page: 'machines',     title: 'Machines' },
  { pattern: /^#\/workers$/,                 page: 'workers',      title: 'Workers' },
  { pattern: /^#\/customers$/,               page: 'customers',    title: 'Customers' },
];

// Resolve hash to { page, params, title }
function resolveRoute(hash) {
  const h = hash || window.location.hash || '#/dashboard';
  for (const route of ROUTES) {
    const m = h.match(route.pattern);
    if (m) {
      const params = {};
      if (route.param && m[1]) params[route.param] = parseInt(m[1]);
      return { page: route.page, params, title: route.title };
    }
  }
  return { page: 'dashboard', params: {}, title: 'Dashboard' };
}

// Navigate to a route — pushes to history
function navigate(path, replace = false) {
  const hash = path.startsWith('#') ? path : '#' + path;
  if (replace) {
    history.replaceState(null, '', hash);
  } else {
    history.pushState(null, '', hash);
  }
  handleRoute();
}

// Go back (or fall back to dashboard)
function goBack(fallback = '/dashboard') {
  if (history.length > 2) {
    history.back();
  } else {
    navigate(fallback);
  }
}

// Main route handler — called on hashchange and popstate
async function handleRoute() {
  const { page, params, title } = resolveRoute(window.location.hash);

  // Update page title
  document.title = `${title} — Dolphin ERP`;
  document.getElementById('pageTitle').textContent = title;

  // Highlight active nav item
  navActive(page);

  // Stop any running timers from previous page
  if (window._pageCleanup) {
    window._pageCleanup();
    window._pageCleanup = null;
  }

  // Show loading state
  const content = document.getElementById('content');
  content.innerHTML = `<div class="page-loading"><div class="spinner"></div></div>`;

  // Update topbar actions for this page
  renderTopbarActions(page, params);

  try {
    switch (page) {
      case 'dashboard':    await renderDashboard(); break;
      case 'today':        await renderToday(); break;
      case 'upcoming':     await renderUpcoming(); break;
      case 'jobs':         await renderJobs(); break;
      case 'job-new':      await renderJobEditor(null); break;
      case 'job-edit':     await renderJobEditor(params.jobId); break;
      case 'orders':       await renderOrders(); break;
      case 'order-new':    await renderOrderEditor(null); break;
      case 'order-edit':   await renderOrderEditor(params.orderId); break;
      case 'quote':        await renderQuote(); break;
      case 'schedule':     await renderSchedule(); break;
      case 'capacity':     await renderCapacity(); break;
      case 'floorplan':    await renderFloorPlan(); break;
      case 'routings':     await renderRoutings(); break;
      case 'routing-new':  await renderRoutingEditor(null); break;
      case 'routing-edit': await renderRoutingEditor(params.routingId); break;
      case 'routing-stats': await renderRoutingStats(); break;
      case 'machines':     await renderMachines(); break;
      case 'workers':      await renderWorkers(); break;
      case 'customers':    await renderCustomers(); break;
      case 'reports':      await renderReports(); break;
      case 'settings':     await renderSettings(); break;
      default:             await renderDashboard();
    }
  } catch (e) {
    console.error('Page render error:', e);
    content.innerHTML = `
      <div class="page-error">
        <div class="page-error-icon">⚠</div>
        <div class="page-error-msg">${e.message || 'Failed to load page'}</div>
        <button class="btn btn-secondary" onclick="handleRoute()">↻ Retry</button>
      </div>`;
  }
}

// Topbar context actions per page
function renderTopbarActions(page, params = {}) {
  const el = document.getElementById('topbarActions');
  if (!el) return;

  const actions = {
    'dashboard':    `<button class="btn btn-primary" onclick="scheduleAll()">⚡ Schedule All</button>`,
    'jobs':         `<button class="btn btn-secondary" onclick="scheduleAll()">⚡ Schedule All</button><button class="btn btn-primary" onclick="navigate('/jobs/new')">+ New Job</button>`,
    'job-new':      `<button class="btn btn-ghost" onclick="goBack('/jobs')">← Back</button>`,
    'orders':       `<button class="btn btn-primary" onclick="navigate('/orders/new')">+ New Order</button>`,
    'quote':        `<button class="btn btn-secondary" onclick="navigate('/orders/new')">+ New Order</button>`,
    'routings':     `<button class="btn btn-primary" onclick="navigate('/routings/new')">+ New Routing</button>`,
    'machines':     `<button class="btn btn-primary" onclick="openMachineModal(null)">+ Add Machine</button>`,
    'workers':      `<button class="btn btn-primary" onclick="openWorkerModal(null)">+ Add Worker</button>`,
    'customers':    `<button class="btn btn-primary" onclick="openCustomerModal(null)">+ Add Customer</button>`,
    'routing-new':  `<button class="btn btn-ghost" onclick="goBack('/routings')">← Back</button>`,
    'routing-edit': `<button class="btn btn-ghost" onclick="goBack('/routings')">← Back</button>`,
    'order-new':    `<button class="btn btn-ghost" onclick="goBack('/orders')">← Back</button>`,
    'order-edit':   `<button class="btn btn-ghost" onclick="goBack('/orders')">← Back</button>`,
  };
  el.innerHTML = actions[page] || '';
}

// Nav active state
function navActive(page) {
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page ||
      // Group: routings page also active for routing-new/edit
      (el.dataset.page === 'routings' && page.startsWith('routing')) ||
      (el.dataset.page === 'orders'   && page.startsWith('order')) ||
      (el.dataset.page === 'jobs'     && (page === 'job-edit' || page === 'job-new'))
    );
  });
}

// Legacy showPage() shim — allows existing onclick="showPage('x')" to keep working
function showPage(p) {
  const legacyMap = {
    'dashboard': '/dashboard', 'today': '/today', 'upcoming': '/upcoming',
    'jobs': '/jobs', 'orders': '/orders', 'schedule': '/schedule',
    'capacity': '/capacity', 'floorplan': '/floorplan', 'routings': '/routings',
    'machines': '/machines', 'workers': '/workers', 'customers': '/customers',
    'reports': '/reports', 'settings': '/settings', 'routing-stats': '/routing-stats',
  };
  navigate(legacyMap[p] || '/' + p);
}

// Init router
window.addEventListener('popstate', handleRoute);
