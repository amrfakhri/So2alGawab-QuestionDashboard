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
    exts:    ['jpg', 'jpeg', 'png', 'webp', 'svg'],
    mimes:   ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'],
    maxSize: 10 * 1024 * 1024,
    label:   'JPG, PNG, WEBP, SVG — max 10 MB'
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
      // audio/x-m4a, audio/aac, image/svg+xml are valid aliases — allow them
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

  /* ---- Return the category using this URL as its image (or null) ---- */
  async getCategoryByImageUrl(mediaUrl) {
    if (!mediaUrl) return null;
    const { data } = await window._sb
      .from('categories')
      .select('id, name, list_id, question_lists ( title )')
      .eq('image_url', mediaUrl)
      .limit(1)
      .maybeSingle();
    return data || null;
  },

  /* ---- Unlink media from its question (question_id → null) ---- */
  async unlinkFromQuestion(mediaId) {
    const { error } = await window._sb
      .from('question_media')
      .update({ question_id: null })
      .eq('id', mediaId);
    if (error) throw new Error(`Failed to unlink from question: ${error.message}`);
    return true;
  },

  /* ---- Remove a URL from any category's image_url ---- */
  async unlinkFromCategory(mediaUrl) {
    const { error } = await window._sb
      .from('categories')
      .update({ image_url: null })
      .eq('image_url', mediaUrl);
    if (error) throw new Error(`Failed to unlink from category: ${error.message}`);
    return true;
  },

  /* ---- Delete media record + its storage file (blocks if linked) ---- */
  async deleteMediaItem(id, filePath) {
    // Live-check question link
    const { data: rec } = await window._sb
      .from('question_media')
      .select('question_id, media_url')
      .eq('id', id)
      .maybeSingle();

    if (rec?.question_id) {
      throw new Error('Cannot delete: this file is linked to a question. Unlink it first.');
    }

    // Live-check category link
    if (rec?.media_url) {
      const { data: cat } = await window._sb
        .from('categories')
        .select('name')
        .eq('image_url', rec.media_url)
        .limit(1)
        .maybeSingle();
      if (cat) {
        throw new Error(`Cannot delete: file is the image for category "${cat.name}". Unlink it first.`);
      }
    }

    await this.deleteStorageFile(filePath);
    const { error } = await window._sb.from('question_media').delete().eq('id', id);
    if (error) throw new Error(`Failed to delete record: ${error.message}`);
    return true;
  },

  /* ---- Paginated media library query ---- */
  async getMediaLibrary({ type = 'all', purpose = 'all', search = '', sort = 'newest', page = 1, pageSize = 48 } = {}) {
    const sb = window._sb;

    let query = sb
      .from('question_media')
      .select(`
        id, question_id, media_type, media_purpose, media_url,
        file_path, file_name, mime_type, file_size,
        sort_order, created_at,
        questions ( id, question, category_id, list_id )
      `);

    if (type !== 'all')    query = query.eq('media_type', type);
    if (purpose !== 'all') query = query.eq('media_purpose', purpose);

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
  async getMediaCount({ type = 'all', purpose = 'all', search = '' } = {}) {
    let query = window._sb
      .from('question_media')
      .select('id', { count: 'exact', head: true });

    if (type !== 'all')    query = query.eq('media_type', type);
    if (purpose !== 'all') query = query.eq('media_purpose', purpose);
    if (search) query = query.or(`file_name.ilike.%${search}%,media_url.ilike.%${search}%`);

    const { count, error } = await query;
    if (error) throw error;
    return count || 0;
  },

  /* ---- Aggregate stats (count + storage usage) ---- */
  async getMediaStats() {
    const { data, error } = await window._sb
      .from('question_media')
      .select('media_type, media_purpose, file_size');

    if (error) throw error;
    const rows = data || [];

    return {
      total:      rows.length,
      byType:     {
        image: rows.filter(r => r.media_type === 'image').length,
        audio: rows.filter(r => r.media_type === 'audio').length,
        video: rows.filter(r => r.media_type === 'video').length
      },
      byPurpose:  {
        question: rows.filter(r => r.media_purpose === 'question').length,
        game_ui:  rows.filter(r => r.media_purpose === 'game_ui').length
      },
      totalSize:  rows.reduce((s, r) => s + (r.file_size || 0), 0)
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

  /* ---- Bulk update media_purpose for multiple items ---- */
  async bulkUpdatePurpose(ids, purpose) {
    if (!ids.length) return;
    const { error } = await window._sb
      .from('question_media')
      .update({ media_purpose: purpose })
      .in('id', ids);
    if (error) throw new Error(`Failed to update purpose: ${error.message}`);
    return true;
  },

  /* ---- Bulk delete items — skips any that are linked ---- */
  async bulkDeleteItems(items) {
    // Check each item for links (question link from loaded data; category via DB)
    const checks = await Promise.all(items.map(async item => {
      if (item.questions) return { item, linked: true };
      if (item.media_url) {
        const { data: cat } = await window._sb
          .from('categories').select('id').eq('image_url', item.media_url).limit(1).maybeSingle();
        if (cat) return { item, linked: true };
      }
      return { item, linked: false };
    }));

    const deletable = checks.filter(c => !c.linked).map(c => c.item);
    const skipped   = checks.filter(c =>  c.linked).length;

    if (!deletable.length) {
      throw new Error('All selected items are linked to questions or categories. Unlink them first.');
    }

    const filePaths = deletable.map(i => i.file_path).filter(Boolean);
    if (filePaths.length) await this.cleanupOrphanFiles(filePaths);

    const ids = deletable.map(i => i.id);
    const { error } = await window._sb.from('question_media').delete().in('id', ids);
    if (error) throw new Error(`Failed to delete: ${error.message}`);

    return { deleted: deletable.length, skipped };
  },

  /* ---- Set a media asset as a category's image ---- */
  async setCategoryImage(categoryId, imageUrl) {
    const { error } = await window._sb
      .from('categories')
      .update({ image_url: imageUrl })
      .eq('id', categoryId);
    if (error) throw new Error(`Failed to set category image: ${error.message}`);
    return true;
  },

  /* ---- Fetch all categories (grouped for picker UI) ---- */
  async getCategories() {
    const { data, error } = await window._sb
      .from('categories')
      .select('id, name, list_id, image_url, question_lists ( title )')
      .order('list_id')
      .order('order_index');
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
