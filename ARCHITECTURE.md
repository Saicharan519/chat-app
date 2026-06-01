# ARCHITECTURE.md
### Read this before writing any code. Update after any schema or endpoint change.

---

## System Overview

```
React (Vite) :3000  ←→  Node.js + Express :5000
                         Socket.io
                         BullMQ workers (async embedding jobs)

PostgreSQL (Supabase)          Redis (Upstash)
Users, Rooms, Members,         Presence, Typing,
Messages + pgvector,           Auth blacklist,
Refresh Tokens                 AI cache, Rate limits

ImageKit — binary file storage (images, PDFs, DOCs)
```

All REST routes: `/api/v1/`
Message ordering: `created_at TIMESTAMPTZ` — never Redis sequences

---

## Folder Structure

```
chat-app/
├── client/
│   └── src/
│       ├── auth/
│       │   ├── AuthProvider.tsx     # user context, login/logout
│       │   └── tokenStore.ts        # access token in MEMORY only
│       ├── components/
│       │   ├── RequireAuth.tsx
│       │   ├── ErrorBoundary.tsx
│       │   ├── sidebar/             # RoomList, RoomItem, UserSearch, AIPanel
│       │   ├── chat/                # ChatWindow, MessageList, MessageBubble
│       │   │                        # MessageInput, TypingIndicator, ReadReceipt
│       │   ├── ai/                  # SuggestionChips, EditorToolbar, ToneSelector
│       │   └── shared/              # Avatar, OnlineBadge, Modal
│       ├── features/                # TanStack Query hooks
│       │   ├── rooms/api.ts
│       │   ├── messages/api.ts
│       │   └── users/api.ts
│       ├── store/                   # Zustand — real-time + UI only
│       │   ├── chat.store.ts
│       │   ├── presence.store.ts
│       │   └── ui.store.ts
│       ├── hooks/
│       │   ├── useSocket.ts
│       │   └── useAI.ts
│       ├── lib/
│       │   ├── env.ts               # VITE_* Zod validation
│       │   └── api/
│       │       ├── client.ts        # Axios + single-flight refresh interceptor
│       │       └── refreshClient.ts # NO interceptors — prevents 401 loop
│       ├── pages/
│       │   ├── LoginPage.tsx
│       │   ├── RegisterPage.tsx
│       │   └── ChatPage.tsx
│       └── types/index.ts
│
└── server/
    └── src/
        ├── config/
        │   ├── env.ts               # Zod env validation — crash on bad config
        │   ├── db.ts                # Supabase client
        │   └── redis.ts             # Upstash ioredis client
        ├── modules/
        │   ├── auth/                # routes, controller, service, schema
        │   ├── users/
        │   ├── rooms/
        │   ├── messages/
        │   │   └── messages.repository.ts  # all Supabase queries
        │   ├── files/
        │   │   └── imagekit.service.ts
        │   └── ai/
        │       ├── ai.service.ts    # Groq + Gemini orchestration
        │       └── prompts.ts       # all LLM prompt templates
        ├── socket/
        │   ├── socket.server.ts
        │   ├── socket.middleware.ts # JWT auth on handshake
        │   └── handlers/
        │       ├── message.handler.ts
        │       ├── presence.handler.ts
        │       ├── room.handler.ts
        │       └── typing.handler.ts
        ├── queues/
        │   └── embedding.queue.ts   # BullMQ — async Gemini embedding after message save
        ├── middleware/
        │   ├── auth.middleware.ts   # JWT verify + Redis blacklist check
        │   ├── validate.ts          # Zod schema factory → 400
        │   ├── error.middleware.ts
        │   └── ratelimit.middleware.ts
        ├── utils/
        │   ├── jwt.ts
        │   ├── ownershipCheck.ts    # assertOwnership — prevent IDOR
        │   ├── tokenCompare.ts      # crypto.timingSafeEqual wrapper
        │   └── logger.ts            # Winston — never log tokens/passwords
        └── app.ts
```

---

## PostgreSQL Schema (Supabase)

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";    -- pgvector for semantic search
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- trigram for fuzzy keyword search

-- Users
CREATE TABLE users (
  id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  username      VARCHAR(30)  UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT         NOT NULL,       -- bcrypt (rounds: 12)
  display_name  VARCHAR(50)  NOT NULL,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ  DEFAULT now(),
  updated_at    TIMESTAMPTZ  DEFAULT now()
);

-- Refresh tokens (SHA-256 hashed — NOT bcrypt)
CREATE TABLE refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,   -- SHA-256 via Node crypto
  device_info TEXT,
  ip_address  INET,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,                   -- null = still valid
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_rt_user ON refresh_tokens(user_id);

