# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo Layout

Two-package monorepo with **no root `package.json`** — `client/` and `server/` are independent. Run all commands from inside the relevant package.

- `client/` — React 19 + Vite + TypeScript + TailwindCSS 4 frontend
- `server/` — Node.js + Express + TypeScript backend (REST + Socket.io + BullMQ worker)
- `server/schema.sql` — Postgres schema, including pgvector extension and HNSW index
- `ARCHITECTURE.md`, `PROJECT_SPECIFICATION.md` — design docs (some details are aspirational / drift from code; trust the code when they disagree)

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
```

There are no test runners configured. Verification is done via `npm run build` (both packages must compile cleanly) and manual browser testing. Several ad-hoc `server/src/test_*.ts` scripts exist (`test_rooms.ts`, `test_sockets.ts`, `test_ai.ts`, `test_files.ts`, `test_search.ts`) — run them with `npx ts-node src/test_<name>.ts` from `server/`.

## Environment

Both `client/.env` and `server/.env` are required. `server/src/config/env.ts` validates everything via Zod and **exits the process** on bad config — symptoms of misconfig are not subtle. Required server vars include `DATABASE_URL`, `UPSTASH_REDIS_URL`, `JWT_ACCESS_SECRET` (≥32 chars), `JWT_REFRESH_SECRET` (≥32 chars), `IMAGEKIT_PUBLIC_KEY` / `IMAGEKIT_PRIVATE_KEY` / `IMAGEKIT_URL_ENDPOINT`, `GROQ_API_KEY`, `GEMINI_API_KEY`. Client needs `VITE_API_BASE_URL` and `VITE_SOCKET_URL`.

The client uses the `@/*` path alias mapped to `src/*` (see `tsconfig.app.json`).

## Architecture (the parts not obvious from browsing)

### Data layer
- **PostgreSQL (Supabase)** for users, rooms, room_members, messages, refresh_tokens, message_reads, message_reactions. The `messages` table stores `embedding vector(768)` **inline** (no separate embeddings table) and has an HNSW cosine index. Message ordering is **`created_at TIMESTAMPTZ`** everywhere — there is no sequence column. Cursor pagination encodes `{created_at, id}` as base64.
- **Redis (Upstash, ioredis)** holds presence (`presence:{userId}`, 30s TTL via heartbeat), typing (`typing:{roomId}:{userId}`, 3s TTL), JWT blacklist on logout (`blacklist:{jti}`), per-room unread counters (`unread:{userId}:{roomId}`), AI response cache, and rate-limit counters.
- **ImageKit** stores binary uploads. The server SDK (`@imagekit/nodejs` v7) is invoked from `utils/imagekit.service.ts` — note its API is `imagekit.files.upload(...)` / `imagekit.files.delete(...)` / `imagekit.helper.getAuthenticationParameters()`.
- **BullMQ** runs an embedding worker (`workers/embedding.worker.ts`) started from `index.ts`. Every new message enqueues a job; the worker calls Gemini `text-embedding-004` (768-dim) and writes the vector back into the message row.

### Auth flow (security-critical — touch with care)
- Access tokens: short-lived JWT, carried in memory on the client (`lib/tokenStore.ts`), sent as `Authorization: Bearer ...`. JWT payload includes a `jti`.
- Refresh tokens: opaque, stored in an **HttpOnly cookie**, hashed with SHA-256 in `refresh_tokens` (NOT bcrypt — bcrypt is only for passwords).
- Refresh is **rotated** on every use. If a revoked refresh token is replayed, **all of that user's refresh tokens are revoked** (breach detection). This logic lives in `controllers/auth.controller.ts`.
- Logout writes the access token's `jti` to `blacklist:{jti}` in Redis with TTL = remaining token lifetime. Both REST `authMiddleware` and the Socket.io handshake check this blacklist on every request/connection.
- The Axios client (`client/src/lib/client.ts`) has a single-flight refresh interceptor. `refreshClient.ts` is a separate Axios instance **without** interceptors — it exists specifically to avoid an infinite 401 loop when the refresh endpoint itself returns 401.
- **IDOR convention:** when a user requests a resource they don't own/belong to, controllers return **404, not 403** (prevents resource scanning). Membership is checked via direct queries against `room_members`; see e.g. `controllers/message.controller.ts` and `controllers/file.controller.ts`.

### Real-time (Socket.io)
- Socket.io is initialized in `server/src/socket.ts` and exported as a singleton `io` (also imported by some REST controllers to broadcast e.g. file uploads). Connection auth happens in `io.use(...)` middleware via the same JWT + Redis blacklist path as REST.
- On `connection` the server: (1) joins all of the user's rooms from Postgres, (2) sets `presence:{userId}` in Redis, (3) emits `presence:update` to every room with this user as online, and (4) emits a **`presence:sync`** event back to the connecting socket with `{ userId: 'online' | 'offline' }` for every other room member. The client handles `presence:sync` in `hooks/useSocket.ts` — without it, a new connection would never learn about users who were already online.
- `room:join` replays unread messages since `last_read_at`. If more than 50 messages are missed, it emits `room:replay` with `has_gap: true` and an empty array; the client falls back to a REST fetch in that case.
- `message:send` over the socket inserts into Postgres, increments `unread:{userId}:{roomId}` in Redis for every other room member, broadcasts `message:new`, and enqueues a BullMQ embedding job.

### AI features (Groq + Gemini + SSE)
- All AI routes are in `controllers/ai.controller.ts`, with the LLM calls factored into `utils/ai.service.ts` and prompts isolated in `utils/ai.prompts.ts`. The model used for Groq is `llama-3.3-70b-versatile`.
- **Streaming endpoints (`/ai/assistant`, `/ai/summarize`) use SSE**, not WebSockets. The client reads them via `streamSse` in `client/src/features/ai/api.ts` using `fetch` + `ReadableStream` (Axios cannot stream). Chunks are `data: {"content": "..."}\n\n`; the stream ends with `data: [DONE]`.
- **`/ai/assistant` accepts optional `roomId`.** When provided, the controller verifies room membership, fetches the last 100 non-deleted text messages, and injects them into the system prompt as a transcript. This is what powers the "Room context" toggle in `components/chat/AiAssistantSidebar.tsx`. Without `roomId` the assistant works as a generic chat AI.
- **Tone & editor prompts wrap user text in `<text>...</text>` tags.** This is load-bearing — without the wrapper, the model interprets short user text (e.g. "hi") as a greeting addressed to it and replies conversationally instead of rewriting. The wrapper plus an explicit "do not respond as if it were addressed to you" rule in `TONE_SYSTEM_PROMPT` keeps it on task. Apply the same pattern if you add new rewrite-style prompts.
- Smart replies (`/ai/smart-reply`) and AI responses are cached in Redis with content-hash keys.

### Frontend state
- **TanStack Query** owns server state (rooms, messages, search results, smart replies). Message lists use `useInfiniteQuery` with cursor pagination.
- **Zustand** (`stores/chatStore.ts`, `stores/authStore.ts`) owns real-time/UI state only: `activeRoomId`, presence map, typing map, unread counts, panel open/closed flags. **Do not put server data in Zustand** — that's TanStack Query's job, and duplicating leads to stale-data bugs.
- Socket event handlers (`hooks/useSocket.ts`) mutate the TanStack Query cache directly via `queryClient.setQueryData` to push real-time updates into the same data the components already read.

## Conventions worth knowing

- File magic-byte validation runs on **both** client (`MessageInput.tsx`) and server (`file.controller.ts`) for image/PDF/DOC uploads. Keep them in sync if you add a new type.
- The TypeScript client uses `"ignoreDeprecations": "6.0"` in `tsconfig.app.json` because TS 6 deprecated `baseUrl`. Don't downgrade this without removing `baseUrl`.
- Route mounting in `server/src/app.ts` mounts `fileRoutes` at `/api/v1` (not `/api/v1/files`) because the file router internally uses paths like `/files/sign` and `/rooms/:roomId/files`. Be careful when moving routes between files.
- ESLint runs only on the client (`npm run lint` in `client/`). There's no server linter.
- Logging goes through Winston (`utils/logger.ts`). Never log token strings, password hashes, or full request bodies on auth endpoints.
