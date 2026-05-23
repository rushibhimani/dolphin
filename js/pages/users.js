/**
 * Dolphin ERP — User Management (Admin only)
 */

async function renderUsers(){
  document.getElementById('topbarActions').innerHTML =
    `<button class="btn btn-primary" onclick="openUserModal(null)">+ Add User</button>`;

  document.getElementById('content').innerHTML =
    `<div style="max-width:900px;margin:0 auto">
      <div style="margin-bottom:16px">
        <h2 style="font-size:18px;font-weight:700;margin:0 0 4px">User Management</h2>
        <div style="font-size:12px;color:var(--muted)">Control who can access Dolphin ERP and what they can do.</div>
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

function _roleBadge(role){
  const cfg = {
    admin:    { bg:'var(--red-soft)',    border:'var(--red)',    color:'var(--red)',    label:'Admin' },
    manager:  { bg:'var(--accent-soft)', border:'var(--accent)', color:'var(--accent)', label:'Manager' },
    operator: { bg:'var(--surface)',     border:'var(--border)', color:'var(--muted)',  label:'Operator' },
  }[role] || { bg:'var(--surface)', border:'var(--border)', color:'var(--muted)', label: role };
  return `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;
    background:${cfg.bg};border:1px solid ${cfg.border};color:${cfg.color}">${cfg.label}</span>`;
}

function _renderUserList(users){
  const el = document.getElementById('usersContent');
  if(!users.length){
    el.innerHTML = `<div class="card"><div class="empty">No users yet.</div></div>`;
    return;
  }
  const adminCount = users.filter(u=>u.role==='admin'&&u.is_active).length;
  const currentUserId = parseInt(authGetUser()?.sub || 0);

  const rows = users.map(u => `
    <tr style="border-bottom:1px solid var(--border);${!u.is_active?'opacity:0.5':''}">
      <td style="padding:11px 14px">
        <div style="font-weight:600;font-size:13px">${escHtml(u.display_name)}</div>
        <div style="font-size:11px;color:var(--muted);font-family:var(--mono)">@${escHtml(u.username)}</div>
      </td>
      <td style="padding:11px 14px">${_roleBadge(u.role)}</td>
      <td style="padding:11px 14px;font-size:12px;color:var(--muted)">
        ${u.worker_name ? `👷 ${escHtml(u.worker_name)}` : '—'}
      </td>
      <td style="padding:11px 14px;font-size:12px">
        ${u.has_password ? '<span style="color:var(--green)">✓ Password</span>' : '<span style="color:var(--muted)">No password</span>'}
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

  el.innerHTML = `
    <!-- Role summary -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px">
      ${['admin','manager','operator'].map(role => {
        const count = users.filter(u=>u.role===role&&u.is_active).length;
        const labels = {admin:'Admins',manager:'Managers',operator:'Operators'};
        return `<div class="card" style="padding:12px 16px">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${labels[role]}</div>
          <div style="font-size:22px;font-weight:700">${count}</div>
        </div>`;
      }).join('')}
    </div>

    <!-- User table -->
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

    <!-- Info box -->
    <div style="margin-top:14px;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--muted)">
      <strong>Roles:</strong>
      <strong style="color:var(--red)">Admin</strong> — full access + user management ·
      <strong style="color:var(--accent)">Manager</strong> — full access, no user management ·
      <strong style="color:var(--muted)">Operator</strong> — Today's Work only, sees only their own tasks
    </div>`;
}

// ── User modal ────────────────────────────────────────────────────────────────
async function openUserModal(userId){
  let u = null;
  if(userId) try { const users = await api('GET','/api/users'); u = users.find(x=>x.id===userId); } catch {}

  const workerOpts = allWorkers.map(w =>
    `<option value="${w.id}" ${u?.worker_id===w.id?'selected':''}>${escHtml(w.name)} (${w.code||'W??'})</option>`
  ).join('');

  const isNew = !u;

  showModal(isNew ? 'Add User' : `Edit — ${u.display_name}`, `
    <div style="display:grid;gap:14px">

      <div class="form-row cols-2">
        <div class="form-group">
          <div class="fld-label">Display Name <span style="color:var(--red)">*</span></div>
          <input id="um_name" value="${escHtml(u?.display_name||'')}" placeholder="e.g. Shreyans Kumar">
        </div>
        <div class="form-group">
          <div class="fld-label">Username <span style="color:var(--red)">*</span></div>
          <input id="um_user" value="${escHtml(u?.username||'')}" placeholder="e.g. shreyans"
            ${!isNew?'readonly style="opacity:0.6;cursor:not-allowed"':''} autocapitalize="none">
        </div>
      </div>

      <div class="form-row cols-2">
        <div class="form-group">
          <div class="fld-label">Role <span style="color:var(--red)">*</span></div>
          <select id="um_role" onchange="umRoleChange()">
            <option value="admin"    ${u?.role==='admin'?'selected':''}>Admin — full access</option>
            <option value="manager"  ${u?.role==='manager'?'selected':''}>Manager — full access</option>
            <option value="operator" ${(!u||u?.role==='operator')?'selected':''}>Operator — Today only</option>
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

      <!-- Worker link — shown only for operators -->
      <div id="um_worker_wrap" class="form-group" style="${u?.role!=='operator'&&!isNew?'display:none':''}">
        <div class="fld-label">Link to Worker <span style="font-size:10px;color:var(--muted);font-weight:400">(required for operators — filters their ops)</span></div>
        <select id="um_worker">
          <option value="">— Not linked to a worker —</option>
          ${workerOpts}
        </select>
      </div>

      <!-- Password section -->
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px">
        <div style="font-weight:600;font-size:13px;margin-bottom:10px">
          🔑 Password ${isNew?'(set one for username/password login)':'(leave blank to keep existing)'}
        </div>
        <div class="form-row cols-2">
          <div class="form-group">
            <div class="fld-label">${isNew?'Password':'New Password'}</div>
            <input type="password" id="um_pw" placeholder="${isNew?'Min 8 characters':'Leave blank to keep'}">
          </div>
          <div class="form-group">
            <div class="fld-label">Confirm Password</div>
            <input type="password" id="um_pw2" placeholder="Repeat password">
          </div>
        </div>
        ${!isNew&&u?.has_password?`<label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="um_clrpw"> Remove password</label>`:''}
      </div>

      <!-- PIN section — for operators -->
      <div id="um_pin_wrap" style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px">
        <div style="font-weight:600;font-size:13px;margin-bottom:10px">
          🔢 PIN ${isNew?'(4–6 digits for tablet quick-login)':'(leave blank to keep existing)'}
        </div>
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

      ${!isNew?`<div style="font-size:11px;color:var(--muted)">
        Created: ${u.created_at?new Date(u.created_at).toLocaleDateString('en-IN'):'—'} ·
        Last login: ${u.last_login?new Date(u.last_login).toLocaleDateString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'Never'}
      </div>`:''}

    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" id="umSaveBtn" onclick="saveUser(${userId||'null'})">${isNew?'Create User':'Save Changes'}</button>`,
    true);
}

