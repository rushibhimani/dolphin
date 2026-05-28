/**
 * Dolphin ERP — Floorplan
 */

// ─────────────────────────────────────────────────────────────────────────────
// FLOOR PLAN PAGE
// ─────────────────────────────────────────────────────────────────────────────
const floorPlan = {
  machines: {}, load: {}, assignments: {}, machineStatus: {}, selected: null, showWorkers: true, timer: null,

  async fetchDetails() {
    const d = await api('GET', '/api/machines/details');
    this.machines = d;
  },

  async fetchData() {
    try {
      const [load, assign, status] = await Promise.all([
        api('GET', '/api/machines/load-today'),
        api('GET', '/api/machines/assignments/now'),
        api('GET', '/api/machines/status-today'),
      ]);
      this.load = load;
      this.assignments = assign;
      this.machineStatus = status;
      this.applyColors();
      this.applyBadges();
      if (this.selected) await this.renderDetail(this.selected);
    } catch(e) { console.warn('Floor plan update failed:', e); }
  },

  colorFor(code) {
    const st = this.machineStatus[code];
    if (st === 'breakdown') return '#3b82f6';
    if (st === 'maintenance') return '#8b5cf6';
    if (st === 'in_progress') return '#ef4444';
    if (st === 'scheduled') return '#f59e0b';
    const pct = Math.round(((this.load[code] || 0) / 10) * 100);
    if (pct > 70) return '#ef4444';
    if (pct > 30) return '#f59e0b';
    return '#22c55e';
  },

  statusLabel(code) {
    const st = this.machineStatus[code];
    if (st === 'breakdown') return 'Down';
    if (st === 'maintenance') return 'Maintenance';
    if (st === 'in_progress') return 'Running';
    if (st === 'scheduled') return 'Scheduled';
    return 'Available';
  },

  buildSVG() {
    // ViewBox 1460 x 590. Two sections split by pathway at y≈300.
    const layout = {
      'M21': {x:15,  y:100, w:90,  h:110},
      'M7':  {x:140, y:165, w:85,  h:80},
      'M8':  {x:255, y:145, w:130, h:110},
      'M9':  {x:415, y:145, w:130, h:110},
      'M10': {x:575, y:145, w:95,  h:65},
      'M20': {x:575, y:220, w:95,  h:60},
      'M11': {x:690, y:145, w:95,  h:110},
      'M12': {x:800, y:145, w:95,  h:110},
      'M13': {x:910, y:145, w:95,  h:110},
      'M14': {x:1040,y:145, w:150, h:110},
      'M17': {x:1255,y:145, w:95,  h:110},
      'M15': {x:995, y:20,  w:300, h:85},
      'M22': {x:1360,y:20,  w:85,  h:85},
      'M16': {x:1360,y:120, w:85,  h:135},
      'M6':  {x:15,  y:320, w:85,  h:130},
      'M5':  {x:15,  y:465, w:85,  h:100},
      'M4':  {x:255, y:345, w:130, h:120},
      'M3':  {x:415, y:345, w:130, h:120},
      'M2':  {x:580, y:345, w:175, h:120},
      'M1':  {x:870, y:345, w:130, h:120},
      'M19': {x:1020,y:380, w:95,  h:70},
      'M18': {x:1255,y:330, w:100, h:110},
    };

    const cell = (code) => {
      const pos = layout[code];
      if (!pos) return '';
      const { x, y, w, h } = pos;
      const d = this.machines[code] || {};
      // Full machine name — use all words, wrap at 14 chars per line
      const fullName = d.name || code;
      const words = fullName.split(' ');
      let line1 = '', line2 = '';
      for (const word of words) {
        if (!line1 || (line1 + ' ' + word).length <= 14) line1 = line1 ? line1 + ' ' + word : word;
        else { line2 = line2 ? line2 + ' ' + word : word; break; }
      }
      const fill = this.colorFor(code);
      const pct  = Math.round(((this.load[code]||0)/10)*100);
      const asgn = this.assignments[code];
      const st   = this.statusLabel(code);
      const fs   = w >= 130 ? 12 : 11;

      // Worker badge — top-right corner INSIDE the box
      const badge = (asgn && this.showWorkers)
        ? `<rect x="${x+w-36}" y="${y+4}" width="32" height="16" rx="3" fill="rgba(0,0,0,0.45)"/>
           <text x="${x+w-20}" y="${y+13}" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">${asgn.worker_code}</text>`
        : '';

      const nameY1 = line2 ? y+h/2+3 : y+h/2+9;
      const codeY  = line2 ? y+h/2-14 : y+h/2-8;
      return `<g class="fp-machine" data-code="${code}" onclick="floorPlan.select('${code}')" style="cursor:pointer">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="rgba(0,0,0,.2)" stroke-width="1"/>
        <text x="${x+w/2}" y="${codeY}" text-anchor="middle" dominant-baseline="middle" font-size="13" font-weight="700" fill="#fff">${code}</text>
        <text x="${x+w/2}" y="${nameY1}" text-anchor="middle" dominant-baseline="middle" font-size="${fs}" fill="rgba(255,255,255,.9)">${line1}</text>
        ${line2 ? `<text x="${x+w/2}" y="${y+h/2+17}" text-anchor="middle" dominant-baseline="middle" font-size="${fs}" fill="rgba(255,255,255,.9)">${line2}</text>` : ''}
        <text x="${x+w/2}" y="${y+h-7}" text-anchor="middle" dominant-baseline="middle" font-size="9" fill="rgba(255,255,255,.75)">${st} · ${pct}%</text>
        ${badge}
      </g>`;
    };

    const cells = Object.keys(layout).map(cell).join('');

    // Pathway: thick grey band between rows
    const pathway = `
      <rect x="110" y="295" width="1345" height="22" rx="0" fill="var(--bg)" opacity="0.5"/>
      <line x1="110" y1="295" x2="1455" y2="295" stroke="var(--border)" stroke-width="1.5"/>
      <line x1="110" y1="317" x2="1455" y2="317" stroke="var(--border)" stroke-width="1.5"/>
      <text x="680" y="309" text-anchor="middle" dominant-baseline="middle" font-size="9" fill="var(--muted)" letter-spacing="4">· · · · · · · · · AISLE · · · · · · · · ·</text>
      <line x1="110" y1="120" x2="110" y2="580" stroke="var(--border)" stroke-width="1.2" stroke-dasharray="6 4" opacity="0.5"/>
    `;

    return `<svg id="fpSvg" viewBox="0 0 1460 590" style="width:100%;min-width:900px">
      ${pathway}
      ${cells}
    </svg>`;
  },

  applyColors() {
    document.querySelectorAll('.fp-machine').forEach(g => {
      const code = g.dataset.code;
      const rect = g.querySelector('rect');
      if (rect) rect.setAttribute('fill', this.colorFor(code));
      // Update status+pct text (last text in group)
      const texts = g.querySelectorAll('text');
      const last = texts[texts.length - 1];
      if (last && !last.dataset.worker) {
        const pct = Math.round(((this.load[code]||0)/10)*100);
        last.textContent = `${this.statusLabel(code)} · ${pct}%`;
      }
    });
  },

  applyBadges() {
    document.querySelectorAll('.fp-machine').forEach(g => {
      const code = g.dataset.code;
      g.querySelectorAll('[data-worker]').forEach(el => el.remove());
      const asgn = this.assignments[code];
      if (asgn && this.showWorkers) {
        const ns = 'http://www.w3.org/2000/svg';
        const rect = g.querySelector('rect');
        const bx = +rect.getAttribute('x') + +rect.getAttribute('width');
        const by = +rect.getAttribute('y');
        const bg = document.createElementNS(ns, 'rect');
        bg.setAttribute('x', bx - 36); bg.setAttribute('y', by + 4);
        bg.setAttribute('width', 32);  bg.setAttribute('height', 16);
        bg.setAttribute('rx', 3);
        bg.setAttribute('fill', 'rgba(0,0,0,0.45)');
        bg.dataset.worker = '1';
        const t = document.createElementNS(ns, 'text');
        t.setAttribute('x', bx - 20); t.setAttribute('y', by + 13);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('font-size', '9'); t.setAttribute('font-weight', '700');
        t.setAttribute('fill', '#fff'); t.dataset.worker = '1';
        t.textContent = asgn.worker_code;
        g.appendChild(bg); g.appendChild(t);
      }
    });
  },

  select(code) {
    document.querySelectorAll('.fp-machine rect:first-child').forEach(r => {
      r.setAttribute('stroke', 'rgba(0,0,0,.2)');
      r.setAttribute('stroke-width', '1');
    });
    const sel = document.querySelector(`.fp-machine[data-code="${code}"] rect`);
    if (sel) { sel.setAttribute('stroke', '#fff'); sel.setAttribute('stroke-width', '3'); }
    this.selected = code;
    this.renderDetail(code);
  },

  async renderDetail(code) {
    const el = document.getElementById('fpDetail');
    if (!el) return;
    const d = this.machines[code] || {};
    const hours = this.load[code] || 0;
    const pct = Math.round((hours / 10) * 100);
    const asgn = this.assignments[code];
    const color = this.colorFor(code);
    const st = this.statusLabel(code);

    let html = `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
        <div style="width:52px;height:52px;border-radius:8px;background:${color};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:16px;flex-shrink:0;flex-direction:column;gap:1px">
          <span>${pct}%</span><span style="font-size:9px;font-weight:500;opacity:.8">${hours.toFixed(1)}h</span>
        </div>
        <div>
          <div style="font-size:17px;font-weight:600;margin-bottom:3px">${d.name||code} <span style="font-size:13px;color:var(--muted);font-weight:400">(${code})</span></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <span style="font-size:11px;padding:2px 8px;border-radius:20px;background:${color};color:#fff;font-weight:600">${st}</span>
            <span style="font-size:11px;color:var(--muted)">${d.type||'—'} · Skill L${d.skill_level||1}</span>
          </div>
        </div>
      </div>`;

    if (asgn) {
      html += `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;border-radius:6px;background:#1d4ed8;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700;flex-shrink:0">${asgn.worker_code}</div>
        <div>
          <div style="font-size:14px;font-weight:600">${escHtml(asgn.worker_name)}</div>
          <div style="font-size:12px;color:var(--muted)">${asgn.job_number} · ${escHtml(asgn.op_name)}</div>
        </div>
        <div style="margin-left:auto;font-size:11px;padding:2px 8px;background:var(--orange,#f59e0b);color:#fff;border-radius:20px;font-weight:600">In progress</div>
      </div>`;
    }

    el.innerHTML = html + `<div id="fpOpsLoading" style="color:var(--muted);font-size:13px">Loading operations…</div>`;

    try {
      const res = await api('GET', `/api/machines/${code}/today`);
      const ops = res.ops || [];
      const statusColor = {completed:'#22c55e', in_progress:'#f59e0b', paused:'#ef4444', scheduled:'#6b7280'};
      const statusLabel = {completed:'Done', in_progress:'Running', paused:'Paused', scheduled:'Scheduled'};
      let opsHtml = `<div style="border-top:1px solid var(--border);padding-top:14px">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px">Today's operations <span style="color:var(--muted);font-weight:400">(${ops.length})</span></div>`;
      if (ops.length === 0) {
        opsHtml += `<div style="color:var(--muted);font-size:13px;padding:8px 0">No operations scheduled for today</div>`;
      } else {
        ops.forEach(op => {
          const t = op.scheduled_start ? new Date(op.scheduled_start).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:false}) : '—';
          const sc = statusColor[op.status] || '#6b7280';
          const sl = statusLabel[op.status] || op.status;
          opsHtml += `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);align-items:flex-start">
            <div style="width:8px;height:8px;border-radius:50%;background:${sc};flex-shrink:0;margin-top:5px"></div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;margin-bottom:2px">${escHtml(op.job_number)} · ${op.operation_name}</div>
              <div style="font-size:12px;color:var(--muted);margin-bottom:2px">${escHtml(op.worker_name)} · ${op.estimated_duration}h · ${t}</div>
            </div>
            <span style="font-size:10px;padding:2px 7px;border-radius:20px;background:${sc};color:#fff;font-weight:600;flex-shrink:0;margin-top:2px">${sl}</span>
          </div>`;
        });
      }
      opsHtml += `</div>`;
      document.getElementById('fpOpsLoading').outerHTML = opsHtml;
    } catch(e) {
      const el2 = document.getElementById('fpOpsLoading');
      if (el2) el2.textContent = 'Could not load operations.';
    }
  },

  toggleWorkers() {
    this.showWorkers = document.getElementById('fpWorkerToggle').checked;
    this.applyBadges();
  },

  start() { this.timer = setInterval(() => this.fetchData(), 5000); },
  stop()  { if (this.timer) { clearInterval(this.timer); this.timer = null; } },
};

