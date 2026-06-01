# PROGRESS.md
### Read this first every session. Update after every completed stage.

---

## Current Status

**Active stage:** Stage 9 — React Chat UI, real-time
**Last completed:** Stage 8 — React Frontend Auth
**Next action:** Implement chat UI, Zustand store updates for rooms/messages, Socket.io integration, and components.

---

## Stage Completion Log

| Stage | Description | Status | Notes |
|---|---|---|---|
| 1 | Foundation — server setup, DB, env, health endpoints | ✅ Completed | Fully verified backend foundation |
| 2 | Auth — register, login, JWT, refresh, logout | ✅ Completed | Rotation breach detection, JTI blacklist |
| 3 | Rooms + messages REST API | ✅ Completed | Cursor pagination, IDOR protection |
| 4 | Socket.io real-time — messages, typing, presence, replay | ✅ Completed | Cap replay, typing TTL, presence TTL |
| 5 | File uploads — ImageKit (images, PDFs) | ✅ Completed | Signed uploads endpoint, file messaging |
| 6 | AI features — Groq (smart reply, editor, tone, assistant, summarizer) | ✅ Completed | SSE Streaming, rate limits, caching |
| 7 | Embeddings + semantic search — BullMQ + Gemini + pgvector | ✅ Completed | BullMQ background jobs, cosine distance |
| 8 | React frontend — auth, routing, API client | ✅ Completed | Checked and verified auth/routing setup |
| 9 | React frontend — chat UI, real-time | ⏳ In Progress | |
| 10 | React frontend — AI features UI | ⏳ Not started | |
| 11 | Deploy + CI/CD | ⏳ Not started | |

---

## Architectural Decisions (locked)

- **Single database:** PostgreSQL (Supabase) — messages as JSONB, vectors via pgvector. No MongoDB, no Qdrant.
- **Single backend:** Node.js + Express — handles all AI calls natively. No FastAPI, no Python.
- **Message ordering:** PostgreSQL `created_at` — no Redis sequences (would break on Upstash eviction).
- **Embeddings:** Gemini API `text-embedding-004` (768-dim) called from Node.js — no sentence-transformers (OOM on Railway).
- **Summarization:** Direct context window — fetch 50-100 messages → transcript → Groq. NOT RAG.
- **Semantic search:** Gemini embed query → pgvector cosine similarity in PostgreSQL.
- **Refresh token hashing:** SHA-256 via Node `crypto` — bcrypt is for passwords only, would block event loop.
- **File storage:** ImageKit free tier (20GB storage + 20GB bandwidth/month). No MinIO (requires Docker).
- **Redis usage:** Presence TTL, typing TTL, JWT blacklist, AI cache, rate limits only.
- **No Docker in dev:** All DBs are cloud-hosted. Docker only needed at deployment (Railway handles it).

---

## Environment Variables Status

| Variable | Status |
|---|---|
| SUPABASE_URL | ✅ Active |
| SUPABASE_SERVICE_KEY | ✅ Active |
| UPSTASH_REDIS_URL | ✅ Active |
| UPSTASH_REDIS_TOKEN | ✅ Active |
| IMAGEKIT_PUBLIC_KEY | ✅ Active |
| IMAGEKIT_PRIVATE_KEY | ✅ Active |
| IMAGEKIT_URL_ENDPOINT | ✅ Active |
| GROQ_API_KEY | ✅ Active |
| GEMINI_API_KEY | ✅ Active |
| JWT_ACCESS_SECRET | ✅ Active |
| JWT_REFRESH_SECRET | ✅ Active |
| SENTRY_DSN | ✅ Active |

---

## Known Issues
None yet.

---

## Implementation Stages

### Stage 1 — Foundation & Setup

**Steps:**
1. Create GitHub repo. Init `/client` (React + Vite + TS) and `/server` (Node + TS). Configure `.gitignore`.
2. Create `.env.example` files (all keys from ARCHITECTURE.md, placeholder values).
3. Supabase: run full SQL schema from ARCHITECTURE.md — enable `uuid-ossp`, `vector`, `pg_trgm` extensions first.
4. Connect Upstash Redis, ImageKit, Sentry — copy keys to `.env`.
5. Install all server deps — **`npm show <pkg> version` before every install, then `npm audit`**.
6. Zod env validation in `src/config/env.ts` — app must crash on startup if any required var is missing.
7. Winston logger in `src/utils/logger.ts` — structured output, never log tokens or passwords.
8. Implement `GET /health` → `{ status: "ok" }` and `GET /ready` → `{ status: "ok", db: "connected" }`.

