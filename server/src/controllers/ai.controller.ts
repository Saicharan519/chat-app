import { Response } from 'express';
import crypto from 'crypto';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import pool from '../config/db';
import redis from '../config/redis';
import { logger } from '../utils/logger';
import { smartReplySchema, toneSchema, editorSchema, summarizeSchema, assistantSchema } from '../schemas/ai.schema';
import {
  generateSmartReplies,
  refineTone,
  refineCustom,
  getChatSummaryStream,
  getAssistantStream,
  ChatMessage,
} from '../utils/ai.service';

// ─────────────────────────────────────────────
// Helper: verify room membership (IDOR guard)
// ─────────────────────────────────────────────
async function assertRoomMembership(roomId: string, userId: string): Promise<boolean> {
  const res = await pool.query(
    'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
    [roomId, userId]
  );
  return (res.rowCount ?? 0) > 0;
}

// ─────────────────────────────────────────────
// POST /api/v1/ai/smart-reply
// ─────────────────────────────────────────────
export async function getSmartReplies(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const parsed = smartReplySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ errors: parsed.error.errors });
    const { roomId } = parsed.data;

    if (!(await assertRoomMembership(roomId, userId))) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Fetch last 10 non-deleted text messages with sender usernames
    const msgRes = await pool.query(
      `SELECT u.username AS sender, m.content
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.room_id = $1 AND m.type = 'text' AND m.deleted_at IS NULL AND m.content IS NOT NULL
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 10`,
      [roomId]
    );

    const messages: ChatMessage[] = msgRes.rows.reverse().map((r) => ({
      sender: r.sender,
      content: r.content,
    }));

    if (messages.length === 0) {
      return res.status(200).json({ replies: [], cached: false });
    }

    // Check Redis cache (key = SHA-256 of message content)
    const cacheKey = `ai:smart-reply:${crypto
      .createHash('sha256')
      .update(JSON.stringify(messages))
      .digest('hex')}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.info('Smart replies served from Redis cache', { roomId, userId });
      return res.status(200).json({ replies: JSON.parse(cached), cached: true });
    }

    const replies = await generateSmartReplies(messages);

    // Cache for 5 minutes
    await redis.set(cacheKey, JSON.stringify(replies), 'EX', 300);

    logger.info('Smart replies generated', { roomId, userId, count: replies.length });
    return res.status(200).json({ replies, cached: false });
  } catch (error: any) {
    logger.error('Error in getSmartReplies', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─────────────────────────────────────────────
// POST /api/v1/ai/tone
// ─────────────────────────────────────────────
export async function refineMessageTone(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const parsed = toneSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ errors: parsed.error.errors });

    const { text, tone } = parsed.data;
    const result = await refineTone(text, tone);

    logger.info('Tone refinement complete', { userId, tone });
    return res.status(200).json({ result });
  } catch (error: any) {
    logger.error('Error in refineMessageTone', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─────────────────────────────────────────────
// POST /api/v1/ai/editor
// ─────────────────────────────────────────────
export async function refineMessageCustom(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const parsed = editorSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ errors: parsed.error.errors });

    const { text, instruction } = parsed.data;
    const result = await refineCustom(text, instruction);

    logger.info('Custom editor refinement complete', { userId });
    return res.status(200).json({ result });
  } catch (error: any) {
    logger.error('Error in refineMessageCustom', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─────────────────────────────────────────────
// POST /api/v1/ai/summarize  (SSE stream)
// ─────────────────────────────────────────────
export async function streamChatSummary(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const parsed = summarizeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ errors: parsed.error.errors });
    const { roomId } = parsed.data;

    if (!(await assertRoomMembership(roomId, userId))) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Fetch last 100 messages chronologically
    const msgRes = await pool.query(
      `SELECT u.username AS sender, m.content
       FROM (
         SELECT sender_id, content, created_at, id
         FROM messages
         WHERE room_id = $1 AND deleted_at IS NULL AND content IS NOT NULL
         ORDER BY created_at DESC, id DESC
         LIMIT 100
       ) m
       JOIN users u ON m.sender_id = u.id
       ORDER BY m.created_at ASC, m.id ASC`,
      [roomId]
    );

    const messages: ChatMessage[] = msgRes.rows.map((r) => ({
      sender: r.sender,
      content: r.content,
    }));

    if (messages.length === 0) {
      return res.status(400).json({ error: 'No messages to summarize in this room' });
    }

    // Establish SSE connection
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx proxy buffering
    res.flushHeaders();

    const stream = await getChatSummaryStream(messages);

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

    logger.info('Chat summary streamed successfully', { roomId, userId });
  } catch (error: any) {
    logger.error('Error in streamChatSummary', { error: error.message });
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error' });
    }
    // If SSE already started, send error event and close
    res.write(`data: ${JSON.stringify({ error: 'Stream error occurred' })}\n\n`);
    res.end();
  }
}

// ─────────────────────────────────────────────
// POST /api/v1/ai/assistant  (SSE stream)
// ─────────────────────────────────────────────
export async function streamAssistant(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const parsed = assistantSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ errors: parsed.error.errors });
    const { history } = parsed.data;

    // Establish SSE connection
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const stream = await getAssistantStream(history);

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

    logger.info('Assistant streamed successfully', { userId });
  } catch (error: any) {
    logger.error('Error in streamAssistant', { error: error.message });
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.write(`data: ${JSON.stringify({ error: 'Stream error occurred' })}\n\n`);
    res.end();
  }
}
