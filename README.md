# ContextChat

**Real-time chat with semantic memory.** A production-grade messaging app that combines instant chat (typing indicators, presence, file uploads, reactions) with AI features that can read and reason about the conversation — semantic search, room-grounded Q&A, smart replies, tone shifting, and live summarization.

Built end-to-end in TypeScript with PostgreSQL + pgvector, Redis, Socket.io, BullMQ, Groq (Llama 3.3-70B), and Google Gemini embeddings.

---

## Highlights

- **Semantic memory** — Every message gets a 768-dimension Gemini embedding (computed async via BullMQ). Search by *meaning* (`"deadline"` finds *"needs to be submitted by Tuesday"*), or let the AI Co-pilot read the room and answer questions with citations.
- **Production-grade security** — Refresh-token rotation with replay-attack breach detection, JTI blacklist on logout (REST + WebSocket), IDOR-safe controllers that return 404 not 403, prompt-injection guardrails, magic-byte file validation on both client and server.
- **Real-time correctness** — Cursor pagination on `created_at`, presence sync on connect (not just diffs), offline replay with gap detection, Redis-backed unread counts.
- **Polished UI** — Custom glassmorphic dark theme, micro-animations, smart reply chips, inline AI rewrite (5 tone presets + improve-writing), SSE-streamed responses, semantic search overlay, emoji reactions, hover actions.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite, TypeScript, TailwindCSS 4, TanStack Query, Zustand, Socket.io-client, React Router, Zod, React Hook Form |
| Backend | Node.js, Express, TypeScript, Socket.io, BullMQ, ioredis, pg, Helmet, Zod, Winston |
| Data | PostgreSQL (Supabase) with `pgvector` + HNSW index, Redis (Upstash) |
| AI | Groq (`llama-3.3-70b-versatile`), Google Gemini (`text-embedding-004`, 768-dim) |
| Files | ImageKit (signed uploads, 25 MB cap, magic-byte validated) |
| Auth | JWT access tokens (15 min, in-memory) + opaque refresh tokens (7 d, HttpOnly cookie, SHA-256 hashed in DB) |

---

## Architecture

```
                        ┌──────────────────────────┐
                        │  React + Vite client     │
                        │  ─ TanStack Query (data) │
                        │  ─ Zustand    (UI state) │
                        │  ─ Socket.io  (realtime) │
                        └────────────┬─────────────┘
                                     │ REST + WS + SSE
                                     ▼
                  ┌────────────────────────────────────┐
                  │   Express + Socket.io  (server)    │
                  │   ─ controllers / routes           │
                  │   ─ JWT auth + JTI blacklist       │
                  │   ─ Zod validation, IDOR guards    │
                  │   ─ Winston logging                │
                  └─────────┬──────────────┬───────────┘
                            │              │
                ┌───────────┘              └────────────┐
                ▼                                       ▼
   ┌─────────────────────────┐         ┌────────────────────────────┐
   │  PostgreSQL (Supabase)  │         │   Redis (Upstash, ioredis) │
   │  ─ users, rooms,        │         │   ─ presence:{userId}      │
   │    messages (+ vec 768) │         │   ─ typing:{room}:{user}   │
   │    refresh_tokens,      │         │   ─ blacklist:{jti}        │
   │    reactions, reads     │         │   ─ unread:{user}:{room}   │
   │  ─ HNSW + trgm indexes  │         │   ─ ai-cache, rate-limits  │
   └─────────────────────────┘         └────────────────────────────┘
                ▲                                       ▲
                │                                       │
                └────────────┐         ┌────────────────┘
                             │         │
                  ┌──────────┴─────────┴──────────┐
                  │   BullMQ embedding worker     │
                  │   ← every new message         │
                  │   → Gemini text-embedding-004 │
                  │   → UPDATE messages SET vec   │
                  └───────────────────────────────┘

  Groq Llama 3.3-70B       Gemini API           ImageKit
  ────────────────────     ──────────────       ────────────────
  smart-reply, tone,       embeddings,          file storage,
  editor, assistant SSE,   semantic search      signed uploads,
  summarizer SSE                                CDN delivery
```

---

## Features

