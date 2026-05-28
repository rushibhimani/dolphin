/**
 * Dolphin ERP — Schedule
 */

async function renderSchedule(){
  const alreadyMounted = !!document.getElementById('ganttWrap');

  // Only rebuild the shell (toolbar + containers) if we're navigating in fresh
  if(!alreadyMounted){
    buildGanttShell();
    // Show cached data immediately so there is zero blank time
    if(ganttData && ganttData.length){
      try{ renderGantt(ganttData,ganttView,ganttFilter); }catch(e){ console.error('Gantt render error:',e); }
    }
  } else {
    // Already on the page — just update the topbar button, leave the chart untouched
    document.getElementById('topbarActions').innerHTML=`<button class="btn btn-secondary" onclick="scheduleAll()">⚡ Reschedule All</button>`;
  }

  // Background refresh — never rebuilds shell, only updates chart if data changed
  try{
    const fresh = await api('GET','/api/gantt');
    const changed = JSON.stringify(fresh) !== JSON.stringify(ganttData);
    ganttData = fresh;
    if(changed || !alreadyMounted){
      try{ renderGantt(ganttData,ganttView,ganttFilter); }catch(e){ console.error('Gantt render error:',e); }
    }
  }catch(e){
    if(!ganttData || !ganttData.length){
      const w=document.getElementById('ganttWrap');
      if(w) w.innerHTML='<div style="padding:40px;text-align:center;color:var(--muted)">Could not load schedule data.</div>';
    }
  }
}

function setGanttView(v){
  ganttView=v;
  document.querySelectorAll('.gantt-view-btn').forEach(b=>b.classList.remove('active'));
  const btn=document.getElementById('gv_'+v);
  if(btn) btn.classList.add('active');
  renderGantt(ganttData,ganttView,ganttFilter);
}
function applyGanttFilter(val){ganttFilter=val.toLowerCase();renderGantt(ganttData,ganttView,ganttFilter);}

