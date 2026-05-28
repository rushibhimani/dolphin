/**
 * Dolphin ERP — User Management (Admin only)
 * Three-tier page permissions: No Access / View / Modify / Full Control
 * Plus capability toggles for cross-cutting features.
 */

// ── All pages ─────────────────────────────────────────────────────────────────
const ALL_PAGES = [
  { id:'dashboard',    label:'Dashboard',       icon:'⊞', group:'Main' },
  { id:'today',        label:"Today's Work",    icon:'⏱', group:'Main' },
  { id:'past-work',    label:'Past Work',       icon:'🕐', group:'Main' },
  { id:'tasks',        label:'Staff Tasks',     icon:'✓',  group:'Main' },
  { id:'upcoming',     label:'Upcoming',        icon:'📅', group:'Main' },
  { id:'jobs',         label:'Jobs',            icon:'📋', group:'Production' },
  { id:'orders',       label:'Orders',          icon:'📦', group:'Production' },
  { id:'quote',        label:'Quotation',       icon:'💰', group:'Production' },
  { id:'quotations',   label:'Quotation List',  icon:'📄', group:'Production' },
  { id:'schedule',     label:'Gantt Schedule',  icon:'📊', group:'Production' },
  { id:'capacity',     label:'Capacity',        icon:'📈', group:'Production' },
  { id:'floorplan',    label:'Floor Plan',      icon:'🏭', group:'Production' },
  { id:'routings',     label:'Routings',        icon:'≡',  group:'Setup' },
  { id:'machines',     label:'Machines',        icon:'⚙',  group:'Setup' },
  { id:'workers',      label:'Workers',         icon:'👷', group:'Setup' },
  { id:'customers',    label:'Customers',       icon:'👤', group:'Setup' },
  { id:'reports',      label:'Reports',         icon:'📉', group:'Reports' },
  { id:'routing-stats',label:'Routing Stats',   icon:'📐', group:'Reports' },
  { id:'settings',     label:'App Settings',    icon:'⚙',  group:'Admin' },
  { id:'users',        label:'User Management', icon:'🔑', group:'Admin' },
];

// Capability overrides (cross-cutting, not page-specific)
const ALL_CAPS = [
  { id:'can_control_ops',          label:'Control Shop Ops',      desc:'Start, pause, complete operations on the floor' },
  { id:'can_control_own_ops_only', label:'Own Ops Only',          desc:'If enabled: can only control ops assigned to themselves' },
  { id:'can_schedule',             label:'Run Scheduler',         desc:'Trigger Schedule All / schedule individual jobs' },
  { id:'can_see_financials',       label:'See Financials',        desc:'View revenue, pricing, pipeline value' },
  { id:'can_see_all_workers',      label:'See All Workers',       desc:"See all workers' ops on Today's Work (not just own)" },
];

// ── Role defaults (page_levels) ───────────────────────────────────────────────
// Level: 0=none, 1=view, 2=modify, 3=full
const ALL_PAGE_IDS = ALL_PAGES.map(p => p.id);

function _levels(overrides) {
  const base = {};
  ALL_PAGE_IDS.forEach(id => base[id] = 0);
  Object.assign(base, overrides);
  return base;
}

const ROLE_DEFAULTS = {
  admin: {
    page_levels: _levels(Object.fromEntries(ALL_PAGE_IDS.map(id => [id, 3]))),
    can_control_ops: true, can_control_own_ops_only: false,
    can_schedule: true, can_see_financials: true,
    can_see_all_workers: true,
  },
  manager: {
    page_levels: _levels({
      dashboard:3, today:3, 'past-work':3, tasks:3, upcoming:3,
      jobs:3, orders:3, quote:3, quotations:3, schedule:3,
      capacity:3, floorplan:3, routings:3, machines:3, workers:3,
      customers:3, reports:3, 'routing-stats':3, settings:2,
      users: 0,
    }),
    can_control_ops: true, can_control_own_ops_only: false,
    can_schedule: true, can_see_financials: true,
    can_see_all_workers: true,
  },
  staff: {
    page_levels: _levels({
      dashboard:1, today:1, 'past-work':1, tasks:3, upcoming:1,
      jobs:1, orders:1, schedule:1, capacity:1, floorplan:1,
      routings:1, machines:1, workers:1, customers:1, reports:1,
    }),
    can_control_ops: false, can_control_own_ops_only: false,
    can_schedule: false, can_see_financials: false,
    can_see_all_workers: true,
  },
  operator: {
    page_levels: _levels({ today:3, 'past-work':3, tasks:3 }),
    can_control_ops: true, can_control_own_ops_only: true,
    can_schedule: false, can_see_financials: false,
    can_see_all_workers: false,
  },
};