function umRoleChange(){
  const role = document.getElementById('um_role')?.value;
  const wrap = document.getElementById('um_worker_wrap');
  if(wrap) wrap.style.display = role === 'operator' ? '' : 'none';
}

async function saveUser(userId){
  const isNew = !userId || userId === 'null';
  const name  = document.getElementById('um_name')?.value.trim();
  const uname = document.getElementById('um_user')?.value.trim().toLowerCase();
  const role  = document.getElementById('um_role')?.value;
  const active= document.getElementById('um_active')?.value === '1';
  const wid   = document.getElementById('um_worker')?.value || null;
  const pw    = document.getElementById('um_pw')?.value;
  const pw2   = document.getElementById('um_pw2')?.value;
  const pin   = document.getElementById('um_pin')?.value;
  const pin2  = document.getElementById('um_pin2')?.value;

  if(!name){ toast('Display name required','error'); return; }
  if(isNew && !uname){ toast('Username required','error'); return; }
  if(pw && pw !== pw2){ toast('Passwords do not match','error'); return; }
  if(pw && pw.length < 8){ toast('Password must be at least 8 characters','error'); return; }
  if(pin && pin !== pin2){ toast('PINs do not match','error'); return; }
  if(pin && (!/^\d{4,6}$/.test(pin))){ toast('PIN must be 4–6 digits','error'); return; }
  if(isNew && !pw && !pin){ toast('Set at least a password or PIN','error'); return; }
  if(role === 'operator' && !wid){ toast('Operators must be linked to a worker','error'); return; }

  const data = {
    display_name: name,
    role, is_active: active,
    worker_id: wid ? parseInt(wid) : null,
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
