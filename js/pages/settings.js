/**
 * Dolphin ERP — Settings
 */

// ── SETTINGS PAGE ──
async function renderSettings(){
  document.getElementById('topbarActions').innerHTML=
    `<button class="btn btn-primary" onclick="saveShiftSettings()">💾 Save Working Hours</button>`;
  const p=getPrefs();
  const opt=(v,l,cur)=>`<button type="button" class="pref-opt ${cur===v?'active':''}" data-value="${v}">${l}</button>`;

  let shifts={};
  try{ shifts=await api('GET','/api/shift-settings'); }catch(e){}

  const DAYS=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const DAY_LABELS={monday:'Monday',tuesday:'Tuesday',wednesday:'Wednesday',
    thursday:'Thursday',friday:'Friday',saturday:'Saturday',sunday:'Sunday'};
  const DAY_SHORT={monday:'MON',tuesday:'TUE',wednesday:'WED',
    thursday:'THU',friday:'FRI',saturday:'SAT',sunday:'SUN'};

  function calcEff(s){
    if(!s.working) return 0;
    const [sh,sm]=(s.start||'08:00').split(':').map(Number);
    const [eh,em]=(s.end||'20:00').split(':').map(Number);
    let total=(eh*60+em)-(sh*60+sm);
    if(s.lunch_start&&s.lunch_end){
      const [lsh,lsm]=s.lunch_start.split(':').map(Number);
      const [leh,lem]=s.lunch_end.split(':').map(Number);
      total-=Math.max(0,(leh*60+lem)-(lsh*60+lsm));
    }
    return Math.max(0,total/60);
  }

  function dayCard(day){
    const s=shifts[day]||{working:day!=='saturday'&&day!=='sunday',
      start:'08:00',end:day==='wednesday'?'14:00':'20:00',
      lunch_start:'12:00',lunch_end:'14:00',effective_hours:0};
    const eff=calcEff(s);
    const dis=s.working?'':'disabled';
    const isWeekend=day==='saturday'||day==='sunday';
    const cardBg=!s.working?'var(--surface)':'var(--card)';
    const borderCol=!s.working?'var(--border)':day==='wednesday'?'var(--amber)':'var(--accent)';
    return `
    <div id="daycard_${day}" style="background:${cardBg};border:2px solid ${borderCol};border-radius:12px;overflow:hidden;transition:all .2s">
      <!-- Day header -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:${s.working?'var(--surface)':'var(--card)'}">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:42px;height:42px;border-radius:8px;background:${s.working?borderCol:'var(--border)'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <span style="font-size:11px;font-weight:800;color:${s.working?'#fff':'var(--muted)'};letter-spacing:.05em">${DAY_SHORT[day]}</span>
          </div>
          <div>
            <div style="font-weight:600;font-size:15px">${DAY_LABELS[day]}</div>
            <div id="daycard_eff_${day}" style="font-size:12px;color:${s.working?'var(--accent)':'var(--muted)'};margin-top:1px">
              ${s.working?`${eff.toFixed(1)}h net working`:'Not working'}
            </div>
          </div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none">
          <span style="font-size:12px;color:var(--muted)">${s.working?'Working':'Off'}</span>
          <div class="toggle-wrap" onclick="toggleDay('${day}')" style="position:relative;width:44px;height:24px;background:${s.working?'var(--accent)':'var(--border2)'};border-radius:12px;cursor:pointer;transition:background .2s;flex-shrink:0">
            <div id="toggle_knob_${day}" style="position:absolute;top:3px;left:${s.working?'23px':'3px'};width:18px;height:18px;background:#fff;border-radius:50%;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>
          </div>
        </label>
      </div>
      <!-- Shift times grid -->
      <div id="daycard_body_${day}" style="padding:14px 16px;display:grid;grid-template-columns:1fr 1fr;gap:14px;${!s.working?'opacity:.4;pointer-events:none':''}">
        <div>
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:6px">Shift Start</div>
          <input type="time" id="shift_start_${day}" value="${s.start||'08:00'}"
            onchange="onShiftChange('${day}')" ${dis}
            style="width:100%;font-size:16px;font-family:var(--mono);padding:8px 10px;border:1.5px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text)">
        </div>
        <div>
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:6px">Shift End</div>
          <input type="time" id="shift_end_${day}" value="${s.end||'20:00'}"
            onchange="onShiftChange('${day}')" ${dis}
            style="width:100%;font-size:16px;font-family:var(--mono);padding:8px 10px;border:1.5px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text)">
        </div>
        <div>
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:6px">🍽 Lunch / Break Start</div>
          <input type="time" id="shift_ls_${day}" value="${s.lunch_start||''}"
            onchange="onShiftChange('${day}')" ${dis} placeholder="No break"
            style="width:100%;font-size:16px;font-family:var(--mono);padding:8px 10px;border:1.5px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text)">
        </div>
        <div>
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:6px">🍽 Lunch / Break End</div>
          <input type="time" id="shift_le_${day}" value="${s.lunch_end||''}"
            onchange="onShiftChange('${day}')" ${dis} placeholder="No break"
            style="width:100%;font-size:16px;font-family:var(--mono);padding:8px 10px;border:1.5px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text)">
        </div>
      </div>
    </div>`;
  }

  // Compute weekly totals
  const weeklyEff = DAYS.reduce((sum,d)=>sum+calcEff(shifts[d]||{working:false}),0);

  document.getElementById('content').innerHTML=`
    <div style="max-width:900px;display:flex;flex-direction:column;gap:20px">

      <!-- Working Hours header card -->
      <div class="card">
        <div class="card-hdr" style="justify-content:space-between;align-items:center">
          <div>
            <div class="card-title">Working Hours</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">Configure shift times for each day. The scheduler uses these for all job planning, estimates and Gantt chart.</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:11px;color:var(--muted)">Weekly capacity</div>
            <div id="weeklyTotal" style="font-size:22px;font-weight:700;color:var(--accent);font-family:var(--mono)">${weeklyEff.toFixed(1)}h</div>
          </div>
        </div>
      </div>

      <!-- Day cards grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">
        ${DAYS.map(dayCard).join('')}
      </div>

      <!-- Note -->
      <div style="background:var(--amber-soft);border:1px solid var(--amber);border-radius:8px;padding:12px 16px;font-size:12px;color:var(--text)">
        💡 <strong>After saving:</strong> Run <strong>Schedule All</strong> from the Jobs page or Dashboard for new hours to take effect on existing jobs. Night shift support coming soon.
      </div>

      <!-- Display preferences -->
      <div class="card">
        <div class="card-hdr"><div class="card-title">Display Preferences</div></div>
        <div class="card-body">
          <div class="pref-row">
            <div class="pref-info"><div class="pref-label">Work time unit</div><div class="pref-help">How to display durations. Both use minutes as the base in the database.</div></div>
            <div class="pref-opts" data-pref="timeUnit">${opt('minutes','Minutes',p.timeUnit||'minutes')}${opt('hours','Hours',p.timeUnit||'minutes')}</div>
          </div>
          <div class="pref-row">
            <div class="pref-info"><div class="pref-label">Theme</div><div class="pref-help">Light for bright shop floors. Dark for night or office use.</div></div>
            <div class="pref-opts" data-pref="theme">${opt('light','Light',p.theme)}${opt('dark','Dark',p.theme)}</div>
          </div>
          <div class="pref-row">
            <div class="pref-info"><div class="pref-label">Font size</div><div class="pref-help">Larger text for monitors viewed from a distance.</div></div>
            <div class="pref-opts" data-pref="fontScale">${opt('small','Small',p.fontScale)}${opt('default','Default',p.fontScale)}${opt('large','Large',p.fontScale)}${opt('xlarge','Extra large',p.fontScale)}</div>
          </div>
          <div class="pref-row">
            <div class="pref-info"><div class="pref-label">Density</div><div class="pref-help">Compact shows more rows. Spacious is easier to tap on touch screens.</div></div>
            <div class="pref-opts" data-pref="density">${opt('compact','Compact',p.density)}${opt('comfortable','Comfortable',p.density)}${opt('spacious','Spacious',p.density)}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-hdr"><div class="card-title">About</div></div>
        <div class="card-body" style="color:var(--text-soft);line-height:1.6">
          <div><strong>Dolphin ERP</strong> — Mould &amp; Die scheduling system.</div>
          <div style="margin-top:4px;font-size:12px;color:var(--muted)">Display preferences saved to this browser only. Working hours saved to server (shift_settings.json).</div>
          <div style="margin-top:12px"><button class="btn btn-ghost" onclick="resetPrefs()">Reset display preferences</button></div>
        </div>
      </div>

      <!-- Change password — admin and manager -->
      ${(authGetUser()?.role === 'admin' || authGetUser()?.role === 'manager') ? `
      <div class="card">
        <div class="card-hdr"><div class="card-title">🔑 Change Password</div></div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;align-items:end">
            <div class="form-group" style="margin:0">
              <div class="fld-label">Current Password</div>
              <input type="password" id="cp_cur" placeholder="Current password" autocomplete="current-password">
            </div>
            <div class="form-group" style="margin:0">
              <div class="fld-label">New Password</div>
              <input type="password" id="cp_new" placeholder="Min 8 characters" autocomplete="new-password">
            </div>
            <div class="form-group" style="margin:0">
              <div class="fld-label">Confirm New</div>
              <input type="password" id="cp_cfm" placeholder="Repeat new password" autocomplete="new-password">
            </div>
          </div>
          <div style="margin-top:12px;display:flex;align-items:center;gap:10px">
            <button class="btn btn-primary" id="cpBtn" onclick="changeMyPassword()">Update Password</button>
            <span id="cpMsg" style="font-size:12px;display:none"></span>
          </div>
        </div>
      </div>` : ''}

    </div>`;

  // Wire pref buttons
  document.querySelectorAll('.pref-opts').forEach(group=>{
    const key=group.getAttribute('data-pref');
    group.querySelectorAll('.pref-opt').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const val=btn.getAttribute('data-value');
        updatePref(key,val);
        group.querySelectorAll('.pref-opt').forEach(b=>b.classList.toggle('active',b===btn));
      });
    });
  });
}