### Core messaging
- Direct messages and group rooms (DB-level)
- Real-time delivery via Socket.io
- Typing indicators (3 s Redis TTL — no DB writes)
- Online / offline presence (30 s TTL heartbeat, snapshot sync on connect)
- Read receipts + per-room unread counters
- Offline message replay on reconnect (`room:replay` with `has_gap` fallback)
- Cursor-based infinite scroll on `(created_at, id)`
- Message editing, soft-delete, and emoji reactions
- File / image / PDF / DOC uploads to ImageKit with magic-byte validation
- Delete conversation (removes you; if no members remain, room and messages cascade)

### AI features (Groq + Gemini + SSE)
- **Smart Reply Chips** — 3 context-aware suggestions written from *your* perspective; reply to the other party or follow up on your own message
- **Tone Shifter** — Rewrite drafts in Professional / Friendly / Empathetic / Concise / Witty
- **Improve Writing** — Custom-instruction editor
- **"Catch Me Up" Summarizer** — SSE-streamed structured summary of the last 100 messages
- **AI Co-pilot Sidebar** — ChatGPT-style assistant with Markdown rendering, stop-generation control
- **Room Q&A** — Toggle "Room context" → assistant grounds answers in the actual transcript (last 100 text messages) and cites participants; refuses to invent facts
- **Semantic Search** — Search by *meaning* via pgvector cosine similarity over Gemini embeddings; results show match-percentage badges

### Security
- Bcrypt (12 rounds) for passwords
- Refresh-token rotation with breach detection: replay of a revoked token revokes **all** of that user's refresh tokens
- JTI blacklist on logout, checked by REST middleware and Socket.io handshake
- IDOR pattern: unauthorized resource access returns `404` (not 403) to prevent scanning
- Prompt-injection guardrails in every AI system prompt; user text wrapped in `<text>…</text>` for tone/editor to prevent the model from being addressed
- File upload validation (magic bytes, size, executable blocking) on both client and server
- Rate limiting: 5 auth attempts / 15 min per IP, 10 AI requests / 60 s per user
- Helmet, CORS, HttpOnly + Secure + SameSite=Strict refresh cookies
- Per-user smart-reply cache keys (no perspective bleed across participants)

---

## Project layout

```
chat-app/
├── client/                 React 19 + Vite + TS + Tailwind 4
│   └── src/
│       ├── components/     UI (chat, sidebar, modals, AI panels)
│       ├── features/       TanStack Query hooks (rooms, messages, ai, users)
│       ├── hooks/          useSocket — listens to socket events, mutates RQ cache
│       ├── stores/         Zustand — activeRoomId, presence, typing, unread, panel flags
│       ├── lib/            Axios clients, env validation, socket bootstrap
│       ├── providers/      AuthProvider — restores session on load
│       └── pages/          Login, Register, Chat
│
└── server/                 Node + Express + TS
    └── src/
        ├── controllers/    auth, room, message, file, ai, user
        ├── routes/         Express routers
        ├── socket.ts       Socket.io singleton + event handlers
        ├── workers/        BullMQ embedding worker
        ├── queues/         BullMQ queue + addEmbeddingJob
        ├── utils/          ai.service, ai.prompts, gemini.service, imagekit.service, logger, auth
        ├── middlewares/    JWT auth, rate-limit
        ├── schemas/        Zod validators for every route
        ├── config/         env (Zod-validated), db pool, redis client, imagekit, bullmq
        ├── scripts/        seed_demo.ts (demo accounts + sample transcript)
        └── schema.sql      Full Postgres schema
```

`CLAUDE.md` at the repo root documents the gotchas worth knowing before editing.

---

## Setup

### Prerequisites
- Node.js 20+
- A Postgres database with the `vector`, `uuid-ossp`, and `pg_trgm` extensions (Supabase free tier works)
- A Redis instance (Upstash free tier works)
- API keys: ImageKit (public + private + URL endpoint), Groq, Gemini

### 1. Database
Apply `server/schema.sql` to your Postgres instance once.

### 2. Server env (`server/.env`)
```env
PORT=4000
NODE_ENV=development

DATABASE_URL=postgresql://...
UPSTASH_REDIS_URL=rediss://...

JWT_ACCESS_SECRET=<at least 32 chars of random>
JWT_REFRESH_SECRET=<at least 32 chars of random, different from access>

IMAGEKIT_PUBLIC_KEY=public_xxx
IMAGEKIT_PRIVATE_KEY=private_xxx
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/yourId

GROQ_API_KEY=gsk_xxx
GEMINI_API_KEY=AIza_xxx
```

