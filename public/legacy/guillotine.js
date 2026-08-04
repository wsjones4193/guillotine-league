// Guillotine League App
// Runs after data.js and src/main.js (cloud init) have loaded.

window.state = window.state || { guillotine: null };
let _gChannel = null;

// ── Navigation ────────────────────────────────────────────────
function navigate(page) {
  document.querySelectorAll('.g-page').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.g-nav-link').forEach(el => el.classList.remove('active'));

  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  const link = document.querySelector(`.g-nav-link[onclick*="'${page}'"]`);
  if (link) link.classList.add('active');

  if (page === 'draft')  renderGuillotineDraft();
  if (page === 'teams')  renderGuillotineTeams();
  if (page === 'setup')  renderGuillotineSetup();
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, 3000);
}

// ── Constants ─────────────────────────────────────────────────
const GUILLOTINE_ROSTER_SLOTS = [
  'QB','RB','RB','WR','WR','TE','FLEX','FLEX','FLEX','K','DEF','BN','BN','BN'
];
const GUILLOTINE_NUM_TEAMS  = 14;
const GUILLOTINE_NUM_ROUNDS = 14;

const GUILLOTINE_KICKERS = [
  'Justin Tucker','Evan McPherson','Tyler Bass','Harrison Butker','Matt Gay',
  'Jake Elliott','Brandon McManus','Younghoe Koo','Jason Sanders','Chris Boswell',
  'Tyler Henry','Dustin Hopkins','Daniel Carlson','Ka\'imi Fairbairn','Graham Gano',
  'Cairo Santos','Matt Prater','Eddy Piñeiro','Nick Folk','Riley Patterson',
  'Wil Lutz','Robbie Gould','Ryan Succop','Elliot Fry','Blake Grupe',
  'Greg Zuerlein','Cade York','Cameron Dicker','Jake Moody','Josh Lambo',
  'Michael Badgley','Sam Ficken',
];

const GUILD_OWNER_PALETTE = [
  '#1e3a5f','#065f46','#7c2d12','#4c1d95','#0c4a6e',
  '#831843','#14532d','#422006','#1c1917','#1e1b4b',
  '#0e7490','#3b0764','#78350f','#134e4a',
];

const _BOARD_POS_BG = {
  QB: '#dbeafe', RB: '#dcfce7', WR: '#fef3c7',
  TE: '#f3e8ff', K:  '#f1f5f9', DEF: '#e0e7ff',
};

// ── Helpers ───────────────────────────────────────────────────
function _guildCurrentUserId() {
  return window.db?.getCurrentUserId?.() || null;
}

function _guildCurrentUserOwns(team) {
  const uid = _guildCurrentUserId();
  return !!(uid && team && team.owner_user_id === uid);
}

function _guildCurrentOnClock(league, picks, teams) {
  if (!league || league.draft_status !== 'active') return null;
  const cp = league.current_pick;
  const pick = (picks || []).find(p => p.overall_pick === cp);
  if (!pick) return null;
  return teams.find(t => t.id === pick.team_id) || null;
}

function _guildPlayerPool(picks) {
  const picked = new Set((picks || []).filter(p => p.player_name).map(p => p.player_name));
  const adpMap = new Map((window.ADP_DATA || []).map(e => [e.fullName, e.adp]));
  const pool = [];

  for (const pos of ['QB','RB','WR','TE']) {
    for (const p of (window.NFL_DATA?.players[pos] || [])) {
      if (!picked.has(p.name)) pool.push({ name: p.name, team: p.team || '', pos, adp: adpMap.get(p.name) ?? null });
    }
  }
  GUILLOTINE_KICKERS.forEach((k, i) => {
    if (!picked.has(k)) pool.push({ name: k, team: '', pos: 'K', adp: adpMap.get(k) ?? (500 + i) });
  });
  const defNames = Object.keys(window.NFL_DATA?.teamNames || {}).map(abbr => `${abbr} DEF`);
  defNames.forEach((def, i) => {
    if (!picked.has(def)) pool.push({ name: def, team: def.replace(' DEF',''), pos: 'DEF', adp: adpMap.get(def) ?? (600 + i) });
  });
  pool.sort((a, b) => (a.adp ?? 9999) - (b.adp ?? 9999));
  return pool;
}

