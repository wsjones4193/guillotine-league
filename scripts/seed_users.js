import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = 'https://pannqrbdblrqpnsjuvfp.supabase.co';
const SERVICE_ROLE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhbm5xcmJkYmxycXBuc2p1dmZwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTMwNjA2MCwiZXhwIjoyMDk0ODgyMDYwfQ.QLZcH26L-1MC8fPGNd7cZMfrqr8hkkws4zEHGjFvkXg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const USERS = [
  { email: 'wsjones4193@gmail.com',  display_name: 'Billy',   role: 'admin' },
  { email: 'mzocco7@gmail.com',      display_name: 'mzocco7' },
  { email: 'b.geddes6@yahoo.com',    display_name: 'bgeddes6' },
  { email: 'ccorbo2013@gmail.com',   display_name: 'ccorbo' },
  { email: 'bjrapoza93@msn.com',     display_name: 'bjrapoza' },
  { email: 'tjsal@yahoo.com',        display_name: 'tjsal' },
];

const PASSWORD = '2026Draft';

for (const u of USERS) {
  // Check if user already exists
  const { data: existing } = await supabase.auth.admin.listUsers();
  const found = existing?.users?.find(x => x.email === u.email);

  let userId;
  if (found) {
    console.log(`exists: ${u.email} — updating password`);
    const { error } = await supabase.auth.admin.updateUserById(found.id, { password: PASSWORD });
    if (error) { console.error(`  error updating ${u.email}:`, error.message); continue; }
    userId = found.id;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: u.email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) { console.error(`  error creating ${u.email}:`, error.message); continue; }
    userId = data.user.id;
    console.log(`created: ${u.email}`);
  }

  // Upsert guillotine_profiles row
  const { error: pe } = await supabase.from('guillotine_profiles').upsert({
    id:           userId,
    email:        u.email,
    display_name: u.display_name,
    role:         u.role || 'member',
  }, { onConflict: 'id' });

  if (pe) console.error(`  profile error for ${u.email}:`, pe.message);
  else     console.log(`  profile ok: ${u.email} (${u.role || 'member'})`);
}

console.log('\nDone.');
