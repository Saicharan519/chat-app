# ContextChat — Deployment Guide

This walks you through deploying ContextChat to production from scratch, end-to-end. Total time: **about 60–90 minutes** if you're careful, longer if you've never used these services before. Everything below uses free tiers.

**Architecture you're building:**

```
  Vercel (frontend)  ──HTTPS──▶  Render (backend)
                                       │
                          ┌────────────┼────────────┐
                          ▼            ▼            ▼
                     Supabase      Upstash      ImageKit
                     (Postgres     (Redis)      (file CDN)
                      + pgvector)
                                       │
                          ┌────────────┼────────────┐
                          ▼                         ▼
                    Groq API                  Gemini API
                    (LLM)                     (embeddings)
```

---

## Part 0 — Accounts you need (5 min)

Sign up for each of these (all free tiers, no credit card required for any of them):

| Service | URL | What it's for |
|---|---|---|
| **GitHub** | https://github.com | Source code hosting; Render and Vercel pull from here |
| **Supabase** | https://supabase.com | PostgreSQL with `pgvector` enabled |
| **Upstash** | https://upstash.com | Redis |
| **ImageKit** | https://imagekit.io | File/image storage CDN |
| **Groq** | https://console.groq.com | Llama 3.3-70B inference |
| **Google AI Studio** | https://aistudio.google.com | Gemini embeddings |
| **Render** | https://render.com | Backend hosting (Node) |
| **Vercel** | https://vercel.com | Frontend hosting (static) |

Use the same email everywhere so you don't lose track.

---

## Part 1 — Push your code to GitHub (5 min)

If your project isn't on GitHub yet:

```bash
cd "C:\Users\Sai Charan\OneDrive\Desktop\P\chat-app"
git init
git add .
git commit -m "Initial commit"
```

1. On https://github.com, click **+ → New repository**
2. Name: `contextchat` (or whatever you like)
3. Keep it **Private** if you want
4. **Don't** initialize with README/license (you already have them)
5. Click **Create repository**
6. Follow the *"…or push an existing repository from the command line"* commands GitHub shows. Roughly:
   ```bash
   git remote add origin https://github.com/<your-username>/contextchat.git
   git branch -M main
   git push -u origin main
   ```

> ⚠️ **Verify `.env` was NOT pushed.** Open the repo on GitHub and look in `server/` and `client/`. You should see `.env.example` but NOT `.env`. If you see `.env`, your secrets just leaked — rotate every key and check your `.gitignore`.

---

## Part 2 — Set up PostgreSQL on Supabase (10 min)

ContextChat needs the `pgvector` extension for semantic search. Supabase has it pre-installed on every project.