// ── Render ────────────────────────────────────────────────────────────────────
async function renderUsers(){
  document.getElementById('topbarActions').innerHTML =
    `<button class="btn btn-primary" onclick="openUserModal(null)">+ Add User</button>`;
  document.getElementById('content').innerHTML =
    `<div style="max-width:980px;margin:0 auto">
      <div style="margin-bottom:16px">
        <div style="font-size:18px;font-weight:700;margin:0 0 4px">User Management</div>
        <div style="font-size:12px;color:var(--muted)">Control who can access Dolphin ERP and exactly what they can do per page.</div>
      </div>
      <div id="usersContent"><div style="color:var(--muted)">Loading…</div></div>
    </div>`;
  await _loadUsers();
}

async function _loadUsers(){
  try {
    const users = await api('GET', '/api/users');
    _renderUserList(users);
  } catch(e){
    document.getElementById('usersContent').innerHTML =
      `<div style="color:var(--red);padding:20px">${e.message}</div>`;
  }
}

function _roleBadge(role, hasCustom){
  const cfg = {
    admin:    { bg:'var(--red-soft)',       border:'var(--red)',    color:'var(--red)',    label:'Admin' },
    manager:  { bg:'var(--accent-soft)',    border:'var(--accent)', color:'var(--accent)', label:'Manager' },
    staff:    { bg:'rgba(99,102,241,.12)',  border:'#818cf8',       color:'#818cf8',       label:'Staff' },
    operator: { bg:'var(--surface)',        border:'var(--border)', color:'var(--muted)',  label:'Operator' },
  }[role] || { bg:'var(--surface)', border:'var(--border)', color:'var(--muted)', label: role };
  const customBadge = hasCustom
    ? `<span style="margin-left:4px;display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;
         font-weight:600;background:rgba(16,185,129,.12);border:1px solid var(--green);color:var(--green)">Custom</span>`
    : '';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;
    background:${cfg.bg};border:1px solid ${cfg.border};color:${cfg.color}">${cfg.label}</span>${customBadge}`;
}

