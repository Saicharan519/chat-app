/**
 * Phase 6 Integration Tests — Core AI Services (Groq)
 * Run: npx ts-node src/test_ai.ts
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
  const username = `ai_${label}_${seed}`;
  const email = `ai_${label}_${seed}@example.com`;
  const res = await fetch(`${BASE_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password: 'Password123!' }),
  });
  const data = (await res.json()) as any;
  assert.strictEqual(res.status, 201, `Register ${label} failed: ${JSON.stringify(data)}`);
  return { id: data.user.id, username, accessToken: data.accessToken };
}

async function runAITests() {
  console.log('🚀 Starting Phase 6 Integration Tests (Core AI Services)...');

  // ── 1. Health check ─────────────────────────────────────────────────────
  console.log('\n--- 1. Health & Readiness ---');
  const readyRes = await fetch(`${BASE_URL}/ready`);
  const readyData = (await readyRes.json()) as any;
  assert.strictEqual(readyRes.status, 200);
  assert.strictEqual(readyData.db, 'connected');
  assert.strictEqual(readyData.redis, 'connected');
  console.log('✅ Server healthy:', readyData);

  // ── 2. Register users ───────────────────────────────────────────────────
  console.log('\n--- 2. Registering Users ---');
  const seed = Date.now();
  const userA = await register('A', seed);
  const userB = await register('B', seed);
  const userRL = await register('RL', seed); // rate-limit test user
  console.log(`✅ UserA: ${userA.id} | UserB: ${userB.id} | UserRL: ${userRL.id}`);

  // ── 3. Create room & seed messages ─────────────────────────────────────
  console.log('\n--- 3. Setting Up Room with Messages ---');
  const roomRes = await fetch(`${BASE_URL}/api/v1/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userA.accessToken}` },
    body: JSON.stringify({ type: 'direct', memberIds: [userB.id] }),
  });
  const roomData = (await roomRes.json()) as any;
  assert.strictEqual(roomRes.status, 201);
  const roomId: string = roomData.id;
  console.log(`✅ Room created: ${roomId}`);

  const msgs = [
    { token: userA.accessToken, content: 'Hey, did you finish the project report?' },
    { token: userB.accessToken, content: 'Not yet, working on it. Should be done by tomorrow.' },
    { token: userA.accessToken, content: 'Let me know if you need help with the data analysis.' },
    { token: userB.accessToken, content: 'Sure! Are we still meeting at 3pm today?' },
    { token: userA.accessToken, content: 'Yes, conference room B at 3pm.' },
  ];
  for (const m of msgs) {
    await fetch(`${BASE_URL}/api/v1/messages/room/${roomId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m.token}` },
      body: JSON.stringify({ content: m.content }),
    });
  }
  console.log(`✅ Seeded ${msgs.length} messages.`);

  // ── 4. Smart Replies ────────────────────────────────────────────────────
  console.log('\n--- 4. Testing Smart Replies (POST /api/v1/ai/smart-reply) ---');

  // Unauthenticated request
  const srUnauth = await fetch(`${BASE_URL}/api/v1/ai/smart-reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId }),
  });
  assert.strictEqual(srUnauth.status, 401, 'Expected 401 for unauthenticated request');
  console.log('✅ Unauthenticated request correctly rejected (401).');

  // IDOR check
  const fakeRoomId = '00000000-0000-0000-0000-000000000001';
  const srIdor = await fetch(`${BASE_URL}/api/v1/ai/smart-reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userA.accessToken}` },
    body: JSON.stringify({ roomId: fakeRoomId }),
  });
  assert.strictEqual(srIdor.status, 404, 'IDOR check should return 404');
  console.log('✅ IDOR protection passed (404 for non-member room).');

  // Valid request #1 — should call Groq and cache result
  const sr1 = await fetch(`${BASE_URL}/api/v1/ai/smart-reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userA.accessToken}` },
    body: JSON.stringify({ roomId }),
  });
  const srData1 = (await sr1.json()) as any;
  console.log('Smart reply response:', srData1);
  assert.strictEqual(sr1.status, 200, `Expected 200, got ${sr1.status}: ${JSON.stringify(srData1)}`);
  assert.ok(Array.isArray(srData1.replies), 'replies must be an array');
  assert.ok(srData1.replies.length > 0, 'should return at least 1 reply');
  assert.strictEqual(srData1.cached, false, 'First call must NOT be cached');
  console.log(`✅ Got ${srData1.replies.length} replies: "${srData1.replies.join('" | "')}"`);

  // Valid request #2 — same room, same messages → should be served from Redis cache
  const sr2 = await fetch(`${BASE_URL}/api/v1/ai/smart-reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userB.accessToken}` },
    body: JSON.stringify({ roomId }),
  });
  const srData2 = (await sr2.json()) as any;
  assert.strictEqual(srData2.cached, true, 'Second identical call MUST be served from Redis cache');
  console.log('✅ Redis cache verified — second call served from cache.');

  // ── 5. Tone Refinement ──────────────────────────────────────────────────
  console.log('\n--- 5. Testing Tone Refinement (POST /api/v1/ai/tone) ---');
  const tonesUnderTest: Array<'professional' | 'friendly' | 'empathetic' | 'concise' | 'witty'> = [
    'professional',
    'friendly',
    'concise',
  ];
  for (const tone of tonesUnderTest) {
    const toneRes = await fetch(`${BASE_URL}/api/v1/ai/tone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userA.accessToken}` },
      body: JSON.stringify({ text: 'I need the report done by end of day, can you do it?', tone }),
    });
    const toneData = (await toneRes.json()) as any;
    assert.strictEqual(toneRes.status, 200, `Tone "${tone}" failed: ${JSON.stringify(toneData)}`);
    assert.ok(typeof toneData.result === 'string' && toneData.result.length > 0, 'result must be a non-empty string');
    console.log(`✅ Tone "${tone}": "${toneData.result.substring(0, 80)}..."`);
  }

  // Validation error — invalid tone
  const toneInvalid = await fetch(`${BASE_URL}/api/v1/ai/tone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userA.accessToken}` },
    body: JSON.stringify({ text: 'hello', tone: 'sarcastic' }),
  });
  assert.strictEqual(toneInvalid.status, 400, 'Invalid tone should return 400');
  console.log('✅ Invalid tone validation rejected (400).');

  // ── 6. Editor / Custom Refinement ───────────────────────────────────────
  console.log('\n--- 6. Testing Editor / Custom Refinement (POST /api/v1/ai/editor) ---');
  const editorRes = await fetch(`${BASE_URL}/api/v1/ai/editor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userA.accessToken}` },
    body: JSON.stringify({
      text: 'the meeting is tmrw at 3, dont forget the slides',
      instruction: 'Fix grammar and spelling. Keep the same meaning.',
    }),
  });
  const editorData = (await editorRes.json()) as any;
  assert.strictEqual(editorRes.status, 200, `Editor failed: ${JSON.stringify(editorData)}`);
  assert.ok(typeof editorData.result === 'string' && editorData.result.length > 0);
  console.log(`✅ Editor result: "${editorData.result}"`);

  // Validation — empty instruction
  const editorInvalid = await fetch(`${BASE_URL}/api/v1/ai/editor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userA.accessToken}` },
    body: JSON.stringify({ text: 'hello', instruction: '' }),
  });
  assert.strictEqual(editorInvalid.status, 400, 'Empty instruction should return 400');
  console.log('✅ Empty instruction validation rejected (400).');

  // ── 7. Summarize (SSE Stream) ────────────────────────────────────────────
  console.log('\n--- 7. Testing Summarization SSE Stream (POST /api/v1/ai/summarize) ---');

  // IDOR check for summarize
  const sumIdor = await fetch(`${BASE_URL}/api/v1/ai/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userA.accessToken}` },
    body: JSON.stringify({ roomId: fakeRoomId }),
  });
  assert.strictEqual(sumIdor.status, 404, 'Summarize IDOR check should return 404');
  console.log('✅ Summarize IDOR protection passed.');

  // Valid streaming request
  const sumRes = await fetch(`${BASE_URL}/api/v1/ai/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userA.accessToken}` },
    body: JSON.stringify({ roomId }),
  });
  assert.strictEqual(sumRes.status, 200, `Summarize failed: status ${sumRes.status}`);
  assert.ok(
    sumRes.headers.get('content-type')?.includes('text/event-stream'),
    'Response must be text/event-stream'
  );

  // Read the SSE stream body
  const rawText = await sumRes.text();
  const dataLines = rawText
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.replace(/^data:\s*/, '').trim());

  assert.ok(dataLines.length > 1, 'Should have received multiple SSE data events');
  assert.strictEqual(dataLines[dataLines.length - 1], '[DONE]', 'Last SSE event must be [DONE]');

  // Reconstruct the summary text from chunks
  let summaryText = '';
  for (const line of dataLines) {
    if (line === '[DONE]') break;
    try {
      const parsed = JSON.parse(line);
      summaryText += parsed.content || '';
    } catch { /* ignore malformed chunks */ }
  }
  assert.ok(summaryText.length > 50, 'Summary text should be non-trivial');
  console.log(`✅ SSE stream received ${dataLines.length} events.`);
  console.log(`✅ Summary snippet: "${summaryText.substring(0, 150)}..."`);

  // ── 8. Rate Limiter ──────────────────────────────────────────────────────
  console.log('\n--- 8. Testing AI Rate Limiter (10 req/60s) ---');

  // Clear any existing counter for this user
  await redis.del(`ratelimit:ai:${userRL.id}`);

  let lastStatus = 0;
  for (let i = 1; i <= 12; i++) {
    const r = await fetch(`${BASE_URL}/api/v1/ai/tone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userRL.accessToken}` },
      body: JSON.stringify({ text: `test message ${i}`, tone: 'concise' }),
    });
    lastStatus = r.status;
    if (i <= 10) {
      assert.strictEqual(r.status, 200, `Request ${i} should succeed (200), got ${r.status}`);
    } else {
      assert.strictEqual(r.status, 429, `Request ${i} should be rate limited (429), got ${r.status}`);
      const body = (await r.json()) as any;
      assert.ok(typeof body.retryAfter === 'number', 'Rate limit response should include retryAfter');
      console.log(`✅ Request ${i} correctly rate-limited (429). retryAfter: ${body.retryAfter}s`);
    }
  }
  console.log('✅ Rate limiter correctly enforces 10 req/60s limit.');

  console.log('\n🎉 ALL PHASE 6 AI INTEGRATION TESTS PASSED SUCCESSFULLY!');
}

runAITests()
  .catch((err) => {
    console.error('\n❌ TEST FAILED:', err.message || err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
    redis.disconnect();
  });
