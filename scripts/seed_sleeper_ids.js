// Fetches Sleeper player list and writes sleeper_id back to player_projections.
// Run after: ALTER TABLE player_projections ADD COLUMN IF NOT EXISTS sleeper_id text;

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://pannqrbdblrqpnsjuvfp.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhbm5xcmJkYmxycXBuc2p1dmZwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTMwNjA2MCwiZXhwIjoyMDk0ODgyMDYwfQ.QLZcH26L-1MC8fPGNd7cZMfrqr8hkkws4zEHGjFvkXg',
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Normalize a name for matching: lowercase, strip punctuation, collapse spaces
function norm(name) {
  return (name || '')
    .toLowerCase()
    .replace(/['.,-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Build secondary key: last + first initial (e.g. "hill t")
function shortKey(name) {
  const parts = norm(name).split(' ');
  if (parts.length < 2) return norm(name);
  return parts.slice(1).join(' ') + ' ' + parts[0][0];
}

console.log('Fetching Sleeper players...');
const res = await fetch('https://api.sleeper.app/v1/players/nfl');
const sleeperAll = await res.json();

// Build lookup maps: exact name → id, short key → id (prefer active/higher exp)
const byName  = new Map();
const byShort = new Map();

for (const [id, p] of Object.entries(sleeperAll)) {
  if (!p.full_name) continue;
  if (!['QB','RB','WR','TE','K','DEF'].includes(p.position)) continue;

  const key   = norm(p.full_name);
  const short = shortKey(p.full_name);

  // Prefer active players; on tie keep first seen
  const prefer = p.active || p.status === 'Active';
  if (!byName.has(key) || prefer) byName.set(key, { id, pos: p.position, active: prefer });
  if (!byShort.has(short) || prefer) byShort.set(short, { id, pos: p.position, active: prefer });
}

// Load all player_projections rows
console.log('Loading player_projections from Supabase...');
const { data: rows, error } = await supabase
  .from('player_projections')
  .select('id, player_name, pos')
  .is('sleeper_id', null);           // only rows not yet seeded

if (error) { console.error('Load error:', error.message); process.exit(1); }
console.log(`${rows.length} rows to process.`);

const updates = [];
const unmatched = [];

for (const row of rows) {
  const key   = norm(row.player_name);
  const short = shortKey(row.player_name);

  let match = byName.get(key) || byShort.get(short) || null;

  // If short key matched but position differs, distrust it
  if (match && !byName.has(key) && match.pos !== row.pos) match = null;

  if (match) {
    updates.push({ id: row.id, sleeper_id: match.id });
  } else {
    unmatched.push({ name: row.player_name, pos: row.pos });
  }
}

console.log(`Matched: ${updates.length} / ${rows.length}`);

// Write in batches of 50
const BATCH = 50;
let updated = 0;
for (let i = 0; i < updates.length; i += BATCH) {
  const batch = updates.slice(i, i + BATCH);
  const { error: ue } = await supabase
    .from('player_projections')
    .upsert(batch.map(u => ({ id: u.id, sleeper_id: u.sleeper_id })), { onConflict: 'id' });
  if (ue) console.error('Batch error:', ue.message);
  else updated += batch.length;
}

console.log(`\n✅ Updated ${updated} rows with Sleeper IDs.`);

if (unmatched.length) {
  console.log(`\n⚠️  ${unmatched.length} unmatched players (manual fix needed):`);
  for (const u of unmatched) console.log(`  ${u.pos}  ${u.name}`);
}
