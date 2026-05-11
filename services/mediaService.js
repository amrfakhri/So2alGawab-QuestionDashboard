'use strict';

/* =====================================================
   MEDIA SERVICE
   Handles Supabase Storage uploads, deletions, and
   the question_media table queries.
   Depends on: services/supabase.js loaded before this.
===================================================== */

const MEDIA_BUCKET = 'question-media';

const ACCEPTED_TYPES = {
  image: {
    exts:    ['jpg', 'jpeg', 'png', 'webp'],
    mimes:   ['image/jpeg', 'image/png', 'image/webp'],
    maxSize: 10 * 1024 * 1024,
    label:   'JPG, PNG, WEBP — max 10 MB'
  },
  audio: {
    exts:    ['mp3', 'wav', 'm4a'],
    mimes:   ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/x-m4a', 'audio/aac'],
    maxSize: 25 * 1024 * 1024,
    label:   'MP3, WAV, M4A — max 25 MB'
  },
  video: {
    exts:    ['mp4', 'webm', 'mov'],
    mimes:   ['video/mp4', 'video/webm', 'video/quicktime'],
    maxSize: 100 * 1024 * 1024,
    label:   'MP4, WEBM, MOV — max 100 MB'
  }
};

const MediaService = {

  /* ---- File validation ---- */
  validateFile(file, mediaType) {
    const rules = ACCEPTED_TYPES[mediaType];
    if (!rules) throw new Error(`Unknown media type: ${mediaType}`);

    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!rules.exts.includes(ext)) {
      throw new Error(`Unsupported .${ext} for ${mediaType}. Allowed: ${rules.exts.join(', ')}`);
    }

    if (file.type) {
      const prefix = mediaType + '/';
      const isCorrectPrefix = file.type.startsWith(prefix);
      // audio/x-m4a and audio/aac are valid aliases — allow them
      const isKnownAlias = rules.mimes.includes(file.type);
      if (!isCorrectPrefix && !isKnownAlias) {
        throw new Error(`Invalid MIME type "${file.type}" for ${mediaType}`);
      }
    }

    if (file.size > rules.maxSize) {
      const maxMB = (rules.maxSize / (1024 * 1024)).toFixed(0);
      throw new Error(`File too large (max ${maxMB} MB for ${mediaType})`);
    }

    return true;
  },

  /* ---- Upload a file to Supabase Storage ---- */
  async uploadFile(file, questionId, mediaType, onProgress) {
    this.validateFile(file, mediaType);

    const sb  = window._sb;
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const dir = mediaType === 'image' ? 'images' : mediaType === 'video' ? 'video' : 'audio';
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const filePath   = `questions/${questionId}/${dir}/${uniqueName}`;

    if (onProgress) onProgress(10);

    const { error } = await sb.storage
      .from(MEDIA_BUCKET)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert:       false,
        contentType:  file.type || `${mediaType}/${ext}`
      });

    if (error) throw new Error(`Upload failed: ${error.message}`);

    if (onProgress) onProgress(100);

    return {
      filePath,
      fileName:  file.name,
      mimeType:  file.type || `${mediaType}/${ext}`,
      fileSize:  file.size,
      mediaUrl:  this.getPublicUrl(filePath),
      mediaType
    };
  },

  /* ---- Get a public URL for a storage path ---- */
  getPublicUrl(filePath) {
    const { data } = window._sb.storage
      .from(MEDIA_BUCKET)
      .getPublicUrl(filePath);
    return data.publicUrl;
  },

  /* ---- Remove a single file from storage ---- */
  async deleteStorageFile(filePath) {
    if (!filePath) return;
    const { error } = await window._sb.storage
      .from(MEDIA_BUCKET)
      .remove([filePath]);
    if (error) console.warn('[MediaService] Storage remove warning:', error.message);
  },

  /* ---- Batch-remove orphan files (cancelled question creation) ---- */
  async cleanupOrphanFiles(filePaths) {
    const paths = (filePaths || []).filter(Boolean);
    if (!paths.length) return;
    try {
      await window._sb.storage.from(MEDIA_BUCKET).remove(paths);
    } catch (e) {
      console.warn('[MediaService] Orphan cleanup failed:', e);
    }
  },

  /* ---- Delete media record + its storage file ---- */
  async deleteMediaItem(id, filePath) {
    await this.deleteStorageFile(filePath);
    const { error } = await window._sb.from('question_media').delete().eq('id', id);
    if (error) throw new Error(`Failed to delete record: ${error.message}`);
    return true;
  },

  /* ---- Paginated media library query ---- */
  async getMediaLibrary({ type = 'all', search = '', sort = 'newest', page = 1, pageSize = 48 } = {}) {
    const sb = window._sb;

    let query = sb
      .from('question_media')
      .select(`
        id, question_id, media_type, media_url,
        file_path, file_name, mime_type, file_size,
        sort_order, created_at,
        questions ( id, question, category_id, list_id )
      `);

    if (type !== 'all') query = query.eq('media_type', type);

    if (search) {
      query = query.or(
        `file_name.ilike.%${search}%,media_url.ilike.%${search}%`
      );
    }

    if (sort === 'newest')  query = query.order('created_at', { ascending: false });
    else if (sort === 'oldest')  query = query.order('created_at', { ascending: true });
    else if (sort === 'largest') query = query.order('file_size', { ascending: false, nullsFirst: false });
    else if (sort === 'most-used') query = query.order('created_at', { ascending: false }); // fallback

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  /* ---- Count total media items (for pagination) ---- */
  async getMediaCount({ type = 'all', search = '' } = {}) {
    let query = window._sb
      .from('question_media')
      .select('id', { count: 'exact', head: true });

    if (type !== 'all') query = query.eq('media_type', type);
    if (search) query = query.or(`file_name.ilike.%${search}%,media_url.ilike.%${search}%`);

    const { count, error } = await query;
    if (error) throw error;
    return count || 0;
  },

  /* ---- Aggregate stats (count + storage usage) ---- */
  async getMediaStats() {
    const { data, error } = await window._sb
      .from('question_media')
      .select('media_type, file_size');

    if (error) throw error;
    const rows = data || [];

    return {
      total:     rows.length,
      byType:    {
        image: rows.filter(r => r.media_type === 'image').length,
        audio: rows.filter(r => r.media_type === 'audio').length,
        video: rows.filter(r => r.media_type === 'video').length
      },
      totalSize: rows.reduce((s, r) => s + (r.file_size || 0), 0)
    };
  },

  /* ---- Fetch recently-uploaded media (last 24 h) ---- */
  async getRecentMedia(limit = 12) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await window._sb
      .from('question_media')
      .select('id, media_type, media_url, file_path, file_name, mime_type, file_size, created_at, question_id')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  },

  /* ---- Format byte count as human-readable string ---- */
  formatFileSize(bytes) {
    if (!bytes && bytes !== 0) return '—';
    if (bytes === 0) return '0 B';
    if (bytes < 1024)             return `${bytes} B`;
    if (bytes < 1024 * 1024)      return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3)        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  },

  /* ---- Copy text to clipboard ---- */
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
};

window.MediaService    = MediaService;
window.ACCEPTED_TYPES  = ACCEPTED_TYPES;
window.MEDIA_BUCKET    = MEDIA_BUCKET;
