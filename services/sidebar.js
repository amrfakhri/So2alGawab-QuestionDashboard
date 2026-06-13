'use strict';

/* =====================================================
   SIDEBAR — Shared navigation component
   Injects sidebar HTML into #appSidebar, sets active
   state, handles mobile toggle, and exposes setUser()
   for populating the user profile after auth.

   Depends on: lucide, Auth (for sign-out)
   Call:  Sidebar.init('page-id')           on DOMContentLoaded
          Sidebar.setUser(userObj, roleStr)  after Auth.requireAuth()
===================================================== */

const _NAV = [
  { id: 'overview', label: 'Overview',       icon: 'layout-dashboard', href: './dashboard.html'       },
  { id: 'database', label: 'Questions List',        icon: 'database',         href: './database.html'        },
  { id: 'media',         label: 'Media Library',    icon: 'images',       href: './media.html'           },
  { id: 'media-migrate', label: 'Media Migration', icon: 'cloud-upload', href: './media-migration.html',
    gateId: 'sbNavMediaMigrate', roles: ['admin','super_admin'] },
  { id: 'activity', label: 'Activity Log',     icon: 'history',          href: './activity.html'        },
  { id: 'players',  label: 'Game Players',     icon: 'gamepad-2',        href: './players.html'         },
  { id: 'analytics',label: 'Analytics',        icon: 'bar-chart-3',      href: './analytics.html',
    gateId: 'sbNavAnalytics', roles: ['admin','super_admin'] },
  { sep: true },
  { id: 'users',    label: 'Users',           icon: 'users',            href: './users.html',
    gateId: 'sbNavUsers', roles: ['admin','super_admin'] },
  { id: 'badges',   label: 'Badges',          icon: 'award',            href: './badges.html',
    gateId: 'sbNavBadges', roles: ['admin','super_admin'] },
  { id: 'moderation',label:'Moderation',       icon: 'shield-alert',     href: './moderation.html',
    gateId: 'sbNavModeration', roles: ['admin','super_admin'], badgeId: 'sbBadgeModeration' },
  { id: 'pools',    label: 'Category Pools',  icon: 'layers',           href: './pools.html',
    gateId: 'sbNavPools', roles: ['admin','super_admin'] },
  { id: 'settings', label: 'Game Settings',   icon: 'sliders-horizontal', href: './settings.html',
    gateId: 'sbNavSettings', roles: ['super_admin'] },
  { id: 'runtime',  label: 'Runtime / Live',  icon: 'power',            href: './runtime.html',
    gateId: 'sbNavRuntime', roles: ['admin','super_admin'] },
  { id: 'status',   label: 'Supabase Status', icon: 'activity',         href: './supabase-status.html' },
];