function renderGantt(data,view,filter){
  const labelsEl = document.getElementById('ganttLabels');
  const timeEl   = document.getElementById('ganttWrap');
  if(!timeEl) return;

  // Theme color constants — read all CSS vars once, works for both light & dark
  const _cs2    = getComputedStyle(document.documentElement);
  const isDark  = document.documentElement.getAttribute('data-theme') !== 'light';
  const ganttBg     = (_cs2.getPropertyValue('--bg').trim())      || (isDark ? '#0f1115' : '#f6f7f9');
  const ganttSurf   = (_cs2.getPropertyValue('--surface').trim()) || (isDark ? '#171a21' : '#ffffff');
  const ganttBorder = (_cs2.getPropertyValue('--border').trim())  || (isDark ? '#262b36' : '#e5e7eb');
  const ganttText   = (_cs2.getPropertyValue('--muted').trim())   || '#7a8295';
  const ganttLabel  = (_cs2.getPropertyValue('--text').trim())    || (isDark ? '#e9ecf3' : '#1d2128');
  const ganttSub    = (_cs2.getPropertyValue('--text-soft').trim())|| (isDark ? '#b9bfcd' : '#3f4654');
  // Row alternating bg: subtle tint that works on both themes
  const ganttRowEven = isDark ? 'rgba(255,255,255,.018)' : 'rgba(0,0,0,.025)';
  const ganttRowBdr  = isDark ? '#1a1f2e' : '#e5e7eb';
  const ganttHdrBdr  = isDark ? '#2a2f3d' : '#d1d5db';
  const ganttDayLbl  = isDark ? '#4a5568' : '#9ca3af';
  const ganttWkend   = isDark ? 'rgba(255,255,255,.006)' : 'rgba(0,0,0,.03)';
  const ganttOffHr   = isDark ? 'rgba(0,0,0,.08)'        : 'rgba(0,0,0,.04)';
  const ganttGloss   = isDark ? 'rgba(255,255,255,.07)'   : 'rgba(255,255,255,.5)';
  const ganttProg    = isDark ? 'rgba(255,255,255,.6)'    : 'rgba(255,255,255,.9)';
  const ganttBarTxt2 = isDark ? 'rgba(255,255,255,.75)'   : 'rgba(255,255,255,.9)';

  if(!data||!data.length){
    if(labelsEl) labelsEl.innerHTML='';
    timeEl.innerHTML='<div style="padding:48px;text-align:center;color:var(--muted)">No scheduled operations. Run Schedule All first.</div>';
    return;
  }

  // Apply filters
  const todayOnly = document.getElementById('ganttTodayOnly')?.checked;
  const todayStr  = new Date().toISOString().slice(0,10);
  let fd = todayOnly ? data.filter(op=>op.start&&op.start.slice(0,10)===todayStr) : data;
  if(filter) fd = fd.filter(op=>
    (op.job_number||'').toLowerCase().includes(filter)||
    (op.customer||'').toLowerCase().includes(filter)||
    (op.op_name||'').toLowerCase().includes(filter)||
    (op.wc_name||'').toLowerCase().includes(filter)||
    (op.worker_name||'').toLowerCase().includes(filter));
  if(!fd.length){
    if(labelsEl) labelsEl.innerHTML='';
    timeEl.innerHTML=`<div style="padding:48px;text-align:center;color:var(--muted)">No results for "${filter||'today'}"</div>`;
    return;
  }

  // Row grouping
  const rowKeyFn = view==='worker' ? op=>(op.worker_name||'⚠ Unassigned') :
                   view==='job'    ? op=>op.job_number : op=>op.wc_name;
  const rowKeys  = [...new Set(fd.map(rowKeyFn))].sort();

  // Time range
  const minD = new Date(Math.min(...fd.map(op=>new Date(op.start))));
  const maxD = new Date(Math.max(...fd.map(op=>new Date(op.end))));
  minD.setHours(0,0,0,0);
  const days=[]; {let c=new Date(minD);while(c<=maxD){days.push(new Date(c));c=new Date(c.getTime()+86400000);}}

  // Layout constants
  const ROW_H  = 52;   // px per row — taller for readability
  const HH     = 64;   // header height
  const PPH    = 60;   // px per hour — wider for readability
  const W      = Math.max(800, (maxD-minD)/3600000*PPH);
  const H      = HH + rowKeys.length*ROW_H + 4;

  // ── STICKY LEFT LABELS (HTML, not SVG) ──
  if(labelsEl){
    const totalH = HH + rowKeys.length*ROW_H;
    let labHtml = `<div style="height:${HH}px;border-bottom:1px solid ${ganttHdrBdr};display:flex;align-items:flex-end;padding:0 10px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:${ganttText}">
      ${view==='machine'?'Machine':view==='worker'?'Worker':'Job'}
    </div>`;
    rowKeys.forEach((key,i)=>{
      const isEven = i%2===0;
      const isUnassigned = key==='⚠ Unassigned';
      const opCount = fd.filter(op=>rowKeyFn(op)===key).length;
      const subLabel = view==='job' ? (allJobs.find(j=>j.job_number===key)?.customer_name||'') :
                       view==='machine' ? (allMachines.find(m=>m.name===key)?.machine_type||'') : '';
      labHtml += `<div style="height:${ROW_H}px;background:${isEven?ganttRowEven:'transparent'};border-bottom:1px solid ${ganttRowBdr};display:flex;flex-direction:column;justify-content:center;padding:0 10px;box-sizing:border-box">
        <div style="font-size:12px;font-weight:500;color:${isUnassigned?'#f97316':ganttLabel};white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${key}">${key}</div>
        ${subLabel?`<div style="font-size:10px;color:${ganttText};margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${subLabel}</div>`:''}
        <div style="font-size:10px;color:var(--accent);margin-top:1px">${opCount} op${opCount!==1?'s':''}</div>
      </div>`;
    });
    labelsEl.innerHTML = labHtml;
    labelsEl.style.height = totalH + 'px';
    labelsEl.style.overflowY = 'hidden';
  }

  // Sync scroll between labels and timeline
  timeEl.onscroll = ()=>{ if(labelsEl) labelsEl.style.marginTop = -timeEl.scrollTop + 'px'; };

  // ── TIMELINE SVG ──
    // Read theme colors once before building SVG
  const _cs = getComputedStyle(document.documentElement);
  // Re-use the ganttBg/ganttBorder/ganttText vars already defined above
  let s = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;min-width:${W}px">
  <rect width="${W}" height="${H}" fill="${ganttBg}"/>`;

  // Day columns
  days.forEach(d=>{
    const x   = (d-minD)/3600000*PPH;
    const dow = d.getDay();
    const isToday = d.toDateString()===new Date().toDateString();

    if(dow===0||dow===6) s+=`<rect x="${x}" y="${HH}" width="${24*PPH}" height="${H-HH}" fill="${ganttWkend}"/>`;
    if(isToday)          s+=`<rect x="${x}" y="0" width="${24*PPH}" height="${HH}" fill="rgba(245,158,11,.06)"/>`;
    s+=`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${ganttBorder}" stroke-width="1"/>`;

    // Day header
    const dl = d.toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short'});
    s+=`<text x="${x+6}" y="20" font-family="IBM Plex Mono,monospace" font-size="11" fill="${isToday?'#f59e0b':ganttDayLbl}" font-weight="${isToday?'bold':'normal'}">${dl}</text>`;

    // Hour marks every 2 hours (8,10,12,14,16,18,20)
    for(let h=8;h<=20;h+=2){
      const xh = (new Date(d.getFullYear(),d.getMonth(),d.getDate(),h)-minD)/3600000*PPH;
      s+=`<line x1="${xh}" y1="${HH-10}" x2="${xh}" y2="${H}" stroke="${ganttBorder}" stroke-width="0.5" stroke-dasharray="1,5"/>`;
      if(h>8&&h<20) s+=`<text x="${xh+2}" y="${HH-2}" font-family="IBM Plex Mono,monospace" font-size="9" fill="${ganttText}">${h}h</text>`;
    }

    // Shift boundary lines
    const mkLine=(hr,col,dash)=>{
      const xm=(new Date(d.getFullYear(),d.getMonth(),d.getDate(),hr)-minD)/3600000*PPH;
      s+=`<line x1="${xm}" y1="${HH}" x2="${xm}" y2="${H}" stroke="${col}" stroke-width="1" stroke-dasharray="${dash}" opacity="0.5"/>`;
    };
    mkLine(8, '#10b981','4,4');
    mkLine(12,'#374151','2,6');
    mkLine(14,'#374151','2,6');
    mkLine(dow===3?14:20,'#6366f1','4,4');

    // Off-hours shading
    const shade=(h1,h2)=>{
      const x1=(new Date(d.getFullYear(),d.getMonth(),d.getDate(),h1)-minD)/3600000*PPH;
      const x2=(new Date(d.getFullYear(),d.getMonth(),d.getDate(),h2)-minD)/3600000*PPH;
      if(x2>x1) s+=`<rect x="${x1}" y="${HH}" width="${x2-x1}" height="${H-HH}" fill="${ganttOffHr}"/>`;
    };
    shade(0,8); shade(12,14); shade(dow===3?14:20,24);
  });

  // Row backgrounds
  rowKeys.forEach((key,i)=>{
    const y = HH+i*ROW_H;
    s+=`<rect x="0" y="${y}" width="${W}" height="${ROW_H}" fill="${i%2===0?ganttRowEven:'transparent'}"/>`;
    s+=`<line x1="0" y1="${y+ROW_H}" x2="${W}" y2="${y+ROW_H}" stroke="${ganttBorder}" stroke-width="1"/>`;
  });

  // Due date lines
  [...new Set(fd.map(op=>op.due_date).filter(Boolean))].forEach(dd=>{
    const dx=(new Date(dd)-minD)/3600000*PPH;
    if(dx>0&&dx<W){
      s+=`<line x1="${dx}" y1="${HH}" x2="${dx}" y2="${H}" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="6,3" opacity="0.5"/>`;
      s+=`<text x="${dx+3}" y="${HH+16}" font-family="IBM Plex Mono,monospace" font-size="9" fill="#ef4444" opacity="0.7">DUE</text>`;
    }
  });

  // NOW line
  const nowX=(new Date()-minD)/3600000*PPH;
  if(nowX>0&&nowX<W){
    s+=`<line x1="${nowX}" y1="0" x2="${nowX}" y2="${H}" stroke="#f59e0b" stroke-width="2" opacity="0.95"/>`;
    s+=`<rect x="${nowX}" y="1" width="32" height="20" rx="4" fill="#f59e0b"/>`;
    s+=`<text x="${nowX+4}" y="15" font-family="IBM Plex Sans,sans-serif" font-size="10" fill="#000" font-weight="bold">NOW</text>`;
  }

  // ── OPERATION BARS ──
  fd.forEach(op=>{
    const ri = rowKeys.indexOf(rowKeyFn(op));
    if(ri<0) return;

    const xStart = (new Date(op.start)-minD)/3600000*PPH;
    const xEnd   = (new Date(op.end)-minD)/3600000*PPH;
    const bw     = Math.max(8, xEnd-xStart-2);
    const y      = HH + ri*ROW_H;
    const barY   = y + 6;
    const barH   = ROW_H - 12;

    // Color logic
    const col = op.is_late||op.priority ? '#ef4444' :
                op.status==='completed'  ? '#10b981' :
                op.status==='in_progress'? '#f59e0b' :
                view==='worker'          ? '#8b5cf6' : '#3b82f6';

    // Shadow
    s+=`<rect x="${xStart+2}" y="${barY+3}" width="${bw}" height="${barH}" rx="5" fill="rgba(0,0,0,.15)"/>`;
    // Bar
    s+=`<rect x="${xStart}" y="${barY}" width="${bw}" height="${barH}" rx="5" fill="${col}" opacity="0.9"><title>${
      view==='machine'?`${op.job_number} — ${op.op_name}\n${op.customer||''}\n${fmtDT(op.start)} → ${fmtDT(op.end)}${op.worker_name?' | 👷 '+op.worker_name:''}${op.is_late?' | ⚠ LATE':''}`:
      view==='worker' ?`${op.job_number} — ${op.op_name}\nMachine: ${op.wc_name}\n${fmtDT(op.start)} → ${fmtDT(op.end)}${op.is_late?' | ⚠ LATE':''}`:
                       `${op.op_name} | ${op.wc_name}\n${op.worker_name?'👷 '+op.worker_name+'\n':''}${fmtDT(op.start)} → ${fmtDT(op.end)}${op.is_late?' | ⚠ LATE':''}`
    }</title></rect>`;
    // Top gloss
    s+=`<rect x="${xStart}" y="${barY}" width="${bw}" height="${Math.floor(barH/2)}" rx="5" fill="${ganttGloss}"/>`;

    // Progress bar (in_progress)
    if(op.status==='in_progress'&&op.actual_start){
      const elapsed=(new Date()-new Date(op.actual_start))/3600000*PPH;
      const pw=Math.min(bw,Math.max(0,elapsed));
      s+=`<rect x="${xStart}" y="${barY+barH-4}" width="${pw}" height="4" rx="2" fill="${ganttProg}"/>`;
    }

    // ── TEXT — only if bar is wide enough ──
    const textX = xStart + 8;
    if(bw >= 120){
      // Two lines of text
      const line1 = view==='job' ? op.op_name : `${op.job_number}: ${op.op_name}`;
      const line2 = view==='machine' ? (op.worker_name?`👷 ${op.worker_name}`:'') :
                    view==='worker'  ? op.wc_name : op.customer||'';
      const maxChars = Math.floor((bw-16)/7);
      const l1 = line1.length>maxChars ? line1.slice(0,maxChars-1)+'…' : line1;
      const l2 = (line2||'').length>maxChars ? (line2||'').slice(0,maxChars-1)+'…' : (line2||'');
      s+=`<text x="${textX}" y="${barY+barH/2-(l2?5:0)}" font-family="IBM Plex Sans,sans-serif" font-size="12" fill="#fff" font-weight="500" paint-order="stroke" stroke="#000" stroke-width="3" stroke-linejoin="round">${l1}</text>`;
      if(l2) s+=`<text x="${textX}" y="${barY+barH/2+10}" font-family="IBM Plex Mono,monospace" font-size="10" fill="${ganttBarTxt2}">${l2}</text>`;
    } else if(bw >= 50){
      // Short label only
      const short = (view==='job'?op.op_name:op.job_number).slice(0,6);
      s+=`<text x="${textX}" y="${barY+barH/2+4}" font-family="IBM Plex Sans,sans-serif" font-size="11" fill="#fff" font-weight="500">${short}</text>`;
    }

    // Late badge
    if(op.is_late){
      s+=`<rect x="${xStart+bw-20}" y="${barY+4}" width="18" height="14" rx="3" fill="rgba(239,68,68,.95)"/>`;
      s+=`<text x="${xStart+bw-11}" y="${barY+14}" font-family="IBM Plex Sans,sans-serif" font-size="9" fill="#fff" text-anchor="middle" font-weight="bold">!</text>`;
    }
  });

  s+=`</svg>`;
  timeEl.innerHTML = s;

  // Auto-scroll to NOW
  if(nowX>200) setTimeout(()=>{ timeEl.scrollLeft = nowX-200; }, 60);
}


// ── CAPACITY ──
