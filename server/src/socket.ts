import { Server, Socket } from 'socket.io';
import http from 'http';
import { verifyAccessToken, AccessTokenPayload } from './utils/auth';
import redis from './config/redis';
import pool from './config/db';
import { logger } from './utils/logger';
import { addEmbeddingJob } from './queues/embedding.queue';

export let io: Server;

export function initSocket(server: http.Server): Server {
  io = new Server(server, {
    cors: {
      origin: '*', // Allow all in dev/testing
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Authentication Handshake Middleware
  io.use(async (socket, next) => {
    try {
      let token = socket.handshake.auth?.token;
      if (!token && socket.handshake.headers?.authorization) {
        const authHeader = socket.handshake.headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
          token = authHeader.substring(7);
        } else {
          token = authHeader;
        }
      }

      if (!token) {
        logger.debug('Socket authentication failed: Token missing');
        return next(new Error('Authentication error: Token missing'));
      }

      let payload: AccessTokenPayload;
      try {
        payload = verifyAccessToken(token);
      } catch (err: any) {
        logger.debug('Socket authentication failed: JWT invalid or expired', { error: err.message });
        return next(new Error('Authentication error: Invalid or expired token'));
      }

      // Check JTI blacklist
      const isBlacklisted = await redis.get(`blacklist:${payload.jti}`);
      if (isBlacklisted) {
        logger.warn('Socket connection attempted with blacklisted token', { jti: payload.jti, userId: payload.userId });
        return next(new Error('Authentication error: Token revoked'));
      }

      // Save user payload in socket
      socket.data.user = payload;
      next();
    } catch (error: any) {
      logger.error('Error in socket auth middleware', { error: error.message });
      return next(new Error('Authentication error: Internal server error'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const user = socket.data.user as AccessTokenPayload;
    const userId = user.userId;
    logger.info(`Socket connected: ${socket.id} (User: ${userId}, ${user.username})`);

    // Fetch user's room memberships and join them
    let roomIds: string[] = [];
    try {
      const roomsResult = await pool.query(
        'SELECT room_id FROM room_members WHERE user_id = $1',
        [userId]
      );
      roomIds = roomsResult.rows.map((row) => row.room_id);
      
      // Join socket rooms
      for (const roomId of roomIds) {
        socket.join(roomId);
      }
    } catch (dbError: any) {
      logger.error('Failed to retrieve room memberships on socket connection', {
        userId,
        error: dbError.message,
      });
    }

    // Set presence status to online in Redis
    try {
      await redis.set(`presence:${userId}`, 'online', 'EX', 30);
      // Broadcast online status to all room members
      for (const roomId of roomIds) {
        socket.to(roomId).emit('presence:update', { userId, status: 'online' });
      }

      // Sync current presence of all room members back to the connecting socket
      if (roomIds.length > 0) {
        const memberRes = await pool.query(
          'SELECT DISTINCT user_id FROM room_members WHERE room_id = ANY($1) AND user_id != $2',
          [roomIds, userId]
        );
        const presenceSnapshot: Record<string, 'online' | 'offline'> = {};
        for (const row of memberRes.rows) {
          const memberId: string = row.user_id;
          const status = await redis.get(`presence:${memberId}`);
          presenceSnapshot[memberId] = status === 'online' ? 'online' : 'offline';
        }
        socket.emit('presence:sync', presenceSnapshot);
      }
    } catch (redisError: any) {
      logger.error('Failed to update presence to online in Redis', {
        userId,
        error: redisError.message,
      });
    }

    // --- SOCKET EVENT HANDLERS ---

    // 1. Room Join (replay and read receipt updates)
    socket.on('room:join', async (data: { roomId: string }) => {
      try {
        const { roomId } = data;
        logger.info(`Socket received room:join for room ${roomId} from user ${userId}`);
        if (!roomId) {
          socket.emit('error', { message: 'roomId is required' });
          return;
        }

        // Verify room membership
        const memberRes = await pool.query(
          'SELECT last_read_at FROM room_members WHERE room_id = $1 AND user_id = $2',
          [roomId, userId]
        );

        if (memberRes.rowCount === 0) {
          logger.warn(`User ${userId} attempted to join room ${roomId} without membership`);
          socket.emit('error', { message: 'Not a member of this room' });
          return;
        }

        const lastReadAt = memberRes.rows[0].last_read_at;

        // Ensure socket is in the room's room channel
        socket.join(roomId);
        if (!roomIds.includes(roomId)) {
          roomIds.push(roomId);
        }

        // Query for new messages since last_read_at
        const messagesRes = await pool.query(
          `SELECT id, room_id, sender_id, type, content, file_url, file_name, file_size, edited_at, deleted_at, created_at
           FROM messages
           WHERE room_id = $1 AND created_at > $2
           ORDER BY created_at ASC`,
          [roomId, lastReadAt]
        );

        const count = messagesRes.rowCount || 0;

        if (count > 50) {
          socket.emit('room:replay', { messages: [], has_gap: true, roomId });
        } else {
          // Format soft-deleted messages
          const formattedMessages = messagesRes.rows.map((msg) => {
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
              };
            }
            return msg;
          });
          socket.emit('room:replay', { messages: formattedMessages, has_gap: false, roomId });
        }

        // Clear unread count for this user in Redis
        await redis.del(`unread:${userId}:${roomId}`);

        // Update user's last_read_at timestamp to now
        await pool.query(
          'UPDATE room_members SET last_read_at = NOW() WHERE room_id = $1 AND user_id = $2',
          [roomId, userId]
        );

      } catch (err: any) {
        logger.error('Error in room:join event', { userId, error: err.message });
        socket.emit('error', { message: 'Internal server error during room join' });
      }
    });

    // 2. Send Message
    socket.on('message:send', async (data: {
      roomId: string;
      content?: string;
      type?: 'text' | 'image' | 'file' | 'system';
      file_url?: string;
      file_name?: string;
      file_size?: number;
    }) => {
      try {
        const { roomId, content, type, file_url, file_name, file_size } = data;
        if (!roomId) {
          socket.emit('error', { message: 'roomId is required' });
          return;
        }

        // Verify membership
        const memberRes = await pool.query(
          'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
          [roomId, userId]
        );

        if (memberRes.rowCount === 0) {
          socket.emit('error', { message: 'Not a member of this room' });
          return;
        }

        const msgType = type || 'text';

        // Insert message into Postgres
        const insertRes = await pool.query(
          `INSERT INTO messages (room_id, sender_id, type, content, file_url, file_name, file_size)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, room_id, sender_id, type, content, file_url, file_name, file_size, edited_at, deleted_at, created_at`,
          [roomId, userId, msgType, content || null, file_url || null, file_name || null, file_size || null]
        );

        const message = insertRes.rows[0];

        // Update sender's last_read_at in room_members
        await pool.query(
          'UPDATE room_members SET last_read_at = $1 WHERE room_id = $2 AND user_id = $3',
          [message.created_at, roomId, userId]
        );

        // Fetch other room members to increment unread counts
        const otherMembersRes = await pool.query(
          'SELECT user_id FROM room_members WHERE room_id = $1 AND user_id != $2',
          [roomId, userId]
        );

        for (const row of otherMembersRes.rows) {
          const memberId = row.user_id;
          await redis.incr(`unread:${memberId}:${roomId}`);
        }

        // Broadcast the message to the room (including sender)
        io.to(roomId).emit('message:new', message);

        // Queue embedding generation for semantic search (Phase 7)
        await addEmbeddingJob(message.id);

      } catch (err: any) {
        logger.error('Error in message:send event', { userId, error: err.message });
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // 3. Read receipt
    socket.on('message:read', async (data: { roomId: string; messageId: string }) => {
      try {
        const { roomId, messageId } = data;
        if (!roomId || !messageId) {
          socket.emit('error', { message: 'roomId and messageId are required' });
          return;
        }

        // Verify membership
        const memberRes = await pool.query(
          'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
          [roomId, userId]
        );

        if (!memberRes.rowCount || memberRes.rowCount === 0) {
          socket.emit('error', { message: 'Not a member of this room' });
          return;
        }

        // Get message created_at timestamp to set last_read_at
        const msgCheck = await pool.query('SELECT created_at FROM messages WHERE id = $1', [messageId]);
        let readTimestamp = new Date();
        if (msgCheck.rowCount && msgCheck.rowCount > 0) {
          readTimestamp = msgCheck.rows[0].created_at;
        }

        // Update reader's last_read_at to the message creation time
        await pool.query(
          'UPDATE room_members SET last_read_at = $1 WHERE room_id = $2 AND user_id = $3',
          [readTimestamp, roomId, userId]
        );

        // Insert into message_reads
        await pool.query(
          `INSERT INTO message_reads (message_id, user_id, read_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (message_id, user_id) DO NOTHING`,
          [messageId, userId, readTimestamp]
        );

        // Broadcast read receipt to room members
        io.to(roomId).emit('message:read', { roomId, messageId, userId });

      } catch (err: any) {
        logger.error('Error in message:read event', { userId, error: err.message });
        socket.emit('error', { message: 'Failed to mark message as read' });
      }
    });

    // 4. Typing Start
    socket.on('typing:start', async (data: { roomId: string }) => {
      try {
        const { roomId } = data;
        if (!roomId) return;

        // Save typing status in Redis
        await redis.set(`typing:${roomId}:${userId}`, '1', 'EX', 3);

        // Broadcast to other users in room
        socket.to(roomId).emit('typing:update', { roomId, userId, isTyping: true });
      } catch (err: any) {
        logger.error('Error in typing:start event', { userId, error: err.message });
      }
    });

    // 5. Typing Stop
    socket.on('typing:stop', async (data: { roomId: string }) => {
      try {
        const { roomId } = data;
        if (!roomId) return;

        // Delete typing status in Redis
        await redis.del(`typing:${roomId}:${userId}`);

        // Broadcast to other users in room
        socket.to(roomId).emit('typing:update', { roomId, userId, isTyping: false });
      } catch (err: any) {
        logger.error('Error in typing:stop event', { userId, error: err.message });
      }
    });

    // 6. Presence Heartbeat
    socket.on('presence:heartbeat', async () => {
      try {
        await redis.set(`presence:${userId}`, 'online', 'EX', 30);
      } catch (err: any) {
        logger.error('Error in presence:heartbeat event', { userId, error: err.message });
      }
    });

    // 7. Disconnection
    socket.on('disconnect', async () => {
      logger.info(`Socket disconnected: ${socket.id} (User: ${userId})`);
      try {
        await redis.del(`presence:${userId}`);
        
        // Broadcast offline status to all room members
        for (const roomId of roomIds) {
          socket.to(roomId).emit('presence:update', { userId, status: 'offline' });
        }
      } catch (err: any) {
        logger.error('Error handling disconnect presence cleanup', { userId, error: err.message });
      }
    });
  });

  return io;
}
