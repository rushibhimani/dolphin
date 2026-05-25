/**
 * Dolphin ERP — Staff Tasks
 * Office staff (designers, admin, quality) can view, create, and complete tasks.
 * Mobile-first: card list on mobile, table on desktop.
 */

// ── Task filter state ─────────────────────────────────────────────────────
let taskFilter = { status: '', priority: '', assignee: '' };

async function renderTasks(){
  document.getElementById('topbarActions').innerHTML = `
    <button class="btn btn-secondary" id="btnTaskFilter" onclick="toggleTaskFilter()">☰ Filter</button>
    <button class="btn btn-primary"   onclick="openTaskModal()">+ New Task</button>`;

  document.getElementById('content').innerHTML = `
    <div id="taskFilterBar" style="display:none;background:var(--card);border:1px solid var(--border);
         border-radius:10px;padding:14px;margin-bottom:14px;display:grid;
         grid-template-columns:1fr 1fr 1fr;gap:10px">
      <select id="tf_status" onchange="applyTaskFilter()" style="font-size:13px">
        <option value="">All Statuses</option>
        <option value="pending">Pending</option>
        <option value="in_progress">In Progress</option>
        <option value="done">Done</option>
        <option value="cancelled">Cancelled</option>
      </select>
      <select id="tf_priority" onchange="applyTaskFilter()" style="font-size:13px">
        <option value="">All Priorities</option>
        <option value="urgent">🔴 Urgent</option>
        <option value="high">🟠 High</option>
        <option value="normal">🟡 Normal</option>
        <option value="low">⚪ Low</option>
      </select>
      <select id="tf_assignee" onchange="applyTaskFilter()" style="font-size:13px">
        <option value="">All Assignees</option>
      </select>
    </div>
    <div id="taskSummary" style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap"></div>
    <div id="taskList">Loading…</div>`;

  await loadTaskData();
}

