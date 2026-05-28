/**
 * Dolphin ERP — Routings
 */

async function renderRoutings(){
  await loadAll();
  const canModify = authCanModify('routings');
  const canDelete = authCanDelete('routings');
  document.getElementById('topbarActions').innerHTML=canModify?`<button class="btn btn-primary" onclick="renderRoutingEditor()">+ New Routing</button>`:'';
  document.getElementById('content').innerHTML=`<div class="card"><div class="card-hdr"><div class="card-title">Routing Templates (${allRoutings.length})</div>${!canModify?'<span style="font-size:11px;color:var(--muted);padding:4px 8px;background:var(--surface);border-radius:4px;border:1px solid var(--border)">👁 View Only</span>':''}</div><div id="routingList"></div></div>`;
  if(!allRoutings.length){document.getElementById('routingList').innerHTML=`<div class="empty">No routings. ${canModify?'Create one or load demo data.':'Nothing to display yet.'}</div>`;return;}
  document.getElementById('routingList').innerHTML=allRoutings.map(r=>{
    const totalMins=r.operations.reduce((s,o)=>s+o.setup_time_mins+(o.work_time_mins!=null?o.work_time_mins:(o.work_time_hrs||0)*60),0);
    return`<div style="padding:14px 18px;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div>
          <div style="font-weight:600;margin-bottom:2px">${escHtml(r.name)}</div>
          <div style="font-size:11px;color:var(--muted)">${escHtml(r.product_type)}${r.description?' · '+r.description:''} · ${r.operations.length} operations · ${fmtTotal(totalMins)} total · ${r.material_lead_days}d material lead</div>
          ${r.operations.length===0?`<div style="font-size:11px;color:var(--red);margin-top:3px">⚠ No operations defined — add at least one</div>`:''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          ${canModify?`<button class="btn btn-ghost" onclick="renderRoutingEditor(${r.id})">Edit</button>`:''}
          ${canDelete?`<button class="btn btn-danger" onclick="delRouting(${r.id})">Delete</button>`:''}
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">
        ${r.operations.map((op,i)=>{
          const opMins=op.setup_time_mins+(op.work_time_mins!=null?op.work_time_mins:(op.work_time_hrs||0)*60);
          return`${i>0?`<span style="color:var(--border2)">→</span>`:''}
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:3px 8px;font-size:11px">
            <span style="color:var(--muted)">${op.sequence}.</span>
            <strong style="margin-left:2px">${op.name}</strong>
            <span style="color:var(--accent2);margin-left:4px">${op.work_center_name}</span>
            <span style="color:var(--muted);margin-left:4px">${fmtTotal(opMins)}${op.is_optional?' opt':''}</span>
          </div>`;}).join('')}
        ${r.operations.length===0?`<span style="color:var(--muted);font-size:12px;font-style:italic">No operations yet</span>`:''}
      </div>
    </div>`;
  }).join('');
}

function buildMachineOpts(selId){
  const byType={};
  allMachines.forEach(m=>{if(!byType[m.machine_type])byType[m.machine_type]=[];byType[m.machine_type].push(m);});
  return Object.entries(byType).map(([t,ms])=>`<optgroup label="${t}">${ms.map(m=>`<option value="${m.id}"${parseInt(selId)===m.id?' selected':''}>${m.name}</option>`).join('')}</optgroup>`).join('');
}
