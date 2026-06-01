# Project Rules — Chat App with AI Features
### Read this file before every coding session. It is the single source of truth for rules, stack, and design.

---

## ⚠️ Version Safety — Mandatory Before Every Install

Never hardcode version numbers from memory or any file into package.json.

Before installing any Node.js package:
1. `npm show <package-name> version` — ground truth
2. Search `"<package-name> npm latest"` + `"<package-name> CVE"` for advisories
3. Use `^` ranges in package.json — never exact pins
4. `npm audit` after every install — fix all high/critical before proceeding

These AI/API SDKs change frequently — always web search current docs before writing any code:
- **groq-sdk** — search `"groq-sdk npm latest docs"`
- **@google/generative-ai** — search `"@google/generative-ai latest docs gemini embedding"`
- **@supabase/supabase-js** — search `"supabase js v2 latest docs"`
- **bullmq** — search `"bullmq latest api docs"`
- **socket.io** — search `"socket.io 4 latest docs"`

---

## Project Identity

- **Type:** Full-stack real-time chat app with native AI features
- **Stack:** React + Vite (frontend) + Node.js + Express (backend, handles AI too)
- **Databases:** PostgreSQL via Supabase (everything) + Redis via Upstash (cache/ephemeral)
- **OS:** Windows 11 — no Docker during development, all DBs are cloud-hosted
- **API prefix:** `/api/v1/` on every route

---

## Features (what we are building)

**Core chat:** Register/login, 1:1 DMs, group rooms (owner/admin/member roles), send text + images + PDFs, emoji reactions, threaded replies, edit + soft-delete messages, typing indicators, online/offline presence, read receipts, unread counts, offline message replay on reconnect.