function _guildPlayerTeam(playerName, pos) {
  if (!playerName) return '';
  if (pos === 'DEF') return playerName.replace(' DEF', '');
  if (pos === 'K')   return '';
  for (const p of [
    ...(window.NFL_DATA?.players.QB || []),
    ...(window.NFL_DATA?.players.RB || []),
    ...(window.NFL_DATA?.players.WR || []),
    ...(window.NFL_DATA?.players.TE || []),
  ]) {
    if (p.name === playerName) return p.team || '';
  }
  return '';
}

function _guildRosterForTeam(teamId, picks) {
  const teamPicks = (picks || []).filter(p => p.team_id === teamId && p.player_name);
  const slots = [...GUILLOTINE_ROSTER_SLOTS];
  const filled = Array(slots.length).fill(null);
  const assigned = new Set();

  for (const pk of teamPicks) {
    const pos = pk.pos;
    // Try exact slot first, then FLEX
    let idx = slots.findIndex((s, i) => s === pos && !filled[i]);
    if (idx === -1 && ['RB','WR','TE'].includes(pos)) {
      idx = slots.findIndex((s, i) => s === 'FLEX' && !filled[i]);
    }
    if (idx === -1) idx = slots.findIndex((s, i) => s === 'BN' && !filled[i]);
    if (idx !== -1) { filled[idx] = pk; assigned.add(pk.overall_pick); }
  }
  return slots.map((slot, i) => ({ slot, pick: filled[i] }));
}

// ── Draft Board ───────────────────────────────────────────────
async function renderGuillotineDraft() {
  const el = document.getElementById('page-draft');
  try {
    window.state.guillotine = await window.db.loadGuillotineLeague();
  } catch(e) {
    el.innerHTML = `<div class="page-inner"><p style="color:#ef4444">Error: ${e.message}</p></div>`;
    return;
  }

  if (!window.state.guillotine) {
    const adminMsg = window.__userRole === 'admin'
      ? `<a href="#" onclick="navigate('setup')" style="color:#6366f1;font-weight:600;">Go to Setup →</a>`
      : '';
    el.innerHTML = `<div class="page-inner"><p style="color:#6b7280;font-size:14px;">No league set up yet. ${adminMsg}</p></div>`;
    return;
  }

  _buildGuillotineDraftHTML(el);

  // Live updates — tear down any existing subscription first
  if (_gChannel) window.db.unsubscribeLeague(_gChannel);
  _gChannel = window.db.subscribeToLeague(window.state.guillotine.league.id, async () => {
    window.state.guillotine = await window.db.loadGuillotineLeague();
    _buildGuillotineDraftHTML(el);
  });
}

function _buildGuillotineDraftHTML(el) {
  const { league, teams, picks } = window.state.guillotine;
  const uid      = _guildCurrentUserId();
  const onClock  = _guildCurrentOnClock(league, picks, teams);
  const pool     = _guildPlayerPool(picks);
  const cp       = league.current_pick;
  const isDone   = league.draft_status === 'complete' || cp > 196;
  const isMyTurn = onClock && _guildCurrentUserOwns(onClock);

  el.innerHTML = `
    <div class="g-draft-layout">
      <div class="g-draft-panel g-draft-pool">
        <div class="g-panel-header">
          <span>Available Players</span>
          <div class="g-pos-tabs">
            <button class="g-pos-tab active" onclick="window.gFilterPos('ALL',this)">ALL</button>
            <button class="g-pos-tab" onclick="window.gFilterPos('QB',this)">QB</button>
            <button class="g-pos-tab" onclick="window.gFilterPos('RB',this)">RB</button>
            <button class="g-pos-tab" onclick="window.gFilterPos('WR',this)">WR</button>
            <button class="g-pos-tab" onclick="window.gFilterPos('TE',this)">TE</button>
            <button class="g-pos-tab" onclick="window.gFilterPos('K',this)">K</button>
            <button class="g-pos-tab" onclick="window.gFilterPos('DEF',this)">DEF</button>
          </div>
        </div>
        <input type="text" id="gPlayerSearch" placeholder="Search players…"
          oninput="window.gFilterPlayers()"
          style="width:calc(100%-16px);margin:8px;border:1px solid #d1d5db;border-radius:6px;padding:8px 10px;font-size:13px;">
        <div id="gPlayerList" class="g-player-list">
          ${_buildPoolRows(pool, isMyTurn, onClock, league)}
        </div>
      </div>

      <div class="g-draft-panel g-draft-center">
        <div class="g-panel-header">Draft Board</div>
        ${isDone
          ? '<div class="g-onclock-banner" style="background:#16a34a">✅ Draft Complete!</div>'
          : `<div class="g-onclock-banner">
               Pick ${cp} of 196 · Round ${Math.ceil(cp/14)} · ${onClock
                 ? `ON THE CLOCK: <strong>${onClock.owner_name}</strong> — ${onClock.team_name}`
                 : 'Draft Pending'}
             </div>`}
        <div class="g-board-scroll">
          ${_buildSnakeBoardGrid(teams, picks, cp)}
        </div>
      </div>
    </div>

    <div class="g-teams-below">
      ${_buildAllTeamsBelow(teams, picks, cp)}
    </div>`;

  window._gPool     = pool;
  window._gOnClock  = onClock;
  window._gLeague   = league;
  window._gIsMyTurn = isMyTurn;
  window._gCurrentPos = window._gCurrentPos || 'ALL';
  window.gFilterPos(window._gCurrentPos);
}

