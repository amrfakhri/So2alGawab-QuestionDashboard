# Database Migration Plan — Supabase Project Move

Move the **entire** Supabase database from the current project to a new one.

| | Project ref | URL |
|---|---|---|
| **Source (old)** | `zsgmageagwaiqxotzmkr` | `https://zsgmageagwaiqxotzmkr.supabase.co` |
| **Target (new)** | `qtzdubdhbdvkvesltmkd` | `https://qtzdubdhbdvkvesltmkd.supabase.co` |

> ⚠️ **This database is shared by two projects:** this **dashboard** repo *and* the **game** project (separate repo). The migration moves the shared backend; **both** apps must be re-pointed at the new project at cutover. Game-side config changes are out of scope for this repo but are tracked in [§7](#7-app--config-changes).

---

## 1. Scope — what is being moved

Captured from the live source project:

### Public tables (19) — dashboard + game

| Domain | Tables |
|---|---|
| **Dashboard / content** | `lists`, `categories`, `questions`, `game_settings`, `question_metadata`, `question_media`, `question_plays`, `user_roles` |
| **Game / runtime** | `game_sessions`, `game_active_players`, `game_history`, `tv_devices`, `user_stats`, `friendships`, `online_rooms`, `online_room_players`, `online_room_questions`, `online_round_answers`, `room_invites` |

### Other database objects
- **Functions (9):** `cleanup_stale_players`, `get_active_players`, `get_top_played_categories`, `get_user_directory`, `get_user_role`, `handle_new_user`, `is_online_room_member`, `touch_last_seen`, `update_updated_at`
- **Enums (2):** `media_type_enum`, `question_status`
- **Triggers:** `lists.update_lists_updated_at`, `questions.update_questions_updated_at` (public) + `auth.users.on_auth_user_created` → `handle_new_user()`
- **Extensions:** `uuid-ossp`, `pgcrypto`, `pg_stat_statements`, `supabase_vault`
- **RLS policies** on every public table (see `user_roles.sql`, `fix_rls.sql`, and game-side migrations)

### Auth
- **`auth.users`: 4 users** (+ `auth.identities`). IDs must be preserved — they are foreign keys from `user_roles.user_id`, `lists.created_by/updated_by`, `question_media.uploaded_by`, and game tables.

### Storage
- **Bucket `question-media`** (public): **119 objects**. Both DB metadata (`storage.objects`) *and* the actual file bytes must be copied.

### Server-side
- **Edge Function:** `admin-users` (secrets: `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`; `SUPABASE_*` are auto-injected)
- **Auth config:** Site URL, Redirect URLs (`https://gamedata.amrfakhri.com/auth/callback`), SMTP, email templates (invite / recovery)

---

## 2. Credentials & tools needed before starting

Gather from **Dashboard → Project Settings** of *both* projects:

- [ ] **New anon (public) key** — `Settings → API`
- [ ] **New service_role key** — `Settings → API` (secret)
- [ ] **Old DB connection string** (`OLD_DB_URL`) — `Settings → Database → Connection string → URI`, direct connection (port `5432`), includes the DB password
- [ ] **New DB connection string** (`NEW_DB_URL`) — same, for the new project
- [ ] Resend API key + verified sender (already configured on old project — reuse the same values)

Tools: `supabase` CLI (already installed, authenticated), `psql`, `node`.

```bash
export OLD_DB_URL='postgresql://postgres:[PWD]@db.zsgmageagwaiqxotzmkr.supabase.co:5432/postgres'
export NEW_DB_URL='postgresql://postgres:[PWD]@db.qtzdubdhbdvkvesltmkd.supabase.co:5432/postgres'
export OLD_REF=zsgmageagwaiqxotzmkr
export NEW_REF=qtzdubdhbdvkvesltmkd
```

---

## 3. Key risks & decisions

| Risk | Mitigation |
|---|---|
| **Auth user IDs / passwords** must survive (FKs + login) | Dump & restore the `auth` schema **data**; preserves `id` and password hashes. Restore with triggers disabled (see §5.3) so `handle_new_user` doesn't double-insert `user_roles`. |
| **Storage file bytes** are not in Postgres | Copy objects separately (§5.4). DB-only restore leaves broken image links. |
| **JWT secret differs** between projects | All existing sessions become invalid → **every user must log in again** after cutover. Anon & service keys change everywhere they're hardcoded (§7). |
| **Shared with game project** | Coordinate a single cutover window; update **both** apps' config together. |
| **Downtime / split-brain** | Freeze writes during the dump→restore→verify window, or accept that writes to the old DB after the dump are lost. Pick a low-traffic window. |
| **Sequence drift** | `--use-copy` data dump preserves sequence values; verify after restore. |
| **RLS lockout** | Restore policies + the `get_user_role()` SECURITY DEFINER helper before testing as a non-service client. |

---

## 4. Pre-flight on the NEW project

1. Create/confirm the new project `qtzdubdhbdvkvesltmkd` exists and is on the **same Postgres major version** as the old one.
2. Enable required extensions (most are on by default; confirm):
   ```sql
   create extension if not exists "uuid-ossp";
   create extension if not exists pgcrypto;
   create extension if not exists pg_stat_statements;
   -- supabase_vault is managed by Supabase
   ```
3. Do **not** run `user_roles.sql` / other app migrations on the new project — the full schema dump in §5.2 supersedes them (running both will cause "already exists" conflicts).

---

## 5. Migration steps

### 5.1 Freeze & snapshot
- Announce a maintenance window. Optionally set the old project to read-only by pausing the game/dashboard writers, or just proceed and accept post-dump writes are dropped.
- Take a fresh Supabase backup of the **old** project (Dashboard → Database → Backups) as a safety net.

### 5.2 Dump roles + schema + data from OLD
```bash
# Roles (custom roles / grants)
supabase db dump --db-url "$OLD_DB_URL" -f roles.sql --role-only

# Full schema (public + auth + storage object definitions, functions, triggers, RLS, enums)
supabase db dump --db-url "$OLD_DB_URL" -f schema.sql

# Data only, COPY format (includes auth.users, auth.identities, storage.objects metadata)
supabase db dump --db-url "$OLD_DB_URL" -f data.sql --data-only --use-copy
```

### 5.3 Restore into NEW (triggers disabled during data load)
```bash
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file roles.sql \
  --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --dbname "$NEW_DB_URL"
```
`session_replication_role = replica` disables triggers during the data load so:
- `on_auth_user_created` does **not** fire and double-create `user_roles` rows, and
- `updated_at` triggers don't rewrite timestamps.

> If `roles.sql` errors on Supabase-managed roles, edit out those lines and re-run; managed roles already exist on the new project.

### 5.4 Copy storage files (119 objects in `question-media`)
The DB restore recreates the bucket + `storage.objects` rows, but **not** the file bytes. Copy them:

```bash
# Option A — Node script (bucket is public, so download by URL, re-upload with service key)
node migrate-storage.mjs   # see scaffold in §8
```
After copy, spot-check a few public URLs resolve on the new project and confirm bucket `question-media` is **public** with the same RLS policies.

### 5.5 Edge Functions + secrets
```bash
# Set secrets on the new project
supabase secrets set --project-ref $NEW_REF \
  RESEND_API_KEY='<same as old>' \
  NOTIFY_FROM_EMAIL='<same as old>'

# Deploy the function to the new project
supabase functions deploy admin-users --project-ref $NEW_REF
```
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected automatically per-project — do not set them manually.)

