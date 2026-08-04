import { supabase } from './supabase.js';
import { signInWithEmail, upsertProfile } from './auth.js';

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await upsertProfile(session);
    window.location.href = '/';
    return;
  }

  const form  = document.getElementById('loginForm');
  const email = document.getElementById('emailInput');
  const pass  = document.getElementById('passwordInput');
  const btn   = document.getElementById('loginBtn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    hideError();
    try {
      const session = await signInWithEmail(email.value.trim().toLowerCase(), pass.value);
      await upsertProfile(session);
      window.location.href = '/';
    } catch (err) {
      showError(err.message || 'Sign-in failed. Check your email and password.');
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.classList.add('visible');
}

function hideError() {
  document.getElementById('errorMsg').classList.remove('visible');
}

init();
