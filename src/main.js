import { supabase } from './supabase.js';
import { getSession, upsertProfile, signOut, getUserRole } from './auth.js';
import * as db from './db.js';

window.db           = db;
window.cloudSignOut = signOut;

document.addEventListener('DOMContentLoaded', async () => {
  const overlay = document.getElementById('loadingOverlay');
  const hideOverlay = () => { if (overlay) overlay.style.display = 'none'; };

  try {
    const session = await getSession();

    if (!session) {
      window.location.href = '/login.html';
      return;
    }

    const role = await getUserRole(session.user.id);
    await upsertProfile(session);

    const displayName = session.user.user_metadata?.full_name || session.user.email.split('@')[0];
    db.setCurrentUser(session.user.id, displayName, role);

    const nameEl = document.getElementById('userDisplayName');
    if (nameEl) nameEl.textContent = displayName;

    // Show admin-only nav items
    if (role === 'admin') {
      document.querySelectorAll('[data-admin]').forEach(el => el.style.display = '');
    }

    // Load players + ADP for draft pool
    await db.loadPlayersAndAdp();


    window.__appReady = true;
    window.__userRole = role;
    hideOverlay();

    // Boot the app
    if (typeof window.appInit === 'function') window.appInit();

  } catch (err) {
    console.error('Init failed:', err);
    if (overlay) {
      overlay.innerHTML = `
        <div style="color:#ef4444;text-align:center;padding:40px;font-family:system-ui;">
          <div style="font-size:24px;margin-bottom:12px;">⚠️</div>
          <div style="font-weight:700;">Failed to load</div>
          <div style="color:#9ca3af;font-size:13px;margin-top:8px;">${err.message}</div>
          <button onclick="location.reload()" style="margin-top:20px;background:#1CA4DF;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer;">Retry</button>
        </div>`;
    }
  }
});
