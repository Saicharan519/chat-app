/**
 * Phase 7 Integration Tests — BullMQ + Gemini Embeddings + Semantic Search
 * Run: npx ts-node src/test_search.ts
 *
 * Prerequisites: server must be running (npm run dev) so the embedding
 * worker is active and can process jobs.
 */
import assert from 'assert';
import pool from './config/db';
import redis from './config/redis';

const BASE_URL = 'http://localhost:4000';

interface User {
  id: string;
  username: string;
  accessToken: string;
}

async function register(label: string, seed: number): Promise<User> {
  const username = `srch_${label}_${seed}`;
  const email = `srch_${label}_${seed}@example.com`;
  const res = await fetch(`${BASE_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password: 'Password123!' }),
  });
  const data = (await res.json()) as any;
  assert.strictEqual(res.status, 201, `Register ${label} failed: ${JSON.stringify(data)}`);
  return { id: data.user.id, username, accessToken: data.accessToken };
}

async function postMessage(token: string, roomId: string, content: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/v1/messages/room/${roomId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content }),
  });
  const data = (await res.json()) as any;
  assert.strictEqual(res.status, 201, `Message send failed: ${JSON.stringify(data)}`);
  return data.id;
}

/** Poll until all provided message IDs have embeddings written, or timeout */
async function waitForEmbeddings(
  messageIds: string[],
  timeoutMs = 30000,
  pollMs = 1500
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await pool.query(
      `SELECT id FROM messages WHERE id = ANY($1) AND embedding IS NOT NULL`,
      [messageIds]
    );
    if (res.rowCount === messageIds.length) return;
    process.stdout.write(
      `  ⏳ ${res.rowCount}/${messageIds.length} embeddings ready — waiting ${pollMs}ms...\r`
    );
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Timeout: not all embeddings were generated within ${timeoutMs}ms`);
}