function _buildPoolRows(pool, isMyTurn, onClock, league) {
  if (league.draft_status !== 'active') {
    return '<p style="color:#9ca3af;font-size:13px;padding:8px">Draft is not active.</p>';
  }
  return pool.map(p => `
    <div class="g-pool-row" data-pos="${p.pos}" data-name="${p.name.toLowerCase()}">
      <span class="g-pool-adp">${p.adp != null ? p.adp.toFixed(1) : '—'}</span>
      <span class="pos-badge pos-${p.pos}">${p.pos}</span>
      <span class="g-pool-name">${p.name}</span>
      <span class="g-pool-team">${p.team}</span>
      ${isMyTurn
        ? `<button class="g-pick-btn" onclick="window.gMakePick('${p.name.replace(/'/g,"\\'")}','${p.pos}')">Pick</button>`
        : `<span class="g-pick-btn-disabled">${onClock ? '🔒' : ''}</span>`}
    </div>`).join('');
}

function _buildSnakeBoardGrid(teams, picks, currentPick) {
  const NUM = GUILLOTINE_NUM_TEAMS;
  const sorted = [...teams].sort((a, b) => a.draft_slot - b.draft_slot);
  const pickMap = {};
  for (const p of picks) pickMap[p.overall_pick] = p;

  const headers = sorted.map(t =>
    `<th class="g-board-th" title="${t.owner_name}">${t.team_name}<div class="g-board-th-owner">${t.owner_name}</div></th>`
  ).join('');

  const rows = [];
  for (let round = 1; round <= GUILLOTINE_NUM_ROUNDS; round++) {
    const isOdd = round % 2 === 1;
    let cells = '';
    for (let slot = 1; slot <= NUM; slot++) {
      const pickInRound = isOdd ? slot : (NUM + 1 - slot);
      const overall = (round - 1) * NUM + slot;
      const p = pickMap[overall];
      const isCurrent = overall === currentPick;

      let cellContent = '', cellStyle = '';
      if (p?.player_name) {
        const pos = p.pos || '';
        const teamAbbr = _guildPlayerTeam(p.player_name, pos);
        const teamColor = (teamAbbr && window.NFL_DATA?.teamColors?.[teamAbbr]) || '#6b7280';
        cellStyle = `background:${_BOARD_POS_BG[pos] || '#f9fafb'};`;
        const logoUrl = teamAbbr ? `https://a.espncdn.com/i/teamlogos/nfl/500/${teamAbbr.toLowerCase()}.png` : '';
        const logoImg = logoUrl
          ? `<img src="${logoUrl}" referrerpolicy="no-referrer" onerror="this.style.display='none'" style="width:22px;height:22px;object-fit:contain;flex-shrink:0;">`
          : '';
        const posColor = { QB:'#1d4ed8', RB:'#047857', WR:'#b45309', TE:'#6d28d9', K:'#475569', DEF:'#0e7490' }[pos] || '#6b7280';
        const photoUrl = window.PLAYER_HEADSHOTS?.[p.player_name.toLowerCase()] || null;
        const headshot = `<div class="g-board-headshot" style="background:#fff;border:1.5px solid ${posColor}30;position:relative;overflow:hidden;">
          <svg width="40" height="46" viewBox="0 0 40 46" fill="none" style="position:absolute;inset:0;width:100%;height:100%;">
            <circle cx="20" cy="14" r="9" fill="${posColor}" opacity="0.4"/>
            <ellipse cx="20" cy="38" rx="14" ry="11" fill="${posColor}" opacity="0.4"/>
          </svg>
          ${photoUrl ? `<img src="${photoUrl}" referrerpolicy="no-referrer" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top center;">` : ''}
        </div>`;
        cellContent = `
          <div style="display:flex;align-items:flex-start;gap:4px;height:100%;">
            ${headshot}
            <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between;height:100%;padding:2px 0;">
              <span class="g-board-player">${p.player_name}</span>
              <div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap;">
                <span class="pos-badge pos-${pos}" style="font-size:8px;padding:1px 3px;">${pos}</span>
                ${logoImg}
                <span class="g-board-team-badge" style="background:${teamColor};font-size:8px;">${teamAbbr}</span>
                <span class="g-board-pick-num" style="margin-left:auto">#${overall}</span>
              </div>
            </div>
          </div>`;
      } else {
        cellContent = `<span class="g-board-pick-num" style="color:#d1d5db">#${overall}</span>`;
      }

      const cls = isCurrent ? 'g-board-cell g-board-current'
        : p?.player_name ? 'g-board-cell g-board-filled'
        : 'g-board-cell g-board-empty';

      cells += `<td class="${cls}" style="${cellStyle}">${cellContent}</td>`;
    }
    rows.push(`
      <tr>
        <td class="g-board-round">${round}<span class="g-board-arrow">${isOdd ? '→' : '←'}</span></td>
        ${cells}
      </tr>`);
  }

  return `
    <table class="g-board-table">
      <thead><tr><th class="g-board-round-hdr"></th>${headers}</tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
}

function _buildRosterCard(team, picks, showOwner, nextPick, headerColor) {
  const roster = _guildRosterForTeam(team.id, picks);
  const nextLabel = nextPick != null ? `Pick #${nextPick}` : `Slot ${team.draft_slot}`;
  const bg = headerColor || '#1e3a5f';
  return `
    <div class="g-roster-card">
      <div class="g-roster-header" style="background:${bg}">
        <div class="g-roster-header-main">
          <div>
            <div class="g-roster-team-name">${team.team_name}</div>
            <div class="g-roster-owner">${team.owner_name}</div>
          </div>
          <div class="g-roster-slot-num">${nextLabel}</div>
        </div>
      </div>
      <div class="g-roster-rows">
        ${roster.map(({ slot, pick }) => `
          <div class="g-roster-row ${pick ? '' : 'g-roster-empty'}">
            <span class="g-roster-slot-label">${slot}</span>
            ${pick
              ? `<span class="pos-badge pos-${pick.pos}">${pick.pos}</span>
                 <span class="g-roster-player">${pick.player_name}</span>`
              : `<span class="g-roster-player" style="color:#d1d5db">—</span>`
            }
          </div>`).join('')}
      </div>
    </div>`;
}