**Verify:**
- Missing env var → server refuses to start with clear Zod error ✓
- `GET /health` → 200 `{ status: "ok" }` ✓
- `GET /ready` → 200 `{ status: "ok", db: "connected" }` ✓

---

### Stage 2 — Auth & Security Infrastructure

**Steps:**
1. Mount security middleware in `app.ts`: `helmet()`, `cors({ origin: env.CORS_ORIGINS })`, `express.json({ limit: '10kb' })`.
2. Auth rate limiter: 5 attempts / 15 min per IP. AI rate limiter: 10 req / 60s per user.
3. `src/utils/tokenCompare.ts` — `crypto.timingSafeEqual` wrapper.
4. `src/utils/ownershipCheck.ts` — `assertOwnership` helper (always 404, never 403).
5. `POST /api/v1/auth/register` — bcrypt password (rounds 12), insert user, return access token.
6. `POST /api/v1/auth/login` — verify bcrypt, return access token in JSON + refresh token in `HttpOnly; Secure; SameSite=Strict` cookie.
7. `POST /api/v1/auth/refresh` — hash incoming token with **SHA-256** (`crypto.createHash('sha256').update(token).digest('hex')`), look up in DB, rotate (invalidate old, create new), return new access token.
8. `POST /api/v1/auth/logout` — blacklist access token JTI in Redis with TTL, clear cookie.
9. Rotation breach: if revoked token is reused → revoke ALL tokens for that user.
10. `auth.middleware.ts` — verify JWT, check Redis blacklist, attach user to `req`.
11. `GET /api/v1/users/me` — protected, return user (never include `password_hash`).
12. Commit Postman collection to `server/postman/collection.json`.

**Verify:**
- Register → receive access token ✓
- Login → httpOnly cookie set + access token ✓
- Protected route with token → 200 ✓
- Protected route without token → 401 `UNAUTHORIZED` ✓
- Expired token → 401 `TOKEN_EXPIRED` ✓
- Logout → same token rejected → 401 `TOKEN_INVALID` ✓
- Refresh → new token, old invalidated ✓
- 6th login attempt in 15 min → 429 ✓

---

### Stage 3 — Rooms + Messages REST

**Steps:**
1. `POST /api/v1/rooms` — create DM or group (insert room + room_member rows in transaction).
2. `GET /api/v1/rooms` — list all rooms for current user via room_members JOIN.
3. `GET /api/v1/rooms/:id` — room detail + members. Use `assertOwnership` to verify membership.
4. `POST /api/v1/rooms/:id/members` — add member (admin/owner only).
5. `DELETE /api/v1/rooms/:id/members/:userId` — remove member.
6. `GET /api/v1/users/search?q=` — search users by username.
7. `GET /api/v1/messages/:roomId` — cursor-based pagination using `created_at`. Query: `WHERE room_id = $1 AND created_at < $cursor ORDER BY created_at DESC LIMIT 20`.
8. `PATCH /api/v1/messages/:id` — edit content JSONB, set `edited_at`. Sender only.
9. `DELETE /api/v1/messages/:id` — soft delete: set `deleted_at`, blank content text.
10. `GET /api/v1/messages/:roomId/search?q=` — trigram search: `WHERE (content->>'text') ILIKE '%query%'` or GIN trigram index query.

**Verify:**
- Create DM → both users see it in room list ✓
- Non-member fetches room → 404 (not 403) ✓
- Fetch messages → ordered newest first by `created_at` ✓
- Non-sender edits → 403 ✓
- Soft delete → `deleted_at` set, row still exists ✓
- Keyword search → trigram matches ✓

---

### Stage 4 — Socket.io Real-time

