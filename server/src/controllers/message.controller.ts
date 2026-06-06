import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import pool from '../config/db';
import { createMessageSchema, editMessageSchema, queryMessagesSchema } from '../schemas/message.schema';
import { logger } from '../utils/logger';
import { addEmbeddingJob } from '../queues/embedding.queue';
import { generateEmbedding, formatVectorLiteral } from '../utils/gemini.service';
import redis from '../config/redis';
import { io } from '../socket';

/**
 * Get messages in a room with cursor-based pagination (IDOR protected)
 */
export async function getRoomMessages(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const { roomId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // IDOR Check: Verify that the current user is a member of the room
    const membershipCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );
    if (membershipCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Validate query parameters
    const parseResult = queryMessagesSchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({ errors: parseResult.error.errors });
    }

    const { limit, cursor } = parseResult.data;

    let queryStr = `
      SELECT
        m.id, m.room_id, m.sender_id, m.type, m.content, m.file_url, m.file_name, m.file_size,
        m.edited_at, m.deleted_at, m.created_at,
        COALESCE(
          (
            SELECT json_agg(json_build_object('emoji', emoji, 'users', users) ORDER BY emoji)
            FROM (
              SELECT emoji, json_agg(user_id ORDER BY created_at) AS users
              FROM message_reactions
              WHERE message_id = m.id
              GROUP BY emoji
            ) sub
          ),
          '[]'::json
        ) AS reactions
      FROM messages m
      WHERE m.room_id = $1
    `;
    const params: any[] = [roomId];

    if (cursor) {
      try {
        const decodedCursor = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
        const { created_at, id } = decodedCursor;
        if (!created_at || !id) {
          return res.status(400).json({ error: 'Invalid cursor format' });
        }
        queryStr += ` AND (m.created_at < $2 OR (m.created_at = $2 AND m.id < $3))`;
        params.push(created_at, id);
      } catch (err) {
        return res.status(400).json({ error: 'Invalid cursor encoding' });
      }
    }

    // Add ordering and limit
    const limitIndex = params.length + 1;
    queryStr += ` ORDER BY m.created_at DESC, m.id DESC LIMIT $${limitIndex}`;
    params.push(limit);

    const messagesRes = await pool.query(queryStr, params);
    const messages = messagesRes.rows;

    // Format soft-deleted messages
    const formattedMessages = messages.map((msg) => {
      if (msg.deleted_at) {
        return {
          id: msg.id,
          room_id: msg.room_id,
          sender_id: msg.sender_id,
          type: msg.type,
          content: 'This message was deleted',
          file_url: null,
          file_name: null,
          file_size: null,
          edited_at: msg.edited_at,
          deleted_at: msg.deleted_at,
          created_at: msg.created_at,
          reactions: [],
        };
      }
      return msg;
    });

    // Determine the next cursor
    let nextCursor: string | null = null;
    if (messages.length === limit) {
      const lastMessage = messages[messages.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({
          created_at: lastMessage.created_at,
          id: lastMessage.id,
        })
      ).toString('base64');
    }

    return res.status(200).json({
      messages: formattedMessages,
      nextCursor,
    });
  } catch (error: any) {
    logger.error('Error in getRoomMessages controller', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Create a message in a room (REST Helper for testing) (IDOR protected)
 */
export async function createMessage(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const { roomId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // IDOR Check: Verify that the current user is a member of the room
    const membershipCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );
    if (membershipCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Validate body content
    const parseResult = createMessageSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ errors: parseResult.error.errors });
    }

    const { content } = parseResult.data;

    const insertRes = await pool.query(
      `INSERT INTO messages (room_id, sender_id, type, content)
       VALUES ($1, $2, $3, $4)
       RETURNING id, room_id, sender_id, type, content, file_url, file_name, file_size, edited_at, deleted_at, created_at, '[]'::json AS reactions`,
      [roomId, userId, 'text', content]
    );

    const message = insertRes.rows[0];

    // Update sender's last_read_at in room_members
    await pool.query(
      'UPDATE room_members SET last_read_at = $1 WHERE room_id = $2 AND user_id = $3',
      [message.created_at, roomId, userId]
    );

    // Fetch other room members to increment unread counts in Redis
    const otherMembersRes = await pool.query(
      'SELECT user_id FROM room_members WHERE room_id = $1 AND user_id != $2',
      [roomId, userId]
    );

    for (const row of otherMembersRes.rows) {
      const memberId = row.user_id;
      await redis.incr(`unread:${memberId}:${roomId}`);
    }

    // Broadcast the new message to room members
    if (io) {
      io.to(roomId).emit('message:new', message);
    }

    logger.info('Created new message via REST helper & broadcasted', { messageId: message.id, roomId, senderId: userId });

    // Queue embedding for semantic search (Phase 7) — fire and forget
    await addEmbeddingJob(message.id);

    return res.status(201).json(message);
  } catch (error: any) {
    logger.error('Error in createMessage controller', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Edit an existing message (Ownership protected)
 */
export async function editMessage(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const { messageId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Validate request body
    const parseResult = editMessageSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ errors: parseResult.error.errors });
    }

    const { content } = parseResult.data;

    // Fetch the message to check existence and ownership
    const messageCheck = await pool.query(
      'SELECT sender_id, deleted_at FROM messages WHERE id = $1',
      [messageId]
    );

    if (messageCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const message = messageCheck.rows[0];

    // Ownership check: must be the sender of the message
    if (message.sender_id !== userId) {
      return res.status(403).json({ error: 'You are not authorized to edit this message' });
    }

    // Ensure the message is not deleted
    if (message.deleted_at) {
      return res.status(400).json({ error: 'Cannot edit a deleted message' });
    }

    // Update message content and edited_at
    const updateRes = await pool.query(
      `UPDATE messages
       SET content = $1, edited_at = NOW()
       WHERE id = $2
       RETURNING id, room_id, sender_id, type, content, file_url, file_name, file_size, edited_at, deleted_at, created_at, '[]'::json AS reactions`,
      [content, messageId]
    );

    const updatedMessage = updateRes.rows[0];

    // Broadcast updated message to room
    if (io) {
      io.to(updatedMessage.room_id).emit('message:update', updatedMessage);
    }

    logger.info('Edited message', { messageId, userId });
    return res.status(200).json(updatedMessage);
  } catch (error: any) {
    logger.error('Error in editMessage controller', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Soft delete a message (Ownership protected)
 */
export async function deleteMessage(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const { messageId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Fetch the message to check existence and ownership
    const messageCheck = await pool.query(
      'SELECT sender_id, deleted_at FROM messages WHERE id = $1',
      [messageId]
    );

    if (messageCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const message = messageCheck.rows[0];

    // Ownership check: must be the sender of the message
    if (message.sender_id !== userId) {
      return res.status(403).json({ error: 'You are not authorized to delete this message' });
    }

    // If already deleted, just return success
    if (message.deleted_at) {
      return res.status(200).json({ message: 'Message already deleted' });
    }

    // Soft delete: clear content & file attributes, set deleted_at = NOW()
    const deleteRes = await pool.query(
      `UPDATE messages
       SET content = NULL, file_url = NULL, file_name = NULL, file_size = NULL, deleted_at = NOW()
       WHERE id = $1
       RETURNING id, room_id, sender_id, type, content, file_url, file_name, file_size, edited_at, deleted_at, created_at, '[]'::json AS reactions`,
      [messageId]
    );

    const updatedMessage = deleteRes.rows[0];

    // Broadcast updated message to room
    if (io) {
      io.to(updatedMessage.room_id).emit('message:update', updatedMessage);
    }

    logger.info('Soft deleted message', { messageId, userId });
    return res.status(200).json(updatedMessage);
  } catch (error: any) {
    logger.error('Error in deleteMessage controller', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Semantic Search — GET /api/v1/messages/room/:roomId/semantic-search?q=...&limit=10
 * Generates a Gemini embedding for the query string, then retrieves the top-k
 * most semantically similar messages from the room using pgvector cosine distance.
 * IDOR protected: caller must be a member of the room.
 */
export async function semanticSearch(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const { roomId } = req.params;
    const q = (req.query.q as string)?.trim();
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 30);

    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Query parameter "q" must be at least 2 characters.' });
    }

    // IDOR — verify room membership
    const memberCheck = await pool.query(
      `SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2`,
      [roomId, userId]
    );
    if (memberCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Room not found or access denied.' });
    }

    // Generate query embedding via Gemini
    const queryEmbedding = await generateEmbedding(q);
    if (!queryEmbedding) {
      return res.status(500).json({ error: 'Failed to generate query embedding.' });
    }

    const vectorLiteral = formatVectorLiteral(queryEmbedding);

    // Cosine similarity search using pgvector (<=> = cosine distance)
    const searchRes = await pool.query(
      `SELECT
         m.id,
         m.room_id,
         m.sender_id,
         u.username AS sender_username,
         m.type,
         m.content,
         m.file_url,
         m.file_name,
         m.created_at,
         ROUND((1 - (m.embedding <=> $2::vector))::numeric, 4) AS similarity
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.room_id = $1
         AND m.deleted_at IS NULL
         AND m.embedding IS NOT NULL
         AND (1 - (m.embedding <=> $2::vector)) >= 0.60
       ORDER BY m.embedding <=> $2::vector
       LIMIT $3`,
      [roomId, vectorLiteral, limit]
    );

    logger.info('Semantic search executed', {
      roomId,
      userId,
      query: q.substring(0, 50),
      results: searchRes.rowCount,
    });

    return res.status(200).json({
      query: q,
      results: searchRes.rows,
      total: searchRes.rowCount,
    });
  } catch (error: any) {
    logger.error('Error in semanticSearch controller', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
}


/**
 * Toggle a reaction on a message (IDOR protected).
 * If the (message, user, emoji) row exists, it's deleted. Otherwise, inserted.
 * Always returns the complete updated reactions list for the message.
 */
export async function toggleMessageReaction(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const { messageId } = req.params;
    const emoji = (req.body?.emoji ?? '').toString().trim();

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!messageId) return res.status(400).json({ error: 'messageId is required' });
    if (!emoji || emoji.length > 10) {
      return res.status(400).json({ error: 'emoji is required (max 10 chars)' });
    }

    // Fetch the message and verify room membership in one query (IDOR)
    const msgRes = await pool.query(
      `SELECT m.id, m.room_id, m.deleted_at
       FROM messages m
       JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = $1
       WHERE m.id = $2`,
      [userId, messageId]
    );
    if (msgRes.rowCount === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }
    const message = msgRes.rows[0];
    if (message.deleted_at !== null) {
      return res.status(400).json({ error: 'Cannot react to a deleted message' });
    }

    // Toggle the reaction
    const existsRes = await pool.query(
      'SELECT 1 FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
      [messageId, userId, emoji]
    );

    if ((existsRes.rowCount ?? 0) > 0) {
      await pool.query(
        'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
        [messageId, userId, emoji]
      );
    } else {
      await pool.query(
        `INSERT INTO message_reactions (message_id, user_id, emoji)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [messageId, userId, emoji]
      );
    }

    // Re-aggregate reactions for the message
    const reactionsRes = await pool.query(
      `SELECT COALESCE(
        json_agg(json_build_object('emoji', emoji, 'users', users) ORDER BY emoji),
        '[]'::json
      ) AS reactions
      FROM (
        SELECT emoji, json_agg(user_id ORDER BY created_at) AS users
        FROM message_reactions
        WHERE message_id = $1
        GROUP BY emoji
      ) sub`,
      [messageId]
    );

    const reactions = reactionsRes.rows[0]?.reactions ?? [];

    // Broadcast updated reactions to the room
    if (io) {
      io.to(message.room_id).emit('message:reactions', {
        messageId,
        roomId: message.room_id,
        reactions,
      });
    }

    return res.status(200).json({ messageId, reactions });
  } catch (error: any) {
    logger.error('Error in toggleMessageReaction controller', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
