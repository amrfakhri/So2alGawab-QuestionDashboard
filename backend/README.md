# So2alGawab — Questions Manager Backend

Node.js + Express API with SQLite persistence for the Questions Manager dashboard.

## Stack

| Layer    | Technology                     |
|----------|-------------------------------|
| Runtime  | Node.js 18+                    |
| Server   | Express 4                      |
| Database | SQLite (via `better-sqlite3`)   |
| Storage  | `backend/data/questions.db`    |

---

## Setup

```bash
cd backend
npm install
npm start
```

The server starts on **http://localhost:3001**.

For development with auto-restart (Node 18+):

```bash
npm run dev
```

---

## API Reference

### Health check
```
GET /api/health
→ { ok: true, service: "so2algawab-questions-api", ts: "..." }
```

### Lists

| Method | Endpoint                  | Description                         |
|--------|---------------------------|-------------------------------------|
| GET    | `/api/lists`              | All lists (with full data)          |
| GET    | `/api/lists/:id`          | Single list by ID                   |
| POST   | `/api/lists`              | Create a new list                   |
| PUT    | `/api/lists/:id`          | Update list (full or partial)       |
| DELETE | `/api/lists/:id`          | Delete a list permanently           |
| GET    | `/api/lists/:id/export`   | Game-ready JSON `{ status, data }`  |

### POST /api/lists — Request body

```json
{
  "id":         "abc123",
  "title":      "Game Night Season 3",
  "categories": [ { "id": "...", "name": "Cars", "order": 0 } ],
  "questions":  [ { ...game question item... } ],
  "createdAt":  "2025-01-01T00:00:00.000Z",
  "updatedAt":  "2025-01-01T00:00:00.000Z"
}
```

### PUT /api/lists/:id — Accepts partial updates

```json
{ "title": "New Title" }
```

or a full list object — both work.

---

## Data Storage

Questions and categories are stored as JSON columns in SQLite, preserving the
full game schema without requiring migrations when fields are added or changed.

Database file: `backend/data/questions.db`

Back it up by copying that file.

---

## Environment Variables

| Variable | Default | Description           |
|----------|---------|-----------------------|
| `PORT`   | `3001`  | Port the API runs on  |

---

## Production Deployment

The backend can be deployed to any Node.js host (Railway, Render, Fly.io, etc.).

Set `window.QUESTIONS_API_BASE` in the frontend HTML before the admin script
loads to point at the production API:

```html
<script>
  window.QUESTIONS_API_BASE = 'https://your-api.example.com/api';
</script>
```

If the backend is unreachable, the frontend automatically falls back to
browser localStorage so the UI always works.
