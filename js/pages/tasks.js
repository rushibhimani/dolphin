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
    <button class="btn btn-ghost" style="font-size:12px" onclick="viewTaskActivity(${t.id},'${escAttr(t.title)}')">💬</button>
    <button class="btn btn-ghost" style="font-size:12px" onclick="manageTaskFiles(${t.id},'${escAttr(t.title)}')">📎</button>
    <button class="btn btn-ghost" style="font-size:12px;color:var(--red)" onclick="deleteTask(${t.id})">🗑</button>
  ` : t.status === 'cancelled' ? `
    <button class="btn btn-ghost" style="flex:1;font-size:12px" onclick="reopenTask(${t.id})">↩ Reopen</button>
    <button class="btn btn-ghost" style="font-size:12px;color:var(--red)" onclick="deleteTask(${t.id})">🗑</button>
  ` : `
    ${t.status === 'pending'
      ? `<button class="btn btn-secondary" style="flex:1;font-size:12px;min-height:40px" onclick="startTask(${t.id})">▶ Start</button>`
      : `<button class="btn btn-secondary" style="flex:1;font-size:12px;min-height:40px" onclick="startTask(${t.id})">⏸ Pause</button>`}
    <button class="btn btn-primary" style="flex:1;font-size:12px;min-height:40px" onclick="promptDoneTask(${t.id})">✓ Done</button>
    <button class="btn btn-ghost"   style="font-size:12px;min-height:40px" onclick="viewTaskActivity(${t.id},'${escAttr(t.title)}')">💬</button>
    <button class="btn btn-ghost"   style="font-size:12px;min-height:40px" onclick="manageTaskFiles(${t.id},'${escAttr(t.title)}')">📎</button>
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
    ${t.description ? `<div style="font-size:13px;color:var(--text-soft);margin-bottom:6px;line-height:1.4">${escHtml(t.description)}</div>` : ''}
    <!-- All assignees -->
    ${t.all_assignees && t.all_assignees.length > 1 ? `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px">
        <span style="font-size:11px;color:var(--muted)">👥 Assigned to:</span>
        ${t.all_assignees.map(a=>`<span style="font-size:11px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:1px 7px">${escHtml(a.worker_name)}</span>`).join('')}
      </div>` : ''}
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
    <!-- Recent activity preview (last 2 entries) -->
    ${t.activities && t.activities.length ? (()=>{
      const recent = t.activities.slice(-2);
      return `<div style="margin-bottom:8px">
        ${recent.map(a=>`<div style="font-size:11px;color:var(--muted);padding:3px 0;
            display:flex;gap:6px;align-items:baseline">
          <span style="color:var(--accent);flex-shrink:0">${activityIcon(a.action)}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            <b>${escHtml(a.actor_name)}</b> ${activityLabel(a.action)}${a.note?' — '+escHtml(a.note.slice(0,60)):''}
          </span>
          <span style="flex-shrink:0;font-size:10px">${fmtTimeAgo(a.created_at)}</span>
        </div>`).join('')}
        ${t.activities.length > 2 ? `<button onclick="viewTaskActivity(${t.id},'${escAttr(t.title)}')"
          style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:11px;padding:2px 0">
          View all ${t.activities.length} activities →</button>` : ''}
      </div>`;
    })() : ''}
    <!-- Files -->
    ${t.files && t.files.length ? `
      <div style="margin-bottom:10px">
        <div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px">📎 ${t.files.length} Attachment${t.files.length>1?'s':''}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${t.files.map(f=>`
            <button onclick="downloadTaskFile(${f.id},'${escAttr(f.filename)}')"
               style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;
                      background:var(--surface);border:1px solid var(--border);border-radius:6px;
                      font-size:12px;color:var(--accent);cursor:pointer;max-width:200px">
              <span>${fileIcon(f.mime_type)}</span>
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(f.filename)}</span>
              <span style="color:var(--muted);font-size:10px;flex-shrink:0">${fmtFileSize(f.file_size)}</span>
            </button>`).join('')}
        </div>
      </div>` : ''}
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
        <div class="fld-label">Primary Assignee</div>
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
      <div class="fld-label">Additional Assignees <span style="font-size:11px;color:var(--muted);font-weight:400">— for multi-person tasks</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:8px;min-height:44px;align-items:center" id="tk_extra_assignees">
        ${(task?.all_assignees||[]).filter(a=>a.worker_id!==task?.assigned_to_id).map(a=>`
          <span class="extra-assignee-tag" data-id="${a.worker_id}" data-name="${escHtml(a.worker_name)}"
            style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;
                   background:var(--accent-soft);border:1px solid var(--accent);border-radius:20px;font-size:12px">
            ${a.worker_name}
            <button onclick="removeExtraAssignee(this)" style="background:none;border:none;cursor:pointer;color:var(--accent);font-size:14px;padding:0;line-height:1">×</button>
          </span>`).join('')}
        <select id="tk_add_extra" onchange="addExtraAssignee()" style="border:none;background:transparent;color:var(--accent);font-size:12px;cursor:pointer;min-width:120px">
          <option value="">+ Add person…</option>
          ${activeWorkers.map(w=>`<option value="${w.id}" data-name="${w.name}">${w.name}</option>`).join('')}
        </select>
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

  // Collect extra assignees from tags
  const extraTags = document.querySelectorAll('#tk_extra_assignees .extra-assignee-tag');
  const extraAssignees = [...extraTags].map(tag => ({
    worker_id:   parseInt(tag.dataset.id),
    worker_name: tag.dataset.name,
  }));

  const data = {
    title:            document.getElementById('tk_title').value.trim(),
    description:      document.getElementById('tk_desc').value.trim(),
    category:         document.getElementById('tk_category').value,
    priority:         document.getElementById('tk_priority').value,
    assigned_to_id:   assigneeId,
    assigned_to_name: assigneeName,
    extra_assignees:  extraAssignees,
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

// ── Multi-assignee helpers ────────────────────────────────────────────────

function addExtraAssignee(){
  const sel = document.getElementById('tk_add_extra');
  const wid = sel?.value;
  if(!wid){ return; }
  const name = sel.options[sel.selectedIndex].getAttribute('data-name');
  // Don't duplicate
  if(document.querySelector(`#tk_extra_assignees .extra-assignee-tag[data-id="${wid}"]`)) {
    sel.value = ''; return;
  }
  // Don't add primary assignee again
  const primary = document.getElementById('tk_assignee')?.value;
  if(wid === primary){ sel.value=''; toast('Already the primary assignee','error'); return; }

  const tag = document.createElement('span');
  tag.className = 'extra-assignee-tag';
  tag.dataset.id   = wid;
  tag.dataset.name = name;
  tag.style.cssText = 'display:inline-flex;align-items:center;gap:5px;padding:3px 10px;background:var(--accent-soft);border:1px solid var(--accent);border-radius:20px;font-size:12px';
  tag.innerHTML = `${name} <button onclick="removeExtraAssignee(this)" style="background:none;border:none;cursor:pointer;color:var(--accent);font-size:14px;padding:0;line-height:1">×</button>`;
  const container = document.getElementById('tk_extra_assignees');
  container.insertBefore(tag, document.getElementById('tk_add_extra'));
  sel.value = '';
}

function removeExtraAssignee(btn){
  btn.closest('.extra-assignee-tag').remove();
}

// ── Activity log ──────────────────────────────────────────────────────────

function activityIcon(action){
  return { started:'▶', paused:'⏸', done:'✓', reopened:'↩', comment:'💬',
           file_added:'📎', assigned:'👥', created:'✨' }[action] || '•';
}

function activityLabel(action){
  return { started:'started working', paused:'paused', done:'marked done',
           reopened:'reopened', comment:'commented', file_added:'uploaded a file',
           assigned:'updated assignees', created:'created this task' }[action] || action;
}

function fmtTimeAgo(iso){
  if(!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m  = Math.floor(ms / 60000);
  if(m < 1)  return 'just now';
  if(m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if(h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}

async function viewTaskActivity(taskId, taskTitle){
  let task = null;
  try{ task = await api('GET', `/api/tasks/${taskId}`); } catch(e){ toast(e.message,'error'); return; }

  function renderActivity(activities){
    if(!activities.length) return `<div style="font-size:13px;color:var(--muted);padding:16px 0;text-align:center">No activity yet.</div>`;
    return `<div style="display:flex;flex-direction:column;gap:2px">` +
      [...activities].reverse().map(a => `
        <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:20px;flex-shrink:0;width:28px;text-align:center">${activityIcon(a.action)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px">
              <b>${escHtml(a.actor_name||'System')}</b>
              <span style="color:var(--muted)"> ${activityLabel(a.action)}</span>
            </div>
            ${a.note ? `<div style="font-size:12px;color:var(--text-soft);margin-top:3px;word-break:break-word">${escHtml(a.note)}</div>` : ''}
            <div style="font-size:11px;color:var(--muted);margin-top:3px">
              ${a.created_at ? new Date(a.created_at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : ''}
            </div>
          </div>
        </div>`).join('') + `</div>`;
  }

  showModal(`💬 Activity — ${taskTitle}`, `
    <div id="activityLog" style="max-height:350px;overflow-y:auto">${renderActivity(task.activities||[])}</div>
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
      <div class="fld-label" style="margin-bottom:6px">Add Comment</div>
      <textarea id="newComment" placeholder="Progress update, note, or question…"
        style="width:100%;min-height:72px;resize:vertical;margin-bottom:8px"></textarea>
      <button class="btn btn-primary" style="width:100%" id="postCommentBtn"
        onclick="postComment(${taskId},'${escAttr(taskTitle)}')">Post Comment</button>
    </div>`,
    `<button class="btn btn-primary" onclick="closeModal()">Close</button>`,
    false
  );
}

async function postComment(taskId, taskTitle){
  const note = document.getElementById('newComment')?.value.trim();
  if(!note){ toast('Enter a comment first','error'); return; }
  setLoading('postCommentBtn', true);
  try{
    await api('POST', `/api/tasks/${taskId}/comment`, { note });
    // Refresh activity log in modal
    const task = await api('GET', `/api/tasks/${taskId}`);
    const logEl = document.getElementById('activityLog');
    if(logEl){
      function renderActivity(activities){
        if(!activities.length) return `<div style="font-size:13px;color:var(--muted);padding:16px 0;text-align:center">No activity yet.</div>`;
        return `<div style="display:flex;flex-direction:column;gap:2px">` +
          [...activities].reverse().map(a => `
            <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
              <div style="font-size:20px;flex-shrink:0;width:28px;text-align:center">${activityIcon(a.action)}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px">
                  <b>${escHtml(a.actor_name||'System')}</b>
                  <span style="color:var(--muted)"> ${activityLabel(a.action)}</span>
                </div>
                ${a.note ? `<div style="font-size:12px;color:var(--text-soft);margin-top:3px;word-break:break-word">${escHtml(a.note)}</div>` : ''}
                <div style="font-size:11px;color:var(--muted);margin-top:3px">
                  ${a.created_at ? new Date(a.created_at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : ''}
                </div>
              </div>
            </div>`).join('') + `</div>`;
      }
      logEl.innerHTML = renderActivity(task.activities||[]);
      logEl.scrollTop = 0;
    }
    document.getElementById('newComment').value = '';
    loadTaskData(); // refresh cards in background
  } catch(e){ toast(e.message,'error'); }
  finally{ setLoading('postCommentBtn', false); }
}

// ── File Management ───────────────────────────────────────────────────────

function escAttr(s){ return (s||'').replace(/'/g,"\\'").replace(/"/g,'&quot;'); }

function fileIcon(mime){
  if(!mime) return '📄';
  if(mime.startsWith('image/'))       return '🖼';
  if(mime === 'application/pdf')      return '📕';
  if(mime.includes('word'))           return '📝';
  if(mime.includes('excel') || mime.includes('spreadsheet')) return '📊';
  if(mime.includes('zip') || mime.includes('rar'))           return '🗜';
  if(mime.startsWith('video/'))       return '🎬';
  return '📄';
}

function fmtFileSize(bytes){
  if(!bytes) return '';
  if(bytes < 1024)       return bytes + 'B';
  if(bytes < 1048576)    return (bytes/1024).toFixed(0) + 'KB';
  return (bytes/1048576).toFixed(1) + 'MB';
}

async function manageTaskFiles(taskId, taskTitle){
  let task = null;
  try{ task = await api('GET', `/api/tasks/${taskId}`); } catch(e){ toast(e.message,'error'); return; }

  function renderFileList(files){
    if(!files.length) return `<div style="font-size:13px;color:var(--muted);padding:12px 0">No attachments yet.</div>`;
    return files.map(f => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:20px">${fileIcon(f.mime_type)}</span>
        <div style="flex:1;min-width:0">
          <button onclick="downloadTaskFile(${f.id},'${escAttr(f.filename)}')"
             style="background:none;border:none;cursor:pointer;font-size:13px;font-weight:600;
                    color:var(--accent);padding:0;text-align:left;
                    display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">
            ${escHtml(f.filename)}
          </button>
          <div style="font-size:11px;color:var(--muted)">
            ${fmtFileSize(f.file_size)} · ${f.uploaded_by||''}
            ${f.note ? ` · ${escHtml(f.note)}` : ''}
          </div>
        </div>
        <button onclick="deleteTaskFile(${f.id},${taskId},'${escAttr(taskTitle)}')"
          style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;padding:4px;flex-shrink:0"
          title="Delete file">🗑</button>
      </div>`).join('');
  }

  showModal(`📎 Files — ${taskTitle}`, `
    <div id="taskFileList">${renderFileList(task.files||[])}</div>
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px">Upload New File</div>
      <div class="form-group">
        <div class="fld-label">Choose File <span style="font-size:11px;color:var(--muted)">(max 20 MB)</span></div>
        <input type="file" id="taskFileInput" style="width:100%"
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.txt,.dxf,.dwg,.step,.stp,.igs">
      </div>
      <div class="form-group">
        <div class="fld-label">Note (optional)</div>
        <input id="taskFileNote" placeholder="e.g. Final approved drawing" style="width:100%">
      </div>
      <button class="btn btn-primary" id="uploadFileBtn" onclick="uploadTaskFile(${taskId},'${escAttr(taskTitle)}')" style="width:100%">
        ⬆ Upload File
      </button>
    </div>`,
    `<button class="btn btn-primary" onclick="closeModal()">Done</button>`,
    false
  );
}

async function uploadTaskFile(taskId, taskTitle){
  const fileInput = document.getElementById('taskFileInput');
  const note      = document.getElementById('taskFileNote')?.value.trim() || '';
  if(!fileInput?.files?.length){ toast('Choose a file first','error'); return; }

  const file = fileInput.files[0];
  if(file.size > 20 * 1024 * 1024){ toast('File too large (max 20 MB)','error'); return; }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('note', note);

  setLoading('uploadFileBtn', true);
  try{
    const token = authGetToken();
    const res = await fetch(`/api/tasks/${taskId}/files`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });
    if(!res.ok){
      const j = await res.json().catch(()=>({}));
      throw new Error(j.detail || 'Upload failed');
    }
    toast('File uploaded!', 'success');
    // Refresh the file list in the modal
    const task = await api('GET', `/api/tasks/${taskId}`);
    const listEl = document.getElementById('taskFileList');
    if(listEl){
      listEl.innerHTML = (function renderFileListInner(files){
        if(!files.length) return `<div style="font-size:13px;color:var(--muted);padding:12px 0">No attachments yet.</div>`;
        return files.map(f => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:20px">${fileIcon(f.mime_type)}</span>
            <div style="flex:1;min-width:0">
              <button onclick="downloadTaskFile(${f.id},'${escAttr(f.filename)}')"
                 style="background:none;border:none;cursor:pointer;font-size:13px;font-weight:600;
                        color:var(--accent);padding:0;text-align:left;
                        display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">
                ${escHtml(f.filename)}
              </button>
              <div style="font-size:11px;color:var(--muted)">
                ${fmtFileSize(f.file_size)} · ${f.uploaded_by||''}
                ${f.note ? ` · ${escHtml(f.note)}` : ''}
              </div>
            </div>
            <button onclick="deleteTaskFile(${f.id},${taskId},'${escAttr(taskTitle)}')"
              style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;padding:4px;flex-shrink:0">🗑</button>
          </div>`).join('');
      })(task.files||[]);
    }
    // Clear inputs
    fileInput.value = '';
    document.getElementById('taskFileNote').value = '';
    loadTaskData(); // refresh cards in background
  } catch(e){ toast(e.message,'error'); }
  finally{ setLoading('uploadFileBtn', false); }
}

async function downloadTaskFile(fileId, filename){
  try{
    const token = authGetToken();
    const res = await fetch(`/api/task-files/${fileId}/download`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if(!res.ok){
      const j = await res.json().catch(()=>({}));
      throw new Error(j.detail || 'Download failed');
    }
    // Create a temporary blob URL and click it — triggers browser Save dialog
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 1000);
  } catch(e){ toast(e.message, 'error'); }
}

async function deleteTaskFile(fileId, taskId, taskTitle){
  const ok = await confirm2('Delete this file permanently?', 'Delete File');
  if(!ok) return;
  try{
    await api('DELETE', `/api/task-files/${fileId}`);
    toast('File deleted');
    manageTaskFiles(taskId, taskTitle); // reopen modal
  } catch(e){ toast(e.message,'error'); }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtDate(iso){
  if(!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
}