async function loadTaskData(){
  try {
    const [tasks, summary, workers] = await Promise.all([
      api('GET', '/api/tasks'),
      api('GET', '/api/tasks/summary/counts').catch(()=>({})),
      api('GET', '/api/workers'),
    ]);

    // Populate assignee filter
    const sel = document.getElementById('tf_assignee');
    if(sel){
      const officeWorkers = workers.filter(w => w.is_active);
      officeWorkers.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w.id; opt.textContent = w.name;
        sel.appendChild(opt);
      });
    }

    // Summary chips
    const summaryEl = document.getElementById('taskSummary');
    if(summaryEl){
      const p  = summary.pending     || 0;
      const ip = summary.in_progress || 0;
      const d  = summary.done        || 0;
      const ov = summary.overdue     || 0;
      summaryEl.innerHTML = `
        ${chip(p,  'Pending',     'var(--accent)',   'var(--accent-soft)',  "applyTaskFilter('pending')")}
        ${chip(ip, 'In Progress', 'var(--amber)',    'var(--amber-soft)',   "applyTaskFilter('in_progress')")}
        ${chip(d,  'Done',        'var(--green)',    'var(--green-soft)',   "applyTaskFilter('done')")}
        ${ov > 0 ? chip(ov, 'Overdue', 'var(--red)', 'var(--red-soft)', "applyTaskFilter('pending')") : ''}
      `;
    }

    // Apply current filters
    let filtered = tasks;
    if(taskFilter.status)   filtered = filtered.filter(t => t.status === taskFilter.status);
    if(taskFilter.priority) filtered = filtered.filter(t => t.priority === taskFilter.priority);
    if(taskFilter.assignee) filtered = filtered.filter(t => t.assigned_to_id == taskFilter.assignee);

    renderTaskList(filtered);
  } catch(e) {
    document.getElementById('taskList').innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

function chip(count, label, color, bg, onclick){
  return `<div onclick="${onclick}" style="cursor:pointer;background:${bg};border:1px solid ${color};
    border-radius:8px;padding:8px 14px;display:flex;align-items:center;gap:8px;font-size:13px">
    <b style="font-size:20px;color:${color}">${count}</b> ${label}
  </div>`;
}

function toggleTaskFilter(){
  const bar = document.getElementById('taskFilterBar');
  if(bar) bar.style.display = bar.style.display === 'none' ? 'grid' : 'none';
}

function applyTaskFilter(statusOverride){
  if(statusOverride !== undefined){
    taskFilter.status = taskFilter.status === statusOverride ? '' : statusOverride;
    const sel = document.getElementById('tf_status');
    if(sel) sel.value = taskFilter.status;
  } else {
    taskFilter.status   = document.getElementById('tf_status')?.value   || '';
    taskFilter.priority = document.getElementById('tf_priority')?.value || '';
    taskFilter.assignee = document.getElementById('tf_assignee')?.value || '';
  }
  loadTaskData();
}

function renderTaskList(tasks){
  const el = document.getElementById('taskList');
  if(!el) return;
  if(!tasks.length){
    el.innerHTML = '<div class="card"><div class="empty">No tasks found. Create your first task.</div></div>';
    return;
  }

  // Group by status for better readability
  const groups = {
    in_progress: tasks.filter(t => t.status === 'in_progress'),
    pending:     tasks.filter(t => t.status === 'pending'),
    done:        tasks.filter(t => t.status === 'done'),
    cancelled:   tasks.filter(t => t.status === 'cancelled'),
  };

  let html = '';
  const groupLabels = {
    in_progress: '▶ In Progress',
    pending:     '◷ Pending',
    done:        '✓ Done',
    cancelled:   '✕ Cancelled',
  };

  Object.entries(groups).forEach(([status, items]) => {
    if(!items.length) return;
    const isCollapsed = status === 'done' || status === 'cancelled';
    html += `
      <div style="margin-bottom:18px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
             color:var(--muted);margin-bottom:8px;padding:0 2px">${groupLabels[status]} (${items.length})</div>
        ${items.map(t => taskCard(t)).join('')}
      </div>`;
  });

  el.innerHTML = html;
}

function taskCard(t){
  const today = new Date().toISOString().slice(0,10);
  const isOverdue = t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'cancelled';
  const isDone    = t.status === 'done';

  const priColor = { urgent:'var(--red)', high:'#f97316', normal:'var(--accent)', low:'var(--muted)' };
  const priLabel = { urgent:'🔴 Urgent', high:'🟠 High', normal:'🟡 Normal', low:'⚪ Low' };
  const statusColor = {
    pending:'var(--muted)', in_progress:'var(--amber)',
    done:'var(--green)', cancelled:'var(--muted)'
  };

  const dueLabel = t.due_date
    ? `${isOverdue ? '⚠ OVERDUE · ' : ''}Due: ${fmtDate(t.due_date)}${t.due_time ? ' ' + t.due_time : ''}`
    : 'No due date';

  const actionBtns = isDone ? `
    <button class="btn btn-ghost" style="flex:1;font-size:12px" onclick="reopenTask(${t.id})">↩ Reopen</button>
    <button class="btn btn-ghost" style="font-size:12px;color:var(--red)" onclick="deleteTask(${t.id})">🗑</button>
  ` : t.status === 'cancelled' ? `
    <button class="btn btn-ghost" style="flex:1;font-size:12px" onclick="reopenTask(${t.id})">↩ Reopen</button>
    <button class="btn btn-ghost" style="font-size:12px;color:var(--red)" onclick="deleteTask(${t.id})">🗑</button>
  ` : `
    ${t.status === 'pending'
      ? `<button class="btn btn-secondary" style="flex:1;font-size:12px;min-height:40px" onclick="startTask(${t.id})">▶ Start</button>`
      : `<button class="btn btn-secondary" style="flex:1;font-size:12px;min-height:40px" onclick="startTask(${t.id})">⏸ Pause</button>`}
    <button class="btn btn-primary" style="flex:1;font-size:12px;min-height:40px" onclick="promptDoneTask(${t.id})">✓ Done</button>
    <button class="btn btn-ghost"   style="font-size:12px;min-height:40px" onclick="openTaskModal(${t.id})">✎</button>
  `;

  return `<div style="background:var(--card);border:1px solid ${isOverdue?'var(--red)':isDone?'var(--green-soft)':'var(--border)'};
               border-left:4px solid ${isDone?'var(--green)':priColor[t.priority]||'var(--accent)'};
               border-radius:10px;padding:12px 14px;margin-bottom:8px;
               opacity:${isDone||t.status==='cancelled'?'0.7':'1'}">
    <!-- Title row -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">
      <div style="flex:1;min-width:0">
        <span style="font-size:15px;font-weight:700;color:var(--text);word-break:break-word;
              text-decoration:${isDone?'line-through':'none'}">${t.title}</span>
      </div>
      <span style="font-size:11px;font-weight:600;color:${statusColor[t.status]};
            background:${statusColor[t.status]}22;border:1px solid ${statusColor[t.status]}44;
            border-radius:5px;padding:2px 8px;white-space:nowrap;flex-shrink:0">
        ${t.status.replace('_',' ').toUpperCase()}
      </span>
    </div>
    <!-- Description -->
    ${t.description ? `<div style="font-size:13px;color:var(--text-soft);margin-bottom:6px;line-height:1.4">${t.description}</div>` : ''}
    <!-- Meta row -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <span style="font-size:11px;background:var(--surface);border:1px solid var(--border);
            border-radius:4px;padding:2px 7px;color:var(--muted)">${t.category}</span>
      <span style="font-size:11px;color:${priColor[t.priority]||'var(--muted)'}">${priLabel[t.priority]||''}</span>
      ${t.assigned_to_name ? `<span style="font-size:11px;color:var(--text-soft)">👤 ${t.assigned_to_name}</span>` : ''}
    </div>
    <!-- Due date -->
    <div style="font-size:12px;color:${isOverdue?'var(--red)':'var(--muted)'};margin-bottom:10px;font-weight:${isOverdue?'700':'400'}">
      ${dueLabel}
    </div>
    <!-- Completion notes -->
    ${isDone && t.notes ? `<div style="font-size:12px;color:var(--green);background:var(--green-soft);
        border-radius:6px;padding:8px 10px;margin-bottom:10px">✓ ${t.notes}</div>` : ''}
    <!-- Actions -->
    <div style="display:flex;gap:8px;padding-top:10px;border-top:1px solid var(--border)">
      ${actionBtns}
    </div>
  </div>`;
}

// ── Task Actions ──────────────────────────────────────────────────────────

async function startTask(taskId){
  try{
    await api('PUT', `/api/tasks/${taskId}`, { status: 'in_progress' });
    loadTaskData();
  } catch(e){ toast(e.message,'error'); }
}

function promptDoneTask(taskId){
  showModal('Mark Task Done',`
    <div style="margin-bottom:12px;font-size:14px;color:var(--text-soft)">
      Add a completion note (optional — what was done, outcome, any follow-up needed):
    </div>
    <textarea id="done_notes" placeholder="e.g. Drawing completed and sent to client for approval…"
      style="width:100%;min-height:100px;resize:vertical"></textarea>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" onclick="confirmDoneTask(${taskId})">✓ Mark Done</button>`
  );
}