async function runSearchTests() {
  console.log('🚀 Starting Phase 7 Integration Tests (Embeddings + Semantic Search)...');

  // ── 1. Health ────────────────────────────────────────────────────────────
  console.log('\n--- 1. Health Check ---');
  const readyRes = await fetch(`${BASE_URL}/ready`);
  const readyData = (await readyRes.json()) as any;
  assert.strictEqual(readyRes.status, 200);
  console.log('✅ Server healthy:', readyData);

  // ── 2. Users + Room ──────────────────────────────────────────────────────
  console.log('\n--- 2. Register Users & Create Room ---');
  const seed = Date.now();
  const userA = await register('A', seed);
  const userB = await register('B', seed);
  const roomRes = await fetch(`${BASE_URL}/api/v1/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userA.accessToken}` },
    body: JSON.stringify({ type: 'direct', memberIds: [userB.id] }),
  });
  const roomData = (await roomRes.json()) as any;
  assert.strictEqual(roomRes.status, 201);
  const roomId: string = roomData.id;
  console.log(`✅ Room: ${roomId} | UserA: ${userA.id}`);

  // ── 3. Seed messages about two distinct topics ───────────────────────────
  console.log('\n--- 3. Seeding Topic-Diverse Messages ---');
  const messages = [
    // Topic A: project deadline
    { token: userA.accessToken, content: 'We need to finish the quarterly report by Friday end of day.' },
    { token: userB.accessToken, content: 'I can have the financial analysis done by Thursday afternoon.' },
    { token: userA.accessToken, content: 'Please share the draft with the team before submitting the report.' },

    // Topic B: lunch / food
    { token: userB.accessToken, content: 'Are we still doing the team lunch at noon today?' },
    { token: userA.accessToken, content: 'Yes, the Italian restaurant on Main Street at 12:30pm.' },
    { token: userB.accessToken, content: 'Perfect, I have been craving pasta all week!' },

    // Topic C: code review
    { token: userA.accessToken, content: 'I opened a pull request for the authentication refactor, can you review it?' },
    { token: userB.accessToken, content: 'Sure, I will look at the code changes and leave comments on GitHub.' },
    { token: userA.accessToken, content: 'The main change is moving the JWT logic into a middleware function.' },
  ];

  const messageIds: string[] = [];
  for (const m of messages) {
    const id = await postMessage(m.token, roomId, m.content);
    messageIds.push(id);
  }
  console.log(`✅ Seeded ${messageIds.length} messages, waiting for embedding worker...`);

  // ── 4. Wait for embeddings ───────────────────────────────────────────────
  console.log('\n--- 4. Waiting for BullMQ Worker to Store Embeddings ---');
  await waitForEmbeddings(messageIds);
  console.log(`\n✅ All ${messageIds.length} embeddings stored in Postgres!`);

  // Verify in DB
  const embeddingCheck = await pool.query(
    `SELECT id, embedding IS NOT NULL AS has_embedding FROM messages WHERE id = ANY($1)`,
    [messageIds]
  );
  for (const row of embeddingCheck.rows) {
    assert.ok(row.has_embedding, `Message ${row.id} is missing embedding`);
  }
  console.log('✅ DB verification: all messages have non-null embedding columns.');

  // ── 5. Semantic Search Tests ─────────────────────────────────────────────
  console.log('\n--- 5. Testing Semantic Search Endpoint ---');

  // Helper
  const search = async (q: string, token: string, expectedStatus = 200) => {
    const r = await fetch(
      `${BASE_URL}/api/v1/messages/room/${roomId}/semantic-search?q=${encodeURIComponent(q)}&limit=5`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return { status: r.status, data: (await r.json()) as any };
  };

  // 5a. Query about reports — should NOT return lunch messages
  console.log('\n  5a. Query: "quarterly report deadline"');
  const r1 = await search('quarterly report deadline', userA.accessToken);
  assert.strictEqual(r1.status, 200);
  assert.ok(r1.data.results.length > 0, 'Expected at least one result');
  const r1Contents = r1.data.results.map((m: any) => m.content).join(' ');
  assert.ok(
    r1Contents.toLowerCase().includes('report'),
    `Expected report-related results, got: ${r1Contents}`
  );
  console.log(`  ✅ Got ${r1.data.total} results, top match: "${r1.data.results[0]?.content}"`);
  console.log(`     Similarity scores: ${r1.data.results.map((m: any) => m.similarity).join(', ')}`);

  // 5b. Query about food — should surface lunch messages
  console.log('\n  5b. Query: "lunch restaurant food"');
  const r2 = await search('lunch restaurant food', userB.accessToken);
  assert.strictEqual(r2.status, 200);
  assert.ok(r2.data.results.length > 0, 'Expected at least one result');
  const r2Contents = r2.data.results.map((m: any) => m.content).join(' ').toLowerCase();
  assert.ok(
    r2Contents.includes('lunch') || r2Contents.includes('pasta') || r2Contents.includes('restaurant'),
    `Expected food-related results, got: ${r2Contents}`
  );
  console.log(`  ✅ Got ${r2.data.total} results, top match: "${r2.data.results[0]?.content}"`);

  // 5c. Query about code review — should surface PR/code messages
  console.log('\n  5c. Query: "pull request code review GitHub"');
  const r3 = await search('pull request code review GitHub', userA.accessToken);
  assert.strictEqual(r3.status, 200);
  assert.ok(r3.data.results.length > 0, 'Expected at least one result');
  const r3Contents = r3.data.results.map((m: any) => m.content).join(' ').toLowerCase();
  assert.ok(
    r3Contents.includes('pull request') || r3Contents.includes('code') || r3Contents.includes('review'),
    `Expected code-related results, got: ${r3Contents}`
  );
  console.log(`  ✅ Got ${r3.data.total} results, top match: "${r3.data.results[0]?.content}"`);

  // 5d. IDOR — user from another room cannot search this room
  console.log('\n  5d. IDOR check — non-member user');
  const outsider = await register('OUT', seed);
  const rIdor = await search('report', outsider.accessToken);
  assert.strictEqual(rIdor.status, 404, `Expected 404 IDOR rejection, got ${rIdor.status}`);
  console.log('  ✅ IDOR correctly rejected (404).');

  // 5e. Validation — empty / too-short query
  console.log('\n  5e. Query validation — empty "q"');
  const rBad = await search('x', userA.accessToken);
  assert.strictEqual(rBad.status, 400, `Expected 400 for short query, got ${rBad.status}`);
  console.log('  ✅ Short query validation rejected (400).');

  // 5f. Unauth request
  console.log('\n  5f. Unauthenticated request');
  const rUnauth = await fetch(
    `${BASE_URL}/api/v1/messages/room/${roomId}/semantic-search?q=hello`
  );
  assert.strictEqual(rUnauth.status, 401);
  console.log('  ✅ Unauthenticated request correctly rejected (401).');

  console.log('\n🎉 ALL PHASE 7 INTEGRATION TESTS PASSED SUCCESSFULLY!');
}

runSearchTests()
  .catch((err) => {
    console.error('\n❌ TEST FAILED:', err.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
    redis.disconnect();
  });
