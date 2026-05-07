'use strict';

/* =====================================================
   AUTH — Supabase Auth utilities
   Depends on: services/supabase.js loaded before this
===================================================== */

const Auth = {
  _session: null,
  _role:    null,

  /* ---- Init: load session and listen for changes ---- */
  async init() {
    const { data: { session } } = await window._sb.auth.getSession();
    this._session = session;

    window._sb.auth.onAuthStateChange((_event, session) => {
      this._session = session;
      this._role = null; // invalidate cached role on any auth change
    });

    return session;
  },

  /* ---- Guard: redirect to login if not authenticated ---- */
  async requireAuth(allowedRoles = null) {
    const session = await this.init();

    if (!session) {
      const redirect = encodeURIComponent(window.location.href);
      window.location.replace('./index.html?redirect=' + redirect);
      return null;
    }

    if (allowedRoles) {
      const role = await this.getRole();
      if (!allowedRoles.includes(role)) {
        window.location.replace('./dashboard.html');
        return null;
      }
    }

    return session;
  },

  /* ---- Get current session ---- */
  async getSession() {
    if (this._session) return this._session;
    const { data: { session } } = await window._sb.auth.getSession();
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
    try {
      const { data } = await window._sb
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .single();
      return data?.role || 'viewer';
    } catch {
      return 'viewer';
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
    const { data, error } = await window._sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this._session = data.session;
    this._role = null;
    return data;
  },

  /* ---- Sign up new user ---- */
  async signUp(email, password) {
    const { data, error } = await window._sb.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  },

  /* ---- Sign out ---- */
  async signOut() {
    await window._sb.auth.signOut();
    this._session = null;
    this._role = null;
    window.location.replace('./index.html');
  },

  /* ---- Render a user info chip: email + role badge + sign-out ---- */
  renderUserChip(containerEl) {
    if (!containerEl) return;
    this.getUser().then(user => {
      if (!user) return;
      this.getRole().then(role => {
        containerEl.innerHTML = `
          <span style="
            display:flex;align-items:center;gap:10px;
            background:rgba(255,255,255,0.05);
            border:1px solid rgba(255,255,255,0.1);
            border-radius:99px;padding:5px 14px 5px 10px;
          ">
            <span style="
              width:28px;height:28px;border-radius:50%;
              background:var(--blue,#2563eb);
              display:flex;align-items:center;justify-content:center;
              font-size:12px;font-weight:700;flex-shrink:0;
            ">${user.email[0].toUpperCase()}</span>
            <span style="font-size:12px;color:#cbd5e1;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${user.email}</span>
            <span style="
              background:${role==='super_admin'?'rgba(251,191,36,0.15)':role==='admin'?'rgba(168,85,247,0.2)':role==='editor'?'rgba(37,99,235,0.2)':'rgba(255,255,255,0.08)'};
              color:${role==='super_admin'?'#fbbf24':role==='admin'?'#c084fc':role==='editor'?'#93c5fd':'#94a3b8'};
              border:1px solid ${role==='super_admin'?'rgba(251,191,36,0.4)':role==='admin'?'rgba(168,85,247,0.4)':role==='editor'?'rgba(37,99,235,0.4)':'rgba(255,255,255,0.12)'};
              padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;
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
