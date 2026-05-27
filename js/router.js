/**
 * Dolphin ERP — History API Router (clean URLs, no #)
 */

const ROUTES = [
  { pattern: /^\/?$/,                         page: 'dashboard',    title: 'Dashboard' },
  { pattern: /^\/dashboard$/,                 page: 'dashboard',    title: 'Dashboard' },
  { pattern: /^\/today$/,                     page: 'today',        title: "Today's Work" },
  { pattern: /^\/upcoming$/,                  page: 'upcoming',     title: 'Upcoming' },
  { pattern: /^\/schedule$/,                  page: 'schedule',     title: 'Gantt Schedule' },
  { pattern: /^\/capacity$/,                  page: 'capacity',     title: 'Capacity' },
  { pattern: /^\/floorplan$/,                 page: 'floorplan',    title: 'Floor Plan' },
  { pattern: /^\/reports$/,                   page: 'reports',      title: 'Reports' },
  { pattern: /^\/settings$/,                  page: 'settings',     title: 'Settings' },
  { pattern: /^\/quote$/,                     page: 'quote',        title: 'Estimator' },
  { pattern: /^\/quotations$/,                 page: 'quotations',      title: 'Quotations' },
  { pattern: /^\/quotations\/new$/,            page: 'quotation-new',   title: 'New Quotation' },
  { pattern: /^\/quotations\/(\d+)$/,          page: 'quotation-edit',  title: 'Edit Quotation', param: 'quotationId' },
  { pattern: /^\/users$/,                     page: 'users',        title: 'Users' },

  // Jobs
  { pattern: /^\/jobs\/new$/,                 page: 'job-new',      title: 'New Job' },
  { pattern: /^\/jobs\/(\d+)$/,              page: 'job-edit',     title: 'Edit Job',     param: 'jobId' },
  { pattern: /^\/jobs$/,                      page: 'jobs',         title: 'Jobs' },

  // Orders
  { pattern: /^\/orders\/new$/,               page: 'order-new',    title: 'New Order' },
  { pattern: /^\/orders\/(\d+)\/assembly$/, page: 'order-assembly', title: 'Assembly Order', param: 'orderId' },
  { pattern: /^\/orders\/(\d+)$/,            page: 'order-edit',   title: 'Edit Order',   param: 'orderId' },
  { pattern: /^\/orders$/,                    page: 'orders',       title: 'Orders' },

  // Routings
  { pattern: /^\/routings\/new$/,             page: 'routing-new',  title: 'New Routing' },
  { pattern: /^\/routings\/(\d+)$/,          page: 'routing-edit', title: 'Edit Routing', param: 'routingId' },
  { pattern: /^\/routing-stats$/,             page: 'routing-stats',title: 'Routing Stats' },
  { pattern: /^\/routings$/,                  page: 'routings',     title: 'Routings' },

  // Setup
  { pattern: /^\/machines$/,                  page: 'machines',     title: 'Machines' },
  { pattern: /^\/workers$/,                   page: 'workers',      title: 'Workers' },
  { pattern: /^\/customers$/,                 page: 'customers',    title: 'Customers' },
  { pattern: /^\/tasks$/,                     page: 'tasks',        title: 'Staff Tasks' },
];

function resolveRoute(path) {
  const p = path || window.location.pathname || '/';
  for (const route of ROUTES) {
    const m = p.match(route.pattern);
    if (m) {
      const params = {};
      if (route.param && m[1]) params[route.param] = parseInt(m[1]);
      return { page: route.page, params, title: route.title };
    }
  }
  return { page: 'dashboard', params: {}, title: 'Dashboard' };
}

function navigate(path, replace = false) {
  // Accept both '/jobs' and legacy '#/jobs' formats
  const cleanPath = path.startsWith('#') ? path.slice(1) : path;
  if (replace) {
    history.replaceState(null, '', cleanPath);
  } else {
    history.pushState(null, '', cleanPath);
  }
  handleRoute();
}

function goBack(fallback = '/dashboard') {
  if (history.length > 2) history.back();
  else navigate(fallback);
}

