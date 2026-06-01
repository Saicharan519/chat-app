import { Response } from 'express';
import pool from '../config/db';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

/**
 * Get current authenticated user details
 */
export async function getMe(req: AuthenticatedRequest, res: Response) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Fetch fresh user data from DB (excluding password_hash)
    const userResult = await pool.query(
      'SELECT id, username, email, created_at FROM users WHERE id = $1 LIMIT 1',
      [user.userId]
    );

    if (!userResult.rowCount || userResult.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const dbUser = userResult.rows[0];

    return res.status(200).json({
      id: dbUser.id,
      username: dbUser.username,
      email: dbUser.email,
      createdAt: dbUser.created_at,
    });
  } catch (error: any) {
    logger.error('Error fetching current user details', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Search users by username (excluding the current user)
 */
export async function searchUsers(req: AuthenticatedRequest, res: Response) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { q } = req.query;
    if (typeof q !== 'string' || q.trim() === '') {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const searchQuery = `%${q.trim().toLowerCase()}%`;

    // Search users by username, excluding the requester
    const searchResult = await pool.query(
      `SELECT id, username, email, created_at 
       FROM users 
       WHERE username ILIKE $1 AND id <> $2 
       ORDER BY username ASC 
       LIMIT 20`,
      [searchQuery, user.userId]
    );

    return res.status(200).json(
      searchResult.rows.map((row) => ({
        id: row.id,
        username: row.username,
        email: row.email,
        createdAt: row.created_at,
      }))
    );
  } catch (error: any) {
    logger.error('Error searching users', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
