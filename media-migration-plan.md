# External Media Migration Plan

## Goal

Move all question media that is currently served from the external CDN
(`d442zbpa1tgal.cloudfront.net`) into Supabase Storage (`question-media` bucket)
and update every database record that points to the old URL so that linkage
to questions is fully preserved after migration.

---

## Where External Media Lives in the DB

Two independent storage locations need to be migrated:

### 1. `question_media` table (question/answer media rows)

Rows where `file_path IS NULL` AND `media_url` contains the CloudFront domain.
These are rows that were imported before the Supabase media library existed.

**Detection query:**
```sql
SELECT id, question_id, media_type, media_url, media_purpose
FROM question_media
WHERE file_path IS NULL
  AND media_url LIKE '%d442zbpa1tgal.cloudfront.net%';
```

After migration each row will have:
- `media_url` → new Supabase Storage public URL
- `file_path` → storage path inside the `question-media` bucket
- `file_name` → filename extracted from original URL
- `mime_type` → inferred from file extension
- `file_size` → actual byte size after fetch

### 2. `question_metadata.hints.correctAnswerMedia` (JSONB field)

The answer media URL is stored as a plain string inside the `hints` JSONB column.
It is NOT a row in `question_media` — it lives entirely in `question_metadata`.

**Detection query:**
```sql
SELECT question_id, hints->>'correctAnswerMedia' AS answer_media_url
FROM question_metadata
WHERE hints->>'correctAnswerMedia' LIKE '%d442zbpa1tgal.cloudfront.net%';
```

After migration each row will have its JSONB updated:
```sql
UPDATE question_metadata
SET hints = jsonb_set(hints, '{correctAnswerMedia}', '"<new_supabase_url>"')
WHERE question_id = '<id>';
```

---

## Storage Path Convention

| Media origin | Bucket path format |
|---|---|
| `question_media` (any purpose) | `questions/{question_id}/{dir}/{timestamp}-{random}.{ext}` |
| `hints.correctAnswerMedia` | `answer-media/{uuid}.{ext}` |

Where `{dir}` = `images` / `video` / `audio` based on `media_type`.

This matches exactly what the existing `MediaService.uploadFile()` and the
dashboard answer-media uploader already use.

---

## Migration Tool

A new self-contained dashboard page: **`media-migration.html`**

### UI Sections

**1. Audit Panel (read-only scan)**
- Button: "Scan Database"
- Shows count of external URLs found in both sources
- Renders a table with columns: Source | Question ID | Question text (truncated) | Current URL | Media type | Status
- Status badge: `pending` / `in progress` / `done` / `error`

**2. Migration Controls**
- "Migrate All" button — processes the full list sequentially with a progress bar
- "Retry Failed" button — re-runs only errored items
- Per-row "Migrate" button for individual items
- Rate limit: process 1 item at a time to avoid storage quota spikes

**3. Verification Panel**
- After migration completes, runs a re-scan
- Shows: total migrated / total remaining external / any broken links
- "Export report" downloads a JSON summary of before/after URLs

---

## Per-Item Migration Steps

For each external URL (both sources use the same steps 1–4):

```
1. Fetch file from external URL
   - Use fetch() with a 30s timeout
   - On 4xx/5xx: mark as error, record HTTP status, skip

2. Detect MIME type + extension
   - From Content-Type response header (preferred)
   - Fallback: infer from URL extension
   - Supported: jpg/jpeg/png/webp/gif → image, mp4/webm/mov → video,
     mp3/wav/m4a/ogg/aac → audio

3. Upload to Supabase Storage
   - Build storage path based on source (see path convention above)
   - Call sb.storage.from('question-media').upload(path, blob, { upsert: false })
   - Get public URL via sb.storage.from('question-media').getPublicUrl(path)

4. Update the database record
   - For question_media rows:
     UPDATE question_media SET
       media_url  = '<new_url>',
       file_path  = '<storage_path>',
       file_name  = '<original_filename>',
       mime_type  = '<mime>',
       file_size  = <bytes>
     WHERE id = '<row_id>';
   - For hints.correctAnswerMedia:
     UPDATE question_metadata SET
       hints = jsonb_set(hints, '{correctAnswerMedia}', '"<new_url>"')
     WHERE question_id = '<id>';

5. Verify linkage
   - Re-fetch the updated row / JSONB
   - Confirm the URL is now the Supabase URL
   - Confirm question_id is still correctly set (question_media rows)
   - Mark as done
```

---

## Question Linkage Safety

The migration must **never break the question ↔ media relationship**.

Guarantees built into the approach:

- `question_media` rows: we update `media_url` and `file_path` **in-place** using
  the row's existing `id`. The `question_id` FK is never touched.
- `hints.correctAnswerMedia`: we use `jsonb_set` with a targeted key path so all
  other hint fields (`hintQuestion`, `questionTypeView`, `label`, etc.) are
  untouched.
- No deletes occur during migration. The old CloudFront URL is replaced, not removed,
  giving a single atomic update per record.
- If the fetch fails (network error or CDN returns 404), the row is left unchanged
  and flagged as `error`. The question still works — it just still points to the
  old external URL.

---

## Rollback

There is no automated rollback (we are not deleting the CloudFront files).

If a migration step produces a broken URL:
- Find the item in the Audit Panel (it shows the original URL)
- Manually update `media_url` / `hints.correctAnswerMedia` back to the CloudFront URL
- OR re-run migration for that specific item

The CloudFront CDN remains live throughout, so questions remain playable even if
migration of individual items fails.

---

## Implementation Steps

1. [ ] Create `media-migration.html` in `lammah-dashboard/`
2. [ ] Add scan logic: query both `question_media` and `question_metadata` for external URLs
3. [ ] Build item list renderer with status badges
4. [ ] Implement `migrateItem(item)` function (fetch → upload → update → verify)
5. [ ] Wire up "Migrate All" sequential loop with progress bar
6. [ ] Wire up per-row "Migrate" and "Retry Failed" buttons
7. [ ] Add verification re-scan after migration completes
8. [ ] Add "Export report" JSON download
9. [ ] Add link from the sidebar (Settings or Media nav item)
10. [ ] Run against the full database, monitor progress
11. [ ] Verify zero remaining CloudFront URLs in both tables
