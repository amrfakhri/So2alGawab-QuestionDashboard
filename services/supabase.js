'use strict';

/* =====================================================
   SUPABASE CONFIG
   Targets the existing production schema — do not alter
   the database structure, only the queries here.
===================================================== */
const SUPABASE_URL      = 'https://qtzdubdhbdvkvesltmkd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF0emR1YmRoYmR2a3Zlc2x0bWtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MjQwMzUsImV4cCI6MjA5NjAwMDAzNX0.xbNoT4_rkXYNbqgbYUw9YLCz0VDjv09whqig44EpgZ0';

const _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---- Current user id (from the locally-cached session, no network) ---- */
async function _currentUserId() {
  try {
    const { data: { session } } = await _sb.auth.getSession();
    return session?.user?.id || null;
  } catch {
    return null;
  }
}

/* =====================================================
   EXISTING SCHEMA (read-only reference)
   ─────────────────────────────────────────────────
   lists            id, title, created_at, updated_at
   categories       id, list_id, name, sort_order, created_at
   questions        id, list_id, category_id, question,
                    correct_answer, created_at, updated_at, deleted_at
   game_settings    question_id (PK), points, team_index, button_click,
                    layout_template, class, status (enum), sort_order
   question_media   id, question_id, media_type (enum), media_url, sort_order, created_at
   question_metadata question_id (PK), notes (jsonb), hints (jsonb)
   ─────────────────────────────────────────────────
   Extended fields not in dedicated columns are packed into
   question_metadata.hints (jsonb):
     { hintQuestion, fixQuestion, duplicateQuestion, label,
       questionTypeView, correctAnswerMedia, userId }
===================================================== */

/* =====================================================
   HELPERS
===================================================== */
function _throwIfError(res, ctx) {
  if (res.error) {
    console.error(`[SupabaseDB] ${ctx}:`, res.error);
    throw new Error(`${ctx}: ${res.error.message}`);
  }
  return res.data;
}

function _assembleQuestion(q, gs, mediaRows, meta) {
  const settings = gs    || {};
  const hints    = meta?.hints || {};
  const notes    = meta?.notes;
  const media    = mediaRows || [];

  return {
    id:                     settings.sort_order ?? 0,
    userId:                 hints.userId || '',
    categoryId:             q.category_id || '',
    class:                  settings.class || 'CLASS_200',
    buttonClick:            settings.button_click || 'TeamOne',
    rightAnswerGivenByTeam: null,
    points:                 settings.points ?? 200,
    questionId:             q.id,
    teamIndex:              settings.team_index ?? 1,
    GamesQuestion: {
      id:                 q.id,
      categoryId:         q.category_id || '',
      question:           q.question    || '',
      questionTypeView:   hints.questionTypeView   || 'Regular_Question',
      correctAnswer:      q.correct_answer         || '',
      correctAnswerMedia: hints.correctAnswerMedia || '',
      layoutTemplate:     settings.layout_template ?? 2,
      class:              settings.class           || 'CLASS_200',
      status:             (settings.status || 'active').toUpperCase(),
      fixQuestion:        !!hints.fixQuestion,
      duplicateQuestion:  !!hints.duplicateQuestion,
      label:              hints.label              || '',
      hintQuestion:       hints.hintQuestion       || {},
      deletedAt:          q.deleted_at             || null,
      createdAt:          q.created_at,
      updatedAt:          q.updated_at,
      // Rebuild media arrays; return [''] placeholder so the form renders an empty field
      image:     _mediaOfType(media, 'image'),
      video:     _mediaOfType(media, 'video'),
      audio:     _mediaOfType(media, 'audio'),
      // Parallel metadata arrays for storage-backed files (null entries for URL-only items)
      imageMeta: _mediaMetaOfType(media, 'image'),
      videoMeta: _mediaMetaOfType(media, 'video'),
      audioMeta: _mediaMetaOfType(media, 'audio'),
      note:      Array.isArray(notes) ? notes : []
    }
  };
}

function _mediaOfType(rows, type) {
  const sorted = rows
    .filter(m => m.media_type === type)
    .sort((a, b) => a.sort_order - b.sort_order);
  const urls = sorted.map(m => m.media_url);
  return urls.length ? urls : [''];
}

