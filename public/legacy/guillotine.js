// Guillotine League App
// Runs after data.js and src/main.js (cloud init) have loaded.

window.state = window.state || { guillotine: null };
let _gChannel     = null;
let _gCurrentPage = 'draft';

// ── URL ↔ page mapping ────────────────────────────────────────
const _PAGE_TO_URL = {
  home: '/', draft: '/draftboard', available: '/available',
  drafting: '/drafting', teams: '/teams', setup: '/setup',
};

function _pageFromPath(path) {
  const map = {
    '/': 'home', '/draftboard': 'draft', '/available': 'available',
    '/drafting': 'drafting', '/teams': 'teams', '/setup': 'setup',
  };
  return map[path] || 'home';
}

// ── Navigation ────────────────────────────────────────────────
function navigate(page, pushState = true) {
  _gCurrentPage = page;

  if (pushState) {
    history.pushState({ page }, '', _PAGE_TO_URL[page] || '/draftboard');
  }

  document.querySelectorAll('.g-page').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.g-nav-link').forEach(el => el.classList.remove('active'));

  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  const link = document.querySelector(`.g-nav-link[href="${_PAGE_TO_URL[page]}"]`);
  if (link) link.classList.add('active');

  if (page === 'home')      renderHome();
  if (page === 'draft')     renderGuillotineDraft();
  if (page === 'available') renderAvailablePlayers();
  if (page === 'drafting')  renderDrafting();
  if (page === 'teams')     renderGuillotineTeams();
  if (page === 'setup')     renderGuillotineSetup();
}

window.addEventListener('popstate', e => {
  navigate(e.state?.page || _pageFromPath(location.pathname), false);
});

function _reRenderCurrentPage() {
  if (_gCurrentPage === 'draft')     _buildGuillotineBoardHTML(document.getElementById('page-draft'));
  if (_gCurrentPage === 'available') _buildAvailableHTML(document.getElementById('page-available'));
  if (_gCurrentPage === 'drafting')  _buildDraftingHTML(document.getElementById('page-drafting'));
}

