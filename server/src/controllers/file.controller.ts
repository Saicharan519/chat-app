import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import pool from '../config/db';
import redis from '../config/redis';
import { ImageKitService } from '../utils/imagekit.service';
import { logger } from '../utils/logger';
import { io } from '../socket';
import { signUploadSchema, registerFileSchema } from '../schemas/file.schema';

/**
 * Delete a file message and remove it from ImageKit (Ownership/Admin protected)
 */
export async function deleteUploadedFile(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const { publicId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!publicId) {
      return res.status(400).json({ error: 'Public ID is required' });
    }

    // Fetch message by public_id to check ownership & existence
    const messageRes = await pool.query(
      'SELECT * FROM messages WHERE public_id = $1 AND deleted_at IS NULL',
      [publicId]
    );

    if (messageRes.rowCount === 0) {
      return res.status(404).json({ error: 'File message not found or already deleted' });
    }

    const message = messageRes.rows[0];

    // IDOR Check: Verify room membership and user role
    const membershipCheck = await pool.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [message.room_id, userId]
    );

    if (membershipCheck.rowCount === 0) {
      return res.status(403).json({ error: 'Forbidden: Not a member of this room' });
    }

    const userRole = membershipCheck.rows[0].role;
    const isSender = message.sender_id === userId;
    const isAuthorized = isSender || userRole === 'owner' || userRole === 'admin';

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Forbidden: You are not authorized to delete this file' });
    }

    // Attempt ImageKit asset deletion
    try {
      await ImageKitService.deleteFile(publicId);
      logger.info('Deleted file from ImageKit', { publicId });
    } catch (imageKitError: any) {
      // Log the ImageKit error but proceed to soft-delete from database so user experience is not degraded
      logger.error('Failed to delete asset from ImageKit, proceeding with database soft-delete', {
        publicId,
        error: imageKitError.message || imageKitError
      });
    }

    // Soft delete message in Postgres
    const deleteRes = await pool.query(
      `UPDATE messages
       SET content = NULL, file_url = NULL, file_name = NULL, file_size = NULL, public_id = NULL, deleted_at = NOW()
       WHERE id = $1
       RETURNING id, room_id, sender_id, type, content, file_url, file_name, file_size, public_id, edited_at, deleted_at, created_at`,
      [message.id]
    );

    const updatedMessage = deleteRes.rows[0];

    // Broadcast updated message to room
    if (io) {
      io.to(message.room_id).emit('message:update', updatedMessage);
    }

    logger.info('Successfully deleted file message and soft-deleted in database', {
      messageId: message.id,
      publicId,
      userId
    });

    return res.status(200).json(updatedMessage);
  } catch (error: any) {
    logger.error('Error deleting uploaded file', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Helper to validate file magic bytes on the backend.
 */
function checkBackendMagicBytes(buffer: Buffer, fileName: string, mimeType: string): { isValid: boolean; errorMsg?: string } {
  if (buffer.length < 2) {
    return { isValid: false, errorMsg: 'File is empty or too small.' };
  }

  // 1. Block executable formats
  const isExe = buffer[0] === 0x4d && buffer[1] === 0x5a;
  const isElf =
    buffer.length >= 4 &&
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46;

  if (isExe || isElf) {
    return { isValid: false, errorMsg: 'Executable files are strictly prohibited.' };
  }

  const name = fileName.toLowerCase();
  const type = mimeType.toLowerCase();

  // 2. Image validation
  if (type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(name)) {
    if (buffer.length < 4) {
      return { isValid: false, errorMsg: 'Invalid image header.' };
    }
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng =
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    let isWebp = false;
    if (buffer.length >= 12) {
      const isRiff =
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46;
      const isWebpSignature =
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
      isWebp = isRiff && isWebpSignature;
    }
    const isGif = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38;

    if (isJpeg || isPng || isWebp || isGif) {
      return { isValid: true };
    } else {
      return {
        isValid: false,
        errorMsg: 'Invalid image format. Must be a valid JPEG, PNG, WebP, or GIF image.',
      };
    }
  }

  // 3. PDF validation
  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    if (buffer.length < 4) {
      return { isValid: false, errorMsg: 'Invalid PDF header.' };
    }
    const isPdf =
      buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
    if (isPdf) {
      return { isValid: true };
    } else {
      return {
        isValid: false,
        errorMsg: 'Invalid PDF format. File content does not match PDF signature.',
      };
    }
  }

  // 4. DOC/DOCX validation
  if (
    type === 'application/msword' ||
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.doc') ||
    name.endsWith('.docx')
  ) {
    if (buffer.length < 4) {
      return { isValid: false, errorMsg: 'Invalid Document header.' };
    }
    const isDocx =
      buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
    const isDoc =
      buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;

    if (isDocx || isDoc) {
      return { isValid: true };
    } else {
      return {
        isValid: false,
        errorMsg: 'Invalid document format. File content does not match DOC/DOCX signature.',
      };
    }
  }

  return { isValid: true };
}

/**
 * Uploads a file to ImageKit and registers it in PostgreSQL (IDOR protected)
 */
export async function uploadAndRegisterFile(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const { roomId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!roomId) {
      return res.status(400).json({ error: 'Room ID is required' });
    }

    // IDOR Check: Verify room membership
    const membershipCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );

    if (membershipCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      // 1. JSON workflow (client-side upload registration)
      const parseResult = registerFileSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ errors: parseResult.error.errors });
      }

      const { file_url, file_name, file_size, file_id, type } = parseResult.data;

      // Insert file message in Postgres
      const insertRes = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, file_url, file_name, file_size, public_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, room_id, sender_id, type, content, file_url, file_name, file_size, public_id, edited_at, deleted_at, created_at`,
        [roomId, userId, type, file_url, file_name, file_size, file_id]
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

      // Log / Stub for BullMQ embedding pipeline queue
      logger.info('Queueing embedding job (BullMQ placeholder)', { messageId: message.id });

      logger.info('Successfully registered client-side uploaded file message', { roomId, userId, messageId: message.id });
      return res.status(201).json(message);
    } else {
      // 2. Multipart form-data workflow (direct server upload)
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Validate file size (<= 25MB)
      const MAX_SIZE = 25 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        return res.status(400).json({ error: 'File size exceeds the 25MB limit.' });
      }

      // Validate magic bytes
      const magicBytesCheck = checkBackendMagicBytes(file.buffer, file.originalname, file.mimetype);
      if (!magicBytesCheck.isValid) {
        return res.status(400).json({ error: magicBytesCheck.errorMsg || 'Invalid file format detected.' });
      }

      // Determine type (image or file)
      const type = file.mimetype.startsWith('image/') ? 'image' : 'file';

      // Upload file to ImageKit via Server SDK
      logger.info('Uploading file to ImageKit from backend', { roomId, userId, fileName: file.originalname });
      const folder = `room_${roomId}`;
      const uploadResult = await ImageKitService.uploadFile(file.buffer, file.originalname, folder);

      // Insert file message in Postgres
      const insertRes = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, file_url, file_name, file_size, public_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, room_id, sender_id, type, content, file_url, file_name, file_size, public_id, edited_at, deleted_at, created_at`,
        [roomId, userId, type, uploadResult.url, file.originalname, file.size, uploadResult.fileId]
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

      // Log / Stub for BullMQ embedding pipeline queue
      logger.info('Queueing embedding job (BullMQ placeholder)', { messageId: message.id });

      logger.info('Successfully uploaded and registered file message', { roomId, userId, messageId: message.id });
      return res.status(201).json(message);
    }
  } catch (error: any) {
    logger.error('Error uploading/registering file', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Generate upload signature for ImageKit (IDOR protected)
 */
export async function getUploadSignature(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const parseResult = signUploadSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ errors: parseResult.error.errors });
    }

    const { roomId } = parseResult.data;

    // IDOR Check: Verify room membership
    const membershipCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );

    if (membershipCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const authParams = ImageKitService.getAuthParams();
    return res.status(200).json(authParams);
  } catch (error: any) {
    logger.error('Error generating upload signature', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