function toggleDay(day){
  const card   = document.getElementById(`daycard_${day}`);
  const body   = document.getElementById(`daycard_body_${day}`);
  const effEl  = document.getElementById(`daycard_eff_${day}`);
  const knob   = document.getElementById(`toggle_knob_${day}`);
  // infer current state from knob position
  const isOn   = knob.style.left==='23px';
  const nowOn  = !isOn;
  knob.style.left       = nowOn?'23px':'3px';
  knob.parentElement.style.background = nowOn?'var(--accent)':'var(--border2)';
  body.style.opacity         = nowOn?'1':'0.4';
  body.style.pointerEvents   = nowOn?'':'none';
  // update label
  const label = knob.parentElement.previousElementSibling;
  if(label) label.textContent = nowOn?'Working':'Off';
  // enable/disable inputs
  ['start','end','ls','le'].forEach(f=>{
    const el=document.getElementById(`shift_${f}_${day}`)||document.getElementById(`shift_start_${day}`);
    // find by id pattern
  });
  ['shift_start','shift_end','shift_ls','shift_le'].forEach(pre=>{
    const el=document.getElementById(`${pre}_${day}`);
    if(el) el.disabled=!nowOn;
  });
  onShiftChange(day);
}

function onShiftChange(day){
  const DAYS=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const knob=document.getElementById(`toggle_knob_${day}`);
  const working=knob?knob.style.left==='23px':true;

  const start=document.getElementById(`shift_start_${day}`)?.value||'08:00';
  const end  =document.getElementById(`shift_end_${day}`)?.value||'20:00';
  const ls   =document.getElementById(`shift_ls_${day}`)?.value||'';
  const le   =document.getElementById(`shift_le_${day}`)?.value||'';
  const [sh,sm]=start.split(':').map(Number);
  const [eh,em]=end.split(':').map(Number);
  let total=(eh*60+em)-(sh*60+sm);
  if(ls&&le){const[lsh,lsm]=ls.split(':').map(Number);const[leh,lem]=le.split(':').map(Number);total-=Math.max(0,(leh*60+lem)-(lsh*60+lsm));}
  const eff=working?Math.max(0,total/60):0;

  const effEl=document.getElementById(`daycard_eff_${day}`);
  if(effEl){
    effEl.style.color=eff>0?'var(--accent)':'var(--muted)';
    effEl.textContent=working?`${eff.toFixed(1)}h net working`:'Not working';
  }

  // Update weekly total
  let weeklyTotal=0;
  DAYS.forEach(d=>{
    const k=document.getElementById(`toggle_knob_${d}`);
    const on=k?k.style.left==='23px':false;
    if(!on) return;
    const s=document.getElementById(`shift_start_${d}`)?.value||'08:00';
    const e=document.getElementById(`shift_end_${d}`)?.value||'20:00';
    const l1=document.getElementById(`shift_ls_${d}`)?.value||'';
    const l2=document.getElementById(`shift_le_${d}`)?.value||'';
    const [sh2,sm2]=s.split(':').map(Number);const[eh2,em2]=e.split(':').map(Number);
    let tot=(eh2*60+em2)-(sh2*60+sm2);
    if(l1&&l2){const[a,b]=l1.split(':').map(Number);const[c,dd]=l2.split(':').map(Number);tot-=Math.max(0,(c*60+dd)-(a*60+b));}
    weeklyTotal+=Math.max(0,tot/60);
  });
  const wtEl=document.getElementById('weeklyTotal');
  if(wtEl) wtEl.textContent=weeklyTotal.toFixed(1)+'h';
}

