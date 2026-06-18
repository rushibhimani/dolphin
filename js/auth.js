/**
 * Dolphin ERP — Auth Client
 * Manages JWT token, session state, login/logout.
 * Must be loaded before api.js and app.js.
 */

// ── Session storage keys ───────────────────────────────────────────────────────
const AUTH_TOKEN_KEY  = 'dolphin_token';
const AUTH_USER_KEY   = 'dolphin_user';

// ── Current session ────────────────────────────────────────────────────────────
let _authToken = null;
let _authUser  = null;   // { role, username, display_name, worker_id, permissions }

// ── Token management ───────────────────────────────────────────────────────────
function authGetToken()  { return _authToken; }
function authGetUser()   { return _authUser;  }
function authIsLoggedIn(){ return !!_authToken; }

function authHasPerm(perm){
  return !!(_authUser?.permissions?.[perm]);
}
function authCanAccess(page){
  return !!(_authUser?.permissions?.pages?.includes(page));
}

/**
 * Get numeric access level for a page:
 *   0 = no access
 *   1 = view only  (can see page, cannot add/edit/delete)
 *   2 = modify     (can add & edit, cannot delete)
 *   3 = full       (can add, edit, delete)
 *
 * page_levels is an object like { routings: 2, machines: 1 }
 * If not set, falls back to: pages array membership = level 3 (legacy behaviour)
 */
function authPageLevel(page){
  const perms = _authUser?.permissions || {};
  // Page aliases: dispatch inherits today's permission (it's a view onto today's work)
  const PAGE_ALIASES = { dispatch: 'today', 'product-schema': 'routings' };
  // New granular system
  if(perms.page_levels && typeof perms.page_levels[page] === 'number'){
    return perms.page_levels[page];
  }
  // Legacy fallback: if page is in the allowed pages list, treat as full control
  if(perms.pages?.includes(page)) return 3;
  // Try alias
  const alias = PAGE_ALIASES[page];
  if(alias){
    if(perms.page_levels && typeof perms.page_levels[alias] === 'number') return perms.page_levels[alias];
    if(perms.pages?.includes(alias)) return 3;
  }
  return 0;
}

// Convenience helpers — use these in page renderers
function authCanView(page)   { return authPageLevel(page) >= 1; }
function authCanModify(page) { return authPageLevel(page) >= 2; }
function authCanDelete(page) { return authPageLevel(page) >= 3; }

function authSaveSession(token, user){
  _authToken = token;
  _authUser  = user;
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  } catch(e) {}
}

function authClearSession(){
  _authToken = null;
  _authUser  = null;
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
  } catch(e) {}
}

function authLoadFromStorage(){
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const user  = localStorage.getItem(AUTH_USER_KEY);
    if(token && user){
      try {
        const parts = token.split('.');
        if(parts.length === 3){
          const claims = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
          if(claims.exp && claims.exp < Math.floor(Date.now()/1000)){
            authClearSession(); return false;
          }
        }
      } catch(e){}
      _authToken = token;
      _authUser  = JSON.parse(user);
      return true;
    }
  } catch(e) {}
  return false;
}

// ── Login / Logout ─────────────────────────────────────────────────────────────
async function authLogin(username, password){
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.trim().toLowerCase(), password })
  });
  if(!res.ok){
    const j = await res.json().catch(() => ({}));
    throw new Error(j.detail || 'Login failed');
  }
  const data = await res.json();
  authSaveSession(data.token, {
    role:         data.role,
    username:     data.username,
    display_name: data.display_name,
    worker_id:    data.worker_id,
    permissions:  data.permissions,
  });
  return data;
}

async function authPinLogin(pin){
  const res = await fetch('/api/auth/pin-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: String(pin).trim() })
  });
  if(!res.ok){
    const j = await res.json().catch(() => ({}));
    throw new Error(j.detail || 'Invalid PIN');
  }
  const data = await res.json();
  authSaveSession(data.token, {
    role:         data.role,
    username:     data.username,
    display_name: data.display_name,
    worker_id:    data.worker_id,
    permissions:  data.permissions,
  });
  return data;
}

function authLogout(){
  authClearSession();
  window.location.href = '/login';
}

// ── Called by api.js on 401 response ──────────────────────────────────────────
function authHandle401(){
  authClearSession();
  if(!window.location.pathname.includes('login')){
    window.location.href = '/login';
  }
}