### 5.6 Replicate Auth settings on the NEW project (Dashboard → Authentication)
- **URL Configuration → Site URL:** `https://gamedata.amrfakhri.com`
- **Redirect URLs:** add `https://gamedata.amrfakhri.com/auth/callback` (and any game-project callback URLs)
- **SMTP:** re-enter the same custom SMTP used on the old project (invite/recovery emails depend on it)
- **Email templates:** copy the invite & recovery templates verbatim
- **Providers / JWT expiry:** match the old project's settings

---

## 6. Verification checklist (run before cutover)

Run against the **new** DB:
```bash
# Row counts should match the source (expected from current source):
# categories 99 · game_settings 617 · lists 9 · question_media 713 · questions 617
# question_metadata 617 · question_plays 180 · user_roles 4 · game_sessions 94 ...
supabase db query --linked "SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY 1;"

# Auth users present (4) and IDs preserved
supabase db query --linked "SELECT count(*) FROM auth.users;"

# Attribution FKs intact (no orphaned created_by/uploaded_by)
supabase db query --linked "SELECT count(*) FROM lists WHERE created_by NOT IN (SELECT id FROM auth.users);"

# Functions present (9) and RLS enabled on all public tables
```
Functional smoke test (point a local build at the new project — §7):
- [ ] Log in as super_admin (existing password works)
- [ ] Dashboard overview loads, KPIs + activity + categories populate
- [ ] Media library thumbnails load (storage bytes copied)
- [ ] Users screen lists 4 users; Reset Password sends an email
- [ ] Create/edit a list → attribution shows the editor
- [ ] Game project: start a session / room flow works end-to-end

