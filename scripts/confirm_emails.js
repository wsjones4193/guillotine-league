import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://pannqrbdblrqpnsjuvfp.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhbm5xcmJkYmxycXBuc2p1dmZwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTMwNjA2MCwiZXhwIjoyMDk0ODgyMDYwfQ.QLZcH26L-1MC8fPGNd7cZMfrqr8hkkws4zEHGjFvkXg',
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const EMAILS = [
  'wsjones4193@gmail.com',
  'mzocco7@gmail.com',
  'b.geddes6@yahoo.com',
  'ccorbo2013@gmail.com',
  'bjrapoza93@msn.com',
  'tjsal@yahoo.com',
];

const { data: { users } } = await supabase.auth.admin.listUsers();

for (const email of EMAILS) {
  const user = users.find(u => u.email === email);
  if (!user) { console.log(`not found: ${email}`); continue; }
  const { error } = await supabase.auth.admin.updateUserById(user.id, { email_confirm: true });
  if (error) console.error(`error ${email}:`, error.message);
  else console.log(`confirmed: ${email}`);
}

console.log('Done.');