function _ensureSubscription(leagueId) {
  if (_gChannel) return;
  _gChannel = window.db.subscribeToLeague(leagueId, async () => {
    window.state.guillotine = await window.db.loadGuillotineLeague();
    _reRenderCurrentPage();
  });
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

const _POS_COLOR = {
  QB: '#1d4ed8', RB: '#047857', WR: '#b45309',
  TE: '#6d28d9', K:  '#475569', DEF: '#0e7490',
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
  const cp   = league.current_pick;
  const pick = (picks || []).find(p => p.overall_pick === cp);
  if (!pick) return null;
  return teams.find(t => t.id === pick.team_id) || null;
}

function _guildPlayerPool(picks) {
  const picked = new Set((picks || []).filter(p => p.player_name).map(p => p.player_name));
  const adpMap = new Map((window.ADP_DATA || []).map(e => [e.fullName, e.adp]));
  const pool   = [];

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
  const slots  = [...GUILLOTINE_ROSTER_SLOTS];
  const filled = Array(slots.length).fill(null);

  for (const pk of teamPicks) {
    const pos = pk.pos;
    let idx = slots.findIndex((s, i) => s === pos && !filled[i]);
    if (idx === -1 && ['RB','WR','TE'].includes(pos)) {
      idx = slots.findIndex((s, i) => s === 'FLEX' && !filled[i]);
    }
    if (idx === -1) idx = slots.findIndex((s, i) => s === 'BN' && !filled[i]);
    if (idx !== -1) filled[idx] = pk;
  }
  return slots.map((slot, i) => ({ slot, pick: filled[i] }));
}

function _ownerColorMap(teams) {
  const owners = [...new Set(teams.map(t => t.owner_name))].sort();
  const map = {};
  owners.forEach((o, i) => map[o] = GUILD_OWNER_PALETTE[i % GUILD_OWNER_PALETTE.length]);
  return map;
}

// ── Home Page ─────────────────────────────────────────────────
function renderHome() {
  const el = document.getElementById('page-home');
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:calc(100vh - 56px);">
      <img src="/logo-words.png" style="max-width:480px;width:90%;object-fit:contain;">
    </div>`;
}

// ── Board Page ────────────────────────────────────────────────
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

  _buildGuillotineBoardHTML(el);
  _ensureSubscription(window.state.guillotine.league.id);
}

function _buildGuillotineBoardHTML(el) {
  const { league, teams, picks } = window.state.guillotine;
  const cp      = league.current_pick;
  const isDone  = league.draft_status === 'complete' || cp > 196;
  const onClock = _guildCurrentOnClock(league, picks, teams);

  el.innerHTML = `
    <div style="padding:12px 16px;">
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
    </div>`;
}

function _buildSnakeBoardGrid(teams, picks, currentPick) {
  const NUM    = GUILLOTINE_NUM_TEAMS;
  const sorted = [...teams].sort((a, b) => a.draft_slot - b.draft_slot);
  const pickMap = {};
  for (const p of picks) pickMap[p.overall_pick] = p;

  const headers = sorted.map(t =>
    `<th class="g-board-th" title="${t.owner_name}">${t.team_name}</th>`
  ).join('');

  const rows = [];
  for (let round = 1; round <= GUILLOTINE_NUM_ROUNDS; round++) {
    const isOdd = round % 2 === 1;
    let cells = '';
    for (let slot = 1; slot <= NUM; slot++) {
      const pickInRound = isOdd ? slot : (NUM + 1 - slot);
      const overall     = (round - 1) * NUM + slot;
      const p           = pickMap[overall];
      const isCurrent   = overall === currentPick;

      let cellContent = '', cellStyle = '';
      if (p?.player_name) {
        const pos      = p.pos || '';
        const teamAbbr = _guildPlayerTeam(p.player_name, pos);
        const teamColor = (teamAbbr && window.NFL_DATA?.teamColors?.[teamAbbr]) || '#6b7280';
        cellStyle = `background:${_BOARD_POS_BG[pos] || '#f9fafb'};`;
        const logoUrl = teamAbbr ? `https://a.espncdn.com/i/teamlogos/nfl/500/${teamAbbr.toLowerCase()}.png` : '';
        const logoImg = logoUrl
          ? `<img src="${logoUrl}" referrerpolicy="no-referrer" onerror="this.style.display='none'" style="width:22px;height:22px;object-fit:contain;flex-shrink:0;">`
          : '';
        const posColor  = _POS_COLOR[pos] || '#6b7280';
        const photoUrl  = window.PLAYER_HEADSHOTS?.[p.player_name.toLowerCase()] || null;
        const headshot  = `<div class="g-board-headshot" style="background:#fff;border:1.5px solid ${posColor}30;position:relative;overflow:hidden;">
          <svg width="40" height="46" viewBox="0 0 40 46" fill="none" style="position:absolute;inset:0;width:100%;height:100%;${photoUrl ? 'display:none;' : ''}">
            <circle cx="20" cy="14" r="9" fill="${posColor}" opacity="0.4"/>
            <ellipse cx="20" cy="38" rx="14" ry="11" fill="${posColor}" opacity="0.4"/>
          </svg>
          ${photoUrl ? `<img src="${photoUrl}" referrerpolicy="no-referrer" onerror="this.remove();this.previousElementSibling.style.display=''" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top center;">` : ''}
        </div>`;
        cellContent = `
          <div style="display:flex;align-items:flex-start;gap:4px;height:100%;">
            ${headshot}
            <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between;height:100%;padding:2px 0;">
              <div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap;">
                <span class="pos-badge pos-${pos}" style="font-size:8px;padding:1px 3px;">${pos}</span>
                ${logoImg}
                <span class="g-board-team-badge" style="background:${teamColor};font-size:8px;">${teamAbbr}</span>
                <span class="g-board-pick-num" style="margin-left:auto">#${overall}</span>
              </div>
              <span class="g-board-player">${p.player_name}</span>
              </div>
            </div>
          </div>`;
      } else {
        cellContent = `<span class="g-board-pick-num" style="color:#d1d5db">#${overall}</span>`;
      }

      const cls = isCurrent ? 'g-board-cell g-board-current'
        : p?.player_name ? 'g-board-cell g-board-filled'
        : 'g-board-cell g-board-empty';

      const ctxMenu = (p?.player_name && window.__userRole === 'admin')
        ? `oncontextmenu="window.gShowRemoveMenu(event,${overall},'${p.player_name.replace(/'/g,"\\'")}');return false;"`
        : '';

      cells += `<td class="${cls}" style="${cellStyle}" ${ctxMenu}>${cellContent}</td>`;
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

// ── Available Players Page ────────────────────────────────────
async function renderAvailablePlayers() {
  const el = document.getElementById('page-available');
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

  _buildAvailableHTML(el);
  _ensureSubscription(window.state.guillotine.league.id);
}

function _buildAvailableHTML(el) {
  const { picks } = window.state.guillotine;
  const pool     = _guildPlayerPool(picks);
  const search   = window._gAvailSearch || '';
  const posOrder = ['QB','RB','WR','TE','K','DEF'];

  const groups = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
  for (const p of pool) {
    if (groups[p.pos]) groups[p.pos].push(p);
  }

  function buildCol(pos) {
    const pc      = _POS_COLOR[pos] || '#6b7280';
    const players = groups[pos] || [];
    const visible = search ? players.filter(p => p.name.toLowerCase().includes(search)) : players;
    const rows = visible.map(p => `
      <div class="g-pool-row" data-pos="${p.pos}" data-name="${p.name.toLowerCase()}"
           style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-bottom:1px solid #f3f4f6;">
        <span style="color:#9ca3af;font-size:10px;width:28px;flex-shrink:0;text-align:right;">${p.adp != null ? p.adp.toFixed(1) : '—'}</span>
        <span style="flex:1;font-size:12px;font-weight:500;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name}</span>
        <span style="font-size:10px;color:#9ca3af;flex-shrink:0;">${p.team}</span>
      </div>`).join('');

    return `
      <div style="display:flex;flex-direction:column;min-width:0;border-right:1px solid #e5e7eb;">
        <div style="padding:8px;background:${pc};color:#fff;font-size:11px;font-weight:700;letter-spacing:0.08em;display:flex;align-items:baseline;gap:6px;flex-shrink:0;">
          ${pos}
          <span style="font-weight:400;opacity:0.8;font-size:10px;">${visible.length}</span>
        </div>
        <div style="flex:1;overflow-y:auto;">
          ${rows || '<div style="padding:10px 8px;color:#9ca3af;font-size:12px;">None</div>'}
        </div>
      </div>`;
  }

  const cols = posOrder.map(buildCol).join('');

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;height:calc(100vh - 56px);">
      <div style="padding:8px 16px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:12px;background:#f9fafb;flex-shrink:0;">
        <input type="text" id="gAvailSearch" placeholder="Search players…"
          oninput="window.gAvailFilter()"
          value="${search}"
          style="border:1px solid #d1d5db;border-radius:6px;padding:7px 10px;font-size:13px;width:200px;">
        <span style="font-size:13px;color:#6b7280;">${pool.length} available</span>
      </div>
      <div style="flex:1;display:grid;grid-template-columns:repeat(6,1fr);overflow:hidden;">
        ${cols}
      </div>
    </div>`;
}

window.gAvailFilter = function() {
  const search = (document.getElementById('gAvailSearch')?.value || '').toLowerCase();
  window._gAvailSearch = search;
  if (window.state.guillotine) _buildAvailableHTML(document.getElementById('page-available'));
};

// ── Drafting Page ─────────────────────────────────────────────
async function renderDrafting() {
  const el = document.getElementById('page-drafting');
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

  _buildDraftingHTML(el);
  _ensureSubscription(window.state.guillotine.league.id);
}

function _buildDraftingHTML(el) {
  const { league, teams, picks } = window.state.guillotine;
  const uid     = _guildCurrentUserId();
  const cp      = league.current_pick;
  const isDone  = league.draft_status === 'complete' || cp > 196;
  const onClock = _guildCurrentOnClock(league, picks, teams);
  const pool    = _guildPlayerPool(picks);
  const colorMap = _ownerColorMap(teams);

  // Owner switcher: default to logged-in user, can act on behalf of any owner
  const allOwners = [...new Set(teams.map(t => t.owner_name))].sort();
  const actingAs  = window._gDraftActingAs || null;
  const myTeams   = (actingAs
    ? teams.filter(t => t.owner_name === actingAs)
    : teams.filter(t => t.owner_user_id === uid)
  ).sort((a, b) => a.draft_slot - b.draft_slot);
  const isMyTurn = !isDone && onClock && myTeams.some(t => t.id === onClock.id);

  // All remaining picks for the user's teams through end of draft
  const myAllPicks = [];
  for (const team of myTeams) {
    const futurePicks = picks
      .filter(p => p.team_id === team.id && !p.player_name && p.overall_pick >= cp)
      .sort((a, b) => a.overall_pick - b.overall_pick);
    for (const fp of futurePicks) {
      myAllPicks.push({ team, nextPick: fp.overall_pick, picksAway: fp.overall_pick - cp });
    }
  }
  myAllPicks.sort((a, b) => a.picksAway - b.picksAway);

  // Roster cards
  const rosterCardsHTML = myTeams.length
    ? myTeams.map(t => _buildRosterCard(t, picks, false, null, colorMap[t.owner_name])).join('')
    : `<div style="color:#9ca3af;font-size:14px;padding:20px;text-align:center;">
         Your teams aren't assigned yet.<br>Ask the admin to link your account.
       </div>`;

  // Player list with pick markers inserted at the right positions
  // picksAway=0 means it's literally your pick right now; marker goes before index 0.
  // picksAway=N means after N other picks you're on the clock; marker goes before index N.
  let playerListHTML = '';

  pool.forEach((p, idx) => {
    for (const m of myAllPicks) {
      if (m.picksAway === idx) {
        const mc = colorMap[m.team.owner_name] || '#1e3a5f';
        const round = Math.ceil(m.nextPick / 14);
        const label = m.picksAway === 0
          ? `🎯 ${m.team.team_name} — ON THE CLOCK! (Pick #${m.nextPick} · Rd ${round})`
          : `▶ ${m.team.team_name} — Pick #${m.nextPick} · Rd ${round} (${m.picksAway} away)`;
        playerListHTML += `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 16px;background:${mc}12;border-top:2px solid ${mc};border-bottom:1px solid ${mc}40;margin:2px 0;">
            <span style="font-size:11px;font-weight:700;color:${mc};letter-spacing:0.04em;">${label}</span>
          </div>`;
      }
    }

    playerListHTML += `
      <div data-player-row data-pos="${p.pos}" data-name="${p.name.toLowerCase()}"
           style="display:flex;align-items:center;gap:8px;padding:7px 16px;border-bottom:1px solid #f3f4f6;">
        <span style="color:#9ca3af;font-size:11px;width:34px;flex-shrink:0;text-align:right;">${p.adp != null ? p.adp.toFixed(1) : '—'}</span>
        <span class="pos-badge pos-${p.pos}">${p.pos}</span>
        <span style="flex:1;font-size:13px;font-weight:500;">${p.name}</span>
        <span style="font-size:12px;color:#9ca3af;margin-right:4px;">${p.team}</span>
        ${isMyTurn
          ? `<button class="g-pick-btn" onclick="window.gMakePick('${p.name.replace(/'/g,"\\'")}','${p.pos}')">Pick</button>`
          : `<span style="width:46px;display:inline-block;"></span>`}
      </div>`;
  });

  if (!playerListHTML) {
    playerListHTML = '<div style="padding:20px;color:#9ca3af;font-size:13px;">No players available.</div>';
  }

  const savedSearch = window._gDraftSearch || '';
  const savedPos    = window._gDraftPos    || 'ALL';

  el.innerHTML = `
    <div style="display:flex;height:calc(100vh - 56px);overflow:hidden;">

      <!-- Left: user's rosters -->
      <div style="width:300px;flex-shrink:0;overflow-y:auto;border-right:1px solid #e5e7eb;background:#f9fafb;">
        ${window.__userRole === 'admin' ? `
        <div style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">
          <div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:5px;">Commissioner — Managing</div>
          <select onchange="window.gDraftActingAs(this.value)"
            style="width:100%;border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;font-size:13px;font-weight:600;background:#fff;cursor:pointer;">
            <option value="">My Teams</option>
            ${allOwners.map(o => `<option value="${o}" ${actingAs === o ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
          ${actingAs ? `<div style="margin-top:5px;font-size:11px;color:#B51217;font-weight:700;">⚡ Picking for ${actingAs}</div>` : ''}
        </div>` : ''}
        <div style="padding:10px;">
          ${rosterCardsHTML}
        </div>
      </div>

      <!-- Right: player list -->
      <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">

        <!-- Status bar -->
        <div style="padding:8px 16px;border-bottom:1px solid #e5e7eb;background:#f9fafb;display:flex;align-items:center;gap:8px;flex-shrink:0;">
          ${isDone
            ? '<span style="font-size:13px;font-weight:700;color:#16a34a;">✅ Draft Complete</span>'
            : `<span style="font-size:13px;font-weight:600;color:#374151;">Pick ${cp} of 196</span>
               <span style="font-size:13px;color:#6b7280;">· Round ${Math.ceil(cp/14)}</span>
               ${onClock
                 ? `<span style="font-size:13px;color:#6b7280;margin-left:4px;">· On clock: <strong style="color:#374151;">${onClock.owner_name}</strong></span>`
                 : '<span style="font-size:13px;color:#6b7280;">· Draft pending</span>'}`}
          ${isMyTurn ? '<span style="background:#22a648;color:#fff;font-size:11px;font-weight:700;padding:2px 10px;border-radius:12px;margin-left:auto;">YOUR PICK</span>' : ''}
        </div>

        <!-- Search + pos filter -->
        <div style="padding:7px 16px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:10px;flex-shrink:0;background:#fff;">
          <input type="text" id="gDraftSearch" placeholder="Search players…"
            value="${savedSearch}"
            oninput="window.gDraftFilter()"
            autocomplete="off"
            style="border:1px solid #d1d5db;border-radius:6px;padding:6px 10px;font-size:13px;width:170px;outline:none;transition:box-shadow 0.15s;"
            onfocus="this.style.boxShadow='0 0 0 2px #6366f1'" onblur="this.style.boxShadow=''">
          <div class="g-pos-tabs">
            ${['ALL','QB','RB','WR','TE','K','DEF'].map(p =>
              `<button class="g-pos-tab ${savedPos === p ? 'active' : ''}" onclick="window.gDraftFilterPos('${p}')">${p}</button>`
            ).join('')}
          </div>
        </div>

        <div id="gDraftPlayerList" style="flex:1;overflow-y:auto;padding-bottom:16px;">
          ${playerListHTML}
        </div>
      </div>

    </div>`;

  // Apply any saved filter, then restore focus to search
  if (savedSearch || savedPos !== 'ALL') window.gDraftFilter();
  const searchEl = document.getElementById('gDraftSearch');
  if (searchEl) {
    searchEl.focus();
    searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);
  }
}

