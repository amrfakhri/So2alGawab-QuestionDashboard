'use strict';

/* =====================================================
   AUTH — Supabase Auth utilities
   Depends on: services/supabase.js loaded before this
===================================================== */

function _client() {
  if (!window._sb) {
    console.error('[Auth] Supabase client not available. Check CDN loading.');
    return null;
  }
  return window._sb;
}

const Auth = {
  _session: null,
  _role:    null,

  /* ---- Init: load session and listen for changes ---- */
  async init() {
    const sb = _client();
    if (!sb) return null;

    const { data: { session } } = await sb.auth.getSession();
    this._session = session;

    // Stamp last-seen so "Last Login" reflects real dashboard activity,
    // not just the last fresh password sign-in. Fire-and-forget.
    if (session) this._touchLastSeen();

    sb.auth.onAuthStateChange((_event, session) => {
      this._session = session;
      this._role = null;
    });

    return session;
  },

  /* ---- Record that the current user is active right now ---- */
  _touchLastSeen() {
    if (this._touchedLastSeen) return;   // once per page load is enough
    this._touchedLastSeen = true;
    const sb = _client();
    if (!sb) return;
    // rpc() returns a thenable query builder (no .catch); wrap it in a real
    // Promise. A missing touch_last_seen RPC surfaces as a resolved {error}.
    Promise.resolve(sb.rpc('touch_last_seen'))
      .then(({ error }) => { if (error) console.warn('[Auth] touch_last_seen failed:', error.message); })
      .catch(err => console.warn('[Auth] touch_last_seen failed:', err?.message || err));
  },

  /* ---- Guard: redirect to login if not authenticated ---- */
  async requireAuth(allowedRoles = null) {
    const session = await this.init();

    if (!session) {
      const redirect = encodeURIComponent(window.location.href);
      window.location.replace('./index.html?redirect=' + redirect);
      return null;
    }

    const role = await this.getRole();

    // Pending users: signed in but not yet approved
    if (role === 'pending') {
      window.location.replace('./index.html?pending=1');
      return null;
    }

    if (allowedRoles && !allowedRoles.includes(role)) {
      window.location.replace('./dashboard.html');
      return null;
    }

    return session;
  },

  /* ---- Get current session ---- */
  async getSession() {
    if (this._session) return this._session;
    const sb = _client();
    if (!sb) return null;
    const { data: { session } } = await sb.auth.getSession();
    this._session = session;
    return session;
  },

  /* ---- Get current user object ---- */
  async getUser() {
    const session = await this.getSession();
    return session?.user || null;
  },

  /* ---- Get role from user_roles table ---- */
  async getRole() {
    if (this._role) return this._role;
    const user = await this.getUser();
    if (!user) return null;
    this._role = await this._fetchRole(user.id);
    return this._role;
  },

  async _fetchRole(userId) {
    const sb = _client();
    if (!sb) return 'pending';
    try {
      const { data } = await sb
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .single();
      return data?.role || 'pending';
    } catch {
      return 'pending';
    }
  },

  async isSuperAdmin() {
    return (await this.getRole()) === 'super_admin';
  },

  async isAdmin() {
    const role = await this.getRole();
    return role === 'super_admin' || role === 'admin';
  },

  async canEdit() {
    const role = await this.getRole();
    return role === 'super_admin' || role === 'admin' || role === 'editor';
  },

  /* ---- Sign in with email/password ---- */
  async signIn(email, password) {
    const sb = _client();
    if (!sb) throw new Error('Supabase not loaded');
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this._session = data.session;
    this._role = null;
    return data;
  },

  /* ---- Sign out ---- */
  async signOut() {
    const sb = _client();
    if (sb) await sb.auth.signOut();
    this._session = null;
    this._role = null;
    window.location.replace('./index.html');
  },

  /* ---- Super-admin: list all users ---- */
  async getAllUsers() {
    const sb = _client();
    if (!sb) return [];
    const { data } = await sb
      .from('user_roles')
      .select('user_id, email, role, created_at')
      .order('created_at', { ascending: false });
    return data || [];
  },

  /* ---- Super-admin: update a user's role ---- */
  async setUserRole(userId, role) {
    const sb = _client();
    if (!sb) throw new Error('Supabase not loaded');
    const { error } = await sb
      .from('user_roles')
      .update({ role })
      .eq('user_id', userId);
    if (error) throw error;
  },

  /* ---- Call the admin-users Edge Function ---- */
  async callAdminFunction(action, params = {}) {
    const session = await this.getSession();
    if (!session) throw new Error('Not authenticated');
    const res = await fetch(`${window.SUPABASE_URL}/functions/v1/admin-users`, {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${session.access_token}`,
        'Content-Type':   'application/json',
        'apikey':         window.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ action, ...params }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  /* ---- Render a user info chip: email + role badge + sign-out ---- */
  renderUserChip(containerEl) {
    if (!containerEl) return;
    this.getUser().then(user => {
      if (!user) return;
      this.getRole().then(role => {
        const roleColor = {
          super_admin: { bg: 'rgba(251,191,36,0.15)',  color: '#fbbf24', border: 'rgba(251,191,36,0.4)'  },
          admin:       { bg: 'rgba(168,85,247,0.2)',   color: '#c084fc', border: 'rgba(168,85,247,0.4)'  },
          editor:      { bg: 'rgba(37,99,235,0.2)',    color: '#93c5fd', border: 'rgba(37,99,235,0.4)'   },
          viewer:      { bg: 'rgba(255,255,255,0.08)', color: '#94a3b8', border: 'rgba(255,255,255,0.12)' },
          pending:     { bg: 'rgba(245,158,11,0.15)',  color: '#fbbf24', border: 'rgba(245,158,11,0.4)'  },
        }[role] || { bg: 'rgba(255,255,255,0.08)', color: '#94a3b8', border: 'rgba(255,255,255,0.12)' };

        containerEl.innerHTML = `
          <span style="
            display:flex;align-items:center;gap:10px;
            background:rgba(255,255,255,0.05);
            border:1px solid rgba(255,255,255,0.1);
            border-radius:99px;padding:5px 14px 5px 10px;
          ">
            <span style="
              width:28px;height:28px;border-radius:50%;
              background:var(--gold-500,#f5c84b);color:var(--fg-on-gold,rgb(10,13,31));
              display:flex;align-items:center;justify-content:center;
              font-size:12px;font-weight:700;flex-shrink:0;
            ">${getInitials(user.user_metadata?.full_name, user.email)}</span>
            <span style="font-size:12px;color:#cbd5e1;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${user.email}</span>
            <span style="
              background:${roleColor.bg};color:${roleColor.color};
              border:1px solid ${roleColor.border};
              padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;
              text-transform:uppercase;letter-spacing:.04em;
            ">${role.replace('_', ' ')}</span>
          </span>
          <button onclick="Auth.signOut()" style="
            background:rgba(239,68,68,0.12);color:#f87171;
            border:1px solid rgba(239,68,68,0.3);border-radius:8px;
            padding:6px 12px;font-size:12px;font-weight:500;cursor:pointer;
            transition:.15s;white-space:nowrap;
          " onmouseover="this.style.background='rgba(239,68,68,0.2)'"
             onmouseout="this.style.background='rgba(239,68,68,0.12)'">
            Sign Out
          </button>
        `;
        containerEl.style.display = 'flex';
        containerEl.style.alignItems = 'center';
        containerEl.style.gap = '8px';
      });
    });
  }
};

window.Auth = Auth;

/* ---- Shared initials helper: "Amr Fakhri" → "AF", "Amr" → "A" ---- */
function getInitials(name, email) {
  const n = (name || '').trim();
  if (n) {
    const parts = n.split(/\s+/);
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0][0].toUpperCase();
  }
  return email ? email[0].toUpperCase() : '?';
}
window.getInitials = getInitials;