-- Rooms
CREATE TYPE room_type AS ENUM ('direct', 'group');
CREATE TABLE rooms (
  id          UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(100),                  -- null for DMs
  type        room_type NOT NULL,
  avatar_url  TEXT,
  created_by  UUID      REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Room members
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');
CREATE TABLE room_members (
  room_id      UUID        REFERENCES rooms(id) ON DELETE CASCADE,
  user_id      UUID        REFERENCES users(id) ON DELETE CASCADE,
  role         member_role DEFAULT 'member',
  last_read_at TIMESTAMPTZ DEFAULT now(),    -- unread = messages WHERE created_at > last_read_at
  muted_until  TIMESTAMPTZ,
  joined_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX idx_rm_user ON room_members(user_id);

-- Messages (all in PostgreSQL — no MongoDB)
CREATE TYPE msg_type AS ENUM ('text', 'image', 'file', 'system');
CREATE TABLE messages (
  id              UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id         UUID      NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_id       UUID      REFERENCES users(id) ON DELETE SET NULL,
  type            msg_type  NOT NULL DEFAULT 'text',
  content         JSONB     NOT NULL,        -- { text?, file_url?, file_name?, file_size?, public_id? }
  reply_to_id     UUID      REFERENCES messages(id) ON DELETE SET NULL,
  reply_to_preview TEXT,                     -- cached preview text for bubble display (avoids JOIN)
  reactions       JSONB     NOT NULL DEFAULT '[]',   -- [{ emoji, user_ids[] }]
  delivery_status JSONB     NOT NULL DEFAULT '{}',   -- { "userId": "delivered" | "read" }
  embedding       vector(768),               -- pgvector — Gemini text-embedding-004 (768-dim)
  edited_at       TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,               -- soft delete
  created_at      TIMESTAMPTZ DEFAULT now()  -- primary ordering column
);
CREATE INDEX idx_msg_room_date ON messages(room_id, created_at DESC);
CREATE INDEX idx_msg_sender    ON messages(sender_id);
CREATE INDEX idx_msg_text      ON messages USING gin ((content->>'text') gin_trgm_ops);
CREATE INDEX idx_msg_embedding ON messages USING hnsw (embedding vector_cosine_ops);
```

**Key schema decisions:**
- No `seq` column — ordering is `created_at DESC`. Reliable, no Redis dependency.
- `last_read_at` in `room_members` replaces `last_read_seq` — unread count = `SELECT COUNT(*) FROM messages WHERE room_id = $1 AND created_at > $2`
- `embedding vector(768)` inline in messages — no separate table, no extra JOIN on search
- `reply_to_id` is a proper FK + `reply_to_preview` caches the display text
- Refresh tokens use SHA-256 (Node `crypto`) — bcrypt only for passwords

---

## Redis Key Design (Upstash)

```
# Presence (heartbeat every 15s, TTL 30s)
presence:{userId}              → STRING "online"   TTL: 30s
user:sockets:{userId}          → SET {socketIds}   TTL: 30s

# Typing (auto-expire = stopped typing, no explicit stop event needed)
typing:{roomId}:{userId}       → STRING "1"        TTL: 3s

# Auth
blacklist:token:{jti}          → STRING "1"        TTL: token remaining expiry

# AI response cache
ai:reply:{contextHash}         → STRING JSON       TTL: 5 min
ai:summary:{roomId}:{hash}     → STRING text       TTL: 10 min

# Rate limiting
ratelimit:ai:{userId}          → STRING counter    TTL: 60s
ratelimit:auth:{ip}            → STRING counter    TTL: 15 min

# Unread (fast counter — no DB query on badge render)
unread:{userId}:{roomId}       → STRING counter    TTL: none
```

**Not in Redis:** message sequence numbers — these are gone. PostgreSQL `created_at` handles ordering.

---

## API Endpoints

```
System (no auth)
  GET  /health                              → { status: "ok" }
  GET  /ready                               → { status: "ok", db: "connected" }

Auth
  POST /api/v1/auth/register
  POST /api/v1/auth/login
  POST /api/v1/auth/logout
  POST /api/v1/auth/refresh

Users
  GET  /api/v1/users/me
  GET  /api/v1/users/search?q=
  PATCH /api/v1/users/me

Rooms
  POST   /api/v1/rooms
  GET    /api/v1/rooms
  GET    /api/v1/rooms/:id
  PATCH  /api/v1/rooms/:id
  POST   /api/v1/rooms/:id/members
  DELETE /api/v1/rooms/:id/members/:userId

Messages
  GET    /api/v1/messages/:roomId            cursor-based on created_at
  GET    /api/v1/messages/:roomId/search?q=  trigram keyword search
  GET    /api/v1/messages/:roomId/semantic-search?q=  pgvector similarity search
  PATCH  /api/v1/messages/:id
  DELETE /api/v1/messages/:id

Files
  POST   /api/v1/files/upload/:roomId
  DELETE /api/v1/files/:publicId

AI
  POST /api/v1/ai/smart-reply     { roomId }
  POST /api/v1/ai/editor          { text }
  POST /api/v1/ai/tone            { text, tone }
  POST /api/v1/ai/assistant       { messages[] }   SSE streaming
  POST /api/v1/ai/summarize       { roomId }       SSE streaming
```

---

## Socket.io Events

```
CLIENT → SERVER
  message:send        { roomId, text, type, replyToId? }
  message:read        { roomId, messageId }
  typing:start        { roomId }
  room:join           { roomId, lastReadAt }   ← timestamp, NOT seq
  presence:heartbeat  {}

SERVER → CLIENT
  message:new         { message }
  message:delivered   { messageId, userId }
  message:read        { messageId, userId }
  message:rejected    { reason, code }
  typing:update       { roomId, userId, isTyping }
  presence:update     { userId, status }
  message:replay      { messages[] }           ← messages WHERE created_at > lastReadAt
  notification:new    { notification }
```

---

## Environment Variables

```bash
# server/.env
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000

SUPABASE_URL=
SUPABASE_SERVICE_KEY=

UPSTASH_REDIS_URL=
UPSTASH_REDIS_TOKEN=

# Generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_ACCESS_SECRET=      # min 64 chars
JWT_REFRESH_SECRET=     # different secret, same length
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

IMAGEKIT_PUBLIC_KEY=
IMAGEKIT_PRIVATE_KEY=
IMAGEKIT_URL_ENDPOINT=

GROQ_API_KEY=
GEMINI_API_KEY=
SENTRY_DSN=

# client/.env
VITE_API_BASE_URL=http://localhost:5000
VITE_SOCKET_URL=http://localhost:5000
```