**Steps:**
1. Initialize Socket.io server, bind to HTTP server instance.
2. JWT handshake middleware — reject unauthenticated socket connections.
3. `room:join` handler — join Socket.io room, query `messages WHERE room_id = $1 AND created_at > $lastReadAt ORDER BY created_at ASC`, emit `message:replay`.
4. `message:send` handler:
   - Save message to PostgreSQL with `created_at = now()`
   - `io.to(roomId).emit('message:new', message)`
   - Queue BullMQ embedding job (async — never block delivery)
5. `message:read` handler — update `delivery_status` JSONB map in PostgreSQL + update `last_read_at` in room_members.
6. `typing:start` — `SET typing:{roomId}:{userId} 1 EX 3` in Redis. Broadcast `typing:update`.
7. `presence:heartbeat` — `SET presence:{userId} online EX 30`. Broadcast transitions.
8. Unread count: `INCR unread:{userId}:{roomId}` on new message, `DEL` on `room:join`.

**Verify (two Chrome profiles on localhost:3000):**
- User A sends → User B receives instantly ✓
- User A types → User B sees indicator → disappears after 3s automatically ✓
- User A closes tab → User B sees offline after ~30s ✓
- User A offline → messages sent → reconnects → all replayed in order ✓
- Unread badge shows, clears on room open ✓

---

### Stage 5 — File Uploads

**Steps:**
1. `imagekit.service.ts` — ImageKit SDK wrapper for auth params and delete.
2. `POST /api/v1/files/sign` — call `imagekit.getAuthenticationParameters()`, return `{ token, expire, signature, publicKey, urlEndpoint }` to client.
3. Client uploads directly to `https://upload.imagekit.io/api/v1/files/upload` with `{ file, fileName, publicKey, token, expire, signature }`.
4. `POST /api/v1/rooms/:roomId/files` — register the returned `{ url, fileId }` as a message row, emit `message:new` via socket.
5. `DELETE /api/v1/files/:fileId` — delete from ImageKit by fileId + soft delete the message row.

**Verify:**
- Upload PNG → appears in chat for both users ✓
- Upload PDF → file message with filename shown ✓
- Upload .exe → 400 blocked ✓
- Upload 30MB → 413 too large ✓

---

### Stage 6 — AI Features (Groq — no Python, no FastAPI)

**Steps:**
1. **Web search `"groq-sdk npm latest docs"` before writing any Groq code.**
2. `ai.service.ts` — Groq SDK client wrapper. All prompts in `prompts.ts`.
3. `POST /api/v1/ai/smart-reply` — fetch last 10 messages from PostgreSQL → call Groq → 3 suggestions as JSON array → cache in Redis `ai:reply:{hash}` TTL 5 min.
4. `POST /api/v1/ai/editor` — user text → Groq rewrite prompt → return improved text.
5. `POST /api/v1/ai/tone` — user text + tone string → Groq tone rewrite → return result.
6. `POST /api/v1/ai/assistant` — conversation history → Groq streaming → SSE response.
7. `POST /api/v1/ai/summarize`:
   - Fetch last 50-100 messages from PostgreSQL ordered by `created_at ASC`
   - Format as plain transcript: `"Username: message text\n"`
   - Send transcript directly to Groq (Mixtral 32k context handles ~1,500 tokens easily)
   - Stream response back via SSE — **no embeddings, no vector retrieval, no RAG**
8. AI rate limiter enforced on all `/api/v1/ai/*` routes — 429 if > 10/min per user.

**Verify (Postman):**
- `POST /ai/smart-reply` → JSON array of 3 strings ✓
- Same request again → Redis cache hit, faster ✓
- `POST /ai/editor` with rough text → cleaner version ✓
- `POST /ai/tone` text + "professional" → formal version ✓
- `POST /ai/summarize` → streams coherent paragraph summary ✓
- 11th AI call in 60s → 429 ✓

---

### Stage 7 — Embeddings + Semantic Search (BullMQ + Gemini + pgvector)

**Steps:**
1. **Web search `"@google/generative-ai latest docs embedding"` before writing any Gemini code.**
2. Create `embedding.queue.ts` (BullMQ) — after every message is saved in Stage 4 handler, add job to queue.
3. BullMQ worker — call Gemini `text-embedding-004` → get 768-dim vector → update `messages.embedding` column: `UPDATE messages SET embedding = $1 WHERE id = $2`.
4. `GET /api/v1/messages/:roomId/semantic-search?q=` — embed query via Gemini → pgvector cosine similarity query:
   ```sql
   SELECT * FROM messages
   WHERE room_id = $1 AND embedding IS NOT NULL
   ORDER BY embedding <=> $2
   LIMIT 20
   ```
