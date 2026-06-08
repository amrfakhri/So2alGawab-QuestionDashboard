# Lammah — Admin Dashboard

The internal admin & content dashboard for the **[Lammah](https://github.com/amrfakhri/lammah-game)**
trivia game. Staff use it to author question content, manage media, moderate
player-submitted content, view analytics, and administer staff accounts.

It is a **static, multi-page web app** (plain HTML + vanilla JS, no build step)
that talks directly to **Supabase**. An optional **Node/Express + SQLite** backend
provides a local Questions Manager API, and a **Supabase Edge Function** handles
privileged admin-user operations.

> **Shared backend:** this dashboard and the game point at the **same** Supabase
> project. The dashboard owns staff accounts (`user_roles`) and question content;
> the game owns player accounts (`profiles`). Both share `auth.users`, so the two
> user populations are separated by **role**, not by table — keep that in mind for
> any feature that lists users (see [Auth & Roles](#auth--roles)).

---

## Architecture

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  Static frontend (this repo) │  ───▶  │  Supabase                     │
│  *.html + services/*.js      │        │  • Postgres (content + roles) │
│  Supabase JS via CDN         │        │  • Auth (shared with game)    │
│                              │        │  • Storage (media)            │
└──────────────┬──────────────┘        │  • Edge Function: admin-users │
               │                        └──────────────────────────────┘
               │ (optional, local only)
               ▼
┌─────────────────────────────┐
│  backend/ — Express + SQLite │  Questions Manager API (localhost:3001)
└─────────────────────────────┘
```

### Pages (`*.html`)

| Page | Purpose |
|------|---------|
| `login.html` · `change-password.html` | Auth entry + password reset |
| `index.html` · `dashboard.html` | Landing / overview |
| `database.html` · `pools.html` | Question lists, categories, questions |
| `media.html` | Question media management (Supabase Storage) |
| `moderation.html` | Review player-submitted content |
| `players.html` | Game player insights |
| `users.html` | **Staff** account management (super_admin only) |
| `analytics.html` · `activity.html` · `runtime.html` | Stats & monitoring |
| `badges.html` · `settings.html` · `profile.html` | Awards, settings, own profile |
| `supabase-status.html` | Backend health check |

### Shared scripts (`services/`)

| File | Role |
|------|------|
| `supabase.js` | Supabase client + content queries (holds project URL + anon key) |
| `auth.js` | Session handling, role lookup, route guards, `callAdminFunction()` |
| `sidebar.js` | Shared navigation chrome |
| `mediaService.js` | Storage upload/management helpers |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Static HTML + vanilla JS (no bundler / no framework) |
| Supabase client | `@supabase/supabase-js` v2 loaded via CDN |
| Backend (DB) | Supabase Postgres + Row Level Security |
| Auth | Supabase Auth (shared with the game) |
| Media | Supabase Storage |
| Privileged ops | Supabase Edge Function (Deno) — `supabase/functions/admin-users` |
| Optional API | Node.js + Express 4 + SQLite (`backend/`) |
| Hosting | Static host / GitHub Pages — custom domain in `CNAME` |

---

## Prerequisites (new machine)

| Tool | Version | Needed for |
|------|---------|-----------|
| [Git](https://git-scm.com) | any | cloning |
| A static file server | any | serving the frontend locally (e.g. `npx serve`, `python3 -m http.server`, VS Code Live Server) |
| [Node.js](https://nodejs.org) | 18+ | only for the optional `backend/` API and tooling |
| [Supabase CLI](https://supabase.com/docs/guides/cli) | latest | only to deploy / run the `admin-users` Edge Function and SQL migrations |

> The frontend has **no build step and no npm install** — it's just HTML/JS served
> statically. You only need Node/Supabase CLI for the optional backend and the
> Edge Function.

---

## Getting Started

### 1. Clone

```bash
git clone https://github.com/amrfakhri/lammah-dashboard.git
cd lammah-dashboard
```

### 2. Run the frontend (static)

Open the app with any static server from the repo root — don't open the HTML files
via `file://` (Supabase auth redirects need an `http://` origin):

```bash
npx serve .            # → http://localhost:3000
# or
python3 -m http.server 8080
```

Then open `login.html` and sign in with a staff account.

> **Supabase config** lives in [`services/supabase.js`](services/supabase.js)
> (`SUPABASE_URL` + `SUPABASE_ANON_KEY`). The anon key is a publishable client key;
> access is enforced by Row Level Security + role checks, not key secrecy. To point
> at a different Supabase project, edit those two constants.

### 3. (Optional) Run the Questions Manager backend

A local Express + SQLite API used by some content tools. See
[`backend/README.md`](backend/README.md) for the full API reference.

```bash
cd backend
npm install
npm start            # → http://localhost:3001  (npm run dev for --watch)
```

To make the frontend use it, set the API base before the admin scripts load:

```html
<script>window.QUESTIONS_API_BASE = 'http://localhost:3001/api';</script>
```

If the backend is unreachable the frontend falls back to browser `localStorage`.

### 4. (Optional) Edge Function + database

```bash
# Deploy the privileged admin-users function
supabase functions deploy admin-users

# Run a SQL migration: paste the file into Supabase → SQL Editor, or use the CLI
```

Edge Function environment variables (set in the Supabase dashboard → Edge Functions):

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | Anon key (validates the caller) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role — server-side only, never shipped to the client |
| `RESEND_API_KEY` | Sends invite / approval / reset emails (optional) |
| `NOTIFY_FROM_EMAIL` | From-address for those emails (optional) |

---

## Auth & Roles

Roles live in `public.user_roles` (descending privilege):

```
super_admin > admin > editor > viewer > pending
```

- **Staff** are created via the **invite flow** (`users.html` → `admin-users`
  Edge Function `createUser`), which sets a `pending_role` until a super_admin
  approves them.
- **Game players** authenticate against the **same** `auth.users` table but are
  **not** staff. They appear in admin user lists only if a query enumerates all of
  `auth.users` — so any such query must filter to staff
  (`role <> 'pending' OR pending_role IS NOT NULL`). The `admin-users` `listUsers`
  action already does this.

See [`user_roles.sql`](user_roles.sql) for the RBAC schema, RLS policies, and the
`get_user_role()` helper.

---

## Database / SQL

SQL lives at the repo root and is applied via the Supabase SQL Editor:

| File | Purpose |
|------|---------|
| `schema.sql` | Core content schema (lists, categories, questions, media, …) |
| `user_roles.sql` | Auth/RBAC: `user_roles`, RLS policies, role helper |
| `fix_rls.sql` | RLS adjustments |
| `migration_*.sql` | Incremental migrations (active players, media v2/v3, activity attribution, question plays) |
| `migration_unshare_player_roles.sql` | Stops game players leaking into the staff Users screen |

See [`DATABASE_MIGRATION_PLAN.md`](DATABASE_MIGRATION_PLAN.md) for ordering/context.

---

## Deployment

The frontend is static and can be hosted anywhere (GitHub Pages, Netlify, any
static host). The custom domain is configured in [`CNAME`](CNAME). Deploying is a
matter of publishing the repo's static files; the Edge Function and SQL are
deployed separately to Supabase as described above.

---

## After Cloning — Setup Checklist (new machine)

1. `git clone https://github.com/amrfakhri/lammah-dashboard.git && cd lammah-dashboard`
2. Serve the frontend: `npx serve .` (or any static server) and open `login.html`
3. Confirm `services/supabase.js` points at the intended Supabase project
4. _(optional)_ Backend API: `cd backend && npm install && npm start`
5. _(optional)_ Install the Supabase CLI to deploy `admin-users` and run SQL migrations
```