> ⚠️ `server/src/config/env.ts` validates these via Zod and **exits the process** on bad config. Typos in keys (especially ImageKit private key — easy to double-paste the `private_` prefix) will surface as `Internal server error` on file uploads.

### 3. Client env (`client/.env`)
```env
VITE_API_BASE_URL=http://localhost:4000/api/v1
VITE_SOCKET_URL=http://localhost:4000
```

### 4. Install + run
```bash
# server
cd server
npm install
npm run dev        # ts-node-dev with respawn

# client (separate terminal)
cd client
npm install
npm run dev        # Vite (default :5173)
```

### 5. (Optional) Seed demo accounts
```bash
cd server
npx ts-node src/scripts/seed_demo.ts
```

Creates:
- `demo1@contextchat.com` / `Demo1234!` — username **alex_demo**
- `demo2@contextchat.com` / `Demo1234!` — username **sam_demo**
- A pre-loaded DM conversation that exercises semantic search, Room Q&A, and the summarizer.

The script is idempotent — running it again wipes and recreates the demo state.

### 6. Production build
```bash
cd server && npm run build && npm start    # → dist/index.js
cd client && npm run build                  # → dist/ (serve with any static host)
```

---

## API surface (high-level)

```
POST /api/v1/auth/{register|login|refresh|logout}

GET    /api/v1/users/me           PATCH /api/v1/users/me
GET    /api/v1/users/search?q=

POST   /api/v1/rooms              GET    /api/v1/rooms
GET    /api/v1/rooms/:id          PATCH  /api/v1/rooms/:id
DELETE /api/v1/rooms/:id          (leaves; deletes room if empty)
GET    /api/v1/rooms/:id/members  POST   /api/v1/rooms/:id/members
DELETE /api/v1/rooms/:id/members/:userId

GET    /api/v1/messages/room/:roomId                 cursor pagination
GET    /api/v1/messages/room/:roomId/semantic-search Gemini + pgvector
POST   /api/v1/messages/room/:roomId
PATCH  /api/v1/messages/:id
DELETE /api/v1/messages/:id
POST   /api/v1/messages/:id/react                   toggle emoji

POST   /api/v1/files/sign                            ImageKit auth params
POST   /api/v1/rooms/:roomId/files                   multipart upload
DELETE /api/v1/files/:publicId

POST   /api/v1/ai/smart-reply  {roomId}
POST   /api/v1/ai/tone         {text, tone}
POST   /api/v1/ai/editor       {text, instruction}
POST   /api/v1/ai/assistant    {history, roomId?}    SSE stream
POST   /api/v1/ai/summarize    {roomId}              SSE stream

GET    /health                                       liveness
GET    /ready                                        DB + Redis readiness
```

Socket events: `message:send`, `message:new`, `message:update`, `message:reactions`, `message:read`, `room:join`, `room:replay`, `typing:start|stop|update`, `presence:heartbeat|sync|update`.

---

## Deployment

ContextChat is provider-agnostic. A free-tier-friendly setup:

| Component | Suggested host |
|---|---|
| Postgres | Supabase free tier (already has `pgvector`) |
| Redis | Upstash free tier |
| Backend | Render / Railway / Fly.io (Node service, port from `$PORT`) |
| Frontend | Vercel / Netlify (static build from `client/dist/`) |
| File storage | ImageKit (free tier covers small projects) |

**Before deploying:**
1. Generate fresh 32+ char secrets for `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`.
2. Set `NODE_ENV=production` on the backend. Refresh cookies will then be sent with `Secure`.
3. Set client `VITE_API_BASE_URL` and `VITE_SOCKET_URL` to the deployed backend URL **at build time** (Vite inlines these).
4. Configure CORS on the backend to allow your frontend's deployed origin (currently permissive in dev).
5. Apply `server/schema.sql` to the production database.
6. Run the demo seed if you want pre-loaded accounts for evaluators.

---

## License & credits

Built as a final-year project. All third-party APIs are accessed through their free tiers. No proprietary code, no scraped data.