async function renderFloorPlan() {
  floorPlan.stop();
  if (Object.keys(floorPlan.machines).length === 0) {
    try { await floorPlan.fetchDetails(); } catch(e) { console.warn('Floor plan details failed:', e); }
  }
  await floorPlan.fetchData();

  document.getElementById('content').innerHTML = `
    <div style="padding:28px 32px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
        <div>
          <div style="font-size:22px;font-weight:600;margin-bottom:2px">Factory Floor Plan</div>
          <div style="font-size:13px;color:var(--muted)">Live machine capacity &amp; worker assignments · auto-refresh 5s</div>
        </div>
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:7px;font-size:13px;cursor:pointer;color:var(--fg)">
            <input type="checkbox" id="fpWorkerToggle" ${floorPlan.showWorkers?'checked':''} onchange="floorPlan.toggleWorkers()"> Show workers
          </label>
          <button class="btn btn-secondary" onclick="floorPlan.fetchData()" style="font-size:12px;padding:5px 12px">↻ Refresh</button>
        </div>
      </div>

      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;font-size:12px">
        <div style="display:flex;align-items:center;gap:5px"><div style="width:12px;height:12px;border-radius:3px;background:#22c55e"></div>Available</div>
        <div style="display:flex;align-items:center;gap:5px"><div style="width:12px;height:12px;border-radius:3px;background:#f59e0b"></div>Scheduled</div>
        <div style="display:flex;align-items:center;gap:5px"><div style="width:12px;height:12px;border-radius:3px;background:#ef4444"></div>Running / Full</div>
        <div style="display:flex;align-items:center;gap:5px"><div style="width:12px;height:12px;border-radius:3px;background:#8b5cf6"></div>Maintenance</div>
        <div style="display:flex;align-items:center;gap:5px"><div style="width:12px;height:12px;border-radius:3px;background:#3b82f6"></div>Breakdown</div>
      </div>

      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:24px;overflow-x:auto">
        ${floorPlan.buildSVG()}
      </div>

      <div id="fpDetail" style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:20px;min-height:80px;font-size:13px;color:var(--muted)">
        Click any machine to view today's operations and worker details
      </div>
    </div>`;

  const style = document.createElement('style');
  style.id = 'fpStyle';
  document.getElementById('fpStyle')?.remove();
  style.textContent = `.fp-machine{cursor:pointer}.fp-machine:hover>rect{filter:brightness(1.1)}.fp-machine rect,.fp-machine text{transition:all .15s}`;
  document.head.appendChild(style);

  floorPlan.start();
}