---

## 7. App & config changes

> Apply these **at cutover**, after data is verified on the new project. Changing them earlier points the live apps at an empty DB.

### This repo (dashboard) — exact edits

**`services/supabase.js`** (lines 8–9):
```diff
- const SUPABASE_URL      = 'https://zsgmageagwaiqxotzmkr.supabase.co';
- const SUPABASE_ANON_KEY = 'eyJ...zsgmageagwaiqxotzmkr...';
+ const SUPABASE_URL      = 'https://qtzdubdhbdvkvesltmkd.supabase.co';
+ const SUPABASE_ANON_KEY = '<NEW ANON KEY>';
```

**`import_gamedata.mjs`** (lines 14–15): same URL + anon key swap.

**`.env.example`**: update `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the new values.

**`supabase/.temp/`** (CLI link): re-link the repo to the new project:
```bash
supabase link --project-ref qtzdubdhbdvkvesltmkd
```

**`.claude/settings.local.json`**: contains the old ref in a permission entry — harmless, update if desired.

> Note: `DEFAULT_REDIRECT` / `APP_URL` in `supabase/functions/admin-users/index.ts` point at the **app domain** (`gamedata.amrfakhri.com`), not the Supabase URL — they stay unchanged. Just ensure the new project's Redirect URLs allow them (§5.6).

After editing, **bump the cache-bust version** on the service scripts so browsers fetch the new client config (the repo uses `?v=YYYYMMDD` on `services/*.js` includes):
```bash
perl -pi -e 's/\?v=\d+"/?v=20260604"/g' *.html
```

### Game project (separate repo) — coordinate
- Swap its Supabase URL + anon key to the new project.
- Update any service_role usage / server env.
- Update its own Auth redirect URLs if different.
- Redeploy.

---

## 8. Storage copy script scaffold (`migrate-storage.mjs`)

```js
import { createClient } from '@supabase/supabase-js';
const OLD = createClient('https://zsgmageagwaiqxotzmkr.supabase.co', '<OLD_ANON>');
const NEW = createClient('https://qtzdubdhbdvkvesltmkd.supabase.co', '<NEW_SERVICE_ROLE>'); // service role to write
const BUCKET = 'question-media';

const { data: files } = await OLD.storage.from(BUCKET).list('', { limit: 10000 });
// NOTE: list() is non-recursive — walk subfolders (questions/<id>/images|video|audio)
for (const f of walkAll()) {                       // implement recursive walk
  const { data: blob } = await OLD.storage.from(BUCKET).download(f.path);
  await NEW.storage.from(BUCKET).upload(f.path, blob, { upsert: true, contentType: f.mime });
  console.log('copied', f.path);
}
```
Alternative: `rclone` with two Supabase S3-compatible remotes, or download via the public CDN URLs (bucket is public) and re-upload.

---

## 9. Cutover sequence

1. ✅ §5.2–§5.6 complete, §6 verification green on the new project.
2. Brief freeze: stop writers on the old project.
3. Final incremental data sync if writes happened since the dump (re-dump changed tables, or accept the gap).
4. Apply §7 config edits in **both** repos; deploy/publish.
5. Smoke-test production against the new project.
6. Announce completion. Users re-authenticate (new JWT secret).

---

## 10. Rollback

Until you're confident, **do not delete or pause the old project.** Rollback = revert the §7 config edits (point both apps back at `zsgmageagwaiqxotzmkr`) and redeploy. Because the old project is untouched by the migration (read-only dump), it remains a valid fallback. Keep it live for at least a few days post-cutover.

---

## 11. Post-migration cleanup (after a stable grace period)
- [ ] Remove/rotate the old project's keys from any external integrations.
- [ ] Update this repo's memory/docs to the new ref.
- [ ] Pause or delete the old Supabase project.
- [ ] Delete local dump artifacts (`roles.sql`, `schema.sql`, `data.sql`) — `data.sql` contains auth password hashes; **do not commit them.**