### 2.1 Create the project
1. Go to https://supabase.com → **New project**
2. **Name:** `contextchat`
3. **Database password:** click *Generate a password*, **save it to a password manager immediately**. You can't recover it.
4. **Region:** pick the closest one to your backend host (Render's free tier is in Oregon `US-West`, so `West US` is a good match; for India users `South Asia (Mumbai)` is fine, just keep your Render region matched)
5. **Pricing plan:** Free
6. Click **Create new project**. Wait ~2 min for provisioning.

### 2.2 Get the connection string
1. In your project → **Project Settings** (gear icon) → **Database**
2. Scroll to **Connection string** → **URI** tab
3. Choose **Session pooler** (port 5432) — important for serverless backends. Actually for Render, use the **Direct connection** (port 5432).
4. Copy the string. It looks like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.abcdefgh.supabase.co:5432/postgres
   ```
5. Replace `[YOUR-PASSWORD]` with the password from step 2.1.3.
6. **Save this string** — you'll paste it into Render in Part 7.

### 2.3 Apply the schema
1. In your project → **SQL Editor** (the `</>` icon in the left sidebar) → **New query**
2. Open `server/schema.sql` from your local repo, copy its entire contents
3. Paste into the SQL editor
4. Click **Run** (bottom right). Should complete in <1 second.
5. Verify by going to **Table Editor** (left sidebar). You should see: `users`, `rooms`, `room_members`, `messages`, `refresh_tokens`, `message_reads`, `message_reactions`.

> If the SQL run fails with "extension `vector` does not exist", go to **Database → Extensions**, search "vector", and toggle it on. Re-run the schema.

---

## Part 3 — Set up Redis on Upstash (5 min)

1. Go to https://console.upstash.com → **Create Database**
2. **Name:** `contextchat-redis`
3. **Type:** Regional
4. **Region:** pick the one closest to your Render backend
5. **TLS:** Enabled (default)
6. Click **Create**
7. On the database page, scroll to **Connect to your database**
8. Find the **Redis** tab → copy the URL that starts with `rediss://` (the double-s is correct — TLS)
   ```
   rediss://default:AbCd...@yourname-12345.upstash.io:6379
   ```
9. **Save this string** for Part 7.

---

## Part 4 — Set up ImageKit (5 min)

1. Sign up at https://imagekit.io with email
2. On first login it asks for an **ID** — pick something like `contextchat` (this becomes part of your CDN URL)
3. Once in the dashboard → **Developer options** (left sidebar) → **API Keys**
4. Copy three values:
   - **URL endpoint** → `https://ik.imagekit.io/yourid`
   - **Public key** → `public_xxxxxxxx...`
   - **Private key** → `private_xxxxxxxx...`

> ⚠️ **Critical — common bug:** When copying the private key, the dashboard sometimes prepends `private_` to your paste. Double-check the saved value doesn't have `pprivate_` (double-p) or you'll get 500 errors on every file upload.

5. **Save all three** for Part 7.

---

## Part 5 — Get Groq + Gemini API keys (5 min)

### Groq (LLM)
1. Go to https://console.groq.com → sign in
2. **API Keys** (left sidebar) → **Create API Key**
3. Name: `contextchat-prod`
4. **Copy the key immediately** — it starts with `gsk_...`. You cannot see it again after closing the dialog.
5. Save for Part 7.

### Gemini (embeddings)
1. Go to https://aistudio.google.com/apikey
2. **Create API key** → choose a Google Cloud project (or let it create one called "Generative Language Client")
3. Copy the key — starts with `AIza...`
4. Save for Part 7.

---

## Part 6 — Generate JWT secrets (1 min)

You need two long random strings. On any computer with Node:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# Run twice and save both outputs
```

You'll get two 96-character hex strings. Label them:
- `JWT_ACCESS_SECRET` = first output
- `JWT_REFRESH_SECRET` = second output (must be different)

Save both for Part 7.

---

## Part 7 — Deploy backend to Render (15 min)

### 7.1 Create the Web Service
1. Go to https://dashboard.render.com → **New + → Web Service**
2. Connect your GitHub account if prompted
3. Pick the `contextchat` repository → **Connect**

### 7.2 Configure the service
Fill in exactly as below:

| Field | Value |
|---|---|
| **Name** | `contextchat-api` (or whatever — this becomes part of the URL) |
| **Region** | Same region as your Supabase + Upstash |
| **Branch** | `main` |
| **Root Directory** | `server` |
| **Runtime** | `Node` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Instance Type** | `Free` |

### 7.3 Add environment variables
Scroll to **Environment Variables** → click **Add Environment Variable** for each row below:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `DATABASE_URL` | (from Part 2.2) |
| `UPSTASH_REDIS_URL` | (from Part 3) |
| `JWT_ACCESS_SECRET` | (from Part 6) |
| `JWT_REFRESH_SECRET` | (from Part 6, different one) |
| `IMAGEKIT_PUBLIC_KEY` | (from Part 4) |
| `IMAGEKIT_PRIVATE_KEY` | (from Part 4) |
| `IMAGEKIT_URL_ENDPOINT` | (from Part 4) |
| `GROQ_API_KEY` | (from Part 5) |
| `GEMINI_API_KEY` | (from Part 5) |
| `CORS_ORIGIN` | leave blank for now — you'll fill it in Part 9 |

> ⚠️ Without `CORS_ORIGIN` set, the backend **will refuse to start in production**. We'll set it as soon as we know the frontend URL in Part 9. For now Render will deploy, the service will try to boot, fail validation, and restart in a loop. That's expected — don't panic.
>
> **Workaround:** put a placeholder like `CORS_ORIGIN=http://localhost:5173` for now so Render boots clean during the initial deploy. We'll update it for real after Vercel gives us the frontend URL.

### 7.4 Deploy
1. Click **Create Web Service** at the bottom
2. Render starts the first build. Watch the log stream. It takes **~5–8 minutes** for the cold first build (installing native deps like `bcrypt` is slow).
3. **What success looks like:**
   ```
   ==> Build successful 🎉
   ==> Starting service with 'npm start'
   ==> Detected service running on port 4000
   ==> Your service is live 🎉
   ```
4. At the top of the Render page, copy the **service URL**. It looks like `https://contextchat-api.onrender.com`. Save it for Part 8.

### 7.5 Verify it's actually alive
Open in browser: `https://contextchat-api.onrender.com/health`
Should return: `{"status":"ok"}`

Then: `https://contextchat-api.onrender.com/ready`
Should return: `{"status":"ok","db":"connected","redis":"connected"}`

If either fails, click **Logs** in Render and read the error.

**Common failures at this step:**
- `db: error` — `DATABASE_URL` is wrong or you didn't apply the schema (Part 2.3)
- `redis: error` — `UPSTASH_REDIS_URL` doesn't have the `rediss://` (double s) prefix
- Service won't boot at all → check Logs, likely a missing env var
- ImageKit errors only show up later when uploading files

---

## Part 8 — Deploy frontend to Vercel (10 min)

### 8.1 Import the project
1. Go to https://vercel.com/new
2. Connect GitHub if prompted, pick the `contextchat` repo
3. Click **Import**

### 8.2 Configure
| Field | Value |
|---|---|
| **Project Name** | `contextchat` |
| **Framework Preset** | `Vite` (auto-detected) |
| **Root Directory** | click **Edit** → select `client` |
| **Build Command** | `npm run build` (default is fine) |
| **Output Directory** | `dist` (default is fine) |
| **Install Command** | `npm install` (default is fine) |

### 8.3 Environment variables
Expand **Environment Variables** and add:

| Key | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://contextchat-api.onrender.com/api/v1` (from Part 7.4, **with `/api/v1` suffix**) |
| `VITE_SOCKET_URL` | `https://contextchat-api.onrender.com` (no path suffix) |

> ⚠️ Vite **inlines these at build time**. If you change them later you must redeploy, not just edit settings.

### 8.4 Deploy
1. Click **Deploy**. Takes ~2 minutes.
2. When it finishes, you'll see a celebration screen with your URL. It looks like:
   ```
   https://contextchat.vercel.app
   ```
   (or `contextchat-<hash>.vercel.app` if the short name is taken)
3. **Copy this URL** — needed for Part 9.

### 8.5 First visit will fail — that's expected
Click the URL. The login page will load (frontend is up), but logging in will fail with a CORS error in the console. That's because the backend is still rejecting cross-origin requests from this URL. We fix that next.

---

## Part 9 — Wire CORS (5 min)

Now the frontend exists at a known URL, we tell the backend to trust it.

1. Back in Render → your `contextchat-api` service → **Environment**
2. Find `CORS_ORIGIN` → click the pencil → set value to your Vercel URL **exactly**, e.g.:
   ```
   https://contextchat.vercel.app
   ```
   If you have a custom domain too, comma-separate (no spaces around commas):
   ```
   https://contextchat.vercel.app,https://contextchat.app
   ```
3. Click **Save Changes**. Render will automatically redeploy (~3 min).
4. Watch the Logs tab until you see `Your service is live 🎉` again.

> Common mistake: trailing slash. Use `https://contextchat.vercel.app`, **NOT** `https://contextchat.vercel.app/`.

---

## Part 10 — Seed the demo accounts (3 min)

So examiners (or you) can log in without registering.

1. In Render → your service → click **Shell** (a tab next to Logs)
2. Once the shell prompt appears, run:
   ```bash
   npx ts-node src/scripts/seed_demo.ts
   ```
3. You'll see:
   ```
   ✅ Demo seed complete.

      Login credentials:
        demo1@contextchat.com  /  Demo1234!   (username: alex_demo)
        demo2@contextchat.com  /  Demo1234!   (username: sam_demo)

      DM room id: ...
   ```

> If the Shell tab is locked (Render free tier sometimes restricts this), instead run the seed locally pointing at the production DB:
> ```bash
> cd server
> # temporarily set DATABASE_URL in your local .env to the production Supabase URL
> npx ts-node src/scripts/seed_demo.ts
> # revert your local .env when done
> ```

---

## Part 11 — Smoke test (5 min)

Open two browsers (regular Chrome + incognito) so you can log in as both demo users at once.

### Test checklist
- [ ] **Browser 1:** open `https://contextchat.vercel.app` → log in as `demo1@contextchat.com` / `Demo1234!`
- [ ] **Browser 2 (incognito):** same URL → log in as `demo2@contextchat.com` / `Demo1234!`
- [ ] Both should see the other user in their conversations list with the pre-loaded transcript
- [ ] **Presence:** the dot under the avatar should be green for both
- [ ] **Send a message** from browser 1 → should appear instantly in browser 2
- [ ] **Typing indicator:** start typing in browser 1 → 3 dots appear in browser 2
- [ ] **File upload:** click the paperclip, upload an image → should appear in both browsers
- [ ] **Reactions:** hover any message → click the smile-plus → pick 👍 → pill appears in both browsers in real time
- [ ] **Smart replies:** look above the input — should show 3 chips. Click one → sends as you.
- [ ] **Tone shift:** type "lets meet tomorrow" → click ✨ → Professional → text gets rewritten
- [ ] **AI Co-pilot:** click the sparkle button in the header → ask *"what did sam_demo say about the proposal deadline?"* → with **Room context** toggle ON, you should get a grounded answer mentioning Tuesday
- [ ] **Summarizer:** click the book icon in the header → SSE stream produces a markdown summary
- [ ] **Semantic search:** click the search icon → type `deadline` → finds the message about "submitted by Tuesday" (even though "deadline" doesn't appear in any message)

If everything above works — **you're done. The app is live.**

---

## Troubleshooting

### "Internal server error" on every action
Most likely a typo'd env var. In Render → Logs, search for `Invalid environment variables`. Fix whatever Zod is complaining about and the service will restart.

### File uploads return 500
Open the Logs and look for ImageKit error messages. Top culprit: the private key got `private_` accidentally typed twice (`pprivate_…`). Fix in Render env, save, wait for redeploy.

### Frontend loads but login fails with a CORS error in browser console
- Check Render → Environment → `CORS_ORIGIN` is **exactly** your Vercel URL, no trailing slash
- If you have a Vercel preview URL (e.g. `contextchat-abc123.vercel.app`), it's different from your production URL — add both to `CORS_ORIGIN` comma-separated, or just test against the production URL

### Login appears to succeed but page just reloads forever
The refresh-token cookie isn't being sent. Causes:
- Backend is not HTTPS — Render gives you HTTPS by default, so this should be fine in production
- Browser is blocking third-party cookies — try in incognito; if that works, it's a browser-level setting

### AI features hang or time out
- **Free Groq tier** has rate limits (~30 RPM). If you hit them, you'll see 429s in the network tab.
- **Render free tier sleeps** services after 15 min of inactivity. First request after sleep takes ~30 seconds to wake up. The chat WILL work but the first AI call after sleep might time out — retry once.
- **Gemini quota** is also rate-limited on the free tier. Same as above.

### Semantic search returns no results even with matching messages
Embeddings are generated by the BullMQ worker **asynchronously**. After your seed runs, the worker queues jobs but they may not have completed yet. Send a new message in the room, wait ~10 seconds, and the worker should backfill recent messages. Verify in Render Logs — you should see `embedding job completed`.

### Render service won't boot — "CORS_ORIGIN must be set in production"
You forgot Part 9. Set it, save, wait for redeploy.

### Cookies not persisting on Safari / iOS
iOS Safari has special cookie rules. `SameSite=None; Secure` is set correctly by the backend, but iOS sometimes still drops them on the first request. Refresh the page once after login — should stick.

---

## Updating after deploy

### Push a code change
```bash
git add .
git commit -m "your message"
git push
```
Both Render (backend) and Vercel (frontend) auto-redeploy on every push to `main`. You don't need to do anything else.

### Change an env var
- **Render:** Environment tab → edit → Save Changes → auto-redeploys (~3 min)
- **Vercel:** Project Settings → Environment Variables → edit → then **Deployments** tab → click **⋯** on the latest deploy → **Redeploy**. Vercel does NOT auto-redeploy on env changes; you have to trigger it manually.

### Rotate a secret
Generate a new one, update the env var on Render, save. JWT secret rotation will log everyone out (their access tokens become invalid) — that's the point.

---

## Going further

| Improvement | Time | Worth it? |
|---|---|---|
| **Custom domain** | 30 min | Cheap polish. Vercel + Render both let you add a custom domain in their UI for free. Update `CORS_ORIGIN` after. |
| **UptimeRobot pinger** | 5 min | Pings `/health` every 5 min so the Render free tier doesn't sleep. Free at https://uptimerobot.com. |
| **Sentry error tracking** | 15 min | Add `@sentry/node` to backend and `@sentry/react` to frontend. Free tier covers small projects. |
| **Production logs to Better Stack** | 20 min | Render's built-in logs are fine but disappear after a few days. Better Stack (formerly Logtail) keeps them. |
| **Database backups** | Already on | Supabase free tier has daily backups for 7 days, no setup needed. |

---

## Cost summary (monthly)

| Service | Free tier limit | What you pay |
|---|---|---|
| Supabase | 500 MB DB, 2 GB transfer | $0 |
| Upstash | 10k commands/day | $0 |
| ImageKit | 20 GB bandwidth, 20 GB storage | $0 |
| Groq | Rate-limited but generous | $0 |
| Gemini embeddings | Rate-limited but generous | $0 |
| Render | 750 hrs/mo (sleeps when idle) | $0 |
| Vercel | 100 GB bandwidth | $0 |
| **Total** | | **$0/mo** |

You can run ContextChat as a portfolio piece indefinitely without paying anyone.

---

If you get stuck at any step, the most useful thing is to **read the Render Logs**. 95% of deploy issues are clearly logged there.
