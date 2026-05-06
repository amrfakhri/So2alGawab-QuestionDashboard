/**
 * import_gamedata.mjs
 * Imports gamedata1.json into the existing Supabase tables.
 * Run: node import_gamedata.mjs
 *
 * Tables written (schema unchanged):
 *   lists · categories · questions · game_settings · question_metadata · question_media
 */

import { readFileSync } from 'fs';
import { createHash }   from 'crypto';

/* ── Config ─────────────────────────────────────────── */
const SUPABASE_URL = 'https://zsgmageagwaiqxotzmkr.supabase.co';
const ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzZ21hZ2VhZ3dhaXF4b3R6bWtyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNjI3MjIsImV4cCI6MjA5MzYzODcyMn0.HCd1CWSnDsTy7My3ez5EjHAbu5-zNWLC_PURjWzjQXc';

const LIST_TITLE   = 'gamedata1';       // name shown in the dashboard
const JSON_PATH    = '/Users/amrfakhri/Mirror/GitHub/So2alGawab-QuestionDashboard/gamedata1.json';

/* ── Supabase REST helpers ───────────────────────────── */
const HEADERS = {
  'apikey':        ANON_KEY,
  'Authorization': `Bearer ${ANON_KEY}`,
  'Content-Type':  'application/json',
};

async function sbSelect(table, filters = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filters}&select=*`;
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`SELECT ${table}: ${await r.text()}`);
  return r.json();
}

async function sbUpsert(table, rows, onConflict) {
  if (!rows.length) return [];
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const r = await fetch(url, {
    method:  'POST',
    headers: { ...HEADERS, 'Prefer': `return=minimal,resolution=merge-duplicates` },
    body:    JSON.stringify(rows),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`UPSERT ${table}: ${txt}`);
  }
  return r.status;
}

async function sbInsert(table, rows) {
  if (!rows.length) return;
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const r = await fetch(url, {
    method:  'POST',
    headers: { ...HEADERS, 'Prefer': 'return=minimal' },
    body:    JSON.stringify(rows),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`INSERT ${table}: ${txt}`);
  }
}

async function sbDelete(table, filter) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filter}`;
  const r = await fetch(url, { method: 'DELETE', headers: HEADERS });
  if (!r.ok) throw new Error(`DELETE ${table}: ${await r.text()}`);
}

