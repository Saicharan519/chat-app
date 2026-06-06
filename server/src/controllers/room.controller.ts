import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import pool, { getClient } from '../config/db';
import { createRoomSchema, addMemberSchema, queryRoomMembersSchema } from '../schemas/room.schema';
import { logger } from '../utils/logger';
import { io } from '../socket';

/**
 * Make every connected socket for each given user join the new room and notify
 * the client so it can refresh its rooms list. Without this, sockets that
 * connected BEFORE the room was created never join it, and real-time messages
 * skip them until they refresh the page.
 */
async function attachUsersToNewRoom(memberIds: string[], room: any) {
  if (!io) return;
  for (const memberId of memberIds) {
    try {
      // socketsJoin makes all sockets currently in `user:{id}` also join roomId.
      await io.in(`user:${memberId}`).socketsJoin(room.id);
      io.to(`user:${memberId}`).emit('room:created', room);
    } catch (err: any) {
      logger.warn('Failed to attach user to new room', {
        userId: memberId,
        roomId: room.id,
        error: err.message,
      });
    }
  }
}

/**
 * Create a new chat room (Direct Message or Group Room)
 */
export async function createRoom(req: AuthenticatedRequest, res: Response) {
  try {
    const creatorId = req.user?.userId;
    if (!creatorId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const parseResult = createRoomSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ errors: parseResult.error.errors });
    }

    const { type, name, memberIds } = parseResult.data;

    // Filter out creatorId if included to prevent duplicate membership inserts
    const uniqueMemberIds = Array.from(new Set(memberIds.filter((id) => id !== creatorId)));

    if (type === 'direct') {
      if (uniqueMemberIds.length !== 1) {
        return res.status(400).json({ error: 'Direct messages must have exactly one other member' });
      }
      const targetUserId = uniqueMemberIds[0];

      if (creatorId === targetUserId) {
        return res.status(400).json({ error: 'Cannot create a direct message room with yourself' });
      }

      // Check if target user exists
      const targetUserCheck = await pool.query('SELECT 1 FROM users WHERE id = $1', [targetUserId]);
      if (targetUserCheck.rowCount === 0) {
        return res.status(400).json({ error: 'Target user does not exist' });
      }

      // DM uniqueness: check if direct room already exists
      const existingRoomQuery = `
        SELECT r.id, r.name, r.type, r.created_by, r.created_at
        FROM rooms r
        JOIN room_members rm1 ON r.id = rm1.room_id
        JOIN room_members rm2 ON r.id = rm2.room_id
        WHERE r.type = 'direct'
          AND rm1.user_id = $1
          AND rm2.user_id = $2
        LIMIT 1;
      `;
      const existingRoomRes = await pool.query(existingRoomQuery, [creatorId, targetUserId]);
      if (existingRoomRes.rowCount && existingRoomRes.rowCount > 0) {
        logger.info('Direct room already exists. Returning existing room.', {
          roomId: existingRoomRes.rows[0].id,
          creatorId,
          targetUserId,
        });
        return res.status(200).json(existingRoomRes.rows[0]);
      }

      // Create room with transaction
      const client = await getClient();
      try {
        await client.query('BEGIN');

        const insertRoomRes = await client.query(
          'INSERT INTO rooms (type, created_by) VALUES ($1, $2) RETURNING *',
          ['direct', creatorId]
        );
        const newRoom = insertRoomRes.rows[0];

        await client.query(
          'INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3)',
          [newRoom.id, creatorId, 'owner']
        );
        await client.query(
          'INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3)',
          [newRoom.id, targetUserId, 'member']
        );

        await client.query('COMMIT');
        logger.info('Created new direct room', { roomId: newRoom.id, creatorId, targetUserId });
        await attachUsersToNewRoom([creatorId, targetUserId], newRoom);
        return res.status(201).json(newRoom);
      } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Failed to create direct room', { error: err.message });
        return res.status(500).json({ error: 'Failed to create room' });
      } finally {
        client.release();
      }
    } else {
      // Group Room
      // Verify all memberIds exist
      if (uniqueMemberIds.length > 0) {
        const userCountRes = await pool.query(
          'SELECT COUNT(*) FROM users WHERE id = ANY($1::uuid[])',
          [uniqueMemberIds]
        );
        const count = parseInt(userCountRes.rows[0].count, 10);
        if (count !== uniqueMemberIds.length) {
          return res.status(400).json({ error: 'One or more member IDs are invalid or do not exist' });
        }
      }

      const client = await getClient();
      try {
        await client.query('BEGIN');

        const insertRoomRes = await client.query(
          'INSERT INTO rooms (name, type, created_by) VALUES ($1, $2, $3) RETURNING *',
          [name, 'group', creatorId]
        );
        const newRoom = insertRoomRes.rows[0];

        // Insert owner
        await client.query(
          'INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3)',
          [newRoom.id, creatorId, 'owner']
        );

        // Insert other members
        for (const memberId of uniqueMemberIds) {
          await client.query(
            'INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3)',
            [newRoom.id, memberId, 'member']
          );
        }

        await client.query('COMMIT');
        logger.info('Created new group room', { roomId: newRoom.id, creatorId, name });
        await attachUsersToNewRoom([creatorId, ...uniqueMemberIds], newRoom);
        return res.status(201).json(newRoom);
      } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Failed to create group room', { error: err.message });
        return res.status(500).json({ error: 'Failed to create room' });
      } finally {
        client.release();
      }
    }
  } catch (error: any) {
    logger.error('Unexpected error in createRoom controller', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * List all rooms for the authenticated user
 */
export async function listRooms(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const queryStr = `
      SELECT 
        r.id, 
        r.name, 
        r.type, 
        r.created_by, 
        r.created_at, 
        rm.role, 
        rm.last_read_at,
        (
          SELECT json_build_object('id', u.id, 'username', u.username, 'email', u.email)
          FROM room_members rm_other
          JOIN users u ON rm_other.user_id = u.id
          WHERE rm_other.room_id = r.id AND rm_other.user_id != $1
          LIMIT 1
        ) as other_member
      FROM rooms r
      JOIN room_members rm ON r.id = rm.room_id
      WHERE rm.user_id = $1
      ORDER BY r.created_at DESC;
    `;

    const roomsRes = await pool.query(queryStr, [userId]);
    return res.status(200).json(roomsRes.rows);
  } catch (error: any) {
    logger.error('Error in listRooms controller', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get detailed metadata of a specific room (IDOR protected)
 */
export async function getRoomDetails(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const { roomId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const queryStr = `
      SELECT 
        r.id, 
        r.name, 
        r.type, 
        r.created_by, 
        r.created_at, 
        rm.role, 
        rm.last_read_at,
        (
          SELECT json_build_object('id', u.id, 'username', u.username, 'email', u.email)
          FROM room_members rm_other
          JOIN users u ON rm_other.user_id = u.id
          WHERE rm_other.room_id = r.id AND rm_other.user_id != $2
          LIMIT 1
        ) as other_member
      FROM rooms r
      JOIN room_members rm ON r.id = rm.room_id
      WHERE r.id = $1 AND rm.user_id = $2;
    `;

    const roomRes = await pool.query(queryStr, [roomId, userId]);
    if (roomRes.rowCount === 0) {
      // Return 404 for IDOR protection
      return res.status(404).json({ error: 'Room not found' });
    }

    return res.status(200).json(roomRes.rows[0]);
  } catch (error: any) {
    logger.error('Error in getRoomDetails controller', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get paginated list of members in a room (IDOR protected)
 */
export async function listRoomMembers(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const { roomId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verify IDOR: Authenticated user must be a member of the room
    const membershipCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );
    if (membershipCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const parseResult = queryRoomMembersSchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({ errors: parseResult.error.errors });
    }
    const { limit, offset } = parseResult.data;

    const queryStr = `
      SELECT u.id, u.username, u.email, rm.role, rm.created_at as joined_at
      FROM room_members rm
      JOIN users u ON rm.user_id = u.id
      WHERE rm.room_id = $1
      ORDER BY rm.created_at ASC
      LIMIT $2 OFFSET $3;
    `;

    const membersRes = await pool.query(queryStr, [roomId, limit, offset]);
    return res.status(200).json({ members: membersRes.rows });
  } catch (error: any) {
    logger.error('Error in listRoomMembers controller', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Add a member to a group room (RBAC protected)
 */
export async function addRoomMember(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const { roomId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const parseResult = addMemberSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ errors: parseResult.error.errors });
    }
    const { userId: targetUserId } = parseResult.data;

    // Check if room exists and get its type
    const roomRes = await pool.query('SELECT type FROM rooms WHERE id = $1', [roomId]);
    if (roomRes.rowCount === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const room = roomRes.rows[0];
    if (room.type === 'direct') {
      return res.status(400).json({ error: 'Cannot add members to a direct message room' });
    }

    // RBAC Check: Is current user owner or admin of the room?
    const selfMembership = await pool.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );
    if (selfMembership.rowCount === 0) {
      return res.status(404).json({ error: 'Room not found' }); // IDOR protection
    }

    const userRole = selfMembership.rows[0].role;
    if (userRole !== 'owner' && userRole !== 'admin') {
      return res.status(403).json({ error: 'Only owners and admins can add members to this room' });
    }

    // Check if target user exists
    const targetUserCheck = await pool.query('SELECT 1 FROM users WHERE id = $1', [targetUserId]);
    if (targetUserCheck.rowCount === 0) {
      return res.status(400).json({ error: 'Target user does not exist' });
    }

    // Check if target user is already a member
    const targetMembership = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, targetUserId]
    );
    if (targetMembership.rowCount && targetMembership.rowCount > 0) {
      return res.status(400).json({ error: 'User is already a member of this room' });
    }

    // Insert target user as member
    await pool.query(
      'INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3)',
      [roomId, targetUserId, 'member']
    );

    logger.info('Added member to room', { roomId, targetUserId, addedBy: userId });
    return res.status(200).json({ message: 'Member added successfully' });
  } catch (error: any) {
    logger.error('Error in addRoomMember controller', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Remove a member from a group room (RBAC & self-leave allowed)
 */
export async function removeRoomMember(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const { roomId, userId: targetUserId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check if room exists and is a group
    const roomRes = await pool.query('SELECT type FROM rooms WHERE id = $1', [roomId]);
    if (roomRes.rowCount === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const room = roomRes.rows[0];
    if (room.type === 'direct') {
      return res.status(400).json({ error: 'Cannot remove members from a direct message room' });
    }

    // Get current user's membership details
    const selfMembership = await pool.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );
    if (selfMembership.rowCount === 0) {
      return res.status(404).json({ error: 'Room not found' }); // IDOR protection
    }
    const userRole = selfMembership.rows[0].role;

    // Check if target user is in the room
    const targetMembership = await pool.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, targetUserId]
    );
    if (targetMembership.rowCount === 0) {
      return res.status(400).json({ error: 'Target user is not a member of this room' });
    }
    const targetRole = targetMembership.rows[0].role;

    const isSelfLeave = userId === targetUserId;

    if (isSelfLeave) {
      // Owner self-leave safety check: owner cannot leave if there are other members (must transfer ownership or delete room)
      if (userRole === 'owner') {
        const countRes = await pool.query(
          'SELECT COUNT(*) FROM room_members WHERE room_id = $1',
          [roomId]
        );
        const count = parseInt(countRes.rows[0].count, 10);
        if (count > 1) {
          return res.status(400).json({
            error: 'Owner cannot leave room with active members. Please transfer ownership or delete the room.',
          });
        }
      }
    } else {
      // Kicking someone else requires RBAC permissions
      if (userRole !== 'owner' && userRole !== 'admin') {
        return res.status(403).json({ error: 'Only owners and admins can remove members' });
      }

      // Hierarchy validation: admins cannot kick owners or other admins
      if (userRole === 'admin' && (targetRole === 'owner' || targetRole === 'admin')) {
        return res.status(403).json({ error: 'Admins cannot remove owners or other admins' });
      }
    }

    // Remove member
    await pool.query('DELETE FROM room_members WHERE room_id = $1 AND user_id = $2', [
      roomId,
      targetUserId,
    ]);

    logger.info('Removed member from room', { roomId, targetUserId, removedBy: userId, isSelfLeave });
    return res.status(200).json({ message: isSelfLeave ? 'Left room successfully' : 'Member removed successfully' });
  } catch (error: any) {
    logger.error('Error in removeRoomMember controller', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Delete a conversation for the current user.
 *
 * For DMs: removes the current user from the room. If no members remain, the room and its messages are hard-deleted.
 * For groups: same — leaves the room; if empty, room is deleted.
 *
 * Returns 404 if the user is not a member (IDOR-safe).
 */
export async function deleteRoomForUser(req: AuthenticatedRequest, res: Response) {
  const userId = req.user?.userId;
  const { roomId } = req.params;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!roomId) {
    return res.status(400).json({ error: 'roomId is required' });
  }

  const dbClient = await getClient();
  try {
    await dbClient.query('BEGIN');

    // Verify membership — IDOR guard (return 404 not 403)
    const memberCheck = await dbClient.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );
    if (memberCheck.rowCount === 0) {
      await dbClient.query('ROLLBACK');
      return res.status(404).json({ error: 'Room not found' });
    }

    // Remove current user
    await dbClient.query(
      'DELETE FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );

    // If the room is now empty, hard-delete it (messages cascade via FK ON DELETE CASCADE)
    const remaining = await dbClient.query(
      'SELECT COUNT(*)::int AS count FROM room_members WHERE room_id = $1',
      [roomId]
    );
    const memberCount = remaining.rows[0]?.count ?? 0;
    let roomDeleted = false;
    if (memberCount === 0) {
      await dbClient.query('DELETE FROM rooms WHERE id = $1', [roomId]);
      roomDeleted = true;
    }

    await dbClient.query('COMMIT');

    logger.info('User left room', { userId, roomId, roomDeleted });
    return res.status(200).json({ roomId, roomDeleted });
  } catch (error: any) {
    await dbClient.query('ROLLBACK');
    logger.error('Error in deleteRoomForUser controller', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    dbClient.release();
  }
}