async function confirmDoneTask(taskId){
  const notes = document.getElementById('done_notes')?.value.trim() || '';
  try{
    await api('PUT', `/api/tasks/${taskId}`, { status: 'done', notes });
    closeModal(); loadTaskData();
  } catch(e){ toast(e.message,'error'); }
}

async function reopenTask(taskId){
  try{
    await api('PUT', `/api/tasks/${taskId}`, { status: 'pending', notes: '' });
    loadTaskData();
  } catch(e){ toast(e.message,'error'); }
}

async function deleteTask(taskId){
  const ok = await confirm2('Delete this task permanently?', 'Delete Task');
  if(!ok) return;
  try{
    await api('DELETE', `/api/tasks/${taskId}`);
    toast('Task deleted'); loadTaskData();
  } catch(e){ toast(e.message,'error'); }
}

// ── Task Modal (Create / Edit) ────────────────────────────────────────────

async function openTaskModal(editId){
  let task = null;
  if(editId){
    try{ task = await api('GET', `/api/tasks/${editId}`); } catch{}
  }

  let workers = [];
  try{ workers = await api('GET', '/api/workers'); } catch{}
  const activeWorkers = workers.filter(w => w.is_active);

  const today = new Date().toISOString().slice(0,10);

  showModal(task ? `Edit Task — ${task.title}` : 'New Task', `
    <div class="form-group">
      <div class="fld-label">Task Title <span style="color:var(--red)">*</span></div>
      <input id="tk_title" value="${task?.title||''}" placeholder="e.g. Prepare AutoCAD drawing for Punch 600×1200">
      <div class="field-err" id="tk_title_err"></div>
    </div>
    <div class="form-group">
      <div class="fld-label">Description</div>
      <textarea id="tk_desc" placeholder="Details, requirements, reference files…" style="min-height:80px;resize:vertical">${task?.description||''}</textarea>
    </div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Category</div>
        <select id="tk_category">
          ${['Design','Drafting','Admin','Quality','Procurement','Inspection','Other'].map(c=>
            `<option value="${c}" ${(task?.category||'Design')===c?'selected':''}>${c}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <div class="fld-label">Priority</div>
        <select id="tk_priority">
          <option value="low"    ${(task?.priority||'normal')==='low'   ?'selected':''}>⚪ Low</option>
          <option value="normal" ${(task?.priority||'normal')==='normal'?'selected':''}>🟡 Normal</option>
          <option value="high"   ${(task?.priority||'normal')==='high'  ?'selected':''}>🟠 High</option>
          <option value="urgent" ${(task?.priority||'normal')==='urgent'?'selected':''}>🔴 Urgent</option>
        </select>
      </div>
    </div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Assign To</div>
        <select id="tk_assignee">
          <option value="">— Unassigned —</option>
          ${activeWorkers.map(w =>
            `<option value="${w.id}" data-name="${w.name}" ${task?.assigned_to_id===w.id?'selected':''}>${w.name}${w.role?' ('+w.role+')':''}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <div class="fld-label">Due Date</div>
        <input type="date" id="tk_due_date" value="${task?.due_date||today}">
      </div>
    </div>
    <div class="form-group">
      <div class="fld-label">Due Time (optional)</div>
      <input type="time" id="tk_due_time" value="${task?.due_time||''}">
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" id="saveTaskBtn" onclick="saveTask(${task?.id||'null'})">
       ${task ? 'Update Task' : 'Create Task'}
     </button>`
  );
  setTimeout(()=>attachValidation('tk_title',[{test:v=>v.trim().length>0,msg:'Title is required'}],'tk_title_err'),50);
}

async function saveTask(editId){
  if(!validateAll(['tk_title'])){ toast('Title is required','error'); return; }
  const assigneeEl = document.getElementById('tk_assignee');
  const assigneeId = assigneeEl?.value ? parseInt(assigneeEl.value) : null;
  const assigneeName = assigneeId ? assigneeEl.options[assigneeEl.selectedIndex].getAttribute('data-name') : '';

  const data = {
    title:            document.getElementById('tk_title').value.trim(),
    description:      document.getElementById('tk_desc').value.trim(),
    category:         document.getElementById('tk_category').value,
    priority:         document.getElementById('tk_priority').value,
    assigned_to_id:   assigneeId,
    assigned_to_name: assigneeName,
    due_date:         document.getElementById('tk_due_date').value || null,
    due_time:         document.getElementById('tk_due_time').value || '',
  };

  setLoading('saveTaskBtn', true);
  try{
    if(editId && editId !== 'null'){
      await api('PUT', `/api/tasks/${editId}`, data);
      toast('Task updated!');
    } else {
      await api('POST', '/api/tasks', data);
      toast('Task created!');
    }
    closeModal(); loadTaskData();
  } catch(e){ toast(e.message,'error'); }
  finally{ setLoading('saveTaskBtn', false); }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function fmtDate(iso){
  if(!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
}
