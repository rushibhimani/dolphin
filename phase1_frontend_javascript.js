// ═════════════════════════════════════════════════════════════════════════════
// PHASE 1: Time Units, Routing Editing, Paused Ops, Future Tasks
// ═════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL STATE
// ─────────────────────────────────────────────────────────────────────────────
let timeUnitDisplay = 'minutes'; // 'minutes', 'hours', 'hours_minutes'
let todayFilter = 'all'; // 'all', 'active', 'paused', 'completed'
let futureTasksDays = 7; // 7 or 30

// ─────────────────────────────────────────────────────────────────────────────
// TIME DISPLAY & CONVERSION FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function formatTime(minutes) {
  minutes = parseFloat(minutes) || 0;
  if (timeUnitDisplay === 'hours') {
    return (minutes / 60).toFixed(1) + ' hrs';
  } else if (timeUnitDisplay === 'hours_minutes') {
    const h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    return h + ':' + String(m).padStart(2, '0') + ' hrs';
  }
  return Math.round(minutes) + ' mins';
}

function parseTimeInput(value) {
  value = String(value).trim();
  if (timeUnitDisplay === 'hours') {
    return parseFloat(value) * 60;
  } else if (timeUnitDisplay === 'hours_minutes' && value.includes(':')) {
    const [h, m] = value.split(':');
    return parseInt(h) * 60 + parseInt(m);
  }
  return parseFloat(value) || 0;
}

async function loadTimePreference() {
  const resp = await fetch('/api/preferences/time-unit');
  const data = await resp.json();
  timeUnitDisplay = data.time_unit_display;
  // Update all time displays on page
  document.querySelectorAll('.time-display').forEach(el => {
    const mins = parseFloat(el.dataset.minutes);
    el.textContent = formatTime(mins);
  });
}

async function setTimePreference(unit) {
  const resp = await fetch('/api/preferences/time-unit', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ time_unit_display: unit })
  });
  if (resp.ok) {
    timeUnitDisplay = unit;
    // Update all displays
    document.querySelectorAll('.time-display').forEach(el => {
      const mins = parseFloat(el.dataset.minutes);
      el.textContent = formatTime(mins);
    });
    showToast('Time unit updated');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TODAY'S WORK - WITH PAUSE FILTERING (PHASE 1)
// ─────────────────────────────────────────────────────────────────────────────

async function loadTodayWithPaused(filter = 'all') {
  todayFilter = filter;
  const resp = await fetch(`/api/today-with-paused?status_filter=${filter}`);
  const ops = await resp.json();

  const tbody = document.getElementById('today-ops-body');
  tbody.innerHTML = '';

  ops.forEach(op => {
    const row = document.createElement('tr');
    const statusBg = op.status === 'paused' ? 'amber-bg' : 
                     op.status === 'in_progress' ? 'amber-bg' : 
                     op.status === 'completed' ? 'green-bg' : '';
    const statusLabel = op.status === 'paused' ? '⏸ PAUSED' :
                        op.status === 'in_progress' ? '▶ IN PROGRESS' :
                        op.status === 'completed' ? '✓ COMPLETED' : 'SCHEDULED';

    row.innerHTML = `
      <td>${op.job_number}</td>
      <td>${op.op_name}</td>
      <td>${op.wc_name}</td>
      <td>${op.worker_name || '—'}</td>
      <td class="time-display" data-minutes="${op.work_time_mins}">${formatTime(op.work_time_mins)}</td>
      <td><span class="${statusBg}">${statusLabel}</span></td>
      <td class="pause-col">${op.pause_reason ? op.pause_reason.replace(/_/g, ' ') : '—'}</td>
      <td>
        ${op.status === 'pending' || op.status === 'scheduled' ? 
          `<button onclick="showStartOpModal(${op.id})">Start</button>` : ''}
        ${op.status === 'in_progress' ? 
          `<button onclick="showPauseOpModal(${op.id})">Pause</button>
           <button onclick="showCompleteOpModal(${op.id})">Complete</button>` : ''}
        ${op.status === 'paused' ? 
          `<button onclick="resumeOp(${op.id})">Resume</button>
           <button onclick="showPauseOpModal(${op.id})">Update Reason</button>` : ''}
      </td>
    `;
    tbody.appendChild(row);
  });
}

function setTodayFilter(filter) {
  loadTodayWithPaused(filter);
}

// ─────────────────────────────────────────────────────────────────────────────
// OPERATION MODALS - ENHANCED FOR PHASE 1
// ─────────────────────────────────────────────────────────────────────────────

function showStartOpModal(opId) {
  const modal = document.getElementById('start-op-modal');
  modal.dataset.opId = opId;
  
  // Pre-fill with current time
  const now = new Date();
  const iso = now.toISOString().slice(0, 16);
  document.getElementById('actual-start-time').value = iso;
  
  modal.style.display = 'block';
}

function showPauseOpModal(opId) {
  const modal = document.getElementById('pause-op-modal');
  modal.dataset.opId = opId;
  
  document.getElementById('pause-reason').value = '';
  document.getElementById('pause-notes').value = '';
  
  modal.style.display = 'block';
}

function showCompleteOpModal(opId) {
  const modal = document.getElementById('complete-op-modal');
  modal.dataset.opId = opId;
  
  const now = new Date();
  const iso = now.toISOString().slice(0, 16);
  document.getElementById('actual-end-time').value = iso;
  
  modal.style.display = 'block';
}

async function startOp(opId) {
  const actualStart = document.getElementById('actual-start-time').value;
  const startEarly = document.getElementById('start-early-checkbox').checked;
  
  const body = {
    status: 'in_progress',
    actual_start: actualStart
  };
  if (startEarly) {
    body.scheduled_start_override = actualStart;
  }
  
  const resp = await fetch(`/api/ops/${opId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  if (resp.ok) {
    document.getElementById('start-op-modal').style.display = 'none';
    loadTodayWithPaused(todayFilter);
    showToast('Operation started');
  }
}

async function pauseOp(opId) {
  const reason = document.getElementById('pause-reason').value;
  const notes = document.getElementById('pause-notes').value;
  
  if (!reason) {
    showToast('Select pause reason', 'warning');
    return;
  }
  
  const resp = await fetch(`/api/ops/${opId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'paused',
      pause_reason: reason,
      pause_notes: notes
    })
  });
  
  if (resp.ok) {
    document.getElementById('pause-op-modal').style.display = 'none';
    loadTodayWithPaused(todayFilter);
    showToast('Operation paused');
  }
}

