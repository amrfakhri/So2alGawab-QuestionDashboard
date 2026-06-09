/**
 * Lammah Game — Questions Manager API
 * Express server with SQLite persistence.
 *
 * Start:    node server.js
 * Dev mode: node --watch server.js   (Node 18+)
 */

const express = require('express');
const cors    = require('cors');

const listsRouter = require('./routes/lists');

const app  = express();
const PORT = process.env.PORT || 3001;

/* -------------------------------------------------------
   Middleware
------------------------------------------------------- */
app.use(cors({
  origin: '*',          // tighten in production: list allowed origins
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));   // questions with base64 media can be large

/* -------------------------------------------------------
   Health check — used by the frontend to detect backend
------------------------------------------------------- */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'so2algawab-questions-api', ts: new Date().toISOString() });
});

/* -------------------------------------------------------
   Routes
------------------------------------------------------- */
app.use('/api/lists', listsRouter);

/* -------------------------------------------------------
   404 catch-all
------------------------------------------------------- */
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

/* -------------------------------------------------------
   Global error handler
------------------------------------------------------- */
app.use((err, _req, res, _next) => {
  console.error('[Unhandled error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

/* -------------------------------------------------------
   Start
------------------------------------------------------- */
app.listen(PORT, () => {
  console.log(`\n🎮  Lammah Game Questions API`);
  console.log(`    http://localhost:${PORT}/api\n`);
});