function _buildAllTeamsBelow(teams, picks, currentPick) {
  const sorted = [...teams].sort((a, b) => a.draft_slot - b.draft_slot);
  const uniqueOwners = [...new Set(sorted.map(t => t.owner_name))].sort();
  const ownerColor = {};
  uniqueOwners.forEach((o, i) => ownerColor[o] = GUILD_OWNER_PALETTE[i % GUILD_OWNER_PALETTE.length]);

  const cards = sorted.map(team => {
    const next = (picks || [])
      .filter(p => p.team_id === team.id && !p.player_name && p.overall_pick >= currentPick)
      .sort((a, b) => a.overall_pick - b.overall_pick)[0];
    return _buildRosterCard(team, picks, false, next?.overall_pick ?? null, ownerColor[team.owner_name]);
  }).join('');
  return `<div class="g-all-teams-grid">${cards}</div>`;
}

// ── Player filter handlers ────────────────────────────────────
window.gFilterPos = function(pos, btn) {
  window._gCurrentPos = pos;
  document.querySelectorAll('.g-pos-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  window.gFilterPlayers();
};

window.gFilterPlayers = function() {
  const search = (document.getElementById('gPlayerSearch')?.value || '').toLowerCase();
  const pos    = window._gCurrentPos || 'ALL';
  document.querySelectorAll('.g-pool-row').forEach(row => {
    const matchPos  = pos === 'ALL' || row.dataset.pos === pos;
    const matchName = row.dataset.name.includes(search);
    row.style.display = (matchPos && matchName) ? '' : 'none';
  });
};

window.gMakePick = async function(playerName, pos) {
  const g = window.state.guillotine;
  if (!g) return;
  if (!confirm(`Pick ${playerName} (${pos})?`)) return;
  try {
    await window.db.makeGuillotinePick(g.league.id, g.league.current_pick, playerName, pos);
    // Optimistic update
    const pick = g.picks.find(p => p.overall_pick === g.league.current_pick);
    if (pick) { pick.player_name = playerName; pick.pos = pos; }
    g.league.current_pick = g.league.current_pick + 1;
    _buildGuillotineDraftHTML(document.getElementById('page-draft'));
    showToast(`Picked ${playerName}!`);
  } catch(e) {
    showToast('Error: ' + e.message, 'error');
  }
};

// ── Teams Page ────────────────────────────────────────────────
async function renderGuillotineTeams() {
  const el = document.getElementById('page-teams');
  try {
    window.state.guillotine = await window.db.loadGuillotineLeague();
  } catch(e) {
    el.innerHTML = `<div class="page-inner"><p style="color:#ef4444">Error: ${e.message}</p></div>`;
    return;
  }

  if (!window.state.guillotine) {
    el.innerHTML = `<div class="page-inner"><p style="color:#6b7280">No league set up yet.</p></div>`;
    return;
  }

  const { teams, picks } = window.state.guillotine;
  const ownerMap = {};
  for (const t of teams) {
    if (!ownerMap[t.owner_name]) ownerMap[t.owner_name] = [];
    ownerMap[t.owner_name].push(t);
  }

  const html = Object.entries(ownerMap).map(([owner, ownerTeams]) => `
    <div class="g-owner-group">
      <div class="g-owner-group-header">${owner}</div>
      <div class="g-owner-group-teams">
        ${ownerTeams.map(t => _buildRosterCard(t, picks, false)).join('')}
      </div>
    </div>`).join('');

  el.innerHTML = `
    <div class="page-inner g-teams-layout">
      <h2 style="font-size:18px;font-weight:700;margin-bottom:20px;">All Teams</h2>
      ${html}
    </div>`;
}

// ── Setup Page (admin only) ───────────────────────────────────
async function renderGuillotineSetup() {
  const el = document.getElementById('page-setup');
  if (window.__userRole !== 'admin') {
    el.innerHTML = `<div class="page-inner"><p style="color:#6b7280">Access restricted.</p></div>`;
    return;
  }

  el.innerHTML = '<div class="page-inner"><p style="color:#6b7280">Loading…</p></div>';
  let g = null;
  try {
    g = await window.db.loadGuillotineLeague();
    if (g) window.state.guillotine = g;
  } catch(e) {
    el.innerHTML = `<div class="page-inner"><p style="color:#ef4444">Error: ${e.message}</p></div>`;
    return;
  }

  let profiles = [];
  try { profiles = await window.db.loadProfiles(); } catch(_) {}

  if (!g) {
    _renderGuillotineSetupNew(el, profiles);
  } else {
    _renderGuillotineSetupExisting(el, g, profiles);
  }
}

function _renderGuillotineSetupNew(el, profiles) {
  const profileOptions = profiles.map(p => `<option value="${p.id}">${p.display_name}</option>`).join('');
  const teamRows = Array.from({ length: GUILLOTINE_NUM_TEAMS }, (_, i) => `
    <tr>
      <td style="padding:6px 8px;text-align:center;color:#6b7280">${i+1}</td>
      <td style="padding:6px 8px"><input type="text" class="g-team-name" data-slot="${i+1}" placeholder="Team ${i+1}" style="width:100%;border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;font-size:13px"></td>
      <td style="padding:6px 8px"><input type="text" class="g-owner-name" data-slot="${i+1}" placeholder="Owner" style="width:100%;border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;font-size:13px"></td>
      <td style="padding:6px 8px">
        <select class="g-owner-id" data-slot="${i+1}" style="width:100%;border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;font-size:13px">
          <option value="">-- none --</option>${profileOptions}
        </select>
      </td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="page-inner" style="max-width:900px">
      <h2 style="font-size:20px;font-weight:700;margin-bottom:4px">League Setup</h2>
      <p style="color:#6b7280;font-size:13px;margin-bottom:24px">Configure teams, owners, and draft order.</p>
      <div style="margin-bottom:20px">
        <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px">League Name</label>
        <input type="text" id="gLeagueName" value="Guillotine League 2025" style="border:1px solid #d1d5db;border-radius:8px;padding:8px 12px;font-size:14px;width:320px">
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <thead>
          <tr style="background:#1e3a5f;color:#fff">
            <th style="padding:8px;text-align:center;width:60px;font-size:12px">SLOT</th>
            <th style="padding:8px;text-align:left;font-size:12px">TEAM NAME</th>
            <th style="padding:8px;text-align:left;font-size:12px">OWNER NAME</th>
            <th style="padding:8px;text-align:left;font-size:12px">APP USER</th>
          </tr>
        </thead>
        <tbody>${teamRows}</tbody>
      </table>
      <button onclick="window.startGuillotineDraft()" style="background:#6366f1;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer">
        🏈 Start Draft
      </button>
    </div>`;
}

function _renderGuillotineSetupExisting(el, g, profiles) {
  const { league, teams, picks } = g;
  const doneCount = picks.filter(p => p.player_name).length;
  const statusColor = league.draft_status === 'active' ? '#22a648' : league.draft_status === 'complete' ? '#3b82f6' : '#f59e0b';
  const isPending = league.draft_status === 'pending';
  const profileOptions = profiles.map(p => `<option value="${p.id}">${p.display_name}</option>`).join('');
  const profileMap = {};
  profiles.forEach(p => profileMap[p.id] = p.display_name);
  window._gProfileMap = profileMap;

  const sorted = [...teams].sort((a, b) => a.draft_slot - b.draft_slot);
  const teamRows = sorted.map(t => {
    if (isPending) {
      return `
        <tr style="border-bottom:1px solid #f3f4f6" data-team-id="${t.id}">
          <td style="padding:6px 8px;text-align:center;color:#6b7280;width:50px">${t.draft_slot}</td>
          <td style="padding:6px 8px"><input class="g-setup-input g-edit-team-name" data-team-id="${t.id}" value="${t.team_name}" style="width:100%"></td>
          <td style="padding:6px 8px">
            <select class="g-setup-input g-edit-owner-id" data-team-id="${t.id}" style="width:100%">
              <option value="">— No user —</option>
              ${profileOptions.replace(`value="${t.owner_user_id}"`, `value="${t.owner_user_id}" selected`)}
            </select>
          </td>
        </tr>`;
    }
    return `
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:8px;text-align:center;color:#6b7280">${t.draft_slot}</td>
        <td style="padding:8px;font-weight:600">${t.team_name}</td>
        <td style="padding:8px;color:#374151">${t.owner_name}</td>
      </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="page-inner" style="max-width:960px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        ${isPending
          ? `<input id="gLeagueNameEdit" class="g-setup-input" value="${league.name}" style="font-size:18px;font-weight:700;width:260px">`
          : `<h2 style="font-size:20px;font-weight:700;margin:0">${league.name}</h2>`}
        <span style="background:${statusColor};color:#fff;font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px;text-transform:uppercase">${league.draft_status}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px">
        <div class="g-stat-card"><div class="g-stat-num">${doneCount}</div><div class="g-stat-label">Picks Made</div></div>
        <div class="g-stat-card"><div class="g-stat-num">${196 - doneCount}</div><div class="g-stat-label">Remaining</div></div>
        <div class="g-stat-card"><div class="g-stat-num">${league.current_pick}</div><div class="g-stat-label">Current Pick</div></div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <thead>
          <tr style="background:#1e3a5f;color:#fff">
            <th style="padding:8px;text-align:center;width:50px;font-size:11px">SLOT</th>
            <th style="padding:8px;text-align:left;font-size:11px">TEAM NAME</th>
            <th style="padding:8px;text-align:left;font-size:11px">OWNER</th>
          </tr>
        </thead>
        <tbody>${teamRows}</tbody>
      </table>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${isPending ? `
          <button onclick="window.saveGuillotineSetup()" style="background:#22a648;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer">💾 Save Changes</button>
          <button onclick="window.startGuillotineDraftExisting()" style="background:#6366f1;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer">🏈 Start Draft</button>
        ` : `
          <button onclick="navigate('draft')" style="background:#6366f1;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer">🎯 Go to Draft Board</button>
        `}
        <button onclick="window.resetGuillotineDraft()" style="background:#fff;color:#ef4444;border:1px solid #ef4444;border-radius:8px;padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer">↺ Reset Draft</button>
      </div>
    </div>`;
}

// ── Setup action handlers ─────────────────────────────────────
window.saveGuillotineSetup = async function() {
  const g = window.state.guillotine;
  if (!g) return;
  const newName = document.getElementById('gLeagueNameEdit')?.value.trim();
  if (newName && newName !== g.league.name) {
    await window.db.updateGuillotineLeague(g.league.id, { name: newName });
  }
  const saves = [];
  document.querySelectorAll('tr[data-team-id]').forEach(row => {
    const id = row.dataset.teamId;
    if (!id) return;
    const teamName  = row.querySelector('.g-edit-team-name')?.value.trim();
    const ownerId   = row.querySelector('.g-edit-owner-id')?.value || null;
    const ownerName = (ownerId && window._gProfileMap?.[ownerId])
      ? window._gProfileMap[ownerId] : (teamName || 'Owner');
    saves.push(window.db.updateGuillotineTeam(id, { team_name: teamName || 'Team', owner_name: ownerName, owner_user_id: ownerId }));
  });
  try {
    await Promise.all(saves);
    window.state.guillotine = await window.db.loadGuillotineLeague();
    showToast('Changes saved!');
    renderGuillotineSetup();
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
};

window.startGuillotineDraft = async function() {
  const name = document.getElementById('gLeagueName')?.value?.trim() || 'Guillotine League 2025';
  const teamsConfig = [];
  document.querySelectorAll('.g-team-name').forEach(inp => {
    const slot = parseInt(inp.dataset.slot);
    const ownerEl = document.querySelector(`.g-owner-name[data-slot="${slot}"]`);
    const idEl    = document.querySelector(`.g-owner-id[data-slot="${slot}"]`);
    teamsConfig.push({
      draft_slot: slot,
      team_name:  inp.value.trim() || `Team ${slot}`,
      owner_name: ownerEl?.value.trim() || `Owner ${slot}`,
      owner_user_id: idEl?.value || null,
    });
  });
  try {
    await window.db.createGuillotineLeague(name, teamsConfig);
    window.state.guillotine = await window.db.loadGuillotineLeague();
    showToast('Draft created!');
    navigate('draft');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
};

window.startGuillotineDraftExisting = async function() {
  const g = window.state.guillotine;
  if (!g) return;
  try {
    await window.db.updateGuillotineLeague(g.league.id, { draft_status: 'active' });
    window.state.guillotine = await window.db.loadGuillotineLeague();
    navigate('draft');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
};

window.resetGuillotineDraft = async function() {
  const g = window.state.guillotine;
  if (!g) return;
  if (!confirm('Reset the draft? All picks will be cleared.')) return;
  try {
    await window.db.resetGuillotineDraft(g.league.id);
    window.state.guillotine = await window.db.loadGuillotineLeague();
    showToast('Draft reset.');
    renderGuillotineSetup();
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
};

// ── Boot ──────────────────────────────────────────────────────
window.appInit = function() {
  // Default to draft board page
  navigate('draft');
};

// If cloud is already ready (race condition), boot immediately
if (window.__appReady) window.appInit();
