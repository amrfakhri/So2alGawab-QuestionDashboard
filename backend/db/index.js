/**
 * Database layer — JSON file persistence.
 *
 * Stores all lists in backend/data/db.json.
 * No native modules required; pure Node.js fs.
 *
 * The file is read fresh on every call and written atomically via a tmp file
 * so a crash mid-write never corrupts existing data.
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE  = path.join(DATA_DIR, 'db.json');
const TMP_FILE = path.join(DATA_DIR, 'db.json.tmp');

fs.mkdirSync(DATA_DIR, { recursive: true });

/* -------------------------------------------------------
   Read / write helpers
------------------------------------------------------- */
function read() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { lists: [] };
  }
}

function write(data) {
  fs.writeFileSync(TMP_FILE, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(TMP_FILE, DB_FILE);   // atomic on POSIX
}

/* -------------------------------------------------------
   CRUD
------------------------------------------------------- */

/** Return all lists, newest-updated first. */
function getLists() {
  const { lists } = read();
  return [...lists].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

/** Return a single list by id, or null. */
function getList(id) {
  return read().lists.find(l => l.id === id) || null;
}

/** Insert a new list. Returns the created list. */
function createList(list) {
  const db = read();
  db.lists.push(list);
  write(db);
  return list;
}

/**
 * Update an existing list — accepts full or partial payload.
 * Returns the merged list, or null if not found.
 */
function updateList(id, payload) {
  const db  = read();
  const idx = db.lists.findIndex(l => l.id === id);
  if (idx === -1) return null;
  db.lists[idx] = { ...db.lists[idx], ...payload, id, updatedAt: new Date().toISOString() };
  write(db);
  return db.lists[idx];
}

/** Delete a list by id. Returns true if removed. */
function deleteList(id) {
  const db  = read();
  const len = db.lists.length;
  db.lists  = db.lists.filter(l => l.id !== id);
  if (db.lists.length === len) return false;
  write(db);
  return true;
}

/**
 * Returns game-compatible export: { status: true, data: [...questions] }
 */
function exportList(id) {
  const list = getList(id);
  if (!list) return null;
  return { status: true, data: list.questions || [] };
}

module.exports = { getLists, getList, createList, updateList, deleteList, exportList };