async function resumeOp(opId) {
  const resp = await fetch(`/api/ops/${opId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'in_progress' })
  });
  
  if (resp.ok) {
    loadTodayWithPaused(todayFilter);
    showToast('Operation resumed');
  }
}

async function completeOp(opId) {
  const actualStart = document.getElementById('actual-start-time-complete').value;
  const actualEnd = document.getElementById('actual-end-time').value;
  
  const resp = await fetch(`/api/ops/${opId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'completed',
      actual_start: actualStart,
      actual_end: actualEnd
    })
  });
  
  if (resp.ok) {
    document.getElementById('complete-op-modal').style.display = 'none';
    loadTodayWithPaused(todayFilter);
    showToast('Operation completed');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FUTURE TASKS - NEW TAB (PHASE 1)
// ─────────────────────────────────────────────────────────────────────────────

async function loadFutureTasks(days = 7) {
  futureTasksDays = days;
  const resp = await fetch(`/api/future-tasks?days=${days}`);
  const ops = await resp.json();
  
  const tbody = document.getElementById('future-tasks-body');
  tbody.innerHTML = '';
  
  ops.forEach(op => {
    const startDate = new Date(op.scheduled_start).toLocaleString();
    const endDate = new Date(op.scheduled_end).toLocaleString();
    const dueDate = op.due_date ? new Date(op.due_date).toLocaleDateString() : '—';
    const priorityBadge = op.priority ? '<span class="red-bg">URGENT</span>' : '';
    
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${op.job_number}</td>
      <td>${op.op_name}</td>
      <td>${op.wc_name}</td>
      <td>${op.worker_name || '—'}</td>
      <td class="time-display" data-minutes="${op.work_time_mins}">${formatTime(op.work_time_mins)}</td>
      <td>${startDate}</td>
      <td>${endDate}</td>
      <td>${dueDate} ${priorityBadge}</td>
    `;
    tbody.appendChild(row);
  });
}

async function loadFutureGantt(view = 'machine', days = 30) {
  const resp = await fetch(`/api/gantt-future?view=${view}&days=${days}`);
  const data = await resp.json();
  
  const container = document.getElementById('future-gantt-container');
  container.innerHTML = '';
  
  data.forEach(item => {
    const section = document.createElement('div');
    section.className = 'gantt-section';
    section.innerHTML = `<h4>${item.name}</h4>`;
    
    const table = document.createElement('table');
    table.className = 'gantt-table';
    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th>Job</th>
        <th>Operation</th>
        <th>Start</th>
        <th>End</th>
        <th>Status</th>
      </tr>
    `;
    table.appendChild(thead);
    
    const tbody = document.createElement('tbody');
    item.ops.forEach(op => {
      const row = document.createElement('tr');
      const statusColor = op.status === 'completed' ? 'green' : 
                         op.status === 'in_progress' ? 'amber' : 'blue';
      row.innerHTML = `
        <td>${op.job}</td>
        <td>${op.op}</td>
        <td>${new Date(op.start).toLocaleString()}</td>
        <td>${new Date(op.end).toLocaleString()}</td>
        <td><span class="${statusColor}-bg">${op.status}</span></td>
      `;
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    section.appendChild(table);
    container.appendChild(section);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB CREATION - ROUTING EDITING (PHASE 1)
// ─────────────────────────────────────────────────────────────────────────────

let editingOperations = []; // Inline ops being edited

function handleRoutingChange() {
  const routingId = document.getElementById('routing-select').value;
  const editOpsDiv = document.getElementById('edit-operations-div');
  
  if (routingId) {
    editOpsDiv.style.display = 'block';
    loadRoutingOperations(routingId);
  } else {
    editOpsDiv.style.display = 'none';
  }
}

async function loadRoutingOperations(routingId) {
  // Fetch the routing with its operations
  const resp = await fetch(`/api/routings/${routingId}`);
  const routing = await resp.json();
  editingOperations = routing.operations.map(op => ({
    work_center_id: op.work_center_id,
    name: op.name,
    machine_setup_mins: op.machine_setup_mins,
    job_setup_mins: op.job_setup_mins,
    work_time_mins: op.work_time_mins
  }));
  
  renderEditingOperations();
}

function renderEditingOperations() {
  const tbody = document.getElementById('edit-ops-table-body');
  tbody.innerHTML = '';
  
  editingOperations.forEach((op, idx) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${op.name}</td>
      <td>
        <input type="number" value="${op.machine_setup_mins}" 
               onchange="editingOperations[${idx}].machine_setup_mins = parseTimeInput(this.value)">
      </td>
      <td>
        <input type="number" value="${op.job_setup_mins}"
               onchange="editingOperations[${idx}].job_setup_mins = parseTimeInput(this.value)">
      </td>
      <td>
        <input type="number" value="${op.work_time_mins}"
               onchange="editingOperations[${idx}].work_time_mins = parseTimeInput(this.value)">
      </td>
      <td>
        <button onclick="editingOperations.splice(${idx}, 1); renderEditingOperations()">Remove</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function toggleSaveAsRouting() {
  const checkbox = document.getElementById('save-routing-checkbox').checked;
  document.getElementById('save-routing-details').style.display = checkbox ? 'block' : 'none';
}

async function submitJobWithRouting() {
  const jobData = {
    customer_name: document.getElementById('customer-name').value,
    product_type: document.getElementById('product-type').value,
    product_size: document.getElementById('product-size').value,
    due_date: document.getElementById('due-date').value,
    total_price: document.getElementById('total-price').value,
    inline_ops: editingOperations.length > 0 ? editingOperations : null
  };
  
  // Create job
  const jobResp = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jobData)
  });
  const jobResult = await jobResp.json();
  
  // Save routing if checkbox is checked
  if (document.getElementById('save-routing-checkbox').checked) {
    const routingData = {
      routing_name: document.getElementById('routing-name').value,
      product_type: jobData.product_type,
      operations: editingOperations
    };
    
    const routingResp = await fetch('/api/routings/from-job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(routingData)
    });
    const routingResult = await routingResp.json();
    showToast(`Job created & routing saved: ${routingResult.routing_name}`);
  } else {
    showToast('Job created');
  }
  
  // Close modal and reload jobs
  document.getElementById('job-modal').style.display = 'none';
  loadJobs();
}

// ─────────────────────────────────────────────────────────────────────────────
// PREFERENCES TAB (PHASE 1)
// ─────────────────────────────────────────────────────────────────────────────

function showPreferencesTab() {
  document.querySelectorAll('[data-unit-option]').forEach(radio => {
    if (radio.value === timeUnitDisplay) {
      radio.checked = true;
    }
  });
}

function handleTimeUnitChange(event) {
  if (event.target.checked) {
    setTimePreference(event.target.value);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

async function initPhase1() {
  await loadTimePreference();
  // Load today's work with paused filter
  await loadTodayWithPaused('all');
  // Load future tasks
  await loadFutureTasks(7);
}

// Call on page load
window.addEventListener('load', () => {
  initPhase1();
});