/* ── ID mapping ──────────────────────────────────────── */
// MongoDB ObjectIds are 24 hex chars (12 bytes).
// Pad to 32 hex chars (16 bytes) → format as UUID.
// Deterministic: same input always produces same UUID.
function mongoToUuid(mongoId) {
  const hex = (mongoId + '00000000').slice(0, 32); // pad to 32 hex chars
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

/* ── Category name inference ─────────────────────────── */
// Inferred from question content (all Arabic-language questions).
const CATEGORY_NAMES = {
  '65eb327901707f002b27e900': 'معلومات عامة',
  '65ec703a01707f002b27eb49': 'سيارات',
  '65fcaced763d3d87ca4cd082': 'أفلام ومسلسلات',
  '66c31731ee1bff3815db29f5': 'تجميل',
  '66c3172309d34bd517a08892': 'أزياء وماركات',
  '6793e92b0a6aa0e40823d432': 'أغاني',
};

/* ── Main import ─────────────────────────────────────── */
async function run() {
  /* 1 — Load JSON */
  const raw   = readFileSync(JSON_PATH, 'utf8');
  const items = JSON.parse(raw).data;
  console.log(`\n📂  Loaded ${items.length} questions from JSON`);

  /* 2 — Build ID maps */
  const oldCatIds = [...new Set(items.map(i => i.categoryId).filter(Boolean))];
  const catIdMap  = Object.fromEntries(oldCatIds.map(id => [id, mongoToUuid(id)]));

  const qIdMap = Object.fromEntries(
    items.map(i => [i.questionId, mongoToUuid(i.questionId)])
  );

  /* 3 — Check for existing list with same title (dedup) */
  const existing = await sbSelect('lists', `title=eq.${encodeURIComponent(LIST_TITLE)}`);
  let listId;
  if (existing.length) {
    console.log(`ℹ️   List "${LIST_TITLE}" already exists (id=${existing[0].id}). Merging into it.`);
    listId = existing[0].id;
  } else {
    listId = crypto.randomUUID();
    await sbInsert('lists', [{ id: listId, title: LIST_TITLE }]);
    console.log(`✅  Created list "${LIST_TITLE}" (id=${listId})`);
  }

  /* 4 — Check which questions already exist (skip duplicates) */
  const newQUuids = items.map(i => qIdMap[i.questionId]);
  const existingQs = await sbSelect(
    'questions',
    `id=in.(${newQUuids.map(id => `"${id}"`).join(',')})`
  );
  const existingQSet = new Set(existingQs.map(q => q.id));
  const toImport     = items.filter(i => !existingQSet.has(qIdMap[i.questionId]));
  const skipped      = items.length - toImport.length;
  console.log(`🔍  ${skipped} question(s) already exist → skipping`);
  console.log(`📥  ${toImport.length} question(s) to import\n`);

  if (!toImport.length) {
    console.log('🎉  Nothing to import. Database is up to date.');
    return;
  }

  /* 5 — Upsert categories */
  const usedCatIds = [...new Set(toImport.map(i => i.categoryId).filter(Boolean))];
  const catRows = usedCatIds.map((oldId, idx) => ({
    id:         catIdMap[oldId],
    list_id:    listId,
    name:       CATEGORY_NAMES[oldId] || `Category ${idx + 1}`,
    sort_order: idx,
  }));
  await sbUpsert('categories', catRows, 'id');
  console.log(`✅  Upserted ${catRows.length} categories`);

  /* 6 — Insert questions */
  const qRows = toImport.map(item => {
    const gq = item.GamesQuestion || {};
    return {
      id:             qIdMap[item.questionId],
      list_id:        listId,
      category_id:    item.categoryId ? catIdMap[item.categoryId] : null,
      question:       gq.question      || '',
      correct_answer: gq.correctAnswer || null,
      created_at:     gq.createdAt     || new Date().toISOString(),
      updated_at:     gq.updatedAt     || new Date().toISOString(),
      deleted_at:     gq.deletedAt     || null,
    };
  });
  await sbInsert('questions', qRows);
  console.log(`✅  Inserted ${qRows.length} questions`);

  /* 7 — Insert game_settings */
  const gsRows = toImport.map((item, idx) => {
    const gq = item.GamesQuestion || {};
    return {
      question_id:     qIdMap[item.questionId],
      points:          item.points          ?? 200,
      team_index:      item.teamIndex       ?? 1,
      button_click:    item.buttonClick     || 'TeamOne',
      layout_template: gq.layoutTemplate    ?? 2,
      class:           item.class           || 'CLASS_200',
      status:          (gq.status || 'ACTIVE').toLowerCase(),
      sort_order:      item.id              ?? idx,   // preserve original sort order
    };
  });
  await sbInsert('game_settings', gsRows);
  console.log(`✅  Inserted ${gsRows.length} game_settings rows`);

  /* 8 — Insert question_metadata */
  const metaRows = toImport.map(item => {
    const gq = item.GamesQuestion || {};
    return {
      question_id: qIdMap[item.questionId],
      notes: Array.isArray(gq.note) ? gq.note : [],
      hints: {
        hintQuestion:       gq.hintQuestion       || {},
        fixQuestion:        !!gq.fixQuestion,
        duplicateQuestion:  !!gq.duplicateQuestion,
        label:              gq.label              || '',
        questionTypeView:   gq.questionTypeView   || 'Regular_Question',
        correctAnswerMedia: gq.correctAnswerMedia || '',
        userId:             item.userId           || '',
      },
    };
  });
  await sbInsert('question_metadata', metaRows);
  console.log(`✅  Inserted ${metaRows.length} question_metadata rows`);

  /* 9 — Insert question_media (image / video / audio URLs) */
  const mediaRows = [];
  toImport.forEach(item => {
    const gq  = item.GamesQuestion || {};
    const qId = qIdMap[item.questionId];
    let pos = 0;
    (gq.image || []).filter(Boolean).forEach(url =>
      mediaRows.push({ question_id: qId, media_type: 'image', media_url: url, sort_order: pos++ }));
    (gq.video || []).filter(Boolean).forEach(url =>
      mediaRows.push({ question_id: qId, media_type: 'video', media_url: url, sort_order: pos++ }));
    (gq.audio || []).filter(Boolean).forEach(url =>
      mediaRows.push({ question_id: qId, media_type: 'audio', media_url: url, sort_order: pos++ }));
    // Note: media_type enum values are lowercase in the schema
  });
  if (mediaRows.length) {
    await sbInsert('question_media', mediaRows);
    console.log(`✅  Inserted ${mediaRows.length} media rows`);
  } else {
    console.log(`ℹ️   No media rows to insert`);
  }

  /* 10 — Summary */
  console.log(`
╔══════════════════════════════╗
║  Import complete             ║
╠══════════════════════════════╣
║  Imported : ${String(toImport.length).padEnd(18)}║
║  Skipped  : ${String(skipped).padEnd(18)}║
║  Failed   : 0                ║
║  List ID  : ${listId.slice(0,18)}║
╚══════════════════════════════╝`);
}

run().catch(err => {
  console.error('\n❌  Import failed:', err.message);
  process.exit(1);
});
