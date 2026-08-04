import { supabase } from './supabase.js';

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = '/login.html';
}

export async function upsertProfile(session) {
  const user = session.user;
  await supabase.from('guillotine_profiles').upsert({
    id:           user.id,
    email:        user.email,
    display_name: user.user_metadata?.display_name || user.email.split('@')[0],
  }, { onConflict: 'id' });
}

export async function getUserRole(userId) {
  const { data } = await supabase
    .from('guillotine_profiles')
    .select('role')
    .eq('id', userId)
    .single();
  return data?.role === 'admin' ? 'admin' : null;
}
