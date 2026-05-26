# So2alGawab Question Dashboard — Feature Reference

Migration checklist for rebuilding this dashboard. Every feature, UI behaviour, and data operation is listed here.

---

## Pages

1. **Login** (`index.html`)
2. **Overview** (`dashboard.html`)
3. **Database / Editor** (`database.html`)
4. **Media Library** (`media.html`)
5. **Users** (`users.html`)
6. **Supabase Status** (`supabase-status.html`)

---

## 1. Login (`index.html`)

- Email + password sign-in with inline validation (6+ char minimum)
- Loading spinner on submit button
- Inline error / success alert messages
- **Set Password flow** — triggered when URL hash contains `#type=invite` or `#type=recovery`
  - Modal with new password + confirm fields (8+ chars, must match)
  - Labels differ for invite vs. recovery
  - Notifies super admins on new invite activation (fire-and-forget)
- **Pending account screen** — shown when `?pending=1` is in URL (approved but awaiting confirmation)
- **Expired/used link detection** — detects via hash params and shows appropriate message
- Auto-redirect to `?redirect=` param URL after login
- Session detection → auto-redirect authenticated users to dashboard

---

## 2. Overview (`dashboard.html`)

- Dropdown to select a question list from Supabase
- "Load List" button to fetch selected list
- "Upload JSON" button to browse a local JSON file for preview
- Quick link to Database page
- Auto-loads most recent list on init
- Supabase connection status indicator
- Questions grouped by category with category headings
- Per-question card shows:
  - Media preview (image / video / audio)
  - Points badge
  - Question type badge
  - Correct answer label
  - Audio player (if audio present)
  - Class and layout template metadata
- Empty state when no lists exist or upload pending

---

## 3. Database / Editor (`database.html`)

### 3.1 Lists View

- Search box to filter lists by title
- Sort dropdown: Last Updated / Date Created / Title A–Z / Most Questions
- "Import" button — bulk import JSON (creates new list or merges into existing)
- "Create List" button — modal for title input
- Lists displayed as cards showing:
  - Title + last-updated date
  - Question count + category count
  - "More" menu (rename, export, delete)
  - "Open" button

#### List actions
| Action | Behaviour |
|---|---|
| Create | Modal title input → new empty list |
| Rename | Modal title input → updates title |
| Delete | Confirmation dialog → removes list + all child data |
| Export JSON | Downloads list as game-ready JSON |
| Import JSON | Re-maps category IDs to prevent conflicts; shows imported question count |

---

### 3.2 Editor View (inside a list)

**Top bar**
- Breadcrumb: Database › List Title (click "Database" to go back to lists)
- Search input — filters questions by text, answer, or label
- Class filter — All / CLASS_200 / 400 / 600 / 800 / 1000
- Status filter — All / ACTIVE / INACTIVE
- Preview button — modal showing all questions grouped by category
- Import button — merge JSON into current list
- Export button — downloads current list as JSON
- "Add Question" button — opens question drawer

**Categories bar**
- "All" tab + one tab per category (shows question count)
- Drag categories left/right to reorder
- Per-category actions: rename (pencil), move to another list (arrow), delete (X)
- "+ Category" button — inline creation prompt

**Questions area**
- Toggle between Table view and Grid view
- "X questions" count display
- Bulk action bar (visible when items selected): Delete Selected
- Select-all checkbox