function _mediaMetaOfType(rows, type) {
  return rows
    .filter(m => m.media_type === type)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(m => ({
      filePath: m.file_path || null,
      fileName: m.file_name || null,
      mimeType: m.mime_type || null,
      fileSize: m.file_size || null
    }));
}

/* =====================================================
   SupabaseDB — implements the same interface the
   database.html and index.html already call.
===================================================== */
const SupabaseDB = {
  connected: false,

  /* ---- Connection probe ---- */
  async ping() {
    try {
      const res = await _sb.from('lists').select('id').limit(1);
      this.connected = !res.error;
    } catch {
      this.connected = false;
    }
    return this.connected;
  },

  /* ---- List all lists with question/category counts ---- */
  async getLists() {
    const [listsRes, qRes, catRes] = await Promise.all([
      _sb.from('lists').select('*').order('updated_at', { ascending: false }),
      _sb.from('questions').select('list_id').is('deleted_at', null),
      _sb.from('categories').select('list_id')
    ]);
    _throwIfError(listsRes, 'getLists');

    const qMap   = {};
    const catMap = {};
    (qRes.data   || []).forEach(r => { qMap[r.list_id]   = (qMap[r.list_id]   || 0) + 1; });
    (catRes.data || []).forEach(r => { catMap[r.list_id] = (catMap[r.list_id] || 0) + 1; });

    return (listsRes.data || []).map(l => ({
      id:         l.id,
      title:      l.title,
      createdAt:  l.created_at,
      updatedAt:  l.updated_at,
      // { length: n } duck-types as an array length for the UI
      questions:  { length: qMap[l.id]   || 0 },
      categories: { length: catMap[l.id] || 0 }
    }));
  },

  /* ---- Full list with all questions ---- */
  async getList(id) {
    const listRes = await _sb.from('lists').select('*').eq('id', id).single();
    if (listRes.error || !listRes.data) return null;
    const list = listRes.data;

    const [catRes, qRes] = await Promise.all([
      _sb.from('categories').select('*').eq('list_id', id).order('sort_order'),
      _sb.from('questions').select('*').eq('list_id', id).is('deleted_at', null)
    ]);

    const categories = (catRes.data || []).map(c => ({
      id:        c.id,
      name:      c.name,
      order:     c.sort_order,
      imagePath: c.image_path || null,
    }));

    if (!qRes.data || qRes.data.length === 0) {
      return {
        id: list.id, title: list.title,
        createdAt: list.created_at, updatedAt: list.updated_at,
        categories, questions: []
      };
    }

    const qIds = qRes.data.map(q => q.id);

    const [gsRes, mediaRes, metaRes] = await Promise.all([
      _sb.from('game_settings').select('*').in('question_id', qIds),
      _sb.from('question_media').select('*').in('question_id', qIds).order('sort_order'),
      _sb.from('question_metadata').select('*').in('question_id', qIds)
    ]);

    const gsMap    = {};
    const mediaMap = {};
    const metaMap  = {};
    (gsRes.data    || []).forEach(r => { gsMap[r.question_id]    = r; });
    (mediaRes.data || []).forEach(r => {
      (mediaMap[r.question_id] = mediaMap[r.question_id] || []).push(r);
    });
    (metaRes.data  || []).forEach(r => { metaMap[r.question_id]  = r; });

    // Sort by game_settings.sort_order to preserve drag-and-drop order
    const sorted = [...qRes.data].sort((a, b) =>
      (gsMap[a.id]?.sort_order ?? 9999) - (gsMap[b.id]?.sort_order ?? 9999)
    );

    const questions = sorted.map(q =>
      _assembleQuestion(q, gsMap[q.id], mediaMap[q.id], metaMap[q.id])
    );

    return {
      id: list.id, title: list.title,
      createdAt: list.created_at, updatedAt: list.updated_at,
      categories, questions
    };
  },

  /* ---- Create a new list ---- */
  async createList(payload) {
    const uid = await _currentUserId();
    const res = await _sb.from('lists').insert({ id: payload.id, title: payload.title, created_by: uid, updated_by: uid });
    _throwIfError(res, 'createList');

    if (payload.categories?.length) await this._syncCategories(payload.id, payload.categories);
    if (payload.questions?.length)  await this._syncQuestions(payload.id, payload.questions);

    return payload;
  },

  /* ---- Update a list (only syncs sub-resources when provided) ---- */
  async updateList(id, payload) {
    const patch = { updated_at: new Date().toISOString(), updated_by: await _currentUserId() };
    if (payload.title !== undefined) patch.title = payload.title;

    const res = await _sb.from('lists').update(patch).eq('id', id);
    _throwIfError(res, 'updateList:header');

    if (payload.categories !== undefined) await this._syncCategories(id, payload.categories);
    if (payload.questions  !== undefined) await this._syncQuestions(id, payload.questions);

    return payload;
  },

  /* ---- Delete a list and all its data ---- */
  async deleteList(id) {
    const qRes = await _sb.from('questions').select('id').eq('list_id', id);
    if (qRes.data?.length) {
      const qIds = qRes.data.map(q => q.id);
      await Promise.all([
        _sb.from('game_settings').delete().in('question_id', qIds),
        _sb.from('question_metadata').delete().in('question_id', qIds),
        _sb.from('question_media').delete().in('question_id', qIds)
      ]);
      await _sb.from('questions').delete().in('id', qIds);
    }
    await _sb.from('categories').delete().eq('list_id', id);
    await _sb.from('lists').delete().eq('id', id);
    return true;
  },

  /* ---- Export as game-ready JSON ---- */
  async exportList(id) {
    const list = await this.getList(id);
    if (!list) return null;
    return { status: true, data: list.questions, message: 'Game Questions list' };
  },

  /* =====================================================
     INTERNAL SYNC HELPERS
  ===================================================== */

  async _syncCategories(listId, categories) {
    const newIds = (categories || []).map(c => c.id);

    // Delete removed categories
    const existRes = await _sb.from('categories').select('id').eq('list_id', listId);
    const existingIds = (existRes.data || []).map(c => c.id);
    const toDelete = existingIds.filter(cid => !newIds.includes(cid));
    if (toDelete.length) {
      await _sb.from('categories').delete().in('id', toDelete);
    }

    if (categories && categories.length) {
      const rows = categories.map(c => ({
        id:         c.id,
        list_id:    listId,
        name:       c.name,
        sort_order: c.order ?? 0
      }));
      _throwIfError(
        await _sb.from('categories').upsert(rows, { onConflict: 'id' }),
        '_syncCategories'
      );
    }
  },

  async _syncQuestions(listId, questions) {
    const newQIds = (questions || []).map(q => q.questionId);

    // Remove questions that were deleted in the editor
    const existRes = await _sb.from('questions').select('id').eq('list_id', listId);
    const existingIds = (existRes.data || []).map(q => q.id);
    const toDelete = existingIds.filter(qid => !newQIds.includes(qid));

    if (toDelete.length) {
      await Promise.all([
        _sb.from('game_settings').delete().in('question_id', toDelete),
        _sb.from('question_metadata').delete().in('question_id', toDelete),
        _sb.from('question_media').delete().in('question_id', toDelete)
      ]);
      await _sb.from('questions').delete().in('id', toDelete);
    }

    if (!questions || questions.length === 0) return;

    // ---- questions table ----
    const qRows = questions.map(q => ({
      id:             q.questionId,
      list_id:        listId,
      category_id:    q.categoryId || null,
      question:       q.GamesQuestion?.question     || '',
      correct_answer: q.GamesQuestion?.correctAnswer || null,
      updated_at:     new Date().toISOString()
    }));
    _throwIfError(
      await _sb.from('questions').upsert(qRows, { onConflict: 'id' }),
      '_syncQuestions:questions'
    );

    // ---- game_settings table ----
    const gsRows = questions.map((q, idx) => {
      const gq = q.GamesQuestion || {};
      return {
        question_id:     q.questionId,
        points:          q.points          ?? 200,
        team_index:      q.teamIndex       ?? 1,
        button_click:    q.buttonClick     || 'TeamOne',
        layout_template: gq.layoutTemplate ?? 2,
        class:           q.class           || 'CLASS_200',
        status:          (gq.status || 'ACTIVE').toLowerCase(),
        sort_order:      idx
      };
    });
    _throwIfError(
      await _sb.from('game_settings').upsert(gsRows, { onConflict: 'question_id' }),
      '_syncQuestions:game_settings'
    );

    // ---- question_metadata table ----
    // Extended fields not in dedicated columns go into hints (jsonb)
    const metaRows = questions.map(q => {
      const gq = q.GamesQuestion || {};
      return {
        question_id: q.questionId,
        notes: Array.isArray(gq.note) ? gq.note : [],
        hints: {
          hintQuestion:       gq.hintQuestion       || {},
          fixQuestion:        !!gq.fixQuestion,
          duplicateQuestion:  !!gq.duplicateQuestion,
          label:              gq.label              || '',
          questionTypeView:   gq.questionTypeView   || 'Regular_Question',
          correctAnswerMedia: gq.correctAnswerMedia || '',
          userId:             q.userId              || ''
        }
      };
    });
    _throwIfError(
      await _sb.from('question_metadata').upsert(metaRows, { onConflict: 'question_id' }),
      '_syncQuestions:question_metadata'
    );

    // ---- question_media table ----
    // Delete current rows then re-insert — simpler than diffing individual URLs.
    // Includes optional file-storage metadata (file_path, file_name, mime_type, file_size)
    // when present; falls back to URL-only for backward compatibility.
    await _sb.from('question_media').delete().in('question_id', newQIds);

    const mediaRows = [];
    questions.forEach(q => {
      const gq  = q.GamesQuestion || {};
      const qId = q.questionId;
      let   pos = 0;

      const pushRows = (type, urls, metaArr) => {
        (urls || []).filter(Boolean).forEach((url, i) => {
          const m = (metaArr && metaArr[i]) || {};
          mediaRows.push({
            question_id: qId,
            media_type:  type,
            media_url:   url,
            file_path:   m.filePath  || null,
            file_name:   m.fileName  || null,
            mime_type:   m.mimeType  || null,
            file_size:   m.fileSize  ? parseInt(m.fileSize)  : null,
            sort_order:  pos++
          });
        });
      };

      pushRows('image', gq.image, gq.imageMeta);
      pushRows('video', gq.video, gq.videoMeta);
      pushRows('audio', gq.audio, gq.audioMeta);
    });

    if (mediaRows.length) {
      _throwIfError(
        await _sb.from('question_media').insert(mediaRows),
        '_syncQuestions:question_media'
      );
    }
  },

  /* ---- Get categories for a given list ---- */
  async getCategories(listId) {
    const res = await _sb.from('categories').select('*').eq('list_id', listId).order('sort_order');
    _throwIfError(res, 'getCategories');
    return (res.data || []).map(c => ({ id: c.id, name: c.name, order: c.sort_order, imagePath: c.image_path || null }));
  },

  /* ---- Move a single question to a different category / list ---- */
  async moveQuestion(questionId, destListId, destCategoryId) {
    // Validate the destination category belongs to the destination list
    const catRes = await _sb.from('categories').select('id')
      .eq('id', destCategoryId).eq('list_id', destListId).single();
    if (catRes.error || !catRes.data) throw new Error('Destination category not found in target list');

    _throwIfError(
      await _sb.from('questions').update({
        category_id: destCategoryId,
        list_id:     destListId,
        updated_at:  new Date().toISOString()
      }).eq('id', questionId),
      'moveQuestion'
    );
    return true;
  },

  /* ---- Move a category (and all its questions) to another list ---- */
  async moveCategory(catId, destListId, questionIds) {
    const listRes = await _sb.from('lists').select('id').eq('id', destListId).single();
    if (listRes.error || !listRes.data) throw new Error('Destination list not found');

    _throwIfError(
      await _sb.from('categories').update({ list_id: destListId }).eq('id', catId),
      'moveCategory:category'
    );

    if (questionIds && questionIds.length) {
      _throwIfError(
        await _sb.from('questions').update({ list_id: destListId }).in('id', questionIds),
        'moveCategory:questions'
      );
    }

    await _sb.from('lists').update({ updated_at: new Date().toISOString(), updated_by: await _currentUserId() }).eq('id', destListId);
    return true;
  }
};

window.SupabaseDB     = SupabaseDB;
window._sb            = _sb;
window.SUPABASE_URL   = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