// ── Roster Card ───────────────────────────────────────────────
function _buildRosterCard(team, picks, showOwner, nextPick, headerColor) {
  const roster    = _guildRosterForTeam(team.id, picks);
  const nextLabel = nextPick != null ? `Pick #${nextPick}` : `Slot ${team.draft_slot}`;
  const bg        = headerColor || '#1e3a5f';
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

// ── Drafting page owner switcher ─────────────────────────────
window.gDraftActingAs = function(ownerName) {
  window._gDraftActingAs = ownerName || null;
  if (window.state.guillotine) _buildDraftingHTML(document.getElementById('page-drafting'));
};

// ── Drafting page filter handlers ────────────────────────────
window.gDraftFilter = function() {
  const search = (document.getElementById('gDraftSearch')?.value || '').toLowerCase();
  const pos    = window._gDraftPos || 'ALL';
  window._gDraftSearch = search;
  document.querySelectorAll('#gDraftPlayerList [data-player-row]').forEach(row => {
    const matchPos  = pos === 'ALL' || row.dataset.pos === pos;
    const matchName = !search || row.dataset.name.includes(search);
    row.style.display = matchPos && matchName ? '' : 'none';
  });
};

window.gDraftFilterPos = function(pos) {
  window._gDraftPos = pos;
  document.querySelectorAll('[onclick^="window.gDraftFilterPos"]').forEach(b => {
    b.classList.toggle('active', b.getAttribute('onclick') === `window.gDraftFilterPos('${pos}')`);
  });
  window.gDraftFilter();
  document.getElementById('gDraftSearch')?.focus();
};

// ── Pick handler ──────────────────────────────────────────────
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
    _reRenderCurrentPage();
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
  const colorMap = _ownerColorMap(teams);

  // Group by owner, preserve slot order within each owner
  const ownerMap = {};
  for (const t of [...teams].sort((a, b) => a.draft_slot - b.draft_slot)) {
    if (!ownerMap[t.owner_name]) ownerMap[t.owner_name] = [];
    ownerMap[t.owner_name].push(t);
  }

  const cols = Object.entries(ownerMap).map(([owner, ownerTeams]) => {
    const color = colorMap[owner];
    const teamCards = ownerTeams.map(t => {
      const roster = _guildRosterForTeam(t.id, picks);
      const rows = roster.map(({ slot, pick }) => `
        <div style="display:flex;align-items:center;gap:4px;padding:3px 8px;border-bottom:1px solid #f3f4f6;min-height:22px;">
          <span style="font-size:9px;font-weight:700;color:#9ca3af;width:28px;flex-shrink:0;">${slot}</span>
          ${pick
            ? `<span class="pos-badge pos-${pick.pos}" style="font-size:8px;padding:0 3px;line-height:14px;">${pick.pos}</span>
               <span style="font-size:11px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;">${pick.player_name}</span>`
            : `<span style="font-size:11px;color:#d1d5db;">—</span>`}
        </div>`).join('');

      return `
        <div style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:8px;">
          <div style="background:${color};padding:6px 8px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-size:12px;font-weight:700;color:#fff;">${t.team_name}</div>
              <div style="font-size:10px;color:rgba(255,255,255,0.7);">Slot ${t.draft_slot}</div>
            </div>
          </div>
          <div>${rows}</div>
        </div>`;
    }).join('');

    return `
      <div style="display:flex;flex-direction:column;min-width:0;">
        <div style="padding:6px 8px;font-size:11px;font-weight:700;color:#fff;background:${color};opacity:0.85;letter-spacing:0.05em;border-radius:4px 4px 0 0;text-align:center;margin-bottom:4px;">
          ${owner}
        </div>
        ${teamCards}
      </div>`;
  }).join('');

  el.innerHTML = `
    <div style="padding:12px 16px;overflow-y:auto;height:calc(100vh - 56px);">
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:10px;min-width:0;">
        ${cols}
      </div>
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
  const doneCount   = picks.filter(p => p.player_name).length;
  const statusColor = league.draft_status === 'active' ? '#22a648' : league.draft_status === 'complete' ? '#3b82f6' : '#f59e0b';
  const isPending   = league.draft_status === 'pending';
  const profileOptions = profiles.map(p => `<option value="${p.id}">${p.display_name}</option>`).join('');
  const profileMap  = {};
  profiles.forEach(p => profileMap[p.id] = p.display_name);
  window._gProfileMap = profileMap;

  const sorted   = [...teams].sort((a, b) => a.draft_slot - b.draft_slot);
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
    const slot    = parseInt(inp.dataset.slot);
    const ownerEl = document.querySelector(`.g-owner-name[data-slot="${slot}"]`);
    const idEl    = document.querySelector(`.g-owner-id[data-slot="${slot}"]`);
    teamsConfig.push({
      draft_slot:    slot,
      team_name:     inp.value.trim() || `Team ${slot}`,
      owner_name:    ownerEl?.value.trim() || `Owner ${slot}`,
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
    // Reset subscription so it re-subscribes to the same league
    _gChannel = null;
    showToast('Draft reset.');
    renderGuillotineSetup();
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
};

// ── Admin: remove pick context menu ──────────────────────────
(function _initRemoveMenu() {
  const menu = document.createElement('div');
  menu.id = 'gRemoveMenu';
  menu.style.cssText = `
    display:none;position:fixed;z-index:9999;
    background:#fff;border:1px solid #e5e7eb;border-radius:10px;
    box-shadow:0 8px 24px rgba(0,0,0,0.15);padding:16px 20px;min-width:240px;
  `;
  menu.innerHTML = `
    <div id="gRemoveMenuLabel" style="font-size:13px;font-weight:600;color:#111;margin-bottom:4px;"></div>
    <div id="gRemoveMenuSub"   style="font-size:11px;color:#6b7280;margin-bottom:14px;"></div>
    <div style="display:flex;gap:8px;">
      <button id="gRemoveYes" style="flex:1;background:#B51217;color:#fff;border:none;border-radius:6px;padding:8px;font-size:13px;font-weight:700;cursor:pointer;">Remove Pick</button>
      <button id="gRemoveNo"  style="flex:1;background:#f1f5f9;color:#374151;border:1px solid #e5e7eb;border-radius:6px;padding:8px;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>
    </div>`;
  document.body.appendChild(menu);

  document.getElementById('gRemoveNo').onclick  = () => { menu.style.display = 'none'; };
  document.addEventListener('click', e => { if (!menu.contains(e.target)) menu.style.display = 'none'; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') menu.style.display = 'none'; });
})();

window.gShowRemoveMenu = function(e, overallPick, playerName) {
  e.preventDefault();
  const menu = document.getElementById('gRemoveMenu');
  document.getElementById('gRemoveMenuLabel').textContent = playerName;
  document.getElementById('gRemoveMenuSub').textContent   = `Pick #${overallPick} · Round ${Math.ceil(overallPick / 14)}`;
  document.getElementById('gRemoveYes').onclick = () => {
    menu.style.display = 'none';
    window.gDoRemovePick(overallPick, playerName);
  };
  // Position near cursor, keep inside viewport
  const x = Math.min(e.clientX, window.innerWidth  - 260);
  const y = Math.min(e.clientY, window.innerHeight - 130);
  menu.style.left    = x + 'px';
  menu.style.top     = y + 'px';
  menu.style.display = 'block';
};

window.gDoRemovePick = async function(overallPick, playerName) {
  const g = window.state.guillotine;
  if (!g) return;
  try {
    await window.db.removeGuillotinePick(g.league.id, overallPick);
    // Optimistic update
    const pick = g.picks.find(p => p.overall_pick === overallPick);
    if (pick) { pick.player_name = null; pick.pos = null; }
    if (overallPick < g.league.current_pick) g.league.current_pick = overallPick;
    _reRenderCurrentPage();
    showToast(`Removed ${playerName}`);
  } catch(e) {
    showToast('Error: ' + e.message, 'error');
  }
};

// ── Boot ──────────────────────────────────────────────────────
window.appInit = function() {
  const startPage = _pageFromPath(location.pathname);
  navigate(startPage, false); // don't push — we're already on this URL
};

if (window.__appReady) window.appInit();
