/**
 * REST routes for question lists.
 *
 * GET    /api/lists           — all lists
 * GET    /api/lists/:id       — single list
 * POST   /api/lists           — create list
 * PUT    /api/lists/:id       — update list (full or partial)
 * DELETE /api/lists/:id       — delete list
 * GET    /api/lists/:id/export — game-compatible JSON export
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');

/* -------------------------------------------------------
   GET /api/lists
------------------------------------------------------- */
router.get('/', (req, res) => {
  try {
    const lists = db.getLists();
    res.json(lists);
  } catch (err) {
    console.error('[GET /lists]', err);
    res.status(500).json({ error: 'Failed to fetch lists' });
  }
});

/* -------------------------------------------------------
   GET /api/lists/:id
------------------------------------------------------- */
router.get('/:id', (req, res) => {
  try {
    const list = db.getList(req.params.id);
    if (!list) return res.status(404).json({ error: 'List not found' });
    res.json(list);
  } catch (err) {
    console.error('[GET /lists/:id]', err);
    res.status(500).json({ error: 'Failed to fetch list' });
  }
});

/* -------------------------------------------------------
   POST /api/lists
   Body: { id, title, categories, questions, createdAt, updatedAt }
------------------------------------------------------- */
router.post('/', (req, res) => {
  try {
    const { id, title, categories = [], questions = [], createdAt, updatedAt } = req.body;

    if (!id || !title) {
      return res.status(400).json({ error: 'id and title are required' });
    }

    const list = {
      id,
      title: String(title).trim(),
      categories,
      questions,
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: updatedAt || new Date().toISOString()
    };

    const created = db.createList(list);
    res.status(201).json(created);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      return res.status(409).json({ error: 'A list with this ID already exists' });
    }
    console.error('[POST /lists]', err);
    res.status(500).json({ error: 'Failed to create list' });
  }
});

/* -------------------------------------------------------
   PUT /api/lists/:id
   Accepts full list object or partial { title, categories, questions }.
------------------------------------------------------- */
router.put('/:id', (req, res) => {
  try {
    const updated = db.updateList(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'List not found' });
    res.json(updated);
  } catch (err) {
    console.error('[PUT /lists/:id]', err);
    res.status(500).json({ error: 'Failed to update list' });
  }
});

/* -------------------------------------------------------
   DELETE /api/lists/:id
------------------------------------------------------- */
router.delete('/:id', (req, res) => {
  try {
    const deleted = db.deleteList(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'List not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /lists/:id]', err);
    res.status(500).json({ error: 'Failed to delete list' });
  }
});

/* -------------------------------------------------------
   GET /api/lists/:id/export
   Returns { status: true, data: [...questions] } — game-ready format.
------------------------------------------------------- */
router.get('/:id/export', (req, res) => {
  try {
    const exported = db.exportList(req.params.id);
    if (!exported) return res.status(404).json({ error: 'List not found' });
    res.json(exported);
  } catch (err) {
    console.error('[GET /lists/:id/export]', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

module.exports = router;
