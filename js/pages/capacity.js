/**
 * Dolphin ERP — Capacity
 */

async function renderCapacity(){
  document.getElementById('topbarActions').innerHTML='';
  document.getElementById('content').innerHTML=`<div class="card"><div class="card-hdr"><div class="card-title">Machine Capacity Heatmap</div></div><div class="card-body" id="hmBody">Loading...</div></div>`;
  try{
    const hm=await api('GET','/api/heatmap');
    const machines=Object.keys(hm);
    if(!machines.length){document.getElementById('hmBody').innerHTML='<div class="empty">No data — schedule jobs first</div>';return;}
    const allDates=[...new Set(machines.flatMap(m=>Object.keys(hm[m])))].sort();
    let html=`<div style="overflow-x:auto"><table class="hm-table"><thead><tr><th style="min-width:190px;text-align:left;padding-right:14px">Machine</th>`;
    allDates.forEach(d=>{const dt=new Date(d);html+=`<th>${dt.toLocaleDateString('en-IN',{weekday:'short'})}<br>${dt.getDate()}</th>`;});
    html+=`</tr></thead><tbody>`;
    machines.forEach(m=>{
      html+=`<tr><td style="font-family:var(--mono);font-size:11px;color:var(--muted);padding:3px 14px 3px 0;white-space:nowrap">${m}</td>`;
      allDates.forEach(d=>{
        const hrs=hm[m][d]||0,pct=Math.min(hrs/10,1);
        let bg,tc;
        if(hrs===0){bg='var(--surface)';tc='transparent';}
        else if(pct<0.5){bg=`rgba(59,130,246,${.15+pct*.7})`;tc='#93c5fd';}
        else if(pct<0.8){bg=`rgba(245,158,11,${.25+pct*.6})`;tc='#fcd34d';}
        else{bg=`rgba(239,68,68,${.35+pct*.5})`;tc='#fca5a5';}
        html+=`<td><div class="hm-cell" title="${m}: ${hrs}h" style="background:${bg};color:${tc}">${hrs>0?hrs:''}</div></td>`;
      });
      html+=`</tr>`;
    });
    html+=`</tbody></table></div>`;
    document.getElementById('hmBody').innerHTML=html;
  }catch(e){document.getElementById('hmBody').innerHTML=`<div class="empty">${e.message}</div>`;}
}

// ── ROUTINGS ──
