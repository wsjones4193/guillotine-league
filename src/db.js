import { supabase } from './supabase.js';

let _userId   = null;
let _userName = null;
let _userRole = null;

export function setCurrentUser(id, displayName, role = null) {
  _userId   = id;
  _userName = displayName;
  _userRole = role;
}

export function getCurrentUserId()   { return _userId; }
export function getCurrentUserRole() { return _userRole; }

// ---------------------------------------------------------------------------
// Boot: load players + ADP into window globals for the draft pool
// ---------------------------------------------------------------------------
export async function loadPlayersAndAdp() {
  // Load players from most recent projection set
  const { data: sets } = await supabase
    .from('projection_sets')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1);

  if (sets?.length) {
    const setId = sets[0].id;
    const { data: playerRows } = await supabase
      .from('player_projections')
      .select('player_name, pos, team_abbr, rank')
      .eq('set_id', setId);

    if (playerRows && window.NFL_DATA) {
      const buckets = { QB: [], RB: [], WR: [], TE: [] };
      for (const row of playerRows) {
        const pos = row.pos;
        if (!buckets[pos]) continue;
        buckets[pos].push({
          name: row.player_name,
          team: row.team_abbr === 'UNALLOCATED' ? '' : (row.team_abbr || ''),
          pos,
          rank: row.rank || 0,
        });
      }
      for (const pos of Object.keys(buckets)) {
        buckets[pos].sort((a, b) => (a.rank || 0) - (b.rank || 0));
        window.NFL_DATA.players[pos] = buckets[pos];
      }
    }
  }

  // Load ADP
  const { data: adpRows } = await supabase
    .from('adp')
    .select('full_name, adp')
    .order('adp', { ascending: true });

  if (adpRows) {
    window.ADP_DATA = adpRows.map(r => ({ fullName: r.full_name, adp: r.adp }));
  }
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
export async function loadProfiles() {
  const { data, error } = await supabase
    .from('guillotine_profiles')
    .select('id, display_name')
    .order('display_name');
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------------------
// Guillotine League
// ---------------------------------------------------------------------------
export async function loadGuillotineLeague() {
  const { data: leagues, error: le } = await supabase
    .from('guillotine_league')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);
  if (le) throw le;
  const league = leagues?.[0];
  if (!league) return null;

  const { data: teams,  error: te } = await supabase.from('guillotine_teams').select('*').eq('league_id', league.id).order('draft_slot');
  const { data: picks,  error: pe } = await supabase.from('guillotine_picks').select('*').eq('league_id', league.id).order('overall_pick');
  if (te) throw te;
  if (pe) throw pe;
  return { league, teams: teams || [], picks: picks || [] };
}

export async function createGuillotineLeague(name, teamsConfig) {
  const { data: leagueRows, error: le } = await supabase
    .from('guillotine_league')
    .insert({ name, draft_status: 'active', current_pick: 1 })
    .select();
  if (le) throw le;
  const league = leagueRows[0];

  const NUM_TEAMS  = teamsConfig.length;
  const NUM_ROUNDS = 14;

  const teamRows = teamsConfig.map(t => ({
    league_id:     league.id,
    draft_slot:    t.draft_slot,
    team_name:     t.team_name,
    owner_name:    t.owner_name,
    owner_user_id: t.owner_user_id || null,
  }));
  const { data: insertedTeams, error: te } = await supabase.from('guillotine_teams').insert(teamRows).select();
  if (te) throw te;

  const slotToTeam = {};
  for (const t of insertedTeams) slotToTeam[t.draft_slot] = t.id;

  const pickRows = [];
  for (let round = 1; round <= NUM_ROUNDS; round++) {
    for (let slot = 1; slot <= NUM_TEAMS; slot++) {
      const pickInRound = (round % 2 === 1) ? slot : (NUM_TEAMS + 1 - slot);
      const overall = (round - 1) * NUM_TEAMS + slot;
      pickRows.push({
        league_id:    league.id,
        team_id:      slotToTeam[pickInRound],
        overall_pick: overall,
        round,
        pick_in_round: slot,
      });
    }
  }
  const BATCH = 100;
  for (let i = 0; i < pickRows.length; i += BATCH) {
    const { error: pe } = await supabase.from('guillotine_picks').insert(pickRows.slice(i, i + BATCH));
    if (pe) throw pe;
  }
  return { league, teams: insertedTeams, picks: pickRows };
}

export async function makeGuillotinePick(leagueId, overallPick, playerName, pos) {
  const now = new Date().toISOString();
  const { error: pe } = await supabase
    .from('guillotine_picks')
    .update({ player_name: playerName, pos, picked_at: now, picked_by_id: _userId, picked_by_name: _userName })
    .eq('league_id', leagueId)
    .eq('overall_pick', overallPick);
  if (pe) throw pe;

  const { error: le } = await supabase
    .from('guillotine_league')
    .update({ current_pick: overallPick + 1 })
    .eq('id', leagueId);
  if (le) throw le;
}

export async function updateGuillotineTeam(teamId, fields) {
  const { error } = await supabase.from('guillotine_teams').update(fields).eq('id', teamId);
  if (error) throw error;
}

export async function updateGuillotineLeague(leagueId, fields) {
  const { error } = await supabase.from('guillotine_league').update(fields).eq('id', leagueId);
  if (error) throw error;
}

export function subscribeToLeague(leagueId, onChange) {
  const channel = supabase
    .channel(`league-${leagueId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'guillotine_picks',
      filter: `league_id=eq.${leagueId}`,
    }, onChange)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'guillotine_league',
      filter: `id=eq.${leagueId}`,
    }, onChange)
    .subscribe();
  return channel;
}

export function unsubscribeLeague(channel) {
  if (channel) supabase.removeChannel(channel);
}

export async function loadSleeperIds() {
  const CACHE_KEY = 'sleeper_ids_v1';
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { data, ts } = JSON.parse(cached);
      if (Date.now() - ts < CACHE_TTL) { window.SLEEPER_IDS = data; return; }
    }
    const res = await fetch('https://api.sleeper.app/v1/players/nfl');
    const all = await res.json();
    const map = {};
    for (const [id, p] of Object.entries(all)) {
      if (p.full_name && (p.active || p.years_exp <= 3)) {
        map[p.full_name.toLowerCase()] = id;
      }
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: map, ts: Date.now() }));
    window.SLEEPER_IDS = map;
  } catch (_) {}
}

export async function resetGuillotineDraft(leagueId) {
  const { error: pe } = await supabase
    .from('guillotine_picks')
    .update({ player_name: null, pos: null, picked_at: null, picked_by_id: null, picked_by_name: null })
    .eq('league_id', leagueId);
  if (pe) throw pe;

  const { error: le } = await supabase
    .from('guillotine_league')
    .update({ draft_status: 'pending', current_pick: 1 })
    .eq('id', leagueId);
  if (le) throw le;
}