**AI features (all handled natively in Node.js — no Python):**
- Smart reply suggestions (3 chips from last 10 messages via Groq)
- Editor / rewrite (Groq rewrites user's typed text)
- Tone changer (6 tones: Professional, Casual, Friendly, Direct, Formal, Funny)
- AI panel (built-in ChatGPT-style assistant in sidebar — separate from human chats)
- Chat summarizer (direct context window — fetch last 50-100 messages → transcript → Groq)
- Semantic search (embed query via Gemini → pgvector cosine similarity in PostgreSQL)

**Out of scope:** Video calls, E2E encryption, mobile app, push notifications (Phase 2), admin dashboard.

---

## Tech Stack

### Frontend
| Package | Verify before install |
|---|---|
| React | `npm show react version` |
| Vite | `npm show vite version` |
| TypeScript (strict) | `npm show typescript version` |
| TailwindCSS | `npm show tailwindcss version` |
| shadcn/ui | copy-paste components, not a package |
| Zustand | `npm show zustand version` |
| TanStack Query | `npm show @tanstack/react-query version` |
| React Hook Form | `npm show react-hook-form version` |
| Socket.io-client | `npm show socket.io-client version` |
| Axios | `npm show axios version` |
| React Router v6 | `npm show react-router-dom version` |
| DOMPurify | `npm show dompurify version` |
| Lucide React | `npm show lucide-react version` |

### Backend (Node.js)
| Package | Verify before install |
|---|---|
| express | `npm show express version` |
| socket.io | `npm show socket.io version` |
| @supabase/supabase-js | `npm show @supabase/supabase-js version` — web search docs first |
| groq-sdk | `npm show groq-sdk version` — web search docs first |
| @google/generative-ai | `npm show @google/generative-ai version` — web search docs first |
| bullmq | `npm show bullmq version` — web search docs first |
| zod | `npm show zod version` |
| jsonwebtoken | `npm show jsonwebtoken version` + CVE search |
| bcrypt | `npm show bcrypt version` — passwords only, NOT tokens |
| helmet | `npm show helmet version` |
| cors | `npm show cors version` |
| express-rate-limit | `npm show express-rate-limit version` |
| multer | `npm show multer version` |
| @imagekit/nodejs | `npm show @imagekit/nodejs version` |
| ioredis | `npm show ioredis version` |
| winston | `npm show winston version` |
| @sentry/node | `npm show @sentry/node version` |
| morgan | `npm show morgan version` |

### LLM & Embedding Models
| Feature | Model | Service | Cost |
|---|---|---|---|
| Smart reply, Editor, Tone | llama-3.1-8b-instant | Groq | Free |
| AI panel assistant | llama-3.1-70b-versatile | Groq | Free |
| Chat summarizer | mixtral-8x7b-32768 | Groq | Free |
| Embeddings | text-embedding-004 (768-dim) | Gemini API | Free tier |

> Always verify current available Groq models at console.groq.com before using — model names change.

### Not Using (and why)
| Skipped | Reason |
|---|---|
| FastAPI / Python | Single Node.js handles everything — avoids OOM on Railway free tier (512MB) |
| MongoDB | PostgreSQL JSONB handles semi-structured messages cleanly |
| Qdrant Cloud | pgvector inside PostgreSQL replaces it — no separate service |
| express-mongo-sanitize | No MongoDB in this project — this middleware is irrelevant |
| sentence-transformers | Would OOM on Railway — using Gemini API instead |
| LangChain | RAG/summarization built manually — cleaner + better for interviews |
| Docker (dev) | Windows 11 — all DBs are cloud-hosted |
| Redis Socket.io adapter | Single Node.js instance handles 50-100 users fine |

---

## Absolute Coding Rules — Never Break

1. Never use `any` in TypeScript. Type everything explicitly.
2. Routes → controllers → services only. No business logic in routes.
3. Never query the database directly from a controller. Always through a service/repository.
4. Never store binary files in PostgreSQL. Files go to ImageKit only.
5. Never make synchronous AI/LLM calls in the WebSocket message handler. Queue via BullMQ.
6. Never use `var`. `const` by default, `let` only when reassignment needed.
7. No function longer than 40 lines. Split if needed.
8. Never hardcode secrets. All config via env vars validated in `src/config/env.ts`.
9. Every async function needs try/catch or proper error middleware.
10. Always validate request bodies with Zod before using them.
11. Access token in memory only via `tokenStore.ts` — never localStorage or sessionStorage.
12. Single-flight refresh: use separate `refreshClient.ts` with no interceptors to prevent 401 loops.
13. Call `assertOwnership()` in every controller that accesses a resource by ID — prevent IDOR.
14. Never return `password_hash` in any API response.
15. Never copy version numbers from memory — always `npm show` + web search first.
16. bcrypt is for PASSWORDS only. Use SHA-256 (`crypto.createHash`) for refresh token hashing.
17. Message ordering uses PostgreSQL `created_at`. Never use Redis for sequence numbers.
18. Chat summarization is direct context window (transcript → Groq). NOT a RAG pipeline.

---

## Security Middleware Stack (app.ts — required order)

```typescript
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
app.use(express.json({ limit: '10kb' }));
// No express-mongo-sanitize — this project has no MongoDB

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
const aiLimiter   = rateLimit({ windowMs: 60 * 1000, max: 10 });
app.use('/api/v1/auth', authLimiter);
app.use('/api/v1/ai', aiLimiter);
```

---

## Token Security Pattern (Frontend)

```typescript
// src/auth/tokenStore.ts — access token in MEMORY ONLY
let _token: string | null = null;
export const tokenStore = {
  get: () => _token,
  set: (t: string) => { _token = t; },
  clear: () => { _token = null; },
};

// src/lib/api/refreshClient.ts — NO interceptors, prevents infinite 401 loop
// src/lib/api/client.ts — single-flight queue for simultaneous 401s
// On failed refresh → tokenStore.clear() + redirect to /login
```

---

## Ownership Check (Backend — use in every controller accessing resource by ID)

```typescript
// Always 404, never 403 — don't confirm resource exists to unauthorized users
export async function assertOwnership(table: string, id: string, userId: string) {
  const { data, error } = await supabase
    .from(table).select('id').eq('id', id).eq('user_id', userId).single();
  if (error || !data) {
    const err = new Error('Resource not found') as any;
    err.statusCode = 404; err.code = 'NOT_FOUND';
    throw err;
  }
  return data;
}
```

---

## Standard API Response Format

```typescript
{ "success": true, "data": { ... } }                          // success
{ "success": true, "data": [...], "pagination": { ... } }    // paginated
{ "success": false, "error": { "code": "...", "message": "..." } }  // error
```

## Error Codes
| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod failed — include `fields` object |
| 401 | `UNAUTHORIZED` | No token |
| 401 | `TOKEN_EXPIRED` | Client should refresh |
| 401 | `TOKEN_INVALID` | Tampered token |
| 401 | `REFRESH_TOKEN_INVALID` | Not found or already rotated |
| 403 | `FORBIDDEN` | Wrong role |
| 404 | `NOT_FOUND` | Resource not found or wrong user |
| 409 | `CONFLICT` | Duplicate unique field |
| 429 | `RATE_LIMIT_EXCEEDED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unhandled server error |

---

## UI Design System (condensed)

**Layout:** 280px fixed left sidebar + flexible right panel. WhatsApp Web / Telegram Web pattern.

**Colors:**
- Primary: `#6366f1` (Indigo 500) — buttons, active states
- AI accent: `#8b5cf6` (Violet 500) — AI chips, AI panel, sparkle button
- Sent bubbles: `#6366f1` white text | Received: `#f1f5f9` dark text
- Online: `#22c55e` | Offline: `#94a3b8`

**Input bar pattern:** `[ 📎 attach ] [ input ... ] [ ✨ AI ] [ ➤ send ]`
AI button opens: `[ ✨ Suggest | ✏️ Edit | 🎨 Tone ]`

**AI panel:** Top of sidebar → "✨ AI Assistant" row → click replaces right panel with ChatGPT-style UI.

**shadcn/ui to install:** button, input, avatar, badge, dialog, dropdown-menu, scroll-area, tooltip, sheet, separator, skeleton

**Animations:** Message appear: `animate-in slide-in-from-bottom-2 duration-150` | AI chips: `animate-in fade-in duration-200`

**Reference:** Layout → WhatsApp Web | Bubbles → iMessage | AI toolbar → Edge Copilot | AI panel → ChatGPT

---

## Code Style

- Files: `kebab-case.ts` | Components: `PascalCase.tsx` | Functions/vars: `camelCase` | Constants: `SCREAMING_SNAKE_CASE`
- Prettier: 2 space indent, single quotes, semicolons
- Every exported function must have a JSDoc comment
- Comments explain WHY, not WHAT

---

## Git Rules

- Commit after every completed stage. Format: `feat:` / `fix:` / `chore:`
- Never commit `.env` — only `.env.example` with placeholders
- `.gitignore`: `node_modules`, `.env`, `.env.*`, `!.env.example`, `dist`, `build`, `*.log`, `coverage/`
- `npm ci` in CI, never `npm install`
- `npm audit` must pass before deploy

---

## Stage Completion Checklist

Before marking any stage done:
- [ ] All endpoints return correct status codes + standard response format
- [ ] All inputs validated with Zod
- [ ] `assertOwnership()` called where needed
- [ ] No unhandled promise rejections
- [ ] Tested in Postman (REST) or two Chrome profiles (Socket.io)
- [ ] `tsc --noEmit` passes — zero TypeScript errors
- [ ] `npm audit` clean
- [ ] PROGRESS.md updated
- [ ] ARCHITECTURE.md updated if schema or endpoints changed
- [ ] Committed to GitHub