async function saveShiftSettings(){
  const DAYS=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const data={};
  DAYS.forEach(day=>{
    const knob=document.getElementById(`toggle_knob_${day}`);
    const working=knob?knob.style.left==='23px':false;
    const ls=document.getElementById(`shift_ls_${day}`)?.value||'';
    const le=document.getElementById(`shift_le_${day}`)?.value||'';
    data[day]={
      working,
      start:      document.getElementById(`shift_start_${day}`)?.value||'08:00',
      end:        document.getElementById(`shift_end_${day}`)?.value||'20:00',
      lunch_start:ls||null,
      lunch_end:  le||null,
    };
  });
  try{
    await api('PUT','/api/shift-settings',data);
    toast('Working hours saved ✓ — run Schedule All to apply');
  }catch(e){ toast(e.message,'error'); }
}


function resetPrefs(){
  applyPrefs(Object.assign({},DEFAULT_PREFS));
  if(window.location.pathname.includes('settings')) renderSettings();
  toast('Preferences reset');
}

async function changeMyPassword(){
  const cur = document.getElementById('cp_cur')?.value;
  const nw  = document.getElementById('cp_new')?.value;
  const cfm = document.getElementById('cp_cfm')?.value;
  const msg = document.getElementById('cpMsg');
  const btn = document.getElementById('cpBtn');

  const showMsg = (text, ok) => {
    msg.textContent = text;
    msg.style.display = '';
    msg.style.color = ok ? 'var(--green)' : 'var(--red)';
  };

  if(!cur)           return showMsg('Enter your current password', false);
  if(!nw)            return showMsg('Enter a new password', false);
  if(nw.length < 8)  return showMsg('New password must be at least 8 characters', false);
  if(nw !== cfm)     return showMsg('Passwords do not match', false);

  btn.disabled = true; btn.textContent = 'Updating…';
  try {
    await api('POST', '/api/auth/change-password', {
      current_password: cur, new_password: nw
    });
    showMsg('✓ Password changed successfully', true);
    document.getElementById('cp_cur').value = '';
    document.getElementById('cp_new').value = '';
    document.getElementById('cp_cfm').value = '';
  } catch(e) {
    showMsg(e.message || 'Failed to change password', false);
  } finally {
    btn.disabled = false; btn.textContent = 'Update Password';
  }
}
// ── ROUTING STATS ──
