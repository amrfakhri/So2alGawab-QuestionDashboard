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
  { id: 'database', label: 'Database',        icon: 'database',         href: './database.html'        },
  { id: 'media',    label: 'Media Library',   icon: 'images',           href: './media.html'           },
  { sep: true },
  { id: 'users',    label: 'Users',           icon: 'users',            href: './users.html',
    gateId: 'sbNavUsers', roles: ['admin','super_admin'] },
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
  },

  /* ---- Build sidebar HTML string ---- */
  _html(activeId) {
    const navItems = _NAV.map(n => {
      if (n.sep) return '<div class="sb-sep"></div>';
      const active  = n.id === activeId ? ' active' : '';
      const hidden  = n.gateId         ? ' style="display:none"' : '';
      const idAttr  = n.gateId         ? ` id="${n.gateId}"`     : '';
      return `<a class="sb-item${active}" href="${n.href}"${idAttr}${hidden}>
        <i data-lucide="${n.icon}" class="icon-sm"></i>${n.label}</a>`;
    }).join('');

    return `
      <!-- Logo -->
      <a class="sb-logo" href="./dashboard.html">
        <i data-lucide="gamepad-2" class="icon-lg sb-logo-icon"></i>
        <span class="sb-logo-text"><span>So2al</span>Gawab</span>
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

  /* ---- Populate user profile after auth resolves ---- */
  setUser(user, role) {
    if (!user) return;

    const email    = user.email || '';
    const initials = email ? email[0].toUpperCase() : '?';
    const name     = user.user_metadata?.full_name || email.split('@')[0] || 'User';

    /* Avatar initial */
    const avatarEl = document.getElementById('sbAvatar');
    if (avatarEl) {
      avatarEl.textContent = initials;
      /* Colour avatar by role */
      const avatarColors = {
        super_admin: '#fbbf24',
        admin:       '#f97316',
        editor:      '#3b82f6',
        viewer:      '#64748b'
      };
      if (avatarColors[role]) avatarEl.style.background = avatarColors[role];
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

    /* Show/hide role-gated nav items */
    const isAdmin = ['admin', 'super_admin'].includes(role);
    const usersEl = document.getElementById('sbNavUsers');
    if (usersEl) usersEl.style.display = isAdmin ? 'flex' : 'none';
  }
};

window.Sidebar = Sidebar;