**Table view columns**
1. Drag handle + row checkbox
2. Question number (#)
3. Question text + correct answer preview
4. Category name
5. Class badge (colour-coded)
6. Points badge
7. Media thumbnail (image preview or type icon)
8. Status badge (ACTIVE / INACTIVE)
9. Row actions: edit, move, duplicate, delete

**Grid view card**
- Media preview
- Badges: class, points, category
- Question text
- Correct answer
- Action buttons: edit, move, duplicate, delete

---

### 3.3 Question Editor Drawer

Split layout — form on left, live preview on right.

**Question Content**
- Question text (required, RTL/Arabic support)
- Correct answer (required)

**Settings**
- Points (number, default 200, step 100)
- Category (required, dropdown from current list)
- Question type: Regular / Image / Video / Audio / MultiChoice
- Status: ACTIVE / INACTIVE

**Layout Template** — thumbnail selector (updates schematic preview in real-time)
1. Text Only — question + answer, no media
2. Media Top — media above question/answer
3. Large Answer — bigger answer area
4. Split View — media left, text right

**Media** (3 tabs: Images / Videos / Audio)
- Drag-drop or browse upload per type
- File limits: Images 10 MB (JPG/PNG/WEBP), Videos 100 MB (MP4/WEBM/MOV), Audio 25 MB (MP3/WAV/M4A)
- "Add URL" option instead of uploading
- Each item: thumbnail, filename, size, remove button
- Drag to reorder within type
- Count badge on each tab when items exist

**Correct Answer Media**
- External URL field
- Preview image shown when URL is populated

**Advanced** (collapsible section)
- Label (optional tag)
- Fix Question checkbox
- Duplicate Question checkbox
- Notes — add multiple via button, text inputs with remove
- Hint Question — JSON editor with validation hint
- Team Index (number 1–10, default 1)
- User ID (optional)

**Drawer actions**
- Cancel — closes drawer; prompts to clean up orphan uploaded files when adding a new question
- Save Question — validates required fields, creates/updates, persists to Supabase
- Unsaved indicator dot shown when form has changes

---

### 3.4 Move Question Modal

- Shows source list + category
- Step 1: select destination list
- Step 2: select destination category (loads dynamically after list chosen)
- Validation: both must be selected
- All media and metadata move with the question

---

### 3.5 Move Category Modal

- Shows category name, source list, question count
- Select destination list (disabled if only one list exists)
- All questions in the category move with it
- Warning displayed: "All questions in this category will move with it"

---

## 4. Media Library (`media.html`)

### Header stats
- Total files count
- Image count
- Audio count
- Video count
- Total storage size

### Upload zone (editor+ roles only)
- Upload purpose toggle: Questions / Game UI
- Drag-drop zone or click-to-browse
- Accepts: JPG, PNG, WEBP, SVG, MP3, WAV, M4A, MP4, WEBM, MOV
- Upload progress bar per file (filename + size shown)

### Recently Uploaded strip
- Last 24 hours, up to 12 items
- Horizontally scrollable
- Click item to open detail drawer

### Filter / search bar
- Search by filename or URL
- Type tabs: All / Images / Audio / Video
- Purpose tabs: All / Questions / Game UI
- "Unlinked" chip toggle — shows only unlinked files
- Sort dropdown: Newest / Oldest / Largest File
- View toggle: Grid ↔ List

### Bulk action bar (when items selected)
- Select-all checkbox
- "X items selected" counter
- Move to: Questions button, Game UI button
- Delete button (disabled for linked items)
- Clear selection button

### Grid view card
- Thumbnail (image preview or type icon)
- Type badge (IMAGE / AUDIO / VIDEO)
- Link indicator:
  - Green — linked to questions and/or category (shows count: "N Questions", "Category: Name", "NQ + Cat")
  - Gray "Not linked" — unlinked
- Filename (ellipsis)
- Hover overlay: size + link status
- Hover actions: View, Copy URL, Delete (only if unlinked)
- Checkbox (visible on hover or when selected)

### List view
- Columns: thumbnail, filename, date + link status, type badge, size, action buttons, checkbox

### Detail Drawer
Opened via "View" action.

**Preview**
- Image: full display
- Audio: native controls player
- Video: player with fullscreen support

**Info table**
- Filename, type, purpose, size, upload date, media URL (clickable + copyable)

**Actions**
- Copy URL
- Delete (disabled if linked)

**Linked Questions section** (purpose = question)
- List of all questions using this file — shows question text, correct answer, category, list
- Unlink button per question
- "Add Question Link" picker:
  - Search by text / answer / category / list
  - "Unlinked only" toggle
  - Click to select, then Link button

**Linked Category section** (if file is a category image)
- Shows category name + list
- "Remove as category image" button

**Set as Category Image** (purpose = game_ui, image type, storage-backed)
- Category picker dropdown grouped by list
- Set button

---

## 5. Users (`users.html`)

Access: super_admin only.

### Stats row (4 cards)
- Total Users
- Active
- Invited
- Disabled

### Filters
- Search by name or email
- Role filter: All / Super Admin / Admin / Editor / Viewer / Pending
- Status filter: All / Active / Invited / Disabled

### Users table columns
1. Avatar initial + name + email ("you" highlight on own row)
2. Role badge (pending shows "pending → target role")
3. Status badge: Active / Invited / Pending / Disabled
4. Invited date
5. Last login (relative: "5m ago", "Never", etc.)
6. Actions menu (three dots)

### Row action menu
| Action | Availability |
|---|---|
| Edit User | All users |
| Approve Access | Pending users only |
| Resend Invite | Invited users only |
| Reset Password | Active users only |
| Disable Account | Active users, not self |
| Enable Account | Disabled users, not self |
| Delete User | Not self |

### Invite / Edit User modal
- Fields: First Name, Last Name, Email (read-only in edit mode), Role dropdown (Viewer / Editor / Admin / Super Admin)
- Info banner on create explaining activation email flow
- Submit label: "Send Invite" (create) or "Save Changes" (edit)

### Reset Password modal
- Shows user email
- Generates one-time reset link asynchronously
- Link expires in 24 h, single use
- Copy button + instructions

### Confirm modal (generic, reused across all destructive actions)
- Customizable icon, title, body text
- Warning section for delete
- Cancel / action button (danger colour for delete/disable)
- Loading spinner on action button

---

## 6. Supabase Status (`supabase-status.html`)

- Refresh button + last-checked timestamp
- 4 summary cards: Database / Auth / Storage / Session (connected/error state + dot indicator)
- Database details: connection status, lists count, questions count, response time (ms)
- Auth details: user ID, email, role, session expiry
- Storage details: bucket name (`question-media`), access status
- Config details: Supabase URL, anon key prefix (first 16 chars)

---

## Sidebar (all pages except login)

- Logo (So2alGawab icon + text, links to dashboard)
- Nav items: Overview, Database, Media Library, [separator], Users (admin+ only), Supabase Status
- Active page indicator
- Supabase connection badge: Connecting / Connected / Offline
- User profile button (avatar initial + email + chevron) → dropdown:
  - Name + email header
  - Role badge
  - Sign Out button
- Mobile: hamburger menu + overlay; mobile title bar showing current page name

---

## Data Model

```
lists
└── categories (ordered by sort_order)
    └── questions
        ├── game_settings  (points, team_index, button_click, layout_template, class, status, sort_order)
        ├── question_metadata  (notes JSON, hints JSON)
        └── question_media  (type, url, file_path, file_name, mime_type, file_size, sort_order)
```

### Supabase tables
| Table | Key columns |
|---|---|
| `lists` | id, title, created_at, updated_at |
| `categories` | id, list_id, name, sort_order |
| `questions` | id, list_id, category_id, question, correct_answer, created_at, updated_at, deleted_at |
| `game_settings` | question_id, points, team_index, button_click, layout_template, class, status, sort_order |
| `question_metadata` | question_id, notes (JSON), hints (JSON) |
| `question_media` | id, question_id, media_type, media_url, file_path, file_name, mime_type, file_size, sort_order, created_at |
| `user_roles` | user_id, email, role, created_at |

- Storage bucket: `question-media`
- Questions support soft delete via `deleted_at` column
- File path pattern: `questions/{questionId}/{type}/{timestamp}-{random}.{ext}`

---

## Auth & Roles

| Role | Access |
|---|---|
| `super_admin` | All pages including Users |
| `admin` | All pages including Users |
| `editor` | Overview, Database, Media (upload enabled) |
| `viewer` | Overview, Database, Media (read-only) |
| `pending` | Redirected to pending screen |

- Auth via Supabase email/password + invite links
- Invite flow: link in email → set password modal → super admin notified
- Role-based route guards on every page load
- Admin operations (invite, approve, disable, delete) go through a Supabase Edge Function: `admin-users`

---

## Validation Rules

| Field | Rule |
|---|---|
| Email | HTML5 email type |
| Login password | 6+ characters |
| Set/reset password | 8+ characters, must match confirm field |
| Question text | Required |
| Correct answer | Required |
| Category | Required |
| Image files | JPG / PNG / WEBP / SVG, max 10 MB |
| Audio files | MP3 / WAV / M4A, max 25 MB |
| Video files | MP4 / WEBM / MOV, max 100 MB |
| Points | Number, step 100, used to derive class (200 → CLASS_200, etc.) |
| JSON import | Validated before processing |

---

## External Dependencies

| Dependency | Version / Source |
|---|---|
| Supabase JS SDK | v2 via jsDelivr CDN |
| Lucide Icons | latest via unpkg CDN |
| Google Fonts — IBM Plex Sans Arabic | weights 300–700 |

---

## UI Patterns to Replicate

- **Toasts** — success/error, 3.5 s auto-dismiss
- **Spinners** — on any async button action
- **Empty states** — dedicated UI when lists/questions/media are empty
- **Drag-and-drop** — categories reorder, question row reorder, media item reorder
- **Inline editing** — category rename, category add
- **Split drawer** — form + live preview side-by-side (question editor)
- **Bulk select** — checkbox per row + select all + bulk action bar
- **Multi-tab panels** — media type tabs, purpose tabs
- **View toggle** — grid ↔ table ↔ list depending on page
- **Confirm dialogs** — all destructive actions
- **Role-gated UI** — upload zone hidden for viewer, Users page hidden for non-admin
- **RTL support** — question text and answer fields