async function handleRoute() {
  const { page, params, title } = resolveRoute(window.location.pathname);

  document.title = `${title} — Dolphin ERP`;
  const pageTitleEl = document.getElementById('pageTitle');
  if (pageTitleEl) pageTitleEl.textContent = title;

  // Operator guard
  const currentUser = authGetUser();
  if (currentUser?.role === 'operator' && page !== 'today') {
    navigate('/today', true); return;
  }

  navActive(page);
  updateBottomNav(page);

  if (window._pageCleanup) { window._pageCleanup(); window._pageCleanup = null; }

  const content = document.getElementById('content');
  content.innerHTML = `<div class="page-loading"><div class="spinner"></div></div>`;

  renderTopbarActions(page, params);

  try {
    switch (page) {
      case 'dashboard':     await renderDashboard(); break;
      case 'today':         await renderToday(); break;
      case 'upcoming':      await renderUpcoming(); break;
      case 'jobs':          await renderJobs(); break;
      case 'job-new':       await renderJobEditor(null); break;
      case 'job-edit':      await renderJobEditor(params.jobId); break;
      case 'orders':        await renderOrders(); break;
      case 'order-new':     await renderOrderEditor(null); break;
      case 'order-edit':    await renderOrderEditor(params.orderId); break;
      case 'order-assembly': await renderAssemblyOrder(params.orderId); break;
      case 'quote':         await renderQuote(); break;
      case 'quotations':      await renderQuotations(); break;
      case 'quotation-new':   await renderQuotationEdit(null); break;
      case 'quotation-edit':  await renderQuotationEdit(params?.quotationId); break;
      case 'schedule':      await renderSchedule(); break;
      case 'capacity':      await renderCapacity(); break;
      case 'floorplan':     await renderFloorPlan(); break;
      case 'routings':      await renderRoutings(); break;
      case 'routing-new':   await renderRoutingEditor(null); break;
      case 'routing-edit':  await renderRoutingEditor(params.routingId); break;
      case 'routing-stats': await renderRoutingStats(); break;
      case 'machines':      await renderMachines(); break;
      case 'workers':       await renderWorkers(); break;
      case 'customers':     await renderCustomers(); break;
      case 'tasks':         await renderTasks(); break;
      case 'reports':       await renderReports(); break;
      case 'settings':      await renderSettings(); break;
      case 'users':
        if (authGetUser()?.role !== 'admin') {
          content.innerHTML = `<div class="empty" style="padding:40px">Access denied. Admin only.</div>`;
        } else { await renderUsers(); }
        break;
      default: await renderDashboard();
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

function renderTopbarActions(page, params = {}) {
  const el = document.getElementById('topbarActions');
  if (!el) return;
  const actions = {
    'dashboard':    ``,
    'jobs':         `<button class="btn btn-secondary" onclick="scheduleAll()">⚡ <span class="btn-label-long">Schedule All</span></button><button class="btn btn-primary" onclick="navigate('/jobs/new')">+ <span class="btn-label-long">New Job</span><span class="btn-label-short" style="display:none">Job</span></button>`,
    'job-new':      `<button class="btn btn-ghost" onclick="goBack('/jobs')">← <span class="btn-label-long">Back</span></button>`,
    'orders':       `<button class="btn btn-secondary" onclick="scheduleAll()">⚡ <span class="btn-label-long">Schedule All</span></button><button class="btn btn-primary" onclick="navigate('/orders/new')">+ <span class="btn-label-long">New Order</span><span class="btn-label-short" style="display:none">Order</span></button>`,
    'quotations':    `<button class="btn btn-primary" onclick="navigate('/quotations/new')">+ New Quote</button>`,
    'quotation-new': `<button class="btn btn-ghost" onclick="navigate('/quotations')">← Back</button>`,
    'quote':        `<button class="btn btn-secondary" onclick="navigate('/orders/new')">+ <span class="btn-label-long">New Order</span><span class="btn-label-short" style="display:none">Order</span></button>`,
    'routings':     `<button class="btn btn-primary" onclick="navigate('/routings/new')">+ <span class="btn-label-long">New Routing</span><span class="btn-label-short" style="display:none">Routing</span></button>`,
    'machines':     `<button class="btn btn-primary" onclick="openMachineModal(null)">+ <span class="btn-label-long">Add Machine</span><span class="btn-label-short" style="display:none">Machine</span></button>`,
    'workers':      `<button class="btn btn-primary" onclick="openWorkerModal(null)">+ <span class="btn-label-long">Add Worker</span><span class="btn-label-short" style="display:none">Worker</span></button>`,
    'customers':    `<button class="btn btn-primary" onclick="openCustomerModal(null)">+ <span class="btn-label-long">Add Customer</span><span class="btn-label-short" style="display:none">Customer</span></button>`,
    'routing-new':  `<button class="btn btn-ghost" onclick="goBack('/routings')">← <span class="btn-label-long">Back</span></button>`,
    'routing-edit': `<button class="btn btn-ghost" onclick="goBack('/routings')">← <span class="btn-label-long">Back</span></button>`,
    'order-new':    `<button class="btn btn-ghost" onclick="goBack('/orders')">← <span class="btn-label-long">Back</span></button>`,
    'order-edit':   `<button class="btn btn-ghost" onclick="goBack('/orders')">← <span class="btn-label-long">Back</span></button>`,
    'job-edit':     `<button class="btn btn-ghost" onclick="goBack('/jobs')">← <span class="btn-label-long">Back</span></button>`,
  };
  el.innerHTML = actions[page] || '';
}

function navActive(page) {
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page ||
      (el.dataset.page === 'routings' && page.startsWith('routing')) ||
      (el.dataset.page === 'orders'   && page.startsWith('order'))   ||
      (el.dataset.page === 'jobs'     && (page === 'job-edit' || page === 'job-new'))
    );
  });
}

function showPage(p) {
  const map = {
    'dashboard':'/dashboard','today':'/today','upcoming':'/upcoming',
    'jobs':'/jobs','orders':'/orders','schedule':'/schedule',
    'capacity':'/capacity','floorplan':'/floorplan','routings':'/routings',
    'machines':'/machines','workers':'/workers','customers':'/customers',
    'reports':'/reports','settings':'/settings','routing-stats':'/routing-stats',
    'quote':'/quote','quotations':'/quotations','users':'/users','tasks':'/tasks',
  };
  navigate(map[p] || '/' + p);
}

window.addEventListener('popstate', handleRoute);
