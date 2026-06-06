# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: ContextChat

Real-time chat with semantic memory — production-grade messaging plus AI features (semantic search, room-grounded Q&A, smart replies, tone shifting, live summarization). The brand name in UI is **ContextChat**; older docs may still say "Antigravity Chat" or "OmniChat" — those are stale.

## Repo Layout

Two-package monorepo with **no root `package.json`** — `client/` and `server/` are independent. Run all commands from inside the relevant package.

- `client/` — React 19 + Vite + TypeScript + TailwindCSS 4 frontend
- `server/` — Node.js + Express + TypeScript backend (REST + Socket.io + BullMQ worker)
- `server/schema.sql` — Postgres schema with `pgvector`, HNSW index, and a normalized `message_reactions` table
- `server/src/scripts/seed_demo.ts` — idempotent demo-account seeder (run with `npx ts-node`)
- `README.md`, `deploy_instruction.md` — user-facing docs (kept accurate, safe to trust)
- `ARCHITECTURE.md`, `PROJECT_SPECIFICATION.md` — older design docs; partially aspirational and partially stale (e.g. they describe a `modules/` server layout that doesn't exist, and `content JSONB` for messages when the real schema has separate `content`/`file_url`/`file_name` columns). **When the docs disagree with the code, the code is right.**

## Common Commands

```bash
# Server (from server/)
npm run dev      # ts-node-dev with respawn, transpile-only
npm run build    # tsc → dist/
npm start        # node dist/index.js

# Client (from client/)
npm run dev      # Vite dev server (default :5173)
npm run build    # tsc -b && vite build
npm run lint     # ESLint
npm run preview  # serve built dist/

# Demo seed (from server/)
npx ts-node src/scripts/seed_demo.ts
# Creates demo1@contextchat.com / Demo1234! (alex_demo)
# and demo2@contextchat.com / Demo1234! (sam_demo)
# with a preloaded DM transcript designed to exercise every AI feature.
# Wipes existing demo rows first; safe to rerun.
```

No test runners are configured. Verification = `npm run build` (both packages must compile cleanly) + manual browser test. Ad-hoc `server/src/test_*.ts` scripts exist (`test_rooms.ts`, `test_sockets.ts`, `test_ai.ts`, `test_files.ts`, `test_search.ts`) — run with `npx ts-node src/test_<name>.ts`.

## Environment

Both `client/.env` and `server/.env` are required. `server/src/config/env.ts` validates everything via Zod and **exits the process** on bad config.

Required server vars: `DATABASE_URL`, `UPSTASH_REDIS_URL`, `JWT_ACCESS_SECRET` (≥32 chars), `JWT_REFRESH_SECRET` (≥32 chars), `IMAGEKIT_PUBLIC_KEY` / `IMAGEKIT_PRIVATE_KEY` / `IMAGEKIT_URL_ENDPOINT`, `GROQ_API_KEY`, `GEMINI_API_KEY`.

**`CORS_ORIGIN` is required when `NODE_ENV=production`** (Zod refuses to boot otherwise) — it's a comma-separated allowlist of frontend origins. In dev it's optional and the CORS middleware falls back to permissive.

Client needs `VITE_API_BASE_URL` and `VITE_SOCKET_URL`. These are inlined at build time, so changing them requires a rebuild.

The client uses the `@/*` path alias mapped to `src/*` (see `tsconfig.app.json`). Note that `tsconfig.app.json` sets `"ignoreDeprecations": "6.0"` because TS 6 deprecated `baseUrl` — don't downgrade this string without removing `baseUrl`.

## Architecture (the parts not obvious from browsing)

### Data layer
- **PostgreSQL (Supabase)** for users, rooms, room_members, messages, refresh_tokens, message_reads, message_reactions. The `messages` table stores `embedding vector(768)` **inline** (no separate embeddings table) with an HNSW cosine index. Message ordering is **`created_at TIMESTAMPTZ`** everywhere — there is no sequence column. Cursor pagination encodes `{created_at, id}` as base64.
- **Redis (Upstash, ioredis)** holds presence (`presence:{userId}`, 30s TTL via heartbeat), typing (`typing:{roomId}:{userId}`, 3s TTL), JWT blacklist on logout (`blacklist:{jti}`), per-room unread counters (`unread:{userId}:{roomId}`), AI response cache, and rate-limit counters.
- **ImageKit** stores binary uploads. The server SDK (`@imagekit/nodejs` v7) is invoked from `utils/imagekit.service.ts` — note its API is `imagekit.files.upload(...)` / `imagekit.files.delete(...)` / `imagekit.helper.getAuthenticationParameters()`.
- **BullMQ** runs an embedding worker (`workers/embedding.worker.ts`) started from `index.ts`. Every new message enqueues a job; the worker calls Gemini `text-embedding-004` (768-dim) and writes the vector back into the message row.

### Auth flow (security-critical — touch with care)
- Access tokens: short-lived JWT, carried in memory on the client (`lib/tokenStore.ts`), sent as `Authorization: Bearer ...`. JWT payload includes a `jti`.
- Refresh tokens: opaque, stored in an **HttpOnly cookie**, hashed with SHA-256 in `refresh_tokens` (NOT bcrypt — bcrypt is only for passwords).
- Refresh is **rotated** on every use. If a revoked refresh token is replayed, **all of that user's refresh tokens are revoked** (breach detection). This logic lives in `controllers/auth.controller.ts`.
- Cookie options live in `utils/auth.ts` → `getCookieOptions()`. In production: `SameSite=None; Secure` (so the cookie crosses Vercel↔Render). In dev: `SameSite=Lax`. **Do not flip prod back to `Strict`** — it kills cross-site refresh.
- Logout writes the access token's `jti` to `blacklist:{jti}` in Redis with TTL = remaining token lifetime. Both REST `authMiddleware` and the Socket.io handshake check this blacklist on every request/connection.
- The Axios client (`client/src/lib/client.ts`) has a single-flight refresh interceptor. `refreshClient.ts` is a separate Axios instance **without** interceptors — it exists specifically to avoid an infinite 401 loop when the refresh endpoint itself returns 401.
- **IDOR convention:** when a user requests a resource they don't own/belong to, controllers return **404, not 403** (prevents resource scanning). Membership is checked via direct queries against `room_members`.

### Real-time (Socket.io)
- Socket.io is initialized in `server/src/socket.ts` and exported as a singleton `io`. It also imports `allowedOrigins` from `app.ts` so REST and WebSocket share the exact same CORS allowlist — don't duplicate the parsing logic. Connection auth happens in `io.use(...)` via the same JWT + Redis blacklist path as REST.
- On `connection` the server: (1) joins all of the user's rooms from Postgres, (2) sets `presence:{userId}` in Redis, (3) emits `presence:update` to every room marking this user online, and (4) emits a **`presence:sync`** event back to the connecting socket with `{ userId: 'online' | 'offline' }` for every other room member. The client handles `presence:sync` in `hooks/useSocket.ts` — without it, a new connection would never learn about users who were already online.
- `room:join` replays unread messages since `last_read_at`. If more than 50 messages are missed, it emits `room:replay` with `has_gap: true` and an empty array; the client falls back to a REST fetch in that case.
- `message:send` over the socket inserts into Postgres, increments `unread:{userId}:{roomId}` in Redis for every other room member, broadcasts `message:new`, and enqueues a BullMQ embedding job.
- `message:reactions` is broadcast by the REST react endpoint (`POST /messages/:messageId/react`) after toggling. Payload: `{ messageId, roomId, reactions: [{emoji, users: string[]}, ...] }`. The client merges it into the TanStack Query cache in `useSocket.ts`.

### Reactions schema invariant
Every new message INSERT in three places (`controllers/message.controller.ts` `createMessage`, `socket.ts` `message:send` handler, `controllers/file.controller.ts` upload paths) returns **`'[]'::json AS reactions`** in its RETURNING clause so the client always receives a Message with a `reactions` field. `getRoomMessages` builds the reactions list inline with a SQL subquery aggregation (no N+1). The aggregation is `json_agg(json_build_object('emoji', emoji, 'users', users))` grouped by emoji. If you add a new INSERT path, add the `'[]'::json AS reactions` to keep the shape consistent.

### AI features (Groq + Gemini + SSE)
- All AI routes are in `controllers/ai.controller.ts`, with the LLM calls factored into `utils/ai.service.ts` and prompts isolated in `utils/ai.prompts.ts`. The Groq model is `llama-3.3-70b-versatile`.
- **Streaming endpoints (`/ai/assistant`, `/ai/summarize`) use SSE**, not WebSockets. The client reads them via `streamSse` in `client/src/features/ai/api.ts` using `fetch` + `ReadableStream` (Axios cannot stream). Chunks are `data: {"content": "..."}\n\n`; the stream ends with `data: [DONE]`. **`streamSse` hard-fails if `VITE_API_BASE_URL` is missing** — no localhost fallback (previously fell back to a wrong port and silently broke things).
- **`/ai/assistant` accepts optional `roomId`.** When provided, the controller verifies room membership, fetches the last 100 non-deleted text messages, and injects them into the system prompt as a transcript. This is what powers the "Room context" toggle in `components/chat/AiAssistantSidebar.tsx`. Without `roomId` the assistant works as a generic chat AI.
- **Tone & editor prompts wrap user text in `<text>...</text>` tags.** This is load-bearing — without the wrapper, the model interprets short user text (e.g. "hi") as a greeting addressed to it and replies conversationally instead of rewriting. The wrapper plus an explicit "do not respond as if it were addressed to you" rule keeps it on task. Apply the same pattern if you add new rewrite-style prompts.
- **Smart replies are perspective-aware.** `generateSmartReplies(messages, currentUsername, currentUserSpokeLast)` always writes in the current user's voice. The controller looks up `currentUsername` from Postgres and computes `currentUserSpokeLast` from the most recent row. The service then sends one of two directives to Groq:
  - If the current user spoke last → "suggest FOLLOW-UP messages they could send next; don't echo what they already said"
  - If someone else spoke last → "suggest replies to that message"
  The Redis cache key is **scoped per-user**: `ai:smart-reply:{userId}:{sha256}` — without the userId in the key, two participants in the same conversation would see each other's perspective.
- The semantic-search endpoint (`GET /messages/room/:roomId/semantic-search?q=`) returns `{ query, results: SemanticSearchResult[], total }`. Each result includes a `similarity` number (0–1, from `1 - cosine_distance`) and a `sender_username` joined in.

### Frontend state
- **TanStack Query** owns server state (rooms, messages, search results, smart replies). Message lists use `useInfiniteQuery` with cursor pagination.
- **Zustand** (`stores/chatStore.ts`, `stores/authStore.ts`) owns real-time/UI state only: `activeRoomId`, presence map, typing map, unread counts, panel open/closed flags. **Do not put server data in Zustand** — that's TanStack Query's job, and duplicating leads to stale-data bugs.
- Socket event handlers (`hooks/useSocket.ts`) mutate the TanStack Query cache directly via `queryClient.setQueryData` to push real-time updates into the same data the components already read.

## Conventions worth knowing

- File magic-byte validation runs on **both** client (`MessageInput.tsx`) and server (`file.controller.ts`) for image/PDF/DOC uploads. Keep them in sync if you add a new type.
- Route mounting in `server/src/app.ts` mounts `fileRoutes` at `/api/v1` (not `/api/v1/files`) because the file router internally uses paths like `/files/sign` and `/rooms/:roomId/files`. Be careful when moving routes between files.
- `DELETE /api/v1/rooms/:roomId` is a "leave conversation" — it removes the current user from `room_members` inside a transaction, and if no members remain, hard-deletes the room (messages cascade via FK). The other party in a DM keeps the room and history when one side leaves.
- ESLint runs only on the client (`npm run lint` in `client/`). There's no server linter.
- Logging goes through Winston (`utils/logger.ts`). Never log token strings, password hashes, or full request bodies on auth endpoints.
- All popovers/dropdowns (AI rewrite menu, kebab menus, etc.) use **solid `bg-zinc-950`** rather than `glass-panel`/`backdrop-blur` — translucent menus over chat bubbles were unreadable. Stick with solid backgrounds for new menus.