const Sidebar = {
  _activeId: null,

  /* ---- Build and inject sidebar HTML ---- */
  init(activeId) {
    this._activeId = activeId;

    const el = document.getElementById('appSidebar');
    if (!el) return;

    el.innerHTML = this._html(activeId);
    lucide.createIcons({ nodes: [el] });
    this._wire(el);

    /* Update mobile bar title to match the active page */
    const titleEl = document.getElementById('sbMobileTitle');
    if (titleEl) {
      const item = _NAV.find(n => n.id === activeId);
      if (item) titleEl.textContent = item.label;
    }

    /* Probe Supabase and update the connection badge on every page */
    this.checkConnection();
  },

  /* ---- Ping Supabase and reflect status in the footer badge ---- */
  async checkConnection() {
    const badge = document.getElementById('connBadge');
    const label = document.getElementById('connLabel');
    if (!badge || !label) return;

    let connected = false;
    try {
      const DB = window.SupabaseDB;
      if (DB && typeof DB.ping === 'function') {
        connected = await DB.ping();
      } else if (window._sb) {
        const { error } = await window._sb.from('app_config').select('key').limit(1);
        connected = !error;
      }
    } catch {
      connected = false;
    }

    badge.className   = 'sb-conn conn-badge ' + (connected ? 'connected' : 'local');
    label.textContent = connected ? 'Supabase Connected' : 'Offline';
  },

  /* ---- Build sidebar HTML string ---- */
  _html(activeId) {
    const navItems = _NAV.map(n => {
      if (n.sep) return '<div class="sb-sep"></div>';
      const active   = n.id === activeId ? ' active' : '';
      const hidden   = n.gateId         ? ' style="display:none"' : '';
      const idAttr   = n.gateId         ? ` id="${n.gateId}"`     : '';
      const badgeHtml = n.badgeId
        ? `<span class="sb-item-badge sb-item-badge-alert" id="${n.badgeId}" style="display:none">0</span>`
        : '';
      return `<a class="sb-item${active}" href="${n.href}"${idAttr}${hidden}>
        <i data-lucide="${n.icon}" class="icon-sm"></i>${n.label}${badgeHtml}</a>`;
    }).join('');

    return `
      <!-- Logo -->
      <a class="sb-logo" href="./dashboard.html">
        <img src="./assets/logo/logo-transparent.png" class="sb-logo-wordmark" alt="Lammah" />
      </a>

      <!-- Nav -->
      <nav class="sb-nav" id="sbNav">${navItems}</nav>

      <!-- Footer -->
      <div class="sb-footer">
        <!-- Supabase connection status (also used by database.html's updateConnBadge()) -->
        <a class="sb-conn conn-badge checking" id="connBadge" href="./supabase-status.html">
          <span class="conn-dot"></span>
          <span id="connLabel">Connecting…</span>
        </a>

        <!-- Notification bell (shown only for admin/super_admin after loadBadges) -->
        <div class="sb-notif-wrap" id="sbNotifWrap" style="display:none">
          <button class="sb-notif-btn" id="sbNotifBtn" type="button">
            <i data-lucide="bell" class="icon-xs"></i>
            <span>Notifications</span>
            <span class="sb-notif-dot" id="sbNotifDot" style="display:none"></span>
          </button>
          <div class="sb-notif-panel" id="sbNotifPanel">
            <div class="sb-notif-hd">
              <span class="sb-notif-title">Needs Attention</span>
              <button type="button" class="sb-notif-close" id="sbNotifClose">
                <i data-lucide="x" class="icon-xs"></i>
              </button>
            </div>
            <div class="sb-notif-list" id="sbNotifList">
              <div class="sb-notif-loading"><div class="spinner spinner-sm"></div></div>
            </div>
            <div class="sb-notif-ft" id="sbNotifFt">Last checked: —</div>
          </div>
        </div>

        <!-- User profile button -->
        <button class="sb-user" id="sbUserBtn" type="button">
          <div class="sb-avatar" id="sbAvatar">?</div>
          <div class="sb-user-info">
            <div class="sb-user-name"  id="sbUserName">Loading…</div>
            <div class="sb-user-email" id="sbUserEmail"></div>
          </div>
          <i data-lucide="chevrons-up-down" class="icon-xs sb-user-chevron"></i>
        </button>

        <!-- User dropdown menu -->
        <div class="sb-user-menu" id="sbUserMenu">
          <div class="sb-menu-header">
            <div class="sb-menu-header-name"  id="sbMenuName">—</div>
            <div class="sb-menu-header-email" id="sbMenuEmail">—</div>
          </div>
          <div class="sb-menu-role-wrap">
            <span class="sb-role" id="sbMenuRole"></span>
          </div>
          <a class="sb-menu-item" href="./profile.html">
            <i data-lucide="user-circle" class="icon-sm"></i> My Profile
          </a>
          <div class="sb-menu-sep"></div>
          <button class="sb-menu-item danger" id="sbSignOut" type="button">
            <i data-lucide="log-out" class="icon-sm"></i> Sign Out
          </button>
        </div>
      </div>`;
  },

  /* ---- Wire interactive behaviour ---- */
  _wire(el) {
    /* User menu toggle */
    const userBtn  = document.getElementById('sbUserBtn');
    const userMenu = document.getElementById('sbUserMenu');
    if (userBtn && userMenu) {
      userBtn.addEventListener('click', e => {
        e.stopPropagation();
        userMenu.classList.toggle('open');
      });
      document.addEventListener('click', () => userMenu.classList.remove('open'), { passive: true });
    }

    /* Sign-out */
    document.getElementById('sbSignOut')?.addEventListener('click', () => {
      if (window.Auth) Auth.signOut();
    });

    /* Notification bell toggle */
    const notifBtn   = document.getElementById('sbNotifBtn');
    const notifPanel = document.getElementById('sbNotifPanel');
    const notifClose = document.getElementById('sbNotifClose');
    if (notifBtn && notifPanel) {
      notifBtn.addEventListener('click', e => {
        e.stopPropagation();
        const opening = !notifPanel.classList.contains('open');
        notifPanel.classList.toggle('open');
        userMenu?.classList.remove('open');
        if (opening) this._markNotifSeen();
      });
      notifClose?.addEventListener('click', e => {
        e.stopPropagation();
        notifPanel.classList.remove('open');
      });
      document.addEventListener('click', () => notifPanel.classList.remove('open'), { passive: true });
    }

    /* Mobile: toggle sidebar open/closed */
    const toggle  = document.getElementById('sbToggle');
    const overlay = document.getElementById('sbOverlay');
    if (toggle)  toggle.addEventListener('click',  () => this._open());
    if (overlay) overlay.addEventListener('click', () => this._close());
  },

  _open() {
    document.getElementById('appSidebar')?.classList.add('open');
    document.getElementById('sbOverlay')?.classList.add('open');
  },
  _close() {
    document.getElementById('appSidebar')?.classList.remove('open');
    document.getElementById('sbOverlay')?.classList.remove('open');
  },

  /* ---- Notification badge + bell logic ---- */
  _userId: null,
  _counts: null,

  _notifKey() { return `lammah_notif_${this._userId || 'anon'}`; },

  _notifState() {
    try { return JSON.parse(localStorage.getItem(this._notifKey()) || '{}'); } catch { return {}; }
  },

  _saveNotifState(state) {
    try { localStorage.setItem(this._notifKey(), JSON.stringify(state)); } catch {}
  },

  _notifTotal(c) {
    return (c.open_question_reports || 0) + (c.open_player_reports || 0);
  },

  _markNotifSeen() {
    if (!this._counts) return;
    this._saveNotifState({ baseline: this._notifTotal(this._counts), checkedAt: new Date().toISOString() });
    const dot = document.getElementById('sbNotifDot');
    if (dot) dot.style.display = 'none';
    this._renderNotifFooter(new Date());
  },

  _renderNotifFooter(date) {
    const ft = document.getElementById('sbNotifFt');
    if (!ft) return;
    if (!date) { ft.textContent = 'Never checked'; return; }
    const diff = Math.round((Date.now() - new Date(date).getTime()) / 1000);
    const label = diff < 60  ? 'just now'
                : diff < 3600 ? `${Math.round(diff / 60)} min ago`
                : `${Math.round(diff / 3600)} hr ago`;
    ft.textContent = `Last checked: ${label}`;
  },

  async loadBadges(userId) {
    if (!window._sb) return;
    this._userId = userId;
    try {
      const { data, error } = await window._sb.rpc('get_admin_dashboard_counts');
      if (error || !data) return;
      this._counts = data;

      const totalOpen = (data.open_question_reports || 0) + (data.open_player_reports || 0);

      /* Moderation nav badge */
      const badge = document.getElementById('sbBadgeModeration');
      if (badge) {
        if (totalOpen > 0) {
          badge.textContent = totalOpen > 99 ? '99+' : String(totalOpen);
          badge.style.display = '';
        } else {
          badge.style.display = 'none';
        }
      }

      /* Bell unread dot: show when total exceeds what user last acknowledged */
      const wrap = document.getElementById('sbNotifWrap');
      if (wrap) wrap.style.display = '';

      const state = this._notifState();
      const baseline = state.baseline ?? -1;
      const dot = document.getElementById('sbNotifDot');
      if (dot) dot.style.display = (this._notifTotal(data) > baseline) ? '' : 'none';

      /* Pre-render panel content so it's ready when bell is clicked */
      this._renderNotifItems(data);
      this._renderNotifFooter(state.checkedAt ? new Date(state.checkedAt) : null);

      window.lucide && lucide.createIcons({ nodes: [document.getElementById('sbNotifPanel')] });
    } catch { /* silent — badge is purely cosmetic */ }
  },

  _renderNotifItems(counts) {
    const list = document.getElementById('sbNotifList');
    if (!list) return;

    const items = [];
    if (counts.open_question_reports > 0) {
      const n = counts.open_question_reports;
      items.push({ icon: 'flag',       dot: 'amber', href: './moderation.html',
        label: `${n} open question report${n !== 1 ? 's' : ''}` });
    }
    if (counts.open_player_reports > 0) {
      const n = counts.open_player_reports;
      items.push({ icon: 'user-x',    dot: 'amber', href: './moderation.html',
        label: `${n} open player report${n !== 1 ? 's' : ''}` });
    }
    if (counts.under_review > 0) {
      const n = counts.under_review;
      items.push({ icon: 'clock',      dot: 'gold',  href: './moderation.html',
        label: `${n} question${n !== 1 ? 's' : ''} under review` });
    }
    if (counts.disabled > 0) {
      const n = counts.disabled;
      items.push({ icon: 'ban',        dot: 'red',   href: './moderation.html',
        label: `${n} question${n !== 1 ? 's' : ''} disabled` });
    }

    if (items.length === 0) {
      list.innerHTML = `<div class="sb-notif-empty">
        <i data-lucide="check-circle" class="icon-lg"></i>
        <span>All clear — nothing needs attention</span>
      </div>`;
    } else {
      list.innerHTML = items.map(it => `
        <a class="sb-notif-item" href="${it.href}">
          <span class="sb-notif-dot-item ${it.dot}"></span>
          <i data-lucide="${it.icon}" class="icon-xs"></i>
          <span>${it.label}</span>
          <i data-lucide="chevron-right" class="icon-xs sb-notif-chevron"></i>
        </a>`).join('');
    }
  },

  /* ---- Populate user profile after auth resolves ---- */
  setUser(user, role) {
    if (!user) return;

    const email      = user.email || '';
    const name       = user.user_metadata?.full_name || email.split('@')[0] || 'User';
    const avatarUrl  = user.user_metadata?.avatar_url;
    const initials   = typeof getInitials === 'function' ? getInitials(name, email) : email[0]?.toUpperCase() || '?';

    /* Avatar — image if available, otherwise role-coloured initials */
    const avatarEl = document.getElementById('sbAvatar');
    if (avatarEl) {
      if (avatarUrl) {
        avatarEl.innerHTML = `<img src="${avatarUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`;
      } else {
        avatarEl.textContent = initials;
        const avatarColors = {
          super_admin: '#fbbf24',
          admin:       '#f97316',
          editor:      '#3b82f6',
          viewer:      '#64748b'
        };
        if (avatarColors[role]) avatarEl.style.background = avatarColors[role];
      }
    }

    /* Name + email in sidebar button */
    const nameEl  = document.getElementById('sbUserName');
    const emailEl = document.getElementById('sbUserEmail');
    if (nameEl)  nameEl.textContent  = name;
    if (emailEl) emailEl.textContent = email;

    /* Dropdown header */
    const mnEl = document.getElementById('sbMenuName');
    const meEl = document.getElementById('sbMenuEmail');
    if (mnEl) mnEl.textContent = name;
    if (meEl) meEl.textContent = email;

    /* Role badge */
    const roleEl = document.getElementById('sbMenuRole');
    if (roleEl) {
      roleEl.className  = 'sb-role ' + (role || '').replace('_', '-');
      roleEl.textContent = (role || '').replace('_', ' ').toUpperCase();
    }

    /* Show/hide role-gated nav items (driven by each item's `roles` list) */
    _NAV.forEach(n => {
      if (!n.gateId || !n.roles) return;
      const el = document.getElementById(n.gateId);
      if (el) el.style.display = n.roles.includes(role) ? 'flex' : 'none';
    });

    /* Load notification badges for admin roles */
    if (role === 'admin' || role === 'super_admin') {
      this.loadBadges(user.id);
    }
  }
};

window.Sidebar = Sidebar;
