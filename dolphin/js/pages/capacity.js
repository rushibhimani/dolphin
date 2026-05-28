/**
 * Dolphin ERP — Capacity Heatmap
 * Mobile-first: accordion per machine on small screens, heatmap table on desktop.
 * iPhone 12 mini (375px) — zero horizontal scrolling.
 */

async function renderCapacity(){
  document.getElementById('topbarActions').innerHTML='';
  document.getElementById('content').innerHTML=`
    <div class="card">
      <div class="card-hdr"><div class="card-title">Machine Capacity Heatmap</div></div>
      <div class="card-body" id="hmBody">Loading...</div>
    </div>`;
  try{
    const hm = await api('GET','/api/heatmap');
    const machines = Object.keys(hm);
    if(!machines.length){
      document.getElementById('hmBody').innerHTML='<div class="empty">No data — schedule jobs first</div>';
      return;
    }
    const allDates = [...new Set(machines.flatMap(m=>Object.keys(hm[m])))].sort();

    /* ── MOBILE view: accordion per machine ─────────────────────────────── */
    let mobileHtml = `<div class="capacity-mobile">`;
    machines.forEach(m=>{
      const dayData = allDates.map(d=>({ date:d, hrs: hm[m][d]||0 }));
      const totalHrs  = dayData.reduce((s,d)=>s+d.hrs,0);
      const maxPossible = allDates.length * 10; // 10h per day
      const avgPct = maxPossible > 0 ? Math.round(totalHrs / maxPossible * 100) : 0;
      const summaryColor = avgPct >= 80 ? 'var(--red)' : avgPct >= 50 ? 'var(--amber)' : 'var(--green)';

      mobileHtml += `
        <div style="margin-bottom:8px">
          <button class="acc-header" onclick="toggleCapAcc(this)"
            style="width:100%;padding:12px 14px;background:var(--card);border:1px solid var(--border);
                   border-radius:10px;text-align:left;cursor:pointer;display:flex;justify-content:space-between;
                   align-items:center;font-size:13px;font-weight:600;color:var(--text)">
            <span>${m}</span>
            <span style="font-size:12px;color:${summaryColor};font-weight:700">${avgPct}% avg</span>
          </button>
          <div class="acc-body" style="display:none;background:var(--card);border:1px solid var(--border);
               border-top:none;border-radius:0 0 10px 10px;padding:0 14px 12px">
            ${dayData.filter(d=>d.hrs>0).map(d=>{
              const pct = Math.min(d.hrs/10,1);
              const barColor = pct>=0.8 ? 'var(--red)' : pct>=0.5 ? 'var(--amber)' : 'var(--green)';
              const dt = new Date(d.date);
              const label = dt.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});
              return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
                <span style="font-size:12px;color:var(--text-soft);width:90px;flex-shrink:0">${label}</span>
                <div class="prog-bar" style="flex:1;height:8px">
                  <div class="prog-fill" style="width:${Math.round(pct*100)}%;background:${barColor};height:8px"></div>
                </div>
                <span style="font-size:12px;font-family:var(--mono);color:${barColor};width:36px;text-align:right;flex-shrink:0">${d.hrs}h</span>
              </div>`;
            }).join('')}
            ${dayData.every(d=>d.hrs===0) ? '<div style="font-size:12px;color:var(--muted);padding:12px 0">No operations scheduled</div>' : ''}
          </div>
        </div>`;
    });
    mobileHtml += `</div>`;

    /* ── DESKTOP view: full heatmap table ───────────────────────────────── */
    let desktopHtml = `<div class="capacity-desktop"><div style="overflow-x:auto"><table class="hm-table"><thead><tr>
      <th style="min-width:190px;text-align:left;padding-right:14px">Machine</th>`;
    allDates.forEach(d=>{
      const dt=new Date(d);
      desktopHtml+=`<th>${dt.toLocaleDateString('en-IN',{weekday:'short'})}<br>${dt.getDate()}</th>`;
    });
    desktopHtml+=`</tr></thead><tbody>`;
    machines.forEach(m=>{
      desktopHtml+=`<tr><td style="font-family:var(--mono);font-size:11px;color:var(--muted);padding:3px 14px 3px 0;white-space:nowrap">${m}</td>`;
      allDates.forEach(d=>{
        const hrs=hm[m][d]||0,pct=Math.min(hrs/10,1);
        let bg,tc;
        if(hrs===0){bg='var(--surface)';tc='transparent';}
        else if(pct<0.5){bg=`rgba(59,130,246,${.15+pct*.7})`;tc='#93c5fd';}
        else if(pct<0.8){bg=`rgba(245,158,11,${.25+pct*.6})`;tc='#fcd34d';}
        else{bg=`rgba(239,68,68,${.35+pct*.5})`;tc='#fca5a5';}
        desktopHtml+=`<td><div class="hm-cell" title="${m}: ${hrs}h" style="background:${bg};color:${tc}">${hrs>0?hrs:''}</div></td>`;
      });
      desktopHtml+=`</tr>`;
    });
    desktopHtml+=`</tbody></table></div></div>`;

    document.getElementById('hmBody').innerHTML = mobileHtml + desktopHtml;
  }catch(e){
    document.getElementById('hmBody').innerHTML=`<div class="empty">${e.message}</div>`;
  }
}

function toggleCapAcc(btn){
  const body = btn.nextElementSibling;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  btn.style.borderRadius = isOpen ? '10px' : '10px 10px 0 0';
}

// ── ROUTINGS ──