function _renderUserList(users){
  const el = document.getElementById('usersContent');
  if(!users.length){
    el.innerHTML = `<div class="card"><div class="empty">No users yet.</div></div>`;
    return;
  }
  const currentUserId = parseInt(authGetUser()?.sub || 0);
  const adminCount = users.filter(u=>u.role==='admin'&&u.is_active).length;

  const rows = users.map(u => `
    <tr style="border-bottom:1px solid var(--border);${!u.is_active?'opacity:0.5':''}">
      <td style="padding:11px 14px">
        <div style="font-weight:600;font-size:13px">${escHtml(u.display_name)}</div>
        <div style="font-size:11px;color:var(--muted);font-family:var(--mono)">@${escHtml(u.username)}</div>
      </td>
      <td style="padding:11px 14px">${_roleBadge(u.role, !!u.custom_permissions)}</td>
      <td style="padding:11px 14px;font-size:12px;color:var(--muted)">
        ${u.worker_name ? `👷 ${escHtml(u.worker_name)}` : '—'}
      </td>
      <td style="padding:11px 14px;font-size:12px">
        ${u.has_password ? '<span style="color:var(--green)">✓ Password</span>' : '<span style="color:var(--muted)">No pw</span>'}
        ${u.has_pin ? ' · <span style="color:var(--green)">✓ PIN</span>' : ''}
      </td>
      <td style="padding:11px 14px;font-size:11px;color:var(--muted)">
        ${u.last_login ? new Date(u.last_login).toLocaleDateString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : 'Never'}
      </td>
      <td style="padding:11px 14px;text-align:center">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${u.is_active?'var(--green)':'var(--muted)'}"></span>
        <span style="font-size:11px;color:var(--muted);margin-left:4px">${u.is_active?'Active':'Inactive'}</span>
      </td>
      <td style="padding:11px 14px">
        <div style="display:flex;gap:6px;justify-content:flex-end">
          <button class="btn btn-ghost" style="font-size:12px;padding:4px 9px" onclick="openUserModal(${u.id})">Edit</button>
          ${u.role!=='admin'||adminCount>1 ? `<button class="btn btn-danger" style="font-size:12px;padding:4px 9px" onclick="deleteUser(${u.id},'${escHtml(u.display_name)}')">Delete</button>` : ''}
        </div>
      </td>
    </tr>`).join('');

  const roleSummary = ['admin','manager','staff','operator'].map(role => {
    const count = users.filter(u=>u.role===role&&u.is_active).length;
    const labels = {admin:'Admins',manager:'Managers',staff:'Staff',operator:'Operators'};
    return `<div class="card" style="padding:12px 16px">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${labels[role]}</div>
      <div style="font-size:22px;font-weight:700">${count}</div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px">
      ${roleSummary}
    </div>
    <div class="card" style="overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:var(--surface);border-bottom:1px solid var(--border)">
          <th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">User</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">Role</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">Worker</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">Credentials</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">Last Login</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--muted);font-weight:600">Status</th>
          <th style="padding:10px 14px;text-align:right;font-size:11px;color:var(--muted);font-weight:600">Actions</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="margin-top:12px;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--muted)">
      <b>Custom</b> badge = user has hand-picked permissions overriding their role defaults.
      Click Edit → Permissions tab to customise per-page access levels.
    </div>`;
}

// ── User Modal ────────────────────────────────────────────────────────────────
var _umUserId = null;

async function openUserModal(userId){
  _umUserId = userId || null;
  let u = null;
  if(userId) try { const users = await api('GET','/api/users'); u = users.find(x=>x.id===userId)||null; } catch {}
  _buildUserModal(u);
}

function _switchUmTab(tab){
  ['details','permissions'].forEach(t => {
    document.getElementById(`um_tab_${t}`).style.display     = t === tab ? '' : 'none';
    const btn = document.getElementById(`um_btn_${t}`);
    btn.style.background = t === tab ? 'var(--accent)' : 'var(--surface)';
    btn.style.color      = t === tab ? '#000'          : 'var(--text)';
  });
}

function _buildUserModal(u){
  const isNew  = !u;
  const userId = _umUserId;

  // Parse existing custom_permissions
  let existing = null;
  if(u?.custom_permissions){
    try { existing = JSON.parse(u.custom_permissions); } catch {}
  }

  const roleDefault  = ROLE_DEFAULTS[u?.role || 'operator'] || ROLE_DEFAULTS.operator;
  const effective    = existing || roleDefault;
  const effectivePL  = effective.page_levels || roleDefault.page_levels;

  const workerOpts = (allWorkers||[]).map(w =>
    `<option value="${w.id}" ${u?.worker_id===w.id?'selected':''}>${escHtml(w.name)} (${w.code||'W??'})</option>`
  ).join('');

  // ── DETAILS TAB ───────────────────────────────────────────────────────────
  const detailsHtml = `
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Display Name <span style="color:var(--red)">*</span></div>
        <input id="um_name" value="${escHtml(u?.display_name||'')}" placeholder="e.g. Rushi Bhimani">
      </div>
      <div class="form-group">
        <div class="fld-label">Username <span style="color:var(--red)">*</span></div>
        <input id="um_user" value="${escHtml(u?.username||'')}" placeholder="e.g. rushi"
          ${!isNew?'readonly style="opacity:0.6;cursor:not-allowed"':''} autocapitalize="none">
      </div>
    </div>
    <div class="form-row cols-2">
      <div class="form-group">
        <div class="fld-label">Base Role <span style="color:var(--red)">*</span>
          <span style="font-size:10px;color:var(--muted);font-weight:400"> — sets permission defaults</span>
        </div>
        <select id="um_role" onchange="umRoleChange()">
          <option value="admin"    ${u?.role==='admin'   ?'selected':''}>Admin</option>
          <option value="manager"  ${u?.role==='manager' ?'selected':''}>Manager</option>
          <option value="staff"    ${u?.role==='staff'   ?'selected':''}>Staff</option>
          <option value="operator" ${(!u||u?.role==='operator')?'selected':''}>Operator</option>
        </select>
      </div>
      <div class="form-group">
        <div class="fld-label">Status</div>
        <select id="um_active">
          <option value="1" ${(!u||u?.is_active)?'selected':''}>Active</option>
          <option value="0" ${(u&&!u?.is_active)?'selected':''}>Inactive</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <div class="fld-label">Link to Worker
        <span style="font-size:10px;color:var(--muted);font-weight:400"> (required for operators; links this login to a shop floor worker)</span>
      </div>
      <select id="um_worker">
        <option value="">— Not linked —</option>
        ${workerOpts}
      </select>
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px;margin-top:4px">
      <div style="font-weight:600;font-size:13px;margin-bottom:10px">
        🔑 Password ${isNew?'':'(leave blank to keep existing)'}
      </div>
      <div class="form-row cols-2">
        <div class="form-group">
          <div class="fld-label">${isNew?'Password':'New Password'}</div>
          <input type="password" id="um_pw" placeholder="${isNew?'Min 8 characters':'Leave blank to keep'}">
        </div>
        <div class="form-group">
          <div class="fld-label">Confirm</div>
          <input type="password" id="um_pw2" placeholder="Repeat password">
        </div>
      </div>
      ${!isNew&&u?.has_password?`<label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="um_clrpw"> Remove password</label>`:''}
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px">
      <div style="font-weight:600;font-size:13px;margin-bottom:10px">🔢 PIN ${isNew?'(4–6 digits)':'(leave blank to keep)'}</div>
      <div class="form-row cols-2">
        <div class="form-group">
          <div class="fld-label">${isNew?'PIN':'New PIN'}</div>
          <input type="password" inputmode="numeric" id="um_pin" maxlength="6" placeholder="4–6 digits">
        </div>
        <div class="form-group">
          <div class="fld-label">Confirm PIN</div>
          <input type="password" inputmode="numeric" id="um_pin2" maxlength="6" placeholder="Repeat PIN">
        </div>
      </div>
      ${!isNew&&u?.has_pin?`<label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="um_clrpin"> Remove PIN</label>`:''}
    </div>
    ${!isNew?`<div style="font-size:11px;color:var(--muted);margin-top:8px">
      Created: ${u.created_at?new Date(u.created_at).toLocaleDateString('en-IN'):'—'} ·
      Last login: ${u.last_login?new Date(u.last_login).toLocaleDateString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'Never'}
    </div>`:''}`;

  // ── PERMISSIONS TAB ───────────────────────────────────────────────────────
  const hasCustom = !!existing;
  const LEVEL_LABELS = ['No Access','View Only','Modify','Full Control'];
  const LEVEL_COLORS = ['var(--muted)','#3b82f6','var(--accent)','var(--green)'];
  const LEVEL_ICONS  = ['✗','👁','✎','✓'];

  // Group pages
  const groups = {};
  ALL_PAGES.forEach(p => {
    if(!groups[p.group]) groups[p.group] = [];
    groups[p.group].push(p);
  });

  const pageRows = Object.entries(groups).map(([grpName, pages]) => `
    <div style="margin-bottom:18px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
                  color:var(--muted);margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid var(--border)">
        ${grpName}
      </div>
      ${pages.map(p => {
        const lvl = effectivePL[p.id] ?? 0;
        return `<div style="display:flex;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);gap:10px" id="plrow_${p.id}">
          <div style="flex:1;font-size:13px">${p.icon} ${p.label}</div>
          <div style="display:flex;gap:4px" id="plbtn_${p.id}">
            ${[0,1,2,3].map(lv => `
              <button onclick="umSetPageLevel('${p.id}',${lv})"
                id="pl_${p.id}_${lv}"
                data-active="${lv===lvl?'1':'0'}"
                style="padding:3px 8px;border-radius:5px;border:1px solid ${lv===lvl?LEVEL_COLORS[lv]:'var(--border)'};
                       font-size:11px;font-weight:600;cursor:pointer;transition:all .12s;
                       background:${lv===lvl?LEVEL_COLORS[lv]:'var(--surface)'};
                       color:${lv===lvl?'#fff':'var(--muted)'}"
                title="${LEVEL_LABELS[lv]}">
                ${LEVEL_ICONS[lv]} ${LEVEL_LABELS[lv]}
              </button>`).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>`).join('');

  const capRows = ALL_CAPS.map(c => {
    const checked = !!effective[c.id];
    return `<label style="display:flex;align-items:flex-start;gap:10px;padding:9px 12px;
              border-radius:6px;cursor:pointer;border:1px solid var(--border);
              background:${checked?'var(--green-soft)':'var(--surface)'};transition:background .1s"
              onclick="umToggleCap(this)">
      <input type="checkbox" class="perm-cap" value="${c.id}" ${checked?'checked':''}
        style="margin-top:2px;accent-color:var(--green);width:15px;height:15px;flex-shrink:0;pointer-events:none">
      <div>
        <div style="font-size:13px;font-weight:600">${c.label}</div>
        <div style="font-size:11px;color:var(--muted);line-height:1.3;margin-top:2px">${c.desc}</div>
      </div>
    </label>`;
  }).join('');

  const permsHtml = `
    <div id="um_custom_banner" style="margin-bottom:14px;padding:10px 14px;border-radius:8px;
         background:${hasCustom?'var(--green-soft)':'var(--surface)'};border:1px solid ${hasCustom?'var(--green)':'var(--border)'}">
      <div style="font-size:13px;font-weight:600;color:${hasCustom?'var(--green)':'var(--text)'}">
        ${hasCustom?'✓ Custom permissions active — these override role defaults.':'Using role defaults. Change any level to customise.'}
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">
        Base role: <b id="um_role_label">${u?.role||'operator'}</b>
        · <button onclick="umResetPerms()" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:12px;padding:0;text-decoration:underline">Reset to role defaults</button>
      </div>
    </div>

    <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:var(--muted)">
      <b style="color:var(--text)">Access levels per page:</b>
      &nbsp;
      <span style="color:var(--muted)">✗ No Access</span> &nbsp;·&nbsp;
      <span style="color:#3b82f6">👁 View Only — can see but not change anything</span> &nbsp;·&nbsp;
      <span style="color:var(--accent)">✎ Modify — can add &amp; edit, not delete</span> &nbsp;·&nbsp;
      <span style="color:var(--green)">✓ Full Control — add, edit, delete</span>
    </div>

    <div style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:10px">
        Page Access Levels
      </div>
      ${pageRows}
    </div>

    <div>
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:10px">
        Additional Capabilities
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px">
        ${capRows}
      </div>
    </div>`;

  // ── Build modal ───────────────────────────────────────────────────────────
  showModal(
    isNew ? 'Add User' : `Edit — ${escHtml(u.display_name)}`,
    `<div style="display:flex;gap:6px;margin-bottom:16px;border-bottom:1px solid var(--border);padding-bottom:12px">
      <button id="um_btn_details" onclick="_switchUmTab('details')"
        style="padding:6px 14px;border-radius:6px;border:1px solid var(--border);cursor:pointer;
               font-size:13px;font-weight:600;background:var(--accent);color:#000">
        👤 Details
      </button>
      <button id="um_btn_permissions" onclick="_switchUmTab('permissions')"
        style="padding:6px 14px;border-radius:6px;border:1px solid var(--border);cursor:pointer;
               font-size:13px;font-weight:600;background:var(--surface);color:var(--text)">
        🔐 Permissions ${hasCustom?'<span style="color:var(--green)">●</span>':''}
      </button>
    </div>
    <div id="um_tab_details">${detailsHtml}</div>
    <div id="um_tab_permissions" style="display:none">${permsHtml}</div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" id="umSaveBtn" onclick="saveUser()">
       ${isNew?'Create User':'Save Changes'}
     </button>`,
    true
  );
}

// ── Permission controls ───────────────────────────────────────────────────────

function umSetPageLevel(pageId, level){
  const LEVEL_COLORS = ['var(--muted)','#3b82f6','var(--accent)','var(--green)'];
  for(let lv = 0; lv <= 3; lv++){
    const btn = document.getElementById(`pl_${pageId}_${lv}`);
    if(!btn) continue;
    const active = lv === level;
    btn.dataset.active   = active ? '1' : '0';
    btn.style.background = active ? LEVEL_COLORS[lv] : 'var(--surface)';
    btn.style.color      = active ? '#fff'           : 'var(--muted)';
    btn.style.borderColor = active ? LEVEL_COLORS[lv] : 'var(--border)';
  }
}

function umToggleCap(label){
  const cb = label.querySelector('input[type=checkbox]');
  cb.checked = !cb.checked;
  label.style.background = cb.checked ? 'var(--green-soft)' : 'var(--surface)';
}

function umResetPerms(){
  const role = document.getElementById('um_role')?.value || 'operator';
  const def  = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.operator;
  // Reset page levels
  ALL_PAGES.forEach(p => {
    const lv = def.page_levels?.[p.id] ?? 0;
    umSetPageLevel(p.id, lv);
  });
  // Reset caps
  ALL_CAPS.forEach(c => {
    const cb = document.querySelector(`.perm-cap[value="${c.id}"]`);
    if(!cb) return;
    cb.checked = !!def[c.id];
    cb.closest('label').style.background = cb.checked ? 'var(--green-soft)' : 'var(--surface)';
  });
  const lbl = document.getElementById('um_role_label');
  if(lbl) lbl.textContent = role;
}

function umRoleChange(){
  const role = document.getElementById('um_role')?.value;
  // Update role label in permissions banner
  const lbl = document.getElementById('um_role_label');
  if(lbl) lbl.textContent = role;
  // Worker link: always visible — any user can be linked to a worker
  // (operators require it; managers/admins may optionally be linked)
  // Reset permissions to new role defaults
  umResetPerms();
}

function _collectPermissions(){
  // Collect page_levels
  const page_levels = {};
  ALL_PAGES.forEach(p => {
    let level = 0;
    // Read active level via data-active attribute (set by umSetPageLevel)
    for(let lv = 0; lv <= 3; lv++){
      const btn = document.getElementById(`pl_${p.id}_${lv}`);
      if(btn && btn.dataset.active === '1'){
        level = lv;
      }
    }
    page_levels[p.id] = level;
  });

  // Collect caps
  const caps = {};
  ALL_CAPS.forEach(c => {
    const cb = document.querySelector(`.perm-cap[value="${c.id}"]`);
    if(cb) caps[c.id] = cb.checked;
  });

  // Derive legacy fields for backend compatibility
  const pages = Object.entries(page_levels).filter(([,l])=>l>0).map(([p])=>p);
  const can_delete = Object.values(page_levels).some(l => l >= 3);
  const can_edit_routings = (page_levels['routings'] || 0) >= 2;
  const can_manage_users  = (page_levels['users']    || 0) >= 2;

  return JSON.stringify({
    page_levels, pages,
    can_delete, can_edit_routings, can_manage_users,
    ...caps
  });
}

async function saveUser(){
  const userId = _umUserId;
  const isNew  = !userId;
  const name   = document.getElementById('um_name')?.value.trim();
  const uname  = document.getElementById('um_user')?.value.trim().toLowerCase();
  const role   = document.getElementById('um_role')?.value;
  const active = document.getElementById('um_active')?.value === '1';
  const wid    = document.getElementById('um_worker')?.value || null;
  const pw     = document.getElementById('um_pw')?.value;
  const pw2    = document.getElementById('um_pw2')?.value;
  const pin    = document.getElementById('um_pin')?.value;
  const pin2   = document.getElementById('um_pin2')?.value;

  if(!name){ toast('Display name required','error'); return; }
  if(isNew && !uname){ toast('Username required','error'); return; }
  if(pw && pw !== pw2){ toast('Passwords do not match','error'); return; }
  if(pw && pw.length < 8){ toast('Password must be at least 8 characters','error'); return; }
  if(pin && pin !== pin2){ toast('PINs do not match','error'); return; }
  if(pin && (!/^\d{4,6}$/.test(pin))){ toast('PIN must be 4–6 digits','error'); return; }
  if(isNew && !pw && !pin){ toast('Set at least a password or PIN','error'); return; }
  if(role === 'operator' && !wid){ toast('Operators must be linked to a worker','error'); return; }

  const customPerms = _collectPermissions();

  const data = {
    display_name: name, role, is_active: active,
    worker_id: wid ? parseInt(wid) : null,
    custom_permissions: customPerms,
  };
  if(isNew) data.username = uname;
  if(pw)    data.password = pw;
  if(pin)   data.pin = pin;
  if(document.getElementById('um_clrpw')?.checked)  data.clear_password = true;
  if(document.getElementById('um_clrpin')?.checked) data.clear_pin = true;

  setLoading('umSaveBtn', true);
  try {
    if(isNew) await api('POST','/api/users', data);
    else      await api('PUT', `/api/users/${userId}`, data);
    toast(isNew ? 'User created!' : 'User updated!');
    closeModal();
    await _loadUsers();
  } catch(e){ toast(e.message,'error'); }
  finally { setLoading('umSaveBtn', false); }
}

async function deleteUser(userId, name){
  const ok = await confirm2(`Delete user "${name}"? They will lose access immediately.`, 'Delete User');
  if(!ok) return;
  try {
    await api('DELETE', `/api/users/${userId}`);
    toast(`User "${name}" deleted`);
    await _loadUsers();
  } catch(e){ toast(e.message,'error'); }
}
