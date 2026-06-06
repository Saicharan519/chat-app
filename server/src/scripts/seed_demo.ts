/**
 * Seed demo accounts + a sample DM conversation that shows off all major features.
 *
 * Run: npx ts-node src/scripts/seed_demo.ts   (from server/)
 *
 * Creates (idempotent):
 *   demo1@contextchat.com / Demo1234!  — username "alex_demo"
 *   demo2@contextchat.com / Demo1234!  — username "sam_demo"
 *   A direct-message room between them with a small conversation that includes
 *   a deadline mention, a meeting plan, and a couple of action items — perfect
 *   for demoing semantic search, Room Q&A, and the Catch-Me-Up summarizer.
 *
 * Existing demo rows are wiped and recreated so reruns produce a clean state.
 *
 * Embeddings are NOT generated here. Run the app, send a new message in the
 * demo room, or restart with the BullMQ worker connected — the worker
 * will backfill embeddings for messages missing them as they get touched.
 * Alternatively, the Room Q&A and summarizer features work on transcript
 * text directly (no embeddings needed) so they work immediately.
 */

import pool from '../config/db';
import { hashPassword } from '../utils/auth';
import { logger } from '../utils/logger';
import { addEmbeddingJob } from '../queues/embedding.queue';

interface SeedUser {
  email: string;
  username: string;
  password: string;
}

const DEMO_USERS: SeedUser[] = [
  { email: 'demo1@contextchat.com', username: 'alex_demo', password: 'Demo1234!' },
  { email: 'demo2@contextchat.com', username: 'sam_demo', password: 'Demo1234!' },
];

// A realistic-looking conversation that exercises every AI feature:
// - "deadline" / "submission" pair for semantic search
// - meeting plan for summarizer "action items"
// - mix of long and short messages to test smart replies
const DEMO_TRANSCRIPT: { authorIdx: 0 | 1; text: string }[] = [
  { authorIdx: 1, text: 'Hey! Are we still on for the kickoff meeting tomorrow?' },
  { authorIdx: 0, text: "Yeah, 10am works for me. I'll send the calendar invite in a bit." },
  { authorIdx: 1, text: "Perfect. By the way, the proposal needs to be submitted by Tuesday — let's make sure the draft is ready by Monday EOD." },
  { authorIdx: 0, text: 'Got it. I can write up the architecture section tonight. Can you handle the cost breakdown?' },
  { authorIdx: 1, text: "Sure thing. I'll share a Google Doc with placeholder numbers we can refine together." },
  { authorIdx: 0, text: 'Sounds good. One more thing — do we have a name for the new feature yet?' },
  { authorIdx: 1, text: 'I was thinking "Context Memory" since it lets the AI remember chat history. Open to suggestions though!' },
  { authorIdx: 0, text: "I like Context Memory. Catchy and self-explanatory. Let's go with that." },
  { authorIdx: 1, text: 'Awesome. Should we book the conference room for the kickoff or do it over video?' },
  { authorIdx: 0, text: "Video is fine — I'll send a Meet link with the invite. Talk tomorrow!" },
];

async function seed() {
  logger.info('Starting demo seed…');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Wipe any previous demo rows (cascades clean up rooms, messages, etc.)
    const emails = DEMO_USERS.map((u) => u.email);
    await client.query('DELETE FROM users WHERE email = ANY($1)', [emails]);

    // 2) Insert users
    const passwordHashes = await Promise.all(
      DEMO_USERS.map((u) => hashPassword(u.password))
    );
    const userIds: string[] = [];
    for (let i = 0; i < DEMO_USERS.length; i++) {
      const u = DEMO_USERS[i];
      const res = await client.query(
        `INSERT INTO users (username, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [u.username, u.email, passwordHashes[i]]
      );
      userIds.push(res.rows[0].id);
    }
    logger.info(`Seeded ${userIds.length} demo users`);

    // 3) Create the DM room
    const roomRes = await client.query(
      `INSERT INTO rooms (name, type, created_by)
       VALUES (NULL, 'direct', $1)
       RETURNING id`,
      [userIds[0]]
    );
    const roomId: string = roomRes.rows[0].id;

    await client.query(
      `INSERT INTO room_members (room_id, user_id, role) VALUES
       ($1, $2, 'owner'),
       ($1, $3, 'member')`,
      [roomId, userIds[0], userIds[1]]
    );

    // 4) Insert messages with staggered timestamps (oldest first → 5 min apart)
    const baseTime = Date.now() - DEMO_TRANSCRIPT.length * 5 * 60 * 1000;
    const insertedMessageIds: string[] = [];
    for (let i = 0; i < DEMO_TRANSCRIPT.length; i++) {
      const msg = DEMO_TRANSCRIPT[i];
      const ts = new Date(baseTime + i * 5 * 60 * 1000).toISOString();
      const senderId = userIds[msg.authorIdx];
      const res = await client.query(
        `INSERT INTO messages (room_id, sender_id, type, content, created_at)
         VALUES ($1, $2, 'text', $3, $4)
         RETURNING id`,
        [roomId, senderId, msg.text, ts]
      );
      insertedMessageIds.push(res.rows[0].id);
    }
    logger.info(`Seeded ${insertedMessageIds.length} demo messages`);

    await client.query('COMMIT');

    // 5) Best-effort: queue embeddings so semantic search works out of the box.
    //    If the queue/worker isn't running, this just no-ops at consume time.
    for (const id of insertedMessageIds) {
      try {
        await addEmbeddingJob(id);
      } catch (e: any) {
        logger.warn('Could not enqueue embedding job (worker may be offline)', {
          messageId: id,
          error: e.message,
        });
      }
    }

    console.log('\n✅ Demo seed complete.\n');
    console.log('   Login credentials:');
    for (const u of DEMO_USERS) {
      console.log(`     ${u.email}  /  ${u.password}   (username: ${u.username})`);
    }
    console.log(`\n   DM room id: ${roomId}\n`);
  } catch (err: any) {
    await client.query('ROLLBACK');
    logger.error('Demo seed failed', { error: err.message, stack: err.stack });
    throw err;
  } finally {
    client.release();
  }
}

seed()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