5. Filter out results with cosine distance > 0.35 (similarity < 0.65) — avoids irrelevant matches.

**Verify:**
- Send 20 messages → check Supabase table → `embedding` column populated for each ✓
- Semantic search "project deadline" → finds messages about deadlines without exact words ✓
- Empty `embedding` column messages excluded from results ✓

---

### Stage 8 — React Frontend Auth

**Steps:**
1. Zod env validation in `src/lib/env.ts` for all `VITE_*` vars.
2. `tokenStore.ts` — access token in memory only, never localStorage.
3. `refreshClient.ts` — separate axios instance, NO interceptors.
4. `client.ts` — single-flight refresh interceptor queue. On fail → `tokenStore.clear()` + redirect `/login`.
5. `AuthProvider.tsx` — on app load: try refresh → set user. Loading spinner until resolved.
6. React Router — `/login`, `/register`, `/` (protected via `RequireAuth`).
7. `ErrorBoundary.tsx` — wrap entire app in `App.tsx`.
8. Login + Register pages — React Hook Form + Zod validation.

**Verify:**
- Register → redirected to chat ✓
- Refresh page → still logged in (token refreshed from cookie) ✓
- 3 simultaneous 401s → exactly ONE refresh call fires ✓
- Navigate to `/` without auth → `/login` ✓

---

### Stage 9 — React Chat UI

**Steps:**
1. TanStack QueryClient in `App.tsx`.
2. `features/rooms/api.ts` — `useRooms`, `useCreateRoom` with TanStack Query.
3. `features/messages/api.ts` — `useMessages` with infinite scroll, `useSendMessage`.
4. Sidebar: `RoomList`, `RoomItem` (unread badge), `UserSearch`.
5. `ChatWindow`, `MessageList`, `MessageBubble` (sent/received styles, reactions, reply preview, read receipts).
6. `MessageInput` — text input, attach button, send, AI sparkle button.
7. `TypingIndicator` — 3 bouncing dots CSS animation.
8. `useSocket.ts` — connect on login, update Zustand stores on all socket events.
9. `DOMPurify.sanitize()` on all user-generated message content before render.

**Verify (two Chrome profiles):**
- Register 2 users → create DM → real-time messages ✓
- Typing indicator appears and disappears ✓
- File upload → image shows in chat ✓
- Unread badge clears on room open ✓

---

### Stage 10 — React AI Features UI

**Steps:**
1. `SuggestionChips` — fetch on room open, 3 tappable chips, tap → send message.
2. AI sparkle button → floating toolbar: Suggest / Edit / Tone.
3. `ToneSelector` — 6 tone pills, click rewrites input text in place.
4. `AIPanel` — clicking "AI Assistant" in sidebar replaces right panel with ChatGPT-style streaming chat.
5. Summarize button in chat header → streaming summary in modal/sheet.
6. Semantic search bar → debounced queries → results highlighted in message list.

**Verify:**
- Tap suggestion chip → sends instantly ✓
- Type rough text → Edit → improved text in input ✓
- Select tone → text rewritten ✓
- AI panel conversation works ✓
- Summarize streams word by word ✓
- Semantic search finds meaning-based matches ✓

---

### Stage 11 — Deploy + CI/CD

**Steps:**
1. GitHub Actions `.github/workflows/ci.yml` — on push: `npm ci`, `tsc --noEmit`, `npm audit` (fail on high/critical).
2. Full end-to-end test with two Chrome profiles.
3. Deploy React to Vercel — connect `/client`, set `VITE_API_BASE_URL` + `VITE_SOCKET_URL`.
4. Deploy Node.js to Railway — connect `/server`, inject all env vars.
5. Supabase: update IP allowlist to include Railway server IP.
6. `README.md` — description, tech stack badges, screenshots, live URL.

**Verify:**
- CI badge green on GitHub ✓
- Deployed app loads ✓
- Two users on deployed URL → real-time works ✓
- All AI features work in production ✓
- `npm audit` passes — zero high/critical ✓